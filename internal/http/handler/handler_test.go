package handler

import (
	"strings"
	"testing"

	"github.com/purels/purels/internal/config"
)

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
