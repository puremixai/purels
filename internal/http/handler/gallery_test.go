package handler

import (
	"html"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func galleryElementContent(t *testing.T, page, tag, id string) string {
	t.Helper()
	pattern := `(?s)<` + regexp.QuoteMeta(tag) + `\b[^>]*\bid="` + regexp.QuoteMeta(id) + `"[^>]*>(.*?)</` + regexp.QuoteMeta(tag) + `>`
	match := regexp.MustCompile(pattern).FindStringSubmatch(page)
	if len(match) != 2 {
		t.Fatalf("missing <%s id=%q> in gallery page", tag, id)
	}
	return match[1]
}

func assertGalleryEscapes(t *testing.T, page, alias, destination string) {
	t.Helper()
	for name, value := range map[string]string{"alias": alias, "destination": destination} {
		if strings.Contains(page, value) {
			t.Fatalf("unescaped %s was emitted into the gallery document", name)
		}
		if !strings.Contains(page, html.EscapeString(value)) {
			t.Fatalf("expected the full escaped %s to remain visible", name)
		}
	}
	link := regexp.MustCompile(`<a\b[^>]*\bid="continue-link"[^>]*>`).FindString(page)
	href := regexp.MustCompile(`\bhref="([^"]*)"`).FindStringSubmatch(link)
	if len(href) != 2 {
		t.Fatal("the continue action must provide a destination URL")
	}
	// html/template normalizes characters that are unsafe inside a URL after
	// escaping the attribute. Decode percent escapes without treating '+' as a
	// query-space so this also covers the deliberately adversarial destination.
	decodedHref, err := url.PathUnescape(html.UnescapeString(href[1]))
	if err != nil || decodedHref != destination {
		t.Fatal("the continue action must retain the HTML-escaped, URL-normalized destination")
	}
	scripts := regexp.MustCompile(`(?s)<script\b[^>]*>(.*?)</script>`).FindAllStringSubmatch(page, -1)
	if len(scripts) == 0 {
		t.Fatal("the gallery requires a script to support pausing its countdown")
	}
	for _, script := range scripts {
		if strings.Contains(script[1], alias) || strings.Contains(script[1], destination) ||
			strings.Contains(script[1], html.EscapeString(alias)) || strings.Contains(script[1], html.EscapeString(destination)) {
			t.Fatal("untrusted alias and destination must not be interpolated into executable JavaScript")
		}
	}
}

func assertGalleryRefresh(t *testing.T, page string, seconds int16, destination string) {
	t.Helper()
	head := regexp.MustCompile(`(?s)<head>(.*?)</head>`).FindStringSubmatch(page)
	if len(head) != 2 {
		t.Fatal("gallery document is missing its head")
	}
	noscript := regexp.MustCompile(`(?s)<noscript\b[^>]*>(.*?)</noscript>`)
	meta := regexp.MustCompile(`<meta\b[^>]*http-equiv="refresh"[^>]*>`)
	var refreshTags []string
	for _, block := range noscript.FindAllStringSubmatch(head[1], -1) {
		refreshTags = append(refreshTags, meta.FindAllString(block[1], -1)...)
	}
	if len(refreshTags) != 1 {
		t.Fatalf("expected exactly one noscript refresh in the head, got %d", len(refreshTags))
	}
	want := `content="` + strconv.Itoa(int(seconds)) + `;url=` + html.EscapeString(destination) + `"`
	if !strings.Contains(refreshTags[0], want) {
		t.Fatal("the no-JavaScript fallback must use the configured delay and destination")
	}
	if meta.MatchString(noscript.ReplaceAllString(page, "")) {
		t.Fatal("an active meta refresh would navigate even after the JavaScript countdown was paused")
	}
}

func TestGalleryPreviewDoesNotAutoRedirect(t *testing.T) {
	page := previewPage("preview-only", "https://example.com/path?a=1&b=2#section", langEnglish)
	if !strings.Contains(page, `data-interstitial="false"`) || !strings.Contains(page, `data-seconds="0"`) {
		t.Fatal("a preview must explicitly disable the automatic countdown")
	}
	if strings.Contains(page, `http-equiv="refresh"`) {
		t.Fatal("a preview must never refresh to the destination, including without JavaScript")
	}
	link := regexp.MustCompile(`<a\b[^>]*\bid="continue-link"[^>]*>`).FindString(page)
	if !strings.Contains(link, `href="https://example.com/path?a=1&amp;b=2#section"`) {
		t.Fatal("the manual preview link must retain query parameters and the fragment")
	}
}

func TestGalleryInterstitialHTTPContract(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		t.Run(method, func(t *testing.T) {
			request := httptest.NewRequest(method, "/gallery", nil)
			request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
			response := httptest.NewRecorder()
			(&Handler{}).interstitial(response, request, "gallery", "https://example.com/path?a=1&b=2#section", 2)
			if response.Code != http.StatusOK {
				t.Fatalf("expected HTTP 200, got %d", response.Code)
			}
			for name, want := range map[string]string{
				"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
			} {
				if got := response.Header().Get(name); got != want {
					t.Fatalf("header %s = %q, want %q", name, got, want)
				}
			}
			if method == http.MethodHead {
				if response.Body.Len() != 0 {
					t.Fatal("HEAD must not render a gallery document")
				}
				return
			}
			if !strings.Contains(response.Body.String(), `<html lang="zh-CN">`) {
				t.Fatal("GET must render the gallery using the request's preferred language")
			}
		})
	}
}

