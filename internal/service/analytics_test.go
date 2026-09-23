package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/purels/purels/internal/domain"
)

// analyticsInjectionPayloads are the strings that must never survive validation.
//
// Each one is a way to escape either the JavaScript string literal the value is
// embedded in or the <script> element that literal sits inside. The values are
// interpolated into a snippet that runs on every page the deployment serves, so
// a payload that got through would be stored XSS against visitors and the
// highest-privilege accounts alike — this is the one test in the package that
// is a security boundary rather than a description of behaviour.
var analyticsInjectionPayloads = []string{
	`G-1"><script>alert(1)</script>`,
	`G-1'</script>`,
	`G-1</script><img src=x>`,
	`G-1</SCRIPT>`,
	`G-1</script >`,
	`G-1<script/>`,
	`G-1<script src=//evil>`,
	`G-1<script>`,
	`G-1<!--`,
	`G-1-->`,
	`G-1";alert(1);//`,
	`G-1\";alert(1);//`,
	`G-1%3Cscript%3E`,
	`G-1&amp;`,
	`G-1 onload=alert(1)`,
	"G-1\n<script>alert(1)</script>",
	"G-1\r\nalert(1)",
	"G-1\u2028alert(1)",
	"G-1\u2029alert(1)",
	"G-1\x00<script>",
}

// analyticsBreakout is the set of characters that can end a string literal or
// the element it lives in.
const analyticsBreakout = "<>\"'`\\\u2028\u2029"

func assertNoBreakout(t *testing.T, field, value string) {
	t.Helper()
	if strings.ContainsAny(value, analyticsBreakout) {
		t.Fatalf("%s accepted %q, which can break out of the script", field, value)
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			t.Fatalf("%s accepted %q, which carries a control character", field, value)
		}
	}
}

func TestAnalyticsValidationRefusesScriptInjection(t *testing.T) {
	for _, payload := range analyticsInjectionPayloads {
		t.Run(payload, func(t *testing.T) {
			if got, err := normalizeGA4MeasurementID(payload); err == nil {
				t.Fatalf("the GA4 field accepted %q and produced %q", payload, got)
			}
			if got, err := normalizeGTMContainerID(payload); err == nil {
				t.Fatalf("the GTM field accepted %q and produced %q", payload, got)
			}
			if got, err := normalizeGoogleTagID(payload); err == nil {
				t.Fatalf("the Google tag field accepted %q and produced %q", payload, got)
			}
			if got, err := normalizeClarityProjectID(payload); err == nil {
				t.Fatalf("the Clarity field accepted %q and produced %q", payload, got)
			}
			if got, err := normalizeMatomoSiteID(payload); err == nil {
				t.Fatalf("the Matomo site id accepted %q and produced %q", payload, got)
			}
			if got, err := normalizeMatomoURL(payload); err == nil {
				t.Fatalf("the Matomo URL accepted %q and produced %q", payload, got)
			}
		})
	}
}

// A payload smuggled into the path of an otherwise valid URL is the case the
// four-field table above cannot reach, because the URL itself is well formed.
func TestMatomoURLRefusesATagAnywhere(t *testing.T) {
	for _, payload := range []string{
		`http://matomo.example/"><script>alert(1)</script>`,
		`http://matomo.example/<script>`,
		`http://matomo.example/#<script>`,
		`http://matomo.example/?q=<script>`,
		`http://matomo.example/<img src=x onerror=alert(1)>`,
		`http://matomo.example/\u2028<script>`,
		`http://<script>/`,
		`http://matomo.example:80<script>/`,
		`javascript:alert(1)`,
		`javascript://matomo.example/`,
		`data:text/html,<script>alert(1)</script>`,
		`//matomo.example/`,
		`http://user:pass@matomo.example/`,
		`http://matomo.example/?a=1`,
		`http://matomo.example/#frag`,
		`http://matomo.example/a b`,
	} {
		if got, err := normalizeMatomoURL(payload); err == nil {
			t.Fatalf("the Matomo URL accepted %q and produced %q", payload, got)
		}
	}
}

