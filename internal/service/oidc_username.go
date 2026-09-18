package service

import (
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"

	"github.com/purels/purels/internal/security"
)

// The names an identity provider hands us are not names this application
// accepts: security.usernamePattern wants 3-32 characters of [a-z0-9_-]
// starting with a letter or a digit, while preferred_username is commonly an
// email address, an email local part may carry dots and plus signs, and a
// UUID-shaped subject is 36 characters on its own. So a name is derived rather
// than copied, and the derivation has to be total — a sign-in must not fail
// because the IdP chose an awkward name.
const (
	oidcUsernameMinLength = 3
	oidcUsernameMaxLength = 32
	// oidcUsernameSuffixes bounds the -2, -3 … search. Reaching it would take a
	// hundred accounts sharing one base name.
	oidcUsernameSuffixes = 100
	// oidcUsernameHashLength is how much of the subject digest a fallback name
	// carries. Twelve hex characters is 48 bits: enough that two subjects
	// colliding here does not happen, short enough to leave the name readable.
	oidcUsernameHashLength = 12
	// oidcUsernameFallbackPrefix starts the fallback with a letter, which the
	// pattern requires.
	oidcUsernameFallbackPrefix = "oidc-"
)

var (
	// oidcUsernameInvalidRun matches every run of characters the pattern does
	// not allow. Runs rather than single characters, so the replacement does
	// not turn one separator into several.
	oidcUsernameInvalidRun = regexp.MustCompile(`[^a-z0-9_-]+`)
	// oidcUsernameEdgeRun trims the separators a replacement can leave at
	// either end. A leading one would fail the pattern's first-character rule.
	oidcUsernameEdgeRun = regexp.MustCompile(`^[_-]+|[_-]+$`)
)

// deriveUsername produces the name a first-time external identity will be
// given, before collisions are resolved.
//
// The order is by how much the name means to a human: what the IdP says the
// person is called, then the local part of a verified address, then a digest of
// the subject — stable for one identity but meaningless, so it is the last
// resort rather than the first.
//
// email is expected to be empty unless the IdP vouched for it: an unverified
// address is a claim by the account holder, and naming an account after a claim
// invites an operator to read the name as a fact.
func deriveUsername(preferredUsername, email, subject string) string {
	for _, raw := range []string{preferredUsername, emailLocalPart(email)} {
		if candidate := cleanUsername(raw); candidate != "" {
			return candidate
		}
	}
	return oidcUsernameFallbackPrefix + subjectDigest(subject)
}

// emailLocalPart returns what precedes the @, or "" when there is no address.
func emailLocalPart(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return ""
	}
	return email[:at]
}

// cleanUsername reduces arbitrary text to something the username pattern
// accepts, or returns "" when nothing usable is left.
//
// Every run of unacceptable characters collapses to a single "-" rather than
// being dropped, so "Alice Smith" and "alice.smith" stay distinguishable
// instead of both becoming "alicesmith".
func cleanUsername(raw string) string {
	candidate := oidcUsernameInvalidRun.ReplaceAllString(strings.ToLower(raw), "-")
	candidate = oidcUsernameEdgeRun.ReplaceAllString(candidate, "")
	if len(candidate) > oidcUsernameMaxLength {
		// Only ASCII survives the replacement above, so cutting at a byte
		// boundary cannot split a character.
		candidate = oidcUsernameEdgeRun.ReplaceAllString(candidate[:oidcUsernameMaxLength], "")
	}
	if len(candidate) < oidcUsernameMinLength {
		return ""
	}
	return candidate
}

// subjectDigest is the stable, meaningless tail of a fallback name.
func subjectDigest(subject string) string {
	return hex.EncodeToString(security.HashBytes(subject))[:oidcUsernameHashLength]
}

// uniqueUsername returns candidate, or the first of candidate-2, candidate-3 …
// that isTaken reports as free.
//
// The predicate is a parameter rather than a query so the rule — which is the
// part that is easy to get wrong, and the part a test can pin down — stays
// separate from the database. It is a check and not a reservation: two sign-ins
// can pass it at the same instant, which is why the caller still has to handle
// the unique index refusing the insert.
func uniqueUsername(candidate string, isTaken func(string) bool) string {
	if !isTaken(candidate) {
		return candidate
	}
	for suffix := 2; suffix <= oidcUsernameSuffixes; suffix++ {
		if next := withUsernameSuffix(candidate, suffix); !isTaken(next) {
			return next
		}
	}
	// Unreachable short of a hundred accounts sharing one base name. Returning
	// the last candidate keeps this function total; the insert then fails on
	// the unique index, which the caller already knows how to report, rather
	// than storing an empty name.
	return withUsernameSuffix(candidate, oidcUsernameSuffixes)
}

// withUsernameSuffix appends -n, shortening the base when the result would
// exceed the pattern's limit.
func withUsernameSuffix(candidate string, suffix int) string {
	tag := "-" + strconv.Itoa(suffix)
	if len(candidate) > oidcUsernameMaxLength-len(tag) {
		candidate = oidcUsernameEdgeRun.ReplaceAllString(candidate[:oidcUsernameMaxLength-len(tag)], "")
	}
	return candidate + tag
}
