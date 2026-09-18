package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/purels/purels/internal/domain"
)

func serveWithScopes(scope string, scopes []string) int {
	handler := RequireScope(scope)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/links", nil)
	request = request.WithContext(domain.WithScopes(request.Context(), scopes))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func TestRequireScopeAllowsGrantedScope(t *testing.T) {
	if code := serveWithScopes(domain.ScopeLinksRead, []string{domain.ScopeLinksRead}); code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
}

func TestRequireScopeRejectsMissingScope(t *testing.T) {
	if code := serveWithScopes(domain.ScopeLinksWrite, []string{domain.ScopeLinksRead}); code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", code)
	}
}

func TestRequireScopeRejectsTokenWithNoScopes(t *testing.T) {
	if code := serveWithScopes(domain.ScopeLinksRead, nil); code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", code)
	}
}

func serveAsAdmin(user *domain.User) int {
	handler := RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	if user != nil {
		request = request.WithContext(domain.WithUser(request.Context(), *user))
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func TestRequireAdmin(t *testing.T) {
	if code := serveAsAdmin(&domain.User{ID: "1", Username: "admin", Role: domain.RoleAdmin}); code != http.StatusOK {
		t.Fatalf("expected an administrator to pass, got %d", code)
	}
	if code := serveAsAdmin(&domain.User{ID: "2", Username: "alice", Role: domain.RoleUser}); code != http.StatusForbidden {
		t.Fatalf("expected a regular user to be rejected, got %d", code)
	}
	// An unauthenticated request never reaches this middleware in the router,
	// but it must not be treated as an administrator if it somehow does.
	if code := serveAsAdmin(nil); code != http.StatusForbidden {
		t.Fatalf("expected an anonymous request to be rejected, got %d", code)
	}
}

func TestScopesForRole(t *testing.T) {
	if len(domain.ScopesForRole(domain.RoleAdmin)) != len(domain.AllScopes) {
		t.Fatal("an administrator must hold every scope")
	}
	userScopes := domain.ScopesForRole(domain.RoleUser)
	for _, scope := range userScopes {
		if scope == domain.ScopeAuditRead {
			t.Fatal("a regular user must not hold the audit scope")
		}
	}
	// The security page mints and revokes API tokens, so the scope that guards
	// it has to be in the regular-user set.
	found := false
	for _, scope := range userScopes {
		if scope == domain.ScopeTokensManage {
			found = true
		}
	}
	if !found {
		t.Fatal("a regular user must be able to manage their own tokens")
	}
	// An unknown role gets the narrow set rather than the wide one.
	if len(domain.ScopesForRole("")) != len(userScopes) {
		t.Fatal("an unknown role must fall back to the regular-user scopes")
	}
}

func TestRateLimiterPassesThroughWithoutCache(t *testing.T) {
	handler := RateLimiter{}.Limit("test", 1, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for i := 0; i < 5; i++ {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected pass-through on request %d, got %d", i, recorder.Code)
		}
	}
}
