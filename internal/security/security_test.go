package security

import (
	"math"
	"strings"
	"testing"
)

func TestValidateAlias(t *testing.T) {
	for _, value := range []string{"abc", "A_1-test"} {
		if err := ValidateAlias(value); err != nil {
			t.Fatalf("expected valid alias %q: %v", value, err)
		}
	}
	for _, value := range []string{"ab", "admin", "bad space", "a/b"} {
		if err := ValidateAlias(value); err == nil {
			t.Fatalf("expected invalid alias %q", value)
		}
	}
}

func TestValidateDestination(t *testing.T) {
	valid := []string{"https://example.com/path", "http://example.org"}
	for _, value := range valid {
		if err := ValidateDestination(value); err != nil {
			t.Fatalf("expected valid URL %q: %v", value, err)
		}
	}
	invalid := []string{"javascript:alert(1)", "file:///tmp/a", "http://localhost/a", "https://user:pass@example.com"}
	for _, value := range invalid {
		if err := ValidateDestination(value); err == nil {
			t.Fatalf("expected invalid URL %q", value)
		}
	}
}

func TestPasswordHash(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil || !CheckPassword("correct horse battery staple", hash) {
		t.Fatalf("password hash verification failed: %v", err)
	}
	if CheckPassword("wrong", hash) {
		t.Fatal("wrong password verified")
	}
}

func TestEncodeBase36(t *testing.T) {
	cases := map[int64]string{
		0:             "0",
		1:             "1",
		9:             "9",
		10:            "a",
		35:            "z",
		36:            "10",
		1295:          "zz",
		1296:          "100",
		math.MaxInt64: "1y2p0ij32e8e7",
	}
	for value, want := range cases {
		if got := EncodeBase36(value); got != want {
			t.Fatalf("EncodeBase36(%d) = %q, want %q", value, got, want)
		}
	}
	// The sequence hands out increasing values, so codes must stay unique across
	// the range it will realistically reach. Reserved words are deliberately not
	// filtered here: value 13878 encodes to "api", and skipping it is the
	// service's job (see AliasReserved), not the encoder's.
	seen := make(map[string]struct{}, 20000)
	for value := int64(1); value <= 20000; value++ {
		code := EncodeBase36(value)
		if _, duplicate := seen[code]; duplicate {
			t.Fatalf("EncodeBase36 collided at %d (%q)", value, code)
		}
		seen[code] = struct{}{}
	}
	if EncodeBase36(13878) != "api" || !AliasReserved(EncodeBase36(13878)) {
		t.Fatal("expected 13878 to encode to the reserved word api")
	}
}

func TestAliasReserved(t *testing.T) {
	for _, alias := range []string{"api", "API", "admin", "login", "healthz", "readyz", "metrics"} {
		if !AliasReserved(alias) {
			t.Fatalf("expected %q to be reserved", alias)
		}
	}
	if AliasReserved("notreserved") {
		t.Fatal("unexpected reserved alias")
	}
}

func TestNormalizeAlias(t *testing.T) {
	cases := map[string]string{
		"AbCdE": "abcde",
		"abc":   "abc",
		"A_1-B": "a_1-b",
	}
	for input, want := range cases {
		got, err := NormalizeAlias(input)
		if err != nil {
			t.Fatalf("expected valid alias %q: %v", input, err)
		}
		if got != want {
			t.Fatalf("NormalizeAlias(%q) = %q, want %q", input, got, want)
		}
	}
	// The reserved words stay reserved in any casing, and the length and charset
	// rules still apply after folding.
	for _, input := range []string{"API", "Admin", "ab", "bad space", "a/b", "a?b"} {
		if _, err := NormalizeAlias(input); err == nil {
			t.Fatalf("expected invalid alias %q", input)
		}
	}
}

func TestIsBotUA(t *testing.T) {
	bots := []string{
		"Googlebot/2.1 (+http://www.google.com/bot.html)",
		"Mozilla/5.0 (compatible; bingbot/2.0)",
		"curl/8.4.0",
		"Wget/1.21.3",
		"python-requests/2.31.0 crawler",
		"Mozilla/5.0 (compatible; Yahoo! Slurp; spider)",
	}
	for _, ua := range bots {
		if !IsBotUA(ua) {
			t.Fatalf("expected %q to be a bot", ua)
		}
	}
	// Real browsers must not be mistaken for crawlers. The desktop UA is the one
	// the smoke suite sends, so a false positive here would silently drop it from
	// every statistic.
	humans := []string{
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile Safari",
		"",
	}
	for _, ua := range humans {
		if IsBotUA(ua) {
			t.Fatalf("did not expect %q to be a bot", ua)
		}
	}
}

func TestDeviceClass(t *testing.T) {
	cases := map[string]string{
		// An absent user agent is its own bucket rather than a desktop.
		"": "unknown",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari":          "desktop",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Safari/605":           "desktop",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile Safari": "mobile",
		"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit Mobile Safari":               "mobile",
		"Mozilla/5.0 (Linux; Android 13; SM-X700 Tablet) AppleWebKit Safari":               "tablet",
		"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit Safari":                 "tablet",
		// Bot beats everything, matching the order the breakdown's CASE uses: a
		// crawler that calls itself mobile is still a bot.
		"curl/8.4.0": "bot",
		"Googlebot/2.1 (+http://www.google.com/bot.html; Mobile)": "bot",
	}
	for ua, want := range cases {
		if got := DeviceClass(ua); got != want {
			t.Fatalf("DeviceClass(%q) = %q, want %q", ua, got, want)
		}
	}
	// Every value the classifier can return has to be a legal rule value, or a
	// "device" rule could never match that bucket.
	for _, ua := range []string{"", "curl/8.4.0", "Mozilla/5.0 (iPad) Tablet", "Mozilla/5.0 (iPhone) Mobile", "Mozilla/5.0"} {
		if class := DeviceClass(ua); !IsDeviceClass(class) {
			t.Fatalf("DeviceClass(%q) = %q, which is not an accepted rule value", ua, class)
		}
	}
	for _, value := range []string{"", "Desktop", "phone", "bots"} {
		if IsDeviceClass(value) {
			t.Fatalf("expected IsDeviceClass(%q) to be false", value)
		}
	}
}

func TestNormalizeUsername(t *testing.T) {
	cases := map[string]string{
		"alice":     "alice",
		"  Alice  ": "alice",
		"ALICE":     "alice",
		"a_1-b":     "a_1-b",
	}
	for input, want := range cases {
		got, err := NormalizeUsername(input)
		if err != nil {
			t.Fatalf("expected valid username %q: %v", input, err)
		}
		if got != want {
			t.Fatalf("NormalizeUsername(%q) = %q, want %q", input, got, want)
		}
	}
	// "Admin" normalises to "admin", which collides with the bootstrap account
	// on insert rather than being rejected here.
	for _, input := range []string{"", "ab", "a", "-abc", "_abc", "bad name", "bad/name", "admin!", strings.Repeat("a", 33)} {
		if _, err := NormalizeUsername(input); err == nil {
			t.Fatalf("expected invalid username %q", input)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	if err := ValidatePassword(strings.Repeat("a", 12)); err != nil {
		t.Fatalf("expected a 12 character password to be valid: %v", err)
	}
	for _, value := range []string{"", "short", strings.Repeat("a", 11), strings.Repeat("a", 129)} {
		if err := ValidatePassword(value); err == nil {
			t.Fatalf("expected invalid password of length %d", len(value))
		}
	}
}
