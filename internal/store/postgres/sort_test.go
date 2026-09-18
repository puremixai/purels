package postgres

import (
	"strings"
	"testing"
)

func TestLinkSortWhitelist(t *testing.T) {
	expected := []string{"created_at_desc", "created_at_asc", "alias_asc", "alias_desc", "clicks_desc", "clicks_asc"}
	for _, key := range expected {
		if _, ok := linkSorts[key]; !ok {
			t.Fatalf("missing sort key %q", key)
		}
	}
	for key, clause := range linkSorts {
		if strings.TrimSpace(clause) == "" {
			t.Fatalf("sort %q has an empty clause", key)
		}
		if strings.ContainsAny(clause, ";") {
			t.Fatalf("sort %q contains a statement separator: %q", key, clause)
		}
	}
}

// Under DESC ordering PostgreSQL places NULLs first, so a link that has never
// been clicked would outrank a heavily clicked one. Ordering by clicks must
// therefore go through COALESCE.
func TestClickSortsGuardAgainstNulls(t *testing.T) {
	for _, key := range []string{"clicks_desc", "clicks_asc"} {
		if !strings.Contains(linkSorts[key], "COALESCE") {
			t.Fatalf("sort %q must COALESCE the click count, got %q", key, linkSorts[key])
		}
	}
}
