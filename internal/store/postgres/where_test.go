package postgres

import (
	"strings"
	"testing"

	"github.com/purels/purels/internal/domain"
)

// ownerArg reads back the owner bind parameter, which is passed as a *string so
// that a nil value reaches PostgreSQL as NULL.
func ownerArg(t *testing.T, args []any) string {
	t.Helper()
	if len(args) == 0 {
		t.Fatal("expected at least one bind parameter")
	}
	value, ok := args[0].(*string)
	if !ok || value == nil {
		t.Fatalf("first parameter is %#v, want a non-nil *string", args[0])
	}
	return *value
}

// A regular user's list must be narrowed to their own links. This is the clause
// that makes the isolation work, so it is worth asserting directly.
func TestBuildLinkWhereScopesToOwner(t *testing.T) {
	owner := "11111111-1111-1111-1111-111111111111"
	where, args := buildLinkWhere(domain.ListFilter{OwnerID: &owner})
	if !strings.Contains(where, "l.user_id = $1") {
		t.Fatalf("expected an owner condition, got %q", where)
	}
	if got := ownerArg(t, args); got != owner {
		t.Fatalf("owner parameter = %q, want %q", got, owner)
	}
}

// An administrator has no restriction, so no condition and no parameter at all.
func TestBuildLinkWhereWithoutOwnerIsUnrestricted(t *testing.T) {
	where, args := buildLinkWhere(domain.ListFilter{})
	if strings.Contains(where, "user_id") {
		t.Fatalf("expected no owner condition, got %q", where)
	}
	if len(args) != 0 {
		t.Fatalf("expected no bind parameters, got %#v", args)
	}
}

// The owner condition is added first, so every later placeholder has to shift
// with it. Getting this wrong would silently bind a search term to a uuid.
func TestBuildLinkWhereKeepsPlaceholderOrder(t *testing.T) {
	owner := "11111111-1111-1111-1111-111111111111"
	where, args := buildLinkWhere(domain.ListFilter{OwnerID: &owner, Search: "x", Tag: "y", Status: "active"})
	if len(args) != 3 {
		t.Fatalf("expected 3 bind parameters, got %#v", args)
	}
	for _, placeholder := range []string{"l.user_id = $1", "$2", "t.name = $3"} {
		if !strings.Contains(where, placeholder) {
			t.Fatalf("expected %q in %q", placeholder, where)
		}
	}
	if args[1] != "x" || args[2] != "y" {
		t.Fatalf("unexpected parameter order: %#v", args)
	}
	if !strings.Contains(where, "l.status = 'active'") {
		t.Fatalf("expected the status filter, got %q", where)
	}
}
