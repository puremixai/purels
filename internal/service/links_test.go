package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/purels/purels/internal/domain"
)

type testRuntimeSettings struct{ settings domain.RuntimeSettings }

func (s testRuntimeSettings) Current() domain.RuntimeSettings { return s.settings }

func TestLinkServiceUsesRuntimeSettingsOverStaticDefaults(t *testing.T) {
	service := &LinkService{
		UniqueURLs:        true,
		MaxLinksPerUser:   99,
		Denylist:          []string{"old.example"},
		ShortDomains:      []string{"old.example"},
		SequentialAliases: true,
		Settings: testRuntimeSettings{settings: domain.RuntimeSettings{RuntimeSettingsInput: domain.RuntimeSettingsInput{
			UniqueURLs:          false,
			MaxLinksPerUser:     7,
			DestinationDenylist: []string{"new.example"},
			ShortDomains:        []string{"go.example"},
			AliasMode:           "random",
		}}},
	}

	got := service.runtimeSettings()
	if got.UniqueURLs || got.MaxLinksPerUser != 7 || got.AliasMode != "random" {
		t.Fatalf("runtime settings did not override static defaults: %#v", got)
	}
	if len(got.DestinationDenylist) != 1 || got.DestinationDenylist[0] != "new.example" {
		t.Fatalf("runtime denylist = %#v", got.DestinationDenylist)
	}
}

