package handler

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
)

type testRuntimeSettingsManager struct {
	settings domain.RuntimeSettings
}

func (m *testRuntimeSettingsManager) Current() domain.RuntimeSettings { return m.settings }

func (m *testRuntimeSettingsManager) Update(_ context.Context, input domain.RuntimeSettingsInput) (domain.RuntimeSettings, error) {
	m.settings.RuntimeSettingsInput = input
	return m.settings, nil
}

func (m *testRuntimeSettingsManager) Patch(_ context.Context, patch domain.RuntimeSettingsPatch) (domain.RuntimeSettings, error) {
	input, err := patch.Apply(m.settings.RuntimeSettingsInput)
	if err != nil {
		return domain.RuntimeSettings{}, err
	}
	m.settings.RuntimeSettingsInput = input
	return m.settings, nil
}

func TestHandlerRuntimeSettingsOverrideConfig(t *testing.T) {
	h := &Handler{
		Config: config.Config{
			RegistrationEnabled: true,
			ForwardQuery:        true,
			FallbackURL:         "https://env.example/fallback",
			ShortDomains:        []string{"env.example"},
		},
		Settings: &testRuntimeSettingsManager{settings: domain.RuntimeSettings{RuntimeSettingsInput: domain.RuntimeSettingsInput{
			RegistrationEnabled: false,
			ForwardQuery:        false,
			FallbackURL:         "https://db.example/fallback",
			ShortDomains:        []string{"db.example"},
		}}},
	}

	settings := h.runtimeSettings()
	if settings.RegistrationEnabled || settings.ForwardQuery || settings.FallbackURL != "https://db.example/fallback" {
		t.Fatalf("runtime settings did not override config: %+v", settings)
	}
	if !h.isShortHost("db.example") || h.isShortHost("env.example") {
		t.Fatal("runtime short domains were not used")
	}
}

func TestShortCode(t *testing.T) {
	h := &Handler{Config: config.Config{PublicURL: "http://localhost"}}

	accepted := map[string]string{
		"abc":                       "abc",
		"  abc  ":                   "abc",
		"http://localhost/abc":      "abc",
		"http://localhost:8080/abc": "abc",
		"https://LOCALHOST/abc":     "abc",
		"http://localhost/abc/":     "abc",
	}
	for input, want := range accepted {
		got, err := h.shortCode(input)
		if err != nil {
			t.Fatalf("shortCode(%q) returned an error: %v", input, err)
		}
		if got != want {
			t.Fatalf("shortCode(%q) = %q, want %q", input, got, want)
		}
	}

	rejected := []string{
		"",
		"   ",
		"a/b",
		// A short URL for someone else's shortener must not be resolvable here.
		"https://evil.example/abc",
		"http://localhost/",
		"http://localhost/a/b",
	}
	for _, input := range rejected {
		if got, err := h.shortCode(input); err == nil {
			t.Fatalf("shortCode(%q) = %q, want an error", input, got)
		}
	}

	// A configured short domain is one of our own hosts, so a full URL on it is
	// accepted; a host that is not on the list still is not.
	multi := &Handler{Config: config.Config{PublicURL: "https://sho.rt", ShortDomains: []string{"go.example.com"}}}
	if got, err := multi.shortCode("https://go.example.com/abc"); err != nil || got != "abc" {
		t.Fatalf("shortCode on a configured short domain = %q, %v", got, err)
	}
	for _, input := range []string{"https://other.example/abc", "https://go.example.com.evil.example/abc", "https://evil.example/?u=go.example.com"} {
		if got, err := multi.shortCode(input); err == nil {
			t.Fatalf("shortCode(%q) = %q, want an error", input, got)
		}
	}
}

func TestPreviewPageEscapes(t *testing.T) {
	// Both the heading and the button's href are built by hand, so an alias or a
	// destination carrying markup must come out escaped rather than live.
	page := previewPage(`ab"c<script>`, `https://example.com/?q=<script>alert(1)</script>"`, langEnglish)
	if strings.Contains(page, "<script>") {
		t.Fatal("the preview page must not emit an unescaped value")
	}
	if !strings.Contains(page, "&lt;script&gt;") {
		t.Fatal("expected the destination to be escaped rather than dropped")
	}
	if !strings.Contains(page, "noindex") {
		t.Fatal("expected the preview page to keep search engines out")
	}
	if !strings.Contains(page, `class="purels-page"`) || !strings.Contains(page, `class="purels-destination"`) {
		t.Fatal("expected the preview page to use the redesigned layout")
	}
}

func TestPreviewPageFollowsTheRequestedLanguage(t *testing.T) {
	// The page is the one document the API renders, so it carries its own copy
	// and its own lang attribute rather than the console's.
	chinese := previewPage("abc", "https://example.com", preferredLang("zh-CN,zh;q=0.9,en;q=0.8"))
	if !strings.Contains(chinese, `<html lang="zh-CN">`) {
		t.Fatal("expected a Chinese request to get the Chinese lang attribute")
	}
	if !strings.Contains(chinese, ">继续</a>") {
		t.Fatal("expected a Chinese request to get the Chinese button")
	}

	english := previewPage("abc", "https://example.com", preferredLang("en-US,en;q=0.9"))
	if !strings.Contains(english, `<html lang="en">`) {
		t.Fatal("expected an English request to get the English lang attribute")
	}
	if !strings.Contains(english, ">Continue</a>") {
		t.Fatal("expected an English request to get the English button")
	}
}

