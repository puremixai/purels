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
	for _, required := range []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead, ScopeTokensManage} {
		if !seen[required] {
			t.Fatalf("AllScopes is missing %q", required)
		}
	}
}