func TestGalleryInterstitialCarriesConfiguredDelays(t *testing.T) {
	for _, seconds := range []int16{1, 2, 7, 60} {
		t.Run(strconv.Itoa(int(seconds)), func(t *testing.T) {
			page := interstitialPage("hold", "https://example.com/path?a=1&b=2#section", seconds, langChinese)
			if !strings.Contains(page, `data-interstitial="true"`) || !strings.Contains(page, `data-seconds="`+strconv.Itoa(int(seconds))+`"`) {
				t.Fatal("the JavaScript countdown must receive the link's configured delay")
			}
			assertGalleryRefresh(t, page, seconds, "https://example.com/path?a=1&b=2#section")
			if !strings.Contains(page, `aria-label="`+interstitialWaitLabel(langChinese, seconds)+`"`) {
				t.Fatal("the countdown requires a complete, localized accessible wait label")
			}
			if !strings.Contains(galleryElementContent(t, page, "button", "pause-button"), "停留欣赏") {
				t.Fatal("an interstitial must offer the pause action")
			}
		})
	}
}

func TestGalleryRendersOneCompleteArtworkInEachLanguage(t *testing.T) {
	if len(galleryArtworks) != 6 {
		t.Fatalf("expected the six supplied fine SVG artworks, got %d", len(galleryArtworks))
	}
	seen := make(map[string]bool)
	for index, art := range galleryArtworks {
		if art.Slug == "" || seen[art.Slug] {
			t.Fatalf("missing or duplicate artwork slug %q", art.Slug)
		}
		seen[art.Slug] = true
		for _, language := range []string{langChinese, langEnglish} {
			t.Run(art.Slug+"/"+language, func(t *testing.T) {
				page := renderGalleryPage("artwork", "https://example.com", language, false, 0, art, index)
				figures := regexp.MustCompile(`(?s)<figure\b[^>]*>(.*?)</figure>`).FindAllStringSubmatch(page, -1)
				if len(figures) != 1 {
					t.Fatalf("expected one artwork figure, got %d", len(figures))
				}
				figure := figures[0][1]
				if count := len(regexp.MustCompile(`<svg\b`).FindAllString(figure, -1)); count != 1 {
					t.Fatalf("each visit must show one inline artwork SVG, got %d", count)
				}
				if art.SVG == "" || !strings.Contains(figure, string(art.SVG)) {
					t.Fatal("the selected fine artwork must be embedded without relying on another request")
				}
				title, artist, description, medium, collection, alt := art.Title, art.Artist, art.Description, art.Medium, art.Collection, art.Alt
				if language == langEnglish {
					title, artist, description, medium, collection, alt = art.EnglishTitle, art.EnglishArtist, art.EnglishDescription, art.EnglishMedium, art.EnglishCollection, art.EnglishAlt
				}
				for _, field := range []struct{ tag, id, want string }{
					{"h1", "art-title", title}, {"span", "art-artist", artist}, {"p", "art-description", description},
					{"dd", "art-medium", medium}, {"dd", "art-collection", collection},
				} {
					if field.want == "" || strings.TrimSpace(html.UnescapeString(galleryElementContent(t, page, field.tag, field.id))) != field.want {
						t.Fatalf("selected artwork has missing or mismatched %s metadata", field.id)
					}
				}
				if alt == "" || !strings.Contains(figure, `aria-label="`+html.EscapeString(alt)+`"`) {
					t.Fatal("the artwork needs a localized accessible visual description")
				}
				if strings.Contains(page, "destination.html") || strings.Contains(page, "review-tools") {
					t.Fatal("production pages must not include prototype navigation or review controls")
				}
			})
		}
	}
}

// Browser checks consume real renderer output without adding a test-only API
// route or requiring stored links. The opt-in directory is normally under the
// ignored coverage folder, and a regular go test run writes nothing.
func TestGalleryBrowserFixtures(t *testing.T) {
	directory := os.Getenv("PURELS_GALLERY_FIXTURE_DIR")
	if directory == "" {
		t.Skip("set PURELS_GALLERY_FIXTURE_DIR to export browser fixtures")
	}
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	const alias = "gallery-browser-check"
	const destination = "http://127.0.0.1:3175/arrived?keep=1&next=two#part"
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for index, art := range galleryArtworks {
		write(art.Slug+"-zh.html", renderGalleryPage(alias, destination, langChinese, false, 0, art, index))
		write(art.Slug+"-en.html", renderGalleryPage(alias, destination, langEnglish, false, 0, art, index))
	}
	art := galleryArtworks[0]
	write("interstitial-zh.html", renderGalleryPage(alias, destination, langChinese, true, 2, art, 0))
	write("interstitial-en.html", renderGalleryPage(alias, destination, langEnglish, true, 2, art, 0))
	write("interstitial-seven.html", renderGalleryPage(alias, destination, langEnglish, true, 7, art, 0))
}
