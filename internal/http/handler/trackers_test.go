package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
)

// configuredTrackers is a configuration in exactly the form the service would
// have stored, so the tests below exercise the real shape.
func configuredTrackers() domain.AnalyticsSettings {
	return domain.AnalyticsSettings{
		GA4MeasurementID: "G-ABCDE12345",
		GTMContainerID:   "GTM-ABC1234",
		GoogleTagID:      "GT-MK52GBMX",
		MatomoURL:        "https://matomo.example",
		MatomoSiteID:     "7",
		ClarityProjectID: "ymutupw1dp",
	}
}

func TestTrackerScriptsCarryEveryConfiguredProvider(t *testing.T) {
	markup := string(trackerScripts(configuredTrackers()))

	for id, want := range map[string]string{
		trackerGA4ID:       "https://www.googletagmanager.com/gtag/js?id=",
		trackerGTMID:       "https://www.googletagmanager.com/gtm.js?id=",
		trackerGoogleTagID: "https://www.googletagmanager.com/gtag/js?id=",
		trackerMatomoID:    "https://matomo.example/matomo.js",
		trackerClarityID:   "https://www.clarity.ms/tag/",
	} {
		element := galleryElementContent(t, markup, "script", id)
		if !strings.Contains(element, want) {
			t.Fatalf("%s does not load %s", id, want)
		}
	}

	// The two Google ids are the same script with a different id, and each has
	// to carry its own — that is the whole reason they are separate fields.
	ga4 := galleryElementContent(t, markup, "script", trackerGA4ID)
	if !strings.Contains(ga4, `"G-ABCDE12345"`) {
		t.Fatal("the GA4 element must configure the measurement id")
	}
	if strings.Contains(ga4, "GT-MK52GBMX") {
		t.Fatal("the GA4 element must not carry the Google tag id")
	}
	googleTag := galleryElementContent(t, markup, "script", trackerGoogleTagID)
	if !strings.Contains(googleTag, `"GT-MK52GBMX"`) {
		t.Fatal("the Google tag element must configure GT-MK52GBMX through gtag")
	}
	// A container id in gtag.js, or a tag id in gtm.js, asks Google for
	// something that does not exist: the page would look configured and report
	// nothing.
	gtm := galleryElementContent(t, markup, "script", trackerGTMID)
	if !strings.Contains(gtm, `"GTM-ABC1234"`) || strings.Contains(gtm, "GT-MK52GBMX") {
		t.Fatal("the GTM element must load the container and only the container")
	}

	clarity := galleryElementContent(t, markup, "script", trackerClarityID)
	if !strings.Contains(clarity, `"ymutupw1dp"`) {
		t.Fatal("the Clarity element must pass the project id to the tag")
	}
}

// Each provider is independently optional, and an empty field is how it is
// turned off.
func TestTrackerScriptsSkipWhatIsNotConfigured(t *testing.T) {
	if markup := trackerScripts(domain.AnalyticsSettings{}); markup != "" {
		t.Fatalf("expected no markup for an empty configuration, got %q", markup)
	}

	only := domain.AnalyticsSettings{ClarityProjectID: "ymutupw1dp"}
	markup := string(trackerScripts(only))
	if !strings.Contains(markup, trackerClarityID) {
		t.Fatal("expected the one configured provider to be injected")
	}
	for _, absent := range []string{trackerGA4ID, trackerGTMID, trackerGoogleTagID, trackerMatomoID} {
		if strings.Contains(markup, absent) {
			t.Fatalf("%s must not be injected when it is not configured", absent)
		}
	}
}

// This is the render boundary. A row that bypassed the write path — hand
// edited, restored from a dump, written by a build with looser rules — must
// produce nothing rather than produce most of it.
func TestTrackerScriptsFailClosedOnAValueTheWritePathWouldRefuse(t *testing.T) {
	for name, broken := range map[string]domain.AnalyticsSettings{
		"a script tag in the Clarity column": {ClarityProjectID: `ymutup</script>`},
		"a quote in the Google tag":          {GoogleTagID: `GT-MK52GBMX";alert(1);//`},
		"a lower-case GA4 id":                {GA4MeasurementID: "g-abcde12345"},
		"a Matomo URL without a site id":     {MatomoURL: "https://matomo.example"},
	} {
		t.Run(name, func(t *testing.T) {
			if markup := trackerScripts(broken); markup != "" {
				t.Fatalf("expected nothing to be injected, got %q", markup)
			}
		})
	}
}

// The character classes already exclude every breakout, so this is the second
// line: the encoder is what makes the result safe to hand to html/template as
// HTML even if a pattern is ever loosened.
func TestJSStringCannotCloseTheElement(t *testing.T) {
	encoded := jsString(`</script><img src=x onerror=alert(1)>`)
	for _, forbidden := range []string{"<", ">"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("jsString left %q in %q", forbidden, encoded)
		}
	}
	if !strings.Contains(encoded, `\u003c`) {
		t.Fatalf("expected the angle brackets to be escaped, got %q", encoded)
	}
	// A plain value still round-trips as a JavaScript string literal.
	if got := jsString("GT-MK52GBMX"); got != `"GT-MK52GBMX"` {
		t.Fatalf("expected a quoted literal, got %q", got)
	}
}

// The interstitial and the preview are the API's own pages, so they carry the
// same trackers the console does.
func TestGalleryPagesCarryTheTrackers(t *testing.T) {
	markup := trackerScripts(configuredTrackers())
	for name, page := range map[string]string{
		"interstitial": interstitialPage("hold", "https://example.com/", 3, langEnglish, markup),
		"preview":      previewPage("preview", "https://example.com/", langEnglish, markup),
	} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(page, trackerMatomoID) {
				t.Fatal("expected the page to carry the configured tracker")
			}
			// It has to be in the head, before the artwork is painted, or the
			// landing pageview arrives after the visitor may have left.
			head := page[:strings.Index(page, "</head>")]
			if !strings.Contains(head, trackerMatomoID) {
				t.Fatal("the tracker must be injected in the head")
			}
		})
	}
}

// A handler with no service is what the small gallery tests build; it must
// render a page rather than panic.
func TestTrackerTagsWithoutTheService(t *testing.T) {
	if markup := (&Handler{}).trackerTags(); markup != "" {
		t.Fatalf("expected no markup, got %q", markup)
	}
}

// The console's server render reads the tracking ids before anybody has signed
// in, so this route has to answer without a session. It is what makes the
// landing page, sign-in and registration carry the same trackers.
func TestPublicAnalyticsAnswersWithoutASession(t *testing.T) {
	// A zero-valued service has published nothing, which every reader treats as
	// "nothing is configured".
	h := &Handler{Analytics: &service.AnalyticsService{}}
	response := httptest.NewRecorder()
	h.PublicAnalytics(response, httptest.NewRequest(http.MethodGet, "/api/v1/analytics/public", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d", response.Code)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected the answer not to be cached downstream, got %q", got)
	}
	// The values are read off the root, not out of an envelope — the console's
	// parser reads them there, and a wrapper would silently yield nothing.
	if !strings.Contains(response.Body.String(), "ga4_measurement_id") {
		t.Fatalf("expected the settings object itself, got %s", response.Body.String())
	}
}