// The property the payload list is an instance of: whatever survives validation
// is safe to interpolate. This is asserted as a property rather than as a list
// of rejected strings because it holds for any future relaxation of the
// patterns — which is exactly the change a payload list would not catch.
func TestAcceptedAnalyticsValuesAreSafeToInterpolate(t *testing.T) {
	inputs := append([]string{
		"G-ABCDE12345", "GTM-ABC1234", "GT-ABC1234", "ymutupw1dp",
		"https://matomo.example/", "http://127.0.0.1:9/",
		"https://matomo.example/sub/path", "https://matomo.example/a~b!c$d(e)f*g+h,i;j=k:l@m%n",
		"12345",
	}, analyticsInjectionPayloads...)

	for _, input := range inputs {
		if got, err := normalizeGA4MeasurementID(input); err == nil {
			assertNoBreakout(t, "the GA4 field", got)
		}
		if got, err := normalizeGTMContainerID(input); err == nil {
			assertNoBreakout(t, "the GTM field", got)
		}
		if got, err := normalizeGoogleTagID(input); err == nil {
			assertNoBreakout(t, "the Google tag field", got)
		}
		if got, err := normalizeClarityProjectID(input); err == nil {
			assertNoBreakout(t, "the Clarity field", got)
		}
		if got, err := normalizeMatomoSiteID(input); err == nil {
			assertNoBreakout(t, "the Matomo site id", got)
		}
		if got, err := normalizeMatomoURL(input); err == nil {
			assertNoBreakout(t, "the Matomo URL", got)
		}
		if got, err := normalizeMatomoURL("https://matomo.example/" + input); err == nil {
			assertNoBreakout(t, "the Matomo URL path", got)
		}
	}
}