func TestNormalizeIDs(t *testing.T) {
	first := "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
	second := "3f2504e0-4f89-11d3-9a0c-0305e82c3302"

	ids, err := normalizeIDs([]string{first, first, "  " + second + " "})
	if err != nil {
		t.Fatalf("expected valid ids: %v", err)
	}
	if len(ids) != 2 || ids[0] != first || ids[1] != second {
		t.Fatalf("expected the list de-duplicated and trimmed, got %v", ids)
	}

	for name, input := range map[string][]string{
		"empty":      {},
		"blank":      {"   "},
		"not a uuid": {"abc"},
	} {
		if _, err := normalizeIDs(input); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestParseExpiry(t *testing.T) {
	if expiresAt, err := parseExpiry(""); err != nil || expiresAt != nil {
		t.Fatalf("an empty string must clear the expiry, got %v / %v", expiresAt, err)
	}
	expiresAt, err := parseExpiry("2030-01-02T03:04:05+02:00")
	if err != nil {
		t.Fatalf("expected a valid instant: %v", err)
	}
	// The instant is kept, only its presentation is normalised to UTC.
	if want := time.Date(2030, 1, 2, 1, 4, 5, 0, time.UTC); !expiresAt.Equal(want) {
		t.Fatalf("expected %s, got %s", want, expiresAt)
	}
	if _, err := parseExpiry("2030-01-02"); err == nil {
		t.Error("a bare date must be rejected; only RFC3339 is accepted")
	}
}

func TestMatchRule(t *testing.T) {
	link := domain.Link{
		RedirectCode: 302,
		Rules: []domain.LinkRule{
			{Position: 0, MatchType: MatchUAContains, MatchValue: "iPhone", DestinationURL: "https://apps.example/ios"},
			{Position: 1, MatchType: MatchDevice, MatchValue: "mobile", DestinationURL: "https://apps.example/mobile", RedirectCode: 301},
			{Position: 2, MatchType: MatchDevice, MatchValue: "bot", DestinationURL: "https://apps.example/bot"},
		},
	}
	cases := []struct {
		name        string
		userAgent   string
		destination string
		code        int16
		matched     bool
	}{
		// The first rule in position order wins, and its value is matched
		// case-insensitively on both sides.
		{"first rule wins", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile Safari", "https://apps.example/ios", 302, true},
		// A later rule still fires when the earlier ones do not.
		{"a later rule can still fire", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit Mobile Safari", "https://apps.example/mobile", 301, true},
		// The bot rule has no code of its own, so it inherits the link's.
		{"a rule without a code inherits the link's", "curl/8.4.0", "https://apps.example/bot", 302, true},
		{"no rule fires", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari", "", 0, false},
		{"no user agent at all", "", "", 0, false},
	}
	for _, c := range cases {
		destination, code, matched := MatchRule(link, c.userAgent)
		if matched != c.matched || destination != c.destination || code != c.code {
			t.Errorf("%s: MatchRule(%q) = %q / %d / %v, want %q / %d / %v",
				c.name, c.userAgent, destination, code, matched, c.destination, c.code, c.matched)
		}
	}

	// Rules are matched in the order the store returned them, which is position
	// order. A ua_contains rule that would also fire must not jump the queue.
	reordered := domain.Link{RedirectCode: 302, Rules: []domain.LinkRule{
		{Position: 0, MatchType: MatchDevice, MatchValue: "mobile", DestinationURL: "https://apps.example/mobile"},
		{Position: 1, MatchType: MatchUAContains, MatchValue: "iphone", DestinationURL: "https://apps.example/ios"},
	}}
	if destination, _, matched := MatchRule(reordered, "Mozilla/5.0 (iPhone) AppleWebKit Mobile Safari"); !matched || destination != "https://apps.example/mobile" {
		t.Fatalf("expected the earlier device rule to win, got %q (matched=%v)", destination, matched)
	}

	// An unknown match type can only come from a row written outside the
	// application, and it must not divert anything.
	broken := domain.Link{RedirectCode: 302, Rules: []domain.LinkRule{
		{MatchType: "ua_regex", MatchValue: ".*", DestinationURL: "https://evil.example/"},
	}}
	if _, _, matched := MatchRule(broken, "anything"); matched {
		t.Fatal("an unknown match type must never fire")
	}
}

func TestNormalizeRules(t *testing.T) {
	rules, err := normalizeRules([]domain.LinkRuleInput{
		{MatchType: " ua_contains ", MatchValue: " iPhone ", DestinationURL: "https://apps.example/ios"},
		{MatchType: "device", MatchValue: "Mobile", DestinationURL: "https://apps.example/mobile", RedirectCode: 301},
	}, nil)
	if err != nil {
		t.Fatalf("expected valid rules: %v", err)
	}
	if len(rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(rules))
	}
	// Position comes from the slice index, so a caller cannot reorder rules.
	if rules[0].Position != 0 || rules[1].Position != 1 {
		t.Fatalf("expected positions 0 and 1, got %d and %d", rules[0].Position, rules[1].Position)
	}
	// The type and value are trimmed but the value keeps the caller's casing,
	// since the comparison folds both sides anyway.
	if rules[0].MatchType != MatchUAContains || rules[0].MatchValue != "iPhone" {
		t.Fatalf("got %q / %q, want a trimmed type and the value as typed", rules[0].MatchType, rules[0].MatchValue)
	}
	// A device value is folded, because it is compared for equality at match
	// time rather than case-insensitively.
	if rules[1].MatchValue != "mobile" {
		t.Fatalf("expected the device value folded to lower case, got %q", rules[1].MatchValue)
	}

	tooMany := make([]domain.LinkRuleInput, maxRulesPerLink+1)
	for i := range tooMany {
		tooMany[i] = domain.LinkRuleInput{MatchType: MatchUAContains, MatchValue: "x", DestinationURL: "https://example.com/"}
	}
	rejected := map[string][]domain.LinkRuleInput{
		"unknown match type": {{MatchType: "ua_regex", MatchValue: "x", DestinationURL: "https://example.com/"}},
		"empty match value":  {{MatchType: MatchUAContains, MatchValue: "   ", DestinationURL: "https://example.com/"}},
		"over-long value":    {{MatchType: MatchUAContains, MatchValue: strings.Repeat("a", maxRuleValueLength+1), DestinationURL: "https://example.com/"}},
		"unknown device":     {{MatchType: MatchDevice, MatchValue: "phone", DestinationURL: "https://example.com/"}},
		"bad destination":    {{MatchType: MatchUAContains, MatchValue: "x", DestinationURL: "javascript:alert(1)"}},
		"bad redirect code":  {{MatchType: MatchUAContains, MatchValue: "x", DestinationURL: "https://example.com/", RedirectCode: 307}},
		"too many rules":     tooMany,
	}
	for name, input := range rejected {
		if _, err := normalizeRules(input, nil); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestNormalizeRulesDenylist(t *testing.T) {
	// A rule destination goes through the same denylist as the link's own.
	// Without that a rule would be a way around it.
	input := []domain.LinkRuleInput{{MatchType: MatchUAContains, MatchValue: "x", DestinationURL: "https://www.bit.ly/abc"}}
	if _, err := normalizeRules(input, []string{"bit.ly"}); err == nil {
		t.Fatal("expected a denied rule destination to be rejected")
	}
	if _, err := normalizeRules(input, []string{"example.com"}); err != nil {
		t.Fatalf("expected an allowed destination to pass: %v", err)
	}
}

// TestShortURL pins where a link is shown. The domain is display only, so the
// only things that matter are the scheme, the host and the code.
func TestShortURL(t *testing.T) {
	service := &LinkService{PublicURL: "https://sho.rt", ShortDomains: []string{"go.example.com"}}

	cases := []struct {
		name string
		link domain.Link
		want string
	}{
		{"no domain uses the public host", domain.Link{Alias: "abc"}, "https://sho.rt/abc"},
		{"a configured domain replaces the host", domain.Link{Alias: "abc", Domain: "go.example.com"}, "https://go.example.com/abc"},
		// The code is path-escaped, so a value the alias pattern would reject
		// still cannot break out of the path.
		{"the code is escaped", domain.Link{Alias: "a b"}, "https://sho.rt/a%20b"},
	}
	for _, test := range cases {
		if got := service.ShortURL(test.link); got != test.want {
			t.Errorf("%s: got %q, want %q", test.name, got, test.want)
		}
	}

	// A port belongs to the default host only: the extra domains are bare host
	// names, and carrying the port over would point at a host that is not
	// serving it.
	withPort := &LinkService{PublicURL: "http://localhost:8080/", ShortDomains: []string{"sho.rt"}}
	if got := withPort.ShortURL(domain.Link{Alias: "abc"}); got != "http://localhost:8080/abc" {
		t.Errorf("default host: got %q", got)
	}
	if got := withPort.ShortURL(domain.Link{Alias: "abc", Domain: "sho.rt"}); got != "http://sho.rt/abc" {
		t.Errorf("extra domain: got %q", got)
	}
}

// TestNormalizeDomain covers the whitelist that keeps a caller from pointing a
// short_url — and therefore the QR code — at a host they do not control.
func TestNormalizeDomain(t *testing.T) {
	service := &LinkService{ShortDomains: []string{"sho.rt", "go.example.com"}}

	for _, allowed := range []string{"", "sho.rt", "GO.EXAMPLE.COM", " go.example.com "} {
		got, err := service.normalizeDomain(allowed)
		if err != nil {
			t.Errorf("%q: unexpected error %v", allowed, err)
			continue
		}
		if allowed == "" && got != "" {
			t.Errorf("an empty domain must stay empty, got %q", got)
		}
		if allowed != "" && got != strings.ToLower(strings.TrimSpace(allowed)) {
			t.Errorf("%q: got %q, want the folded host", allowed, got)
		}
	}

	for _, rejected := range []string{"evil.example", "sho.rt.evil.example", "https://sho.rt", "sho.rt:8080", "sho.rt/path"} {
		if _, err := service.normalizeDomain(rejected); err == nil {
			t.Errorf("%q: expected a rejection", rejected)
		}
	}

	// With nothing configured, only the default domain is left, and naming it
	// explicitly is still not one of the configured short domains.
	empty := &LinkService{}
	if _, err := empty.normalizeDomain("sho.rt"); err == nil {
		t.Error("expected a rejection when no short domains are configured")
	}
}

func TestInterstitialSeconds(t *testing.T) {
	// An omitted value takes the default, which is what makes the option on by
	// default rather than something every caller has to remember to ask for.
	if got, err := interstitialSeconds(nil); err != nil || got != DefaultInterstitialSeconds {
		t.Errorf("an omitted value must take the default, got %d (%v)", got, err)
	}

	// Zero is a real value here — it means redirect immediately — so it has to
	// survive as itself rather than being folded into the default.
	off := int16(0)
	if got, err := interstitialSeconds(&off); err != nil || got != 0 {
		t.Errorf("zero must mean off, got %d (%v)", got, err)
	}

	// The bounds are inclusive at the top.
	top := int16(MaxInterstitialSeconds)
	if got, err := interstitialSeconds(&top); err != nil || got != MaxInterstitialSeconds {
		t.Errorf("%d must be accepted, got %d (%v)", MaxInterstitialSeconds, got, err)
	}

	for _, rejected := range []int16{-1, MaxInterstitialSeconds + 1} {
		if _, err := interstitialSeconds(&rejected); err == nil {
			t.Errorf("%d: expected a rejection", rejected)
		}
	}
}

func TestGeneratedAliasPreservesCase(t *testing.T) {
	service := &LinkService{}
	sawUppercase := false
	for i := 0; i < 100; i++ {
		alias, err := service.nextAlias(context.Background())
		if err != nil {
			t.Fatalf("nextAlias() returned an error: %v", err)
		}
		if alias != strings.ToLower(alias) {
			sawUppercase = true
		}
	}
	if !sawUppercase {
		t.Fatal("generated aliases never contained an uppercase character")
	}
}
