package domain

import (
	"context"
	"testing"
)

func TestHasScope(t *testing.T) {
	ctx := WithScopes(context.Background(), []string{ScopeLinksRead, ScopeStatsRead})

	if !HasScope(ctx, ScopeLinksRead) {
		t.Fatal("expected links:read to be granted")
	}
	if !HasScope(ctx, ScopeStatsRead) {
		t.Fatal("expected stats:read to be granted")
	}
	if HasScope(ctx, ScopeLinksWrite) {
		t.Fatal("links:write must not be granted")
	}
	if HasScope(ctx, ScopeTokensManage) {
		t.Fatal("tokens:manage must not be granted")
	}
}

func TestHasScopeWithoutScopes(t *testing.T) {
	if HasScope(context.Background(), ScopeLinksRead) {
		t.Fatal("a context with no scopes must grant nothing")
	}
}

func TestAllScopesAreDistinct(t *testing.T) {
	seen := map[string]bool{}
	for _, scope := range AllScopes {
		if seen[scope] {
			t.Fatalf("duplicate scope %q", scope)
		}
		seen[scope] = true
	}
	for _, required := range []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead, ScopeTokensManage, ScopeAuditRead, ScopeUsersManage, ScopeRolesManage, ScopeOIDCManage, ScopeAnalyticsManage} {
		if !seen[required] {
			t.Fatalf("AllScopes is missing %q", required)
		}
	}
	if len(AllScopes) != len(seen) {
		t.Fatalf("AllScopes has %d entries but only %d distinct ones", len(AllScopes), len(seen))
	}
}

func TestIsKnownScope(t *testing.T) {
	for _, scope := range AllScopes {
		if !IsKnownScope(scope) {
			t.Fatalf("expected %q to be known", scope)
		}
	}
	for _, unknown := range []string{"", "links:delete", "LINKS:READ", "admin", " "} {
		if IsKnownScope(unknown) {
			t.Fatalf("expected %q to be rejected", unknown)
		}
	}
}

// The default token must not carry a capability that would let a leaked token
// escalate: minting tokens, reading the audit trail, or administering accounts.
func TestDefaultTokenScopesExcludeAdministration(t *testing.T) {
	for _, forbidden := range []string{ScopeTokensManage, ScopeAuditRead, ScopeUsersManage, ScopeRolesManage, ScopeOIDCManage, ScopeAnalyticsManage} {
		for _, granted := range DefaultTokenScopes {
			if granted == forbidden {
				t.Fatalf("DefaultTokenScopes must not include %q", forbidden)
			}
		}
	}
	for _, granted := range DefaultTokenScopes {
		if !IsKnownScope(granted) {
			t.Fatalf("DefaultTokenScopes contains the unknown scope %q", granted)
		}
	}
}

func TestOwnerIDFromContext(t *testing.T) {
	// An unrestricted account sees every link, which the store expresses as a
	// nil owner filter.
	unrestricted := WithUser(context.Background(), User{ID: "1", Username: "admin", Unrestricted: true})
	if owner := OwnerIDFromContext(unrestricted); owner != nil {
		t.Fatalf("expected no owner filter, got %q", *owner)
	}
	// A regular account is narrowed to its own links.
	regular := WithUser(context.Background(), User{ID: "2", Username: "alice"})
	owner := OwnerIDFromContext(regular)
	if owner == nil || *owner != "2" {
		t.Fatalf("expected the actor's own id, got %#v", owner)
	}
	// An unauthenticated context must not widen the query.
	if owner := OwnerIDFromContext(context.Background()); owner != nil {
		t.Fatalf("expected no owner filter without a user, got %q", *owner)
	}
}