func TestNormalizeGA4MeasurementID(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"a canonical id", "G-ABCDE12345", "G-ABCDE12345"},
		{"surrounding whitespace", "  G-ABCDE12345\t", "G-ABCDE12345"},
		{"lower case is folded up", "g-abcde12345", "G-ABCDE12345"},
		{"the shortest legal id", "G-ABCD", "G-ABCD"},
		{"the longest legal id", "G-" + strings.Repeat("9", 20), "G-" + strings.Repeat("9", 20)},
		{"empty turns it off", "", ""},
		{"whitespace alone turns it off", "   ", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeGA4MeasurementID(tc.input)
			if err != nil {
				t.Fatalf("expected %q to be accepted, got %v", tc.input, err)
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
	for _, rejected := range []string{"ABCDE12345", "UA-12345-1", "G-ABC", "G-" + strings.Repeat("A", 21), "G-ABCD-1234", "GTM-ABCD123", "GT-ABCD123"} {
		if got, err := normalizeGA4MeasurementID(rejected); err == nil {
			t.Fatalf("expected %q to be rejected, got %q", rejected, got)
		}
	}
}

func TestNormalizeGTMContainerID(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"a canonical id", "GTM-ABC1234", "GTM-ABC1234"},
		{"lower case is folded up", "gtm-abc1234", "GTM-ABC1234"},
		{"surrounding whitespace", " GTM-ABC1234 ", "GTM-ABC1234"},
		{"empty turns it off", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeGTMContainerID(tc.input)
			if err != nil {
				t.Fatalf("expected %q to be accepted, got %v", tc.input, err)
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
	for _, rejected := range []string{"GTM-ABC", "GTM-" + strings.Repeat("A", 13), "G-ABC1234", "GTMABC1234", "GTM-ABC-123", "GT-ABC1234"} {
		if got, err := normalizeGTMContainerID(rejected); err == nil {
			t.Fatalf("expected %q to be rejected, got %q", rejected, got)
		}
	}
}

// The Google tag is a separate field from the GTM container precisely because
// the two ids load through different scripts, so each must refuse the other's
// shape. GT-MK52GBMX is the id this distinction was written for.
func TestNormalizeGoogleTagID(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"the id this field exists for", "GT-MK52GBMX", "GT-MK52GBMX"},
		{"lower case is folded up", "gt-mk52gbmx", "GT-MK52GBMX"},
		{"surrounding whitespace", "  GT-MK52GBMX\t", "GT-MK52GBMX"},
		{"the shortest legal id", "GT-ABCD", "GT-ABCD"},
		{"the longest legal id", "GT-" + strings.Repeat("9", 20), "GT-" + strings.Repeat("9", 20)},
		{"empty turns it off", "", ""},
		{"whitespace alone turns it off", "   ", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeGoogleTagID(tc.input)
			if err != nil {
				t.Fatalf("expected %q to be accepted, got %v", tc.input, err)
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
	// A container id is not a Google tag id: injecting it into gtag.js would
	// ask Google for a tag that does not exist, and the console would look
	// configured while reporting nothing.
	for _, rejected := range []string{"GTM-MK52GBMX", "GT-ABC", "GT-" + strings.Repeat("A", 21), "GT-AB-CD", "GTMK52GBMX", "G-ABCDE12345"} {
		if got, err := normalizeGoogleTagID(rejected); err == nil {
			t.Fatalf("expected %q to be rejected, got %q", rejected, got)
		}
	}
}

func TestNormalizeClarityProjectID(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"the canonical shape", "ymutupw1dp", "ymutupw1dp"},
		{"upper case is folded down", "YMUTUPW1DP", "ymutupw1dp"},
		{"surrounding whitespace", " ymutupw1dp ", "ymutupw1dp"},
		{"the shortest legal id", "abc123", "abc123"},
		{"the longest legal id", strings.Repeat("a", 20), strings.Repeat("a", 20)},
		{"empty turns it off", "", ""},
		{"whitespace alone turns it off", "   ", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeClarityProjectID(tc.input)
			if err != nil {
				t.Fatalf("expected %q to be accepted, got %v", tc.input, err)
			}
			if got != tc.want {
				t.Fatalf("expected %q, got %q", tc.want, got)
			}
		})
	}
	// The id is a path segment in the tag URL, so anything that could change the
	// path is refused rather than folded.
	for _, rejected := range []string{"ymutu", strings.Repeat("a", 21), "ymutup-w1dp", "ymutup_w1dp", "ymutup/w1dp", "ymutup w1dp", "ymutup.w1dp"} {
		if got, err := normalizeClarityProjectID(rejected); err == nil {
			t.Fatalf("expected %q to be rejected, got %q", rejected, got)
		}
	}
}

// The render boundary calls this on whatever the database holds, so it has to
// accept a value the write path produced and refuse anything else.
func TestValidateAnalyticsSettings(t *testing.T) {
	// The shape Update would have stored, so the check is exercised against the
	// real form rather than against strings that happen to agree.
	stored := domain.AnalyticsSettings{
		GA4MeasurementID: "G-ABCDE12345",
		GTMContainerID:   "GTM-ABC1234",
		GoogleTagID:      "GT-MK52GBMX",
		MatomoURL:        "https://matomo.example",
		MatomoSiteID:     "7",
		ClarityProjectID: "ymutupw1dp",
	}
	if err := ValidateAnalyticsSettings(stored); err != nil {
		t.Fatalf("expected a stored configuration to validate, got %v", err)
	}
	if err := ValidateAnalyticsSettings(domain.AnalyticsSettings{}); err != nil {
		t.Fatalf("expected an empty configuration to validate, got %v", err)
	}

	// Each of these is what a hand-edited row or an older build could leave
	// behind. None may reach a page.
	for name, broken := range map[string]domain.AnalyticsSettings{
		"a lower-case GA4 id":                {GA4MeasurementID: "g-abcde12345"},
		"a Google tag in the GTM column":     {GTMContainerID: "GT-MK52GBMX"},
		"a script tag in the Clarity column": {ClarityProjectID: "ymutup</script>"},
		"an upper-case Clarity id":           {ClarityProjectID: "YMUTUPW1DP"},
		"a Matomo URL without a site id":     {MatomoURL: "https://matomo.example"},
		"a Matomo site id without a URL":     {MatomoSiteID: "7"},
		"a trailing slash on the Matomo URL": {MatomoURL: "https://matomo.example/", MatomoSiteID: "7"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateAnalyticsSettings(broken); !errors.Is(err, ErrAnalyticsInvalid) {
				t.Fatalf("expected ErrAnalyticsInvalid, got %v", err)
			}
		})
	}
}

