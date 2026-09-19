package middleware

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
)

type Auth struct{ Store *postgres.Store }

func (a Auth) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		if len(authorization) > 7 && strings.EqualFold(authorization[:7], "Bearer ") {
			bearer := strings.TrimSpace(authorization[7:])
			if user, scopes, ok, err := a.Store.AuthenticateToken(r.Context(), security.HashBytes(bearer)); err == nil && ok {
				ctx := domain.WithUser(r.Context(), user)
				ctx = domain.WithScopes(ctx, scopes)
				ctx = domain.WithClientIP(ctx, ClientIP(r))
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}
		cookie, err := r.Cookie("purels_session")
		if err != nil {
			writeJSONError(w, http.StatusUnauthorized, domain.CodeUnauthorized, "unauthorized")
			return
		}
		session, ok, err := a.Store.GetSession(r.Context(), security.HashBytes(cookie.Value))
		if err != nil {
			// A lookup failure is a server fault, not a bad credential. Reporting 401
			// here would make the browser discard a perfectly valid session.
			slog.Error("session lookup failed", "path", r.URL.Path, "err", err)
			writeJSONError(w, http.StatusInternalServerError, domain.CodeInternalError, "could not verify session")
			return
		}
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, domain.CodeUnauthorized, "unauthorized")
			return
		}
		ctx := domain.WithUser(r.Context(), session.User)
		ctx = domain.WithSession(ctx, session)
		// Interactive sessions are not scope-limited by a token, but they are
		// still bounded by the scopes their role grants.
		ctx = domain.WithScopes(ctx, session.User.Scopes)
		ctx = domain.WithClientIP(ctx, ClientIP(r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireScope rejects API tokens that do not carry the given scope.
// Interactive sessions hold the scopes of their role, so this constrains both.
func RequireScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !domain.HasScope(r.Context(), scope) {
				writeJSONError(w, http.StatusForbidden, domain.CodeInsufficientScope, "api token is missing required scope: "+scope)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (a Auth) CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := domain.SessionFromContext(r.Context()); !ok {
			// Bearer-token requests are not cookie-authenticated, so CSRF does not apply.
			next.ServeHTTP(w, r)
			return
		}
		csrfCookie, err := r.Cookie("purels_csrf")
		if err != nil || csrfCookie.Value == "" {
			writeJSONError(w, http.StatusForbidden, domain.CodeCSRFRequired, "csrf token required")
			return
		}
		session, _ := domain.SessionFromContext(r.Context())
		provided := security.HashBytes(r.Header.Get("X-CSRF-Token"))
		if subtle.ConstantTimeCompare(provided, session.CSRFHash) != 1 || subtle.ConstantTimeCompare(provided, security.HashBytes(csrfCookie.Value)) != 1 {
			writeJSONError(w, http.StatusForbidden, domain.CodeCSRFInvalid, "csrf token invalid")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// writeJSONError answers with the same envelope the handlers use, including the
// machine-readable code the console localizes on. See handler.ErrorCode for why
// the code is omitted rather than sent blank when there is none.
func writeJSONError(w http.ResponseWriter, status int, code, message string) {
	body := map[string]string{"message": message}
	if code != "" {
		body["code"] = code
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": body})
}
