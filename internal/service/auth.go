package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
)

// RegistrationCaptcha is the narrow seam the auth flow needs. Keeping it off
// CompleteLogin ensures OIDC and the second-factor handoff do not accidentally
// inherit a registration-only anti-abuse check.
type RegistrationCaptcha interface {
	VerifyRegistration(context.Context, string, string) error
}

type AuthService struct {
	Store   *postgres.Store
	Config  config.Config
	Captcha RegistrationCaptcha
	// Settings carries the deployment's runtime switches, of which the second
	// factor is one. Nil falls back to the boot-time configuration, which is what
	// unit tests that construct this service without a database rely on.
	Settings domain.RuntimeSettingsReader
	// Hasher turns the caller's address into the digest stored on the session.
	// Its zero value is the default mode, so an unconfigured service still
	// records one.
	Hasher security.IPHasher
	// Box decrypts the stored TOTP secrets. Its zero value refuses everything,
	// which is what makes a missing key fail closed rather than let a second
	// factor be skipped.
	Box security.SecretBox
}

// twoFactorEnabled reports the switch alone. It is never the whole answer: a
// caller that acts on it must also have a usable key, which SecretsAvailable
// reports. See startSecondFactor for why the two cannot be separated.
func (a *AuthService) twoFactorEnabled() bool {
	if a.Settings != nil {
		return a.Settings.Current().TOTPEnabled
	}
	return a.Config.TOTPEnabled
}

// ErrInvalidCredentials covers a wrong username, a wrong password and a disabled
// account. They share one message so the response cannot be used to discover
// which account names exist.
var ErrInvalidCredentials = errors.New("invalid credentials")

type LoginResult struct {
	User         domain.User
	SessionToken string
	CSRFToken    string
	// MFAChallenge is set instead of a session when a second factor is due.
	// When it is set the other fields are empty and the caller must not set a
	// cookie: a correct password alone has not authenticated anybody.
	MFAChallenge string
}

func (a *AuthService) Bootstrap(ctx context.Context) error {
	if len(a.Config.BootstrapPassword) < 12 {
		return errors.New("BOOTSTRAP_PASSWORD must contain at least 12 characters")
	}
	hash, err := security.HashPassword(a.Config.BootstrapPassword)
	if err != nil {
		return err
	}
	return a.Store.CreateAdminIfMissing(ctx, a.Config.BootstrapUsername, hash)
}

func (a *AuthService) Login(ctx context.Context, username, password, userAgent, ip string) (LoginResult, error) {
	// Usernames are case-insensitive; registration stores them lower-cased.
	user, passwordHash, enabled, err := a.Store.FindUser(ctx, strings.ToLower(strings.TrimSpace(username)))
	if err != nil {
		return LoginResult{}, err
	}
	if !enabled || user.Username == "" || !security.CheckPassword(password, passwordHash) {
		return LoginResult{}, ErrInvalidCredentials
	}
	return a.CompleteLogin(ctx, user, userAgent, ip)
}

// CompleteLogin finishes a sign-in for an account that has already been
// authenticated somehow.
//
// Both entries end here — the password path and OIDC — so the second-factor
// decision, the token lengths, the TTL and the client-address hash cannot drift
// apart between them. Rewriting createSession inside the OIDC path would
// eventually miss one of those, and the difference would show up in exactly the
// place that is hardest to notice: a login that works but leaves a weaker
// session behind.
//
// Register and VerifySecondFactor deliberately do not come through here. A
// registration has no second factor bound yet, and a completed second factor
// must not be asked for again.
func (a *AuthService) CompleteLogin(ctx context.Context, user domain.User, userAgent, ip string) (LoginResult, error) {
	if challenge, ok, err := a.startSecondFactor(ctx, user.ID); err != nil {
		return LoginResult{}, err
	} else if ok {
		return LoginResult{MFAChallenge: challenge}, nil
	}
	return a.createSession(ctx, user, userAgent, ip)
}