func TestInterstitialPageEscapes(t *testing.T) {
	// The destination is interpolated twice — once as visible text and once as
	// the meta refresh target — so markup in it must come out escaped in both.
	page := interstitialPage(`ab"c<script>`, `https://example.com/?q=<script>alert(1)</script>"`, 2, langEnglish)
	if strings.Contains(page, "<script>") {
		t.Fatal("the interstitial page must not emit an unescaped value")
	}
	if !strings.Contains(page, "&lt;script&gt;") {
		t.Fatal("expected the destination to be escaped rather than dropped")
	}
	if !strings.Contains(page, "noindex") {
		t.Fatal("expected the interstitial page to keep search engines out")
	}
}

func TestInterstitialPageCarriesTheDelay(t *testing.T) {
	// The meta refresh is the whole mechanism: without the right number of
	// seconds and the destination in its content attribute, the page never
	// moves the visitor on.
	page := interstitialPage("abc", "https://example.com/landing", 7, langEnglish)
	if !strings.Contains(page, `<meta http-equiv="refresh" content="7;url=https://example.com/landing">`) {
		t.Fatalf("expected a 7 second refresh to the destination, got %q", page)
	}
	// The delay also has to reach the visitor as text, not only as an attribute.
	if !strings.Contains(page, "Redirecting in 7 seconds") {
		t.Fatal("expected the page to say how long it will hold")
	}
	if !strings.Contains(page, `class="purels-progress"`) {
		t.Fatal("expected the interstitial page to show a countdown progress track")
	}
}

func TestInterstitialPageFollowsTheRequestedLanguage(t *testing.T) {
	chinese := interstitialPage("abc", "https://example.com", 2, preferredLang("zh-CN,zh;q=0.9,en;q=0.8"))
	if !strings.Contains(chinese, `<html lang="zh-CN">`) {
		t.Fatal("expected a Chinese request to get the Chinese lang attribute")
	}
	if !strings.Contains(chinese, "2 秒后自动跳转") {
		t.Fatal("expected a Chinese request to get the Chinese wait label")
	}
	if !strings.Contains(chinese, ">继续</a>") {
		t.Fatal("expected a Chinese request to get the Chinese button")
	}

	english := interstitialPage("abc", "https://example.com", 2, preferredLang("en-US,en;q=0.9"))
	if !strings.Contains(english, `<html lang="en">`) {
		t.Fatal("expected an English request to get the English lang attribute")
	}
	if !strings.Contains(english, "Redirecting in 2 seconds") {
		t.Fatal("expected an English request to get the English wait label")
	}
}

func TestMergeQuery(t *testing.T) {
	cases := []struct {
		destination string
		rawQuery    string
		want        string
	}{
		// Nothing to forward leaves the destination untouched.
		{"https://example.com/a", "", "https://example.com/a"},
		// A destination with no query gets one.
		{"https://example.com/a", "utm_source=x", "https://example.com/a?utm_source=x"},
		// An existing query is extended rather than replaced.
		{"https://example.com/a?p=1", "utm_source=x", "https://example.com/a?p=1&utm_source=x"},
		// The query has to land before the fragment or the browser never sends it.
		{"https://example.com/a#frag", "utm_source=x", "https://example.com/a?utm_source=x#frag"},
		{"https://example.com/a?p=1#frag", "utm_source=x", "https://example.com/a?p=1&utm_source=x#frag"},
		// A trailing separator is not doubled up.
		{"https://example.com/a?", "utm_source=x", "https://example.com/a?utm_source=x"},
		{"https://example.com/a?p=1&", "utm_source=x", "https://example.com/a?p=1&utm_source=x"},
		// Multiple parameters survive intact.
		{"https://example.com/a", "a=1&b=2", "https://example.com/a?a=1&b=2"},
	}
	for _, c := range cases {
		if got := mergeQuery(c.destination, c.rawQuery); got != c.want {
			t.Fatalf("mergeQuery(%q, %q) = %q, want %q", c.destination, c.rawQuery, got, c.want)
		}
	}
}

func TestReadImportBodyRejectsOversizePayload(t *testing.T) {
	tooLarge := bytes.Repeat([]byte{'x'}, maxImportBytes+1)

	if _, err := readImportBody(bytes.NewReader(tooLarge)); !errors.Is(err, errImportTooLarge) {
		t.Fatalf("readImportBody() error = %v, want errImportTooLarge", err)
	}
}

func TestReadImportBodyAcceptsPayloadAtLimit(t *testing.T) {
	content := bytes.Repeat([]byte{'x'}, maxImportBytes)

	got, err := readImportBody(bytes.NewReader(content))
	if err != nil {
		t.Fatalf("readImportBody() returned an error at the limit: %v", err)
	}
	if len(got) != len(content) {
		t.Fatalf("readImportBody() returned %d bytes, want %d", len(got), len(content))
	}
}
