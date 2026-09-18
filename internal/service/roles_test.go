package service

import (
	"reflect"
	"testing"

	"github.com/purels/purels/internal/domain"
)

func TestNormalizeRoleScopesSortsAndDeduplicates(t *testing.T) {
	scopes, err := normalizeRoleScopes([]string{domain.ScopeStatsRead, domain.ScopeLinksRead, domain.ScopeStatsRead})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{domain.ScopeLinksRead, domain.ScopeStatsRead}
	if !reflect.DeepEqual(scopes, want) {
		t.Fatalf("expected %#v, got %#v", want, scopes)
	}
}

// A role with no permissions is legitimate — it is how an operator parks an
// account — so an empty submission must not be rejected.
func TestNormalizeRoleScopesAllowsEmpty(t *testing.T) {
	scopes, err := normalizeRoleScopes(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scopes) != 0 {
		t.Fatalf("expected no scopes, got %#v", scopes)
	}
	if scopes == nil {
		t.Fatal("expected an empty slice rather than nil, so the jsonb column stores []")
	}
}

func TestNormalizeRoleScopesRejectsUnknown(t *testing.T) {
	for _, unknown := range []string{"", "links:delete", "LINKS:READ", "admin"} {
		t.Run(unknown, func(t *testing.T) {
			if _, err := normalizeRoleScopes([]string{domain.ScopeLinksRead, unknown}); err == nil {
				t.Fatalf("expected %q to be rejected", unknown)
			}
		})
	}
}

func TestNormalizeRoleScopesAcceptsEveryKnownScope(t *testing.T) {
	scopes, err := normalizeRoleScopes(domain.AllScopes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scopes) != len(domain.AllScopes) {
		t.Fatalf("expected %d scopes, got %d", len(domain.AllScopes), len(scopes))
	}
}
