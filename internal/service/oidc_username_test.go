package service

import (
	"strings"
	"testing"

	"github.com/purels/purels/internal/security"
)

const testSubject = "4e9f1c62-8f2b-4d5a-9c31-7a0e5b6d8f24"

// The property that matters is not any single name but that the derivation is
// total: whatever the provider calls the person, the result has to be a name
// this application will accept. An identity provider is free to send anything
// at all in preferred_username, and a sign-in must not fail because of it.
func TestDeriveUsernameAlwaysProducesAValidUsername(t *testing.T) {
	cases := []struct {
		name      string
		preferred string
		email     string
	}{
		{"a plain name", "alice", ""},
		{"mixed case and a space", "Alice Smith", ""},
		{"an address as the preferred name", "alice@example.com", ""},
		{"dots and a plus tag", "alice.smith+tag", ""},
		{"a uuid", testSubject, ""},
		{"an over-long name", strings.Repeat("a", 80), ""},
		{"non-ascii", "用户名", ""},
		{"punctuation only", "!!!", ""},
		{"a leading separator", "___alice", ""},
		{"only separators", "-_-", ""},
		{"nothing at all", "", ""},
		{"one character", "a", ""},
		{"two characters", "ab", ""},
		{"an address with a one-letter local part", "", "a@example.com"},
		{"an address with no at sign", "", "example.com"},
		{"an address with a dotted local part", "", "first.last@example.com"},
		{"a full address and a uuid", "a", "first.last@example.com"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveUsername(tc.preferred, tc.email, testSubject)
			normalized, err := security.NormalizeUsername(got)
			if err != nil {
				t.Fatalf("deriveUsername(%q, %q) = %q, which is not a valid username: %v", tc.preferred, tc.email, got, err)
			}
			// Canonical form matters as well as validity: the unique index is a
			// plain one, so a name that differs only in case would be a second
			// account for the same person.
			if normalized != got {
				t.Fatalf("deriveUsername(%q, %q) = %q, which is not canonical (%q)", tc.preferred, tc.email, got, normalized)
			}
		})
	}
}

func TestDeriveUsernamePrefersWhatTheProviderSays(t *testing.T) {
	if got := deriveUsername("alice", "bob@example.com", testSubject); got != "alice" {
		t.Fatalf("a usable preferred_username should win, got %q", got)
	}
	if got := deriveUsername("", "bob@example.com", testSubject); got != "bob" {
		t.Fatalf("an absent preferred_username should fall back to the address, got %q", got)
	}
	// "a" cannot be an account name here, so the address is the next best thing
	// rather than a reason to refuse the sign-in.
	if got := deriveUsername("a", "bob@example.com", testSubject); got != "bob" {
		t.Fatalf("an unusable preferred_username should fall back to the address, got %q", got)
	}
	if got := deriveUsername("a", "", testSubject); !strings.HasPrefix(got, oidcUsernameFallbackPrefix) {
		t.Fatalf("with nothing usable the subject digest should be the name, got %q", got)
	}
}

// The fallback has to be stable, because it is the name a returning identity
// gets if its binding was ever lost, and distinct per subject so two people do
// not collide on the same meaningless name.
func TestDeriveUsernameFallbackFollowsTheSubject(t *testing.T) {
	first := deriveUsername("", "", testSubject)
	if first != deriveUsername("", "", testSubject) {
		t.Fatalf("the same subject produced two names: %q", first)
	}
	if first == deriveUsername("", "", "7b1d3f45-2c08-4e6a-8d19-5f3a9c2b6e70") {
		t.Fatalf("two subjects produced the same name: %q", first)
	}
}

func TestVerifiedEmailIgnoresAnUnverifiedAddress(t *testing.T) {
	if got := verifiedEmail(oidcClaims{Email: "alice@example.com", EmailVerified: false}); got != "" {
		t.Fatalf("an unverified address is a claim, not a fact; got %q", got)
	}
	if got := verifiedEmail(oidcClaims{Email: "alice@example.com", EmailVerified: true}); got != "alice@example.com" {
		t.Fatalf("a verified address should be used; got %q", got)
	}
}

func TestCleanUsernameCollapsesRunsOfSeparators(t *testing.T) {
	cases := map[string]string{
		"alice":                             "alice",
		"Alice":                             "alice",
		"Alice  Smith":                      "alice-smith",
		"alice.smith":                       "alice-smith",
		"alice@e.com":                       "alice-e-com",
		"__alice__":                         "alice",
		"alice!":                            "alice",
		"!alice":                            "alice",
		"alice_smith-1":                     "alice_smith-1",
		"":                                  "",
		"a":                                 "",
		"ab":                                "",
		"...":                               "",
		"用户名":                               "",
		"alice\nsmith":                      "alice-smith",
		"  alice  ":                         "alice",
		"ALICE_SMITH":                       "alice_smith",
		"a" + strings.Repeat("!", 40) + "b": "a-b",
	}
	for input, want := range cases {
		if got := cleanUsername(input); got != want {
			t.Errorf("cleanUsername(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUniqueUsernameStepsPastTakenNames(t *testing.T) {
	taken := map[string]bool{}
	isTaken := func(candidate string) bool { return taken[candidate] }

	if got := uniqueUsername("alice", isTaken); got != "alice" {
		t.Fatalf("a free name should be returned unchanged, got %q", got)
	}
	taken["alice"] = true
	if got := uniqueUsername("alice", isTaken); got != "alice-2" {
		t.Fatalf("a taken name should gain a suffix, got %q", got)
	}
	taken["alice-2"] = true
	if got := uniqueUsername("alice", isTaken); got != "alice-3" {
		t.Fatalf("the search should keep going, got %q", got)
	}
}

// The suffix is appended to a name that is already at the pattern's limit, so
// the base has to give way rather than the result growing past it.
func TestUniqueUsernameKeepsTheResultWithinTheLimit(t *testing.T) {
	base := strings.Repeat("a", oidcUsernameMaxLength)
	got := uniqueUsername(base, func(candidate string) bool { return candidate == base })
	if len(got) > oidcUsernameMaxLength {
		t.Fatalf("uniqueUsername produced %d characters: %q", len(got), got)
	}
	if _, err := security.NormalizeUsername(got); err != nil {
		t.Fatalf("uniqueUsername produced an invalid name %q: %v", got, err)
	}
	if !strings.HasSuffix(got, "-2") {
		t.Fatalf("the suffix should survive the truncation, got %q", got)
	}
}

// The bound is unreachable short of a hundred accounts sharing one base name,
// but the function still has to return a usable name rather than an empty one:
// an empty string would be inserted as an account name and accepted by the
// column, which has no length constraint.
func TestUniqueUsernameStaysTotalWhenEverythingIsTaken(t *testing.T) {
	got := uniqueUsername("alice", func(string) bool { return true })
	if _, err := security.NormalizeUsername(got); err != nil {
		t.Fatalf("uniqueUsername produced an unusable name %q: %v", got, err)
	}
}
