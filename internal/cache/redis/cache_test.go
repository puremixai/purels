package redis

import "testing"

func TestLinkKeyPreservesAliasCase(t *testing.T) {
	if got := linkKey("YQqzagF7"); got != "purels:link:v3:YQqzagF7" {
		t.Fatalf("linkKey() = %q, want the case-sensitive cache key", got)
	}
}
