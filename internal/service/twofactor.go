package service

import (
	"context"
	"encoding/base64"
	"errors"
	"net/url"
	"time"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
	qrcode "github.com/skip2/go-qrcode"
)

// ErrTwoFactorUnavailable is returned when the deployment cannot use the second
// factor at all — the master switch is off, or no encryption key is configured.
// Enrolment is refused rather than hidden, because accepting a secret the
// server cannot read back would be worse than refusing it.
var ErrTwoFactorUnavailable = errors.New("two-factor authentication is not available on this deployment")

// ErrInvalidSecondFactor covers a wrong code, an unknown challenge, an expired
// one and one that has run out of attempts. They share a message on purpose:
// telling them apart would say whether a challenge ever existed.
var ErrInvalidSecondFactor = errors.New("invalid or expired verification code")

// ErrNoEnrolment is returned when a confirmation arrives with nothing to
// confirm, which means the enrolment was already completed or never started.
var ErrNoEnrolment = errors.New("no enrolment is in progress")

const (
	// mfaAttemptLimit is how many codes one half-session accepts. Five is
	// enough for a mistyped digit and far too few to search a six-digit space.
	mfaAttemptLimit = 5
	// recoveryCodeCount is how many codes an enrolment hands out.
	recoveryCodeCount = 10
)

type TwoFactorService struct {
	Store  *postgres.Store
	Config config.Config
	// Settings carries the deployment's runtime switches, of which the second
	// factor's master switch is one. Nil falls back to the boot-time
	// configuration, for callers that have no database.
	Settings domain.RuntimeSettingsReader
	// Box holds the key the secrets are stored under. Its zero value refuses
	// every operation, which is what makes a missing key fail closed instead of
	// silently skipping the second factor.
	Box security.SecretBox
}

// available reports whether the second factor can be used at all. Both halves are
// required, and every entry point reads this: a switch turned on without a
// usable key would otherwise start challenging accounts whose secrets can no
// longer be decrypted, locking out everyone who enrolled.
func (s *TwoFactorService) available() bool {
	enabled := s.Config.TOTPEnabled
	if s.Settings != nil {
		enabled = s.Settings.Current().TOTPEnabled
	}
	return enabled && s.Config.SecretsAvailable()
}

// Status describes the second factor for one account.
func (s *TwoFactorService) Status(ctx context.Context, userID string) (domain.MFAStatus, error) {
	status := domain.MFAStatus{Available: s.available()}
	state, err := s.Store.GetMFAState(ctx, userID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return status, nil
		}
		return status, err
	}
	status.Enabled = state.Enrolled()
	status.Pending = len(state.Secret) > 0 && !status.Enabled
	remaining, err := s.Store.CountRecoveryCodes(ctx, userID)
	if err != nil {
		return status, err
	}
	status.RecoveryCodesRemaining = remaining
	return status, nil
}

// Enroll starts an enrolment: it generates a secret, stores it encrypted, and
// returns everything the authenticator app needs.
//
// The secret is written immediately and the confirmation is left empty, so the
// account is not yet protected and an abandoned enrolment is inert — an
// unconfirmed secret never takes part in a login decision.
func (s *TwoFactorService) Enroll(ctx context.Context, user domain.User) (domain.MFAEnrollment, error) {
	if !s.available() {
		return domain.MFAEnrollment{}, ErrTwoFactorUnavailable
	}
	secret, err := security.NewTOTPSecret()
	if err != nil {
		return domain.MFAEnrollment{}, err
	}
	sealed, err := s.Box.Seal([]byte(secret))
	if err != nil {
		return domain.MFAEnrollment{}, err
	}
	if err := s.Store.SetTOTPSecret(ctx, user.ID, sealed); err != nil {
		return domain.MFAEnrollment{}, err
	}
	uri := security.OTPAuthURL(s.issuer(), user.Username, secret)
	// A data URI rather than a second endpoint: one round trip, the secret
	// never reaches a URL or a proxy log, and there is no ambiguity about which
	// pending secret an image belongs to.
	png, err := qrcode.Encode(uri, qrcode.Medium, 320)
	if err != nil {
		return domain.MFAEnrollment{}, err
	}
	return domain.MFAEnrollment{
		Secret:     secret,
		OTPAuthURL: uri,
		QR:         "data:image/png;base64," + base64.StdEncoding.EncodeToString(png),
	}, nil
}

// Confirm completes an enrolment and returns the recovery codes, which are
// shown to the operator exactly once — only their hashes are kept.
func (s *TwoFactorService) Confirm(ctx context.Context, userID, code string) ([]string, error) {
	if !s.available() {
		return nil, ErrTwoFactorUnavailable
	}
	state, err := s.Store.GetMFAState(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(state.Secret) == 0 {
		return nil, ErrNoEnrolment
	}
	if !s.verifySecret(state.Secret, code) {
		return nil, ErrInvalidSecondFactor
	}
	codes, err := security.NewRecoveryCodes(recoveryCodeCount)
	if err != nil {
		return nil, err
	}
	hashes := make([][]byte, 0, len(codes))
	for _, code := range codes {
		hashes = append(hashes, security.HashBytes(security.NormalizeRecoveryCode(code)))
	}
	if err := s.Store.ConfirmTOTP(ctx, userID, hashes); err != nil {
		return nil, err
	}
	return codes, nil
}

// Disable turns the second factor off. It demands the password as well as a
// code so a stolen session cannot quietly remove it.
func (s *TwoFactorService) Disable(ctx context.Context, user domain.User, password, code string) error {
	if !s.available() {
		return ErrTwoFactorUnavailable
	}
	_, passwordHash, enabled, err := s.Store.FindUser(ctx, user.Username)
	if err != nil {
		return err
	}
	if !enabled || !security.CheckPassword(password, passwordHash) {
		return ErrInvalidCredentials
	}
	state, err := s.Store.GetMFAState(ctx, user.ID)
	if err != nil {
		return err
	}
	if !state.Enrolled() {
		return ErrNoEnrolment
	}
	if !s.verifySecret(state.Secret, code) {
		return ErrInvalidSecondFactor
	}
	return s.Store.ClearTOTP(ctx, user.ID)
}

// Reset removes another account's second factor.
//
// It is the only way back in after SECRET_ENCRYPTION_KEY is lost or changed, so it
// deliberately asks the target for nothing — the administrator acting on it
// cannot produce the code either.
func (s *TwoFactorService) Reset(ctx context.Context, userID string) error {
	return s.Store.ClearTOTP(ctx, userID)
}

// verifySecret decrypts a stored secret and checks one code against it. Every
// failure is the same "no": a key that no longer matches and a tampered row are
// indistinguishable, and neither is the caller's problem to diagnose.
func (s *TwoFactorService) verifySecret(sealed []byte, code string) bool {
	plaintext, err := s.Box.Open(sealed)
	if err != nil {
		return false
	}
	return security.VerifyTOTP(string(plaintext), code, time.Now().UTC())
}

// issuer is the name an authenticator app shows for this deployment. It comes
// from PUBLIC_URL rather than a setting of its own: the host is already what
// identifies the install, and a second name to keep in step would only be one
// more way for the two to disagree.
func (s *TwoFactorService) issuer() string {
	if parsed, err := url.Parse(s.Config.PublicURL); err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	return "Purels"
}
