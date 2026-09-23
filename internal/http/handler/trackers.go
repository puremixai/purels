package handler

import (
	"encoding/json"
	"html/template"
	"strings"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
)

// The tracker snippets the API's own pages carry, mirroring
// web/src/components/analytics-injector.tsx snippet for snippet.
//
// The duplication is deliberate and is the same bargain the two regexes make:
// Go cannot import TypeScript, and shipping a shared build artifact for five
// short strings would cost more than it saves. A change to a snippet here has
// to be made there too. The ids on the elements are part of the contract the
// browser smoke suite asserts on, so they are constants rather than anything
// derived from the stored values.
const (
	trackerGA4ID       = "purels-analytics-ga4"
	trackerGTMID       = "purels-analytics-gtm"
	trackerGoogleTagID = "purels-analytics-google-tag"
	trackerMatomoID    = "purels-analytics-matomo"
	trackerClarityID   = "purels-analytics-clarity"
)

// trackerTags returns the script elements the API's pages should carry, or
// nothing when the deployment has no tracking configured.
func (h *Handler) trackerTags() template.HTML {
	// A handler without the service is what the small gallery tests build; it
	// carries no trackers, which is also what a deployment with none looks like.
	if h.Analytics == nil {
		return ""
	}
	return trackerScripts(h.Analytics.Current())
}

// trackerScripts builds the elements from a configuration, or nothing at all
// when that configuration is not one the write path could have produced.
//
// It validates before it interpolates. The write path is the gate and this is
// the second lock on the same door: a row restored from a dump, or written by a
// build whose rules were looser, would otherwise reach a public page as script.
// Failing closed — one bad value means no trackers at all, rather than the
// others that were fine — matches parseAnalyticsConfig on the console side.
func trackerScripts(settings domain.AnalyticsSettings) template.HTML {
	if err := service.ValidateAnalyticsSettings(settings); err != nil {
		return ""
	}

	var page strings.Builder

	// GA4 and the Google tag are the same gtag.js load with a different id: a
	// "G-…" measurement id and a "GT-…" Google tag are both configured by name
	// through gtag('config', …). A GTM container is not, which is why it has
	// its own snippet.
	if settings.GA4MeasurementID != "" {
		page.WriteString(scriptElement(trackerGA4ID, gtagSnippet(settings.GA4MeasurementID)))
	}
	if settings.GTMContainerID != "" {
		page.WriteString(scriptElement(trackerGTMID, gtmSnippet(settings.GTMContainerID)))
	}
	if settings.GoogleTagID != "" {
		page.WriteString(scriptElement(trackerGoogleTagID, gtagSnippet(settings.GoogleTagID)))
	}
	if settings.MatomoURL != "" {
		page.WriteString(scriptElement(trackerMatomoID, matomoSnippet(settings.MatomoURL, settings.MatomoSiteID)))
	}
	if settings.ClarityProjectID != "" {
		page.WriteString(scriptElement(trackerClarityID, claritySnippet(settings.ClarityProjectID)))
	}

	return template.HTML(page.String())
}

// scriptElement wraps a snippet in the element the smoke suite looks for. The
// id is one of the constants above, never a stored value.
func scriptElement(id, snippet string) string {
	return `<script id="` + id + `">` + snippet + "</script>"
}

// jsString encodes a value as a JavaScript string literal.
//
// json.Marshal is the Go counterpart of the console's jsonForScript: besides
// quotes and backslashes it escapes "<", ">" and "&" to \uXXXX, and the line
// separators too, so a value containing "</script>" cannot close the element
// and everything after it cannot be parsed as HTML. The character classes
// already exclude all of those; this is the belt beside the braces.
func jsString(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		// Only an unsupported type can fail, and every caller passes a string.
		return `""`
	}
	return string(encoded)
}

// gtagSnippet sends the landing pageview through gtag's own config call, so it
// is not repeated anywhere else.
func gtagSnippet(tagID string) string {
	return "window.dataLayer=window.dataLayer||[];" +
		"function gtag(){window.dataLayer.push(arguments);}" +
		"window.gtag=gtag;" +
		"gtag('js',new Date());" +
		"gtag('config'," + jsString(tagID) + ");" +
		"(function(){var s=document.createElement('script');s.async=true;" +
		"s.src='https://www.googletagmanager.com/gtag/js?id='+" + jsString(tagID) + ";" +
		"document.head.appendChild(s);})();"
}

// gtmSnippet loads the container; its own triggers decide what is sent.
func gtmSnippet(containerID string) string {
	return "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
		"var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!=='dataLayer'?'&l='+l:'';" +
		"j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;" +
		"f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer'," +
		jsString(containerID) + ");"
}

// matomoSnippet sends the landing pageview with its own trackPageView.
func matomoSnippet(baseURL, siteID string) string {
	return "var _paq=window._paq=window._paq||[];" +
		"_paq.push(['setTrackerUrl'," + jsString(baseURL+"/matomo.php") + "]);" +
		"_paq.push(['setSiteId'," + jsString(siteID) + "]);" +
		"_paq.push(['trackPageView']);" +
		"_paq.push(['enableLinkTracking']);" +
		"(function(){var d=document,g=d.createElement('script'),s=d.getElementsByTagName('script')[0];" +
		"g.async=true;g.src=" + jsString(baseURL+"/matomo.js") + ";s.parentNode.insertBefore(g,s);})();"
}

// claritySnippet is Microsoft's own tag, with the project id substituted. It
// records session recordings and heatmaps, not just pageviews, so it is the one
// provider here that reports more than a visit.
func claritySnippet(projectID string) string {
	return "(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};" +
		"t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;" +
		"y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})" +
		"(window,document,'clarity','script'," + jsString(projectID) + ");"
}
