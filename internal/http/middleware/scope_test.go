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

// With the role-name check gone, these two scopes are the only gate on account
// and role administration, so they must be granted explicitly and separately.
func TestRequireScopeGatesAdministration(t *testing.T) {
	if code := serveWithScopes(domain.ScopeUsersManage, []string{domain.ScopeUsersManage}); code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if code := serveWithScopes(domain.ScopeUsersManage, domain.DefaultTokenScopes); code != http.StatusForbidden {
		t.Fatalf("expected a default token to be rejected, got %d", code)
	}
	if code := serveWithScopes(domain.ScopeRolesManage, []string{domain.ScopeUsersManage}); code != http.StatusForbidden {
		t.Fatalf("expected users:manage not to imply roles:manage, got %d", code)
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
