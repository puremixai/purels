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

type AuthService struct {
	Store  *postgres.Store
	Config config.Config
	// Hasher turns the caller's address into the digest stored on the session.
	// Its zero value is the default mode, so an unconfigured service still
	// records one.
	Hasher security.IPHasher
}

type LoginResult struct {
	User         domain.User
	SessionToken string
	CSRFToken    string
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
		return LoginResult{}, errors.New("invalid credentials")
	}
	return a.createSession(ctx, user, userAgent, ip)
}

// Register creates a regular account and signs it in, so a new user lands in
// the console instead of being sent back to the login form. The role is always
// the plain user role: administrator accounts only ever come from the bootstrap
// step or from an existing administrator promoting someone.
func (a *AuthService) Register(ctx context.Context, username, password, userAgent, ip string) (LoginResult, error) {
	normalized, err := security.NormalizeUsername(username)
	if err != nil {
		return LoginResult{}, err
	}
	if err := security.ValidatePassword(password); err != nil {
		return LoginResult{}, err
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