// startSecondFactor decides whether a correct password is enough.
//
// It reports false when the deployment cannot verify a code at all, even for an
// account that has one: a switch turned on without a usable key must not start
// challenging people whose secrets can no longer be decrypted, because that
// would lock out every account that ever enrolled.
func (a *AuthService) startSecondFactor(ctx context.Context, userID string) (string, bool, error) {
	if !a.twoFactorEnabled() || !a.Config.SecretsAvailable() {
		return "", false, nil
	}
	state, err := a.Store.GetMFAState(ctx, userID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	if !state.Enrolled() {
		return "", false, nil
	}
	token, err := security.RandomString(48)
	if err != nil {
		return "", false, err
	}
	expires := time.Now().UTC().Add(a.Config.TOTPChallengeTTL)
	if err := a.Store.CreateMFAChallenge(ctx, userID, security.HashBytes(token), expires); err != nil {
		return "", false, err
	}
	return token, true, nil
}

// VerifySecondFactor completes a login that was interrupted for a second
// factor. The code may be a TOTP code or one of the account's recovery codes.
//
// The challenge is claimed — one attempt spent — before the code is looked at,
// so a wrong code costs an attempt rather than being free to try.
func (a *AuthService) VerifySecondFactor(ctx context.Context, challenge, code, userAgent, ip string) (LoginResult, error) {
	challenge = strings.TrimSpace(challenge)
	if challenge == "" {
		return LoginResult{}, ErrInvalidSecondFactor
	}
	hash := security.HashBytes(challenge)
	userID, ok, err := a.Store.ClaimMFAChallenge(ctx, hash, mfaAttemptLimit)
	if err != nil {
		return LoginResult{}, err
	}
	if !ok {
		return LoginResult{}, ErrInvalidSecondFactor
	}
	state, err := a.Store.GetMFAState(ctx, userID)
	if err != nil || !state.Enrolled() {
		return LoginResult{}, ErrInvalidSecondFactor
	}
	if accepted, err := a.codeAccepted(ctx, userID, state.Secret, code); err != nil {
		return LoginResult{}, err
	} else if !accepted {
		return LoginResult{}, ErrInvalidSecondFactor
	}
	// Retire the half-session, so the same challenge cannot mint a second one.
	if err := a.Store.ConsumeMFAChallenge(ctx, hash); err != nil {
		return LoginResult{}, err
	}
	user, err := a.Store.GetUserByID(ctx, userID)
	if err != nil {
		// The account was disabled while the challenge was outstanding.
		return LoginResult{}, ErrInvalidSecondFactor
	}
	return a.createSession(ctx, user, userAgent, ip)
}

// codeAccepted tries the TOTP code first and then the recovery-code set. The
// two vocabularies cannot collide: a TOTP code is six digits and a recovery code
// is ten letters.
func (a *AuthService) codeAccepted(ctx context.Context, userID string, sealed []byte, code string) (bool, error) {
	plaintext, err := a.Box.Open(sealed)
	if err != nil {
		// A changed key or a tampered row. Not the caller's fault, but there is
		// nothing they can do about it either, and the administrator's reset is
		// the documented way out.
		return false, nil
	}
	if security.VerifyTOTP(string(plaintext), code, time.Now().UTC()) {
		return true, nil
	}
	normalized := security.NormalizeRecoveryCode(code)
	if normalized == "" {
		return false, nil
	}
	// Spending is one atomic statement, so two simultaneous submissions of the
	// same code cannot both succeed.
	return a.Store.SpendRecoveryCode(ctx, userID, security.HashBytes(normalized))
}

// Register creates a regular account and signs it in, so a new user lands in
// the console instead of being sent back to the login form. The role is always
// the plain user role: administrator accounts only ever come from the bootstrap
// step or from an existing administrator promoting someone.
func (a *AuthService) Register(ctx context.Context, username, password, captchaToken, userAgent, ip string) (LoginResult, error) {
	normalized, err := security.NormalizeUsername(username)
	if err != nil {
		return LoginResult{}, err
	}
	if err := security.ValidatePassword(password); err != nil {
		return LoginResult{}, err
	}
	if a.Captcha != nil {
		if err := a.Captcha.VerifyRegistration(ctx, captchaToken, ip); err != nil {
			return LoginResult{}, err
		}
	}
	hash, err := security.HashPassword(password)
	if err != nil {
		return LoginResult{}, err
	}
	user := domain.User{ID: postgres.NewID(), Username: normalized, Role: domain.RoleUser}
	if err := a.Store.CreateUser(ctx, user.ID, user.Username, hash, user.Role); err != nil {
		return LoginResult{}, err
	}
	return a.createSession(ctx, user, userAgent, ip)
}

// createSession mints a session for an already-verified account. Login and
// registration share it so both end with the caller signed in.
func (a *AuthService) createSession(ctx context.Context, user domain.User, userAgent, ip string) (LoginResult, error) {
	sessionToken, err := security.RandomString(48)
	if err != nil {
		return LoginResult{}, err
	}
	csrfToken, err := security.RandomString(32)
	if err != nil {
		return LoginResult{}, err
	}
	expires := time.Now().UTC().Add(a.Config.SessionTTL)
	if err := a.Store.CreateSession(ctx, user.ID, security.HashBytes(sessionToken), security.HashBytes(csrfToken), a.Hasher.Hash(ip), userAgent, expires); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{User: user, SessionToken: sessionToken, CSRFToken: csrfToken}, nil
}

func (a *AuthService) Logout(ctx context.Context, request *http.Request) error {
	cookie, err := request.Cookie("purels_session")
	if err != nil {
		return nil
	}
	return a.Store.RevokeSession(ctx, security.HashBytes(cookie.Value))
}

func ExtractBearer(request *http.Request) string {
	value := request.Header.Get("Authorization")
	if len(value) < 8 || !strings.EqualFold(value[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(value[7:])
}