func TestNormalizeMatomo(t *testing.T) {
	cases := []struct {
		name     string
		url      string
		site     string
		wantURL  string
		wantSite string
	}{
		{"both set", "https://matomo.example", "1", "https://matomo.example", "1"},
		{"both empty turns it off", "", "", "", ""},
		{"a trailing slash is stripped", "https://matomo.example/", "7", "https://matomo.example", "7"},
		{"several trailing slashes", "https://matomo.example///", "7", "https://matomo.example", "7"},
		{"the scheme is folded", "HTTP://matomo.example", "7", "http://matomo.example", "7"},
		{"a port is kept", "http://127.0.0.1:9/", "1", "http://127.0.0.1:9", "1"},
		{"a path is kept", "https://example.com/matomo/", "3", "https://example.com/matomo", "3"},
		{"whitespace around both", "  https://matomo.example  ", "  7  ", "https://matomo.example", "7"},
		{"a site id without a url is dropped", "", "7", "", ""},
		{"even a malformed one, once the url is gone", "", "not-a-number", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotURL, gotSite, err := normalizeMatomo(tc.url, tc.site)
			if err != nil {
				t.Fatalf("expected (%q, %q) to be accepted, got %v", tc.url, tc.site, err)
			}
			if gotURL != tc.wantURL || gotSite != tc.wantSite {
				t.Fatalf("expected (%q, %q), got (%q, %q)", tc.wantURL, tc.wantSite, gotURL, gotSite)
			}
		})
	}

	// A URL with no site id would inject a tracker that reports to nobody, so
	// unlike the reverse it is a refusal rather than a silent drop.
	if _, _, err := normalizeMatomo("https://matomo.example", ""); !errors.Is(err, ErrAnalyticsInvalid) {
		t.Fatalf("expected ErrAnalyticsInvalid for a URL without a site id, got %v", err)
	}
}

func TestNormalizeMatomoSiteID(t *testing.T) {
	for _, accepted := range []string{"1", "7", "1234567890", " 42 "} {
		if _, err := normalizeMatomoSiteID(accepted); err != nil {
			t.Fatalf("expected %q to be accepted, got %v", accepted, err)
		}
	}
	for _, rejected := range []string{"0", "-1", "1.5", "abc", "12345678901", "1 2", "1e3"} {
		if got, err := normalizeMatomoSiteID(rejected); err == nil {
			t.Fatalf("expected %q to be rejected, got %q", rejected, got)
		}
	}
}

// Every refusal has to be recognisable as bad input, because that is what turns
// it into a 400 rather than a 500 at the handler.
func TestAnalyticsRefusalsAreInvalidInput(t *testing.T) {
	if _, err := normalizeGA4MeasurementID("not-an-id"); !errors.Is(err, ErrAnalyticsInvalid) {
		t.Fatalf("expected ErrAnalyticsInvalid, got %v", err)
	}
	if _, err := normalizeGTMContainerID("not-an-id"); !errors.Is(err, ErrAnalyticsInvalid) {
		t.Fatalf("expected ErrAnalyticsInvalid, got %v", err)
	}
	if _, err := normalizeMatomoURL("not-a-url"); !errors.Is(err, ErrAnalyticsInvalid) {
		t.Fatalf("expected ErrAnalyticsInvalid, got %v", err)
	}
	if _, err := normalizeMatomoSiteID("not-a-number"); !errors.Is(err, ErrAnalyticsInvalid) {
		t.Fatalf("expected ErrAnalyticsInvalid, got %v", err)
	}
}
