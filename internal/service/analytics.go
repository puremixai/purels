package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

// ErrAnalyticsInvalid marks a tracking setting the service refused. Every
// refusal reaches the client as a 400 through writeServiceError's default
// branch, and the wrapped message names the offending field so the operator can
// act on it rather than guess.
var ErrAnalyticsInvalid = errors.New("invalid analytics settings")

// The accepted formats.
//
// These are the security control, not a tidiness check: every one of these
// values is interpolated into an inline <script> that runs on every page the
// deployment serves, so a value that escaped its character class would be
// stored XSS against visitors and the highest-privilege accounts alike.
//
// web/src/lib/analytics-config.ts holds the same patterns and validates again
// before it builds that script. That second check is the render boundary
// proper, because it is the one doing the interpolating; the two must stay
// character-for-character identical, and a divergence in either direction is a
// bug. Each one names the other for that reason.
//
// Google issues two ids that look similar and load differently: a Tag Manager
// container is "GTM-…" and is fetched from gtm.js, while a Google tag is
// "GT-…" and is fetched from gtag.js. They are separate fields for exactly
// that reason — see AnalyticsSettings.
var (
	analyticsGA4Pattern       = regexp.MustCompile(`^G-[A-Z0-9]{4,20}$`)
	analyticsGTMPattern       = regexp.MustCompile(`^GTM-[A-Z0-9]{4,12}$`)
	analyticsGoogleTagPattern = regexp.MustCompile(`^GT-[A-Z0-9]{4,20}$`)
	analyticsMatomoPattern    = regexp.MustCompile(`^https?://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$`)
	analyticsSitePattern      = regexp.MustCompile(`^[1-9][0-9]{0,9}$`)
	// A Clarity project id is the short lower-case token in the tag URL, e.g.
	// "ymutupw1dp". Clarity never issues an upper-case one, so lower-casing on
	// write is safe in the same way upper-casing a Google id is.
	analyticsClarityPattern = regexp.MustCompile(`^[a-z0-9]{6,20}$`)
)

// analyticsRefreshInterval is how often a process re-reads the configuration
// it did not itself write.
//
// It exists for the case the console's own write does not cover: a second API
// replica, or a row edited outside the application. The write path publishes
// immediately, so on a single-replica deployment this ticker changes nothing —
// which is why the interval is unhurried.
const analyticsRefreshInterval = 60 * time.Second

// AnalyticsService owns the deployment's tracking configuration: the ids every
// page injects, held in the database and cached here.
type AnalyticsService struct {
	Store *postgres.Store
	// current is the snapshot the render paths read. It is an atomic pointer
	// rather than a plain field because the interstitial and preview pages are
	// public and unauthenticated: they must not take a lock, and they must not
	// query the database, on the redirect path.
	current atomic.Pointer[domain.AnalyticsSettings]
}

// Current returns the cached configuration. A process that has never read the
// row answers with the zero value, which every reader treats as "nothing is
// configured" — the same thing an empty row means.
func (s *AnalyticsService) Current() domain.AnalyticsSettings {
	current := s.current.Load()
	if current == nil {
		return domain.AnalyticsSettings{}
	}
	return *current
}

// Refresh re-reads the row and publishes it.
func (s *AnalyticsService) Refresh(ctx context.Context) error {
	settings, err := s.Store.GetAnalyticsSettings(ctx)
	if err != nil {
		return err
	}
	s.publish(settings)
	return nil
}

// Start polls the row until the context ends, so a change made by another
// process or written straight to the database reaches the render paths without
// a restart.
func (s *AnalyticsService) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(analyticsRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// A transient failure leaves the last known-good snapshot in
				// place; the next tick retries it. Serving the previous
				// configuration is better than serving none.
				_ = s.Refresh(ctx)
			}
		}
	}()
}

func (s *AnalyticsService) publish(settings domain.AnalyticsSettings) {
	s.current.Store(&settings)
}

// Get returns the current settings, read from the database rather than from the
// cache.
//
// The console's settings form is what calls this, and it is the one reader for
// which "the value I just saved" has to be certain rather than merely fresh.
// The successful read also refreshes the snapshot, so the two never disagree
// inside this process for longer than a request.
func (s *AnalyticsService) Get(ctx context.Context) (domain.AnalyticsSettings, error) {
	settings, err := s.Store.GetAnalyticsSettings(ctx)
	if err != nil {
		return settings, err
	}
	s.publish(settings)
	return settings, nil
}

// Update validates the whole configuration and stores it.
//
// Every field is replaced, including with an empty value: that is how a
// provider is turned off, and it is why the request is a PUT rather than a
// PATCH. There is no write-only field here to protect the way the OIDC client
// secret needs protecting.
func (s *AnalyticsService) Update(ctx context.Context, input domain.AnalyticsSettingsInput) (domain.AnalyticsSettings, error) {
	ga4, err := normalizeGA4MeasurementID(input.GA4MeasurementID)
	if err != nil {
		return domain.AnalyticsSettings{}, err
	}
	gtm, err := normalizeGTMContainerID(input.GTMContainerID)
	if err != nil {
		return domain.AnalyticsSettings{}, err
	}
	googleTag, err := normalizeGoogleTagID(input.GoogleTagID)
	if err != nil {
		return domain.AnalyticsSettings{}, err
	}
	matomoURL, siteID, err := normalizeMatomo(input.MatomoURL, input.MatomoSiteID)
	if err != nil {
		return domain.AnalyticsSettings{}, err
	}
	clarity, err := normalizeClarityProjectID(input.ClarityProjectID)
	if err != nil {
		return domain.AnalyticsSettings{}, err
	}

	settings, err := s.Store.UpdateAnalyticsSettings(ctx, domain.AnalyticsSettings{
		GA4MeasurementID: ga4,
		GTMContainerID:   gtm,
		GoogleTagID:      googleTag,
		MatomoURL:        matomoURL,
		MatomoSiteID:     siteID,
		ClarityProjectID: clarity,
	})
	if err != nil {
		return settings, err
	}
	s.publish(settings)
	return settings, nil
}

// ValidateAnalyticsSettings re-checks a configuration that has already been
// stored, for the render boundary to call before it interpolates anything.
//
// The write path is the gate; this is the second lock on the same door. A row
// can arrive here without passing through Update — hand-edited, restored from a
// dump, or written by a version whose rules were looser — and the Go side
// interpolates these values into HTML just as the console does. The rule is
// fail-closed, matching parseAnalyticsConfig: if any non-empty value does not
// survive normalization unchanged, the caller injects nothing at all rather
// than most of it.
func ValidateAnalyticsSettings(settings domain.AnalyticsSettings) error {
	checks := []struct {
		field     string
		stored    string
		normalize func(string) (string, error)
	}{
		{"ga4_measurement_id", settings.GA4MeasurementID, normalizeGA4MeasurementID},
		{"gtm_container_id", settings.GTMContainerID, normalizeGTMContainerID},
		{"google_tag_id", settings.GoogleTagID, normalizeGoogleTagID},
		{"clarity_project_id", settings.ClarityProjectID, normalizeClarityProjectID},
	}
	for _, check := range checks {
		normalized, err := check.normalize(check.stored)
		if err != nil {
			return err
		}
		if normalized != check.stored {
			return fmt.Errorf("%w: the stored %s is not in its normalized form", ErrAnalyticsInvalid, check.field)
		}
	}
	matomoURL, siteID, err := normalizeMatomo(settings.MatomoURL, settings.MatomoSiteID)
	if err != nil {
		return err
	}
	if matomoURL != settings.MatomoURL || siteID != settings.MatomoSiteID {
		return fmt.Errorf("%w: the stored Matomo settings are not in their normalized form", ErrAnalyticsInvalid)
	}
	return nil
}

// normalizeGA4MeasurementID accepts "G-XXXXXXXXXX", or nothing for "off".
//
// It is upper-cased before the check because Google's ids always are, and a
// lower-case paste is a common enough slip that refusing it would be pedantic.
// The console only accepts upper case, so a lower-case value written straight
// to the database is dropped at the render boundary instead of being injected —
// which is the safe direction for the two to disagree in.
func normalizeGA4MeasurementID(raw string) (string, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", nil
	}
	if !analyticsGA4Pattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: the GA4 measurement id must look like G-XXXXXXXXXX", ErrAnalyticsInvalid)
	}
	return trimmed, nil
}

// normalizeGTMContainerID accepts "GTM-XXXXXXX", or nothing for "off". It
// upper-cases for the same reason the GA4 one does.
func normalizeGTMContainerID(raw string) (string, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", nil
	}
	if !analyticsGTMPattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: the GTM container id must look like GTM-XXXXXXX", ErrAnalyticsInvalid)
	}
	return trimmed, nil
}

// normalizeGoogleTagID accepts "GT-XXXXXXXXXX", or nothing for "off".
//
// This is the id Google's own tag installer hands out, and it is not a
// container: it is loaded through gtag.js and configured by name, so it is a
// field of its own rather than something the GTM container field has to infer
// from a prefix. It upper-cases for the same reason the GA4 one does.
func normalizeGoogleTagID(raw string) (string, error) {
	trimmed := strings.ToUpper(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", nil
	}
	if !analyticsGoogleTagPattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: the Google tag id must look like GT-XXXXXXXXXX", ErrAnalyticsInvalid)
	}
	return trimmed, nil
}

// normalizeMatomoURL accepts an absolute http(s) base URL, or nothing for "off".
//
// http is allowed deliberately: a self-hosted Matomo is routinely reached over
// plain http on a private network. The cost is that a console served over https
// has the script blocked as mixed content, which surfaces as analytics quietly
// not working rather than as an error — the one failure mode here that does not
// announce itself.
func normalizeMatomoURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	// A URL scheme is case-insensitive but the pattern is not, so it is folded
	// here: pasting "HTTP://…" should not come back as a format error. Only the
	// scheme is touched — the host is left as typed, because nothing compares
	// these strings and leaving it alone keeps the stored value the one the
	// operator pasted.
	if idx := strings.Index(trimmed, "://"); idx > 0 {
		trimmed = strings.ToLower(trimmed[:idx]) + trimmed[idx:]
	}
	// Trailing slashes are stripped so the snippet's own "…/matomo.js" does not
	// come out as "…//matomo.js".
	trimmed = strings.TrimRight(trimmed, "/")
	if !analyticsMatomoPattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: the Matomo URL must be an absolute http(s) address without credentials, a query string or a fragment", ErrAnalyticsInvalid)
	}
	return trimmed, nil
}

// normalizeMatomoSiteID accepts a positive integer, or nothing for "off".
func normalizeMatomoSiteID(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	if !analyticsSitePattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: the Matomo site id must be a positive integer", ErrAnalyticsInvalid)
	}
	return trimmed, nil
}

// normalizeClarityProjectID accepts the short token from a Clarity tag URL, or
// nothing for "off".
//
// It lower-cases rather than upper-cases, because Clarity issues only lower-case
// project ids and the id is a path segment in the tag URL. Upper-casing would
// produce a URL that 404s; folding down is the direction that cannot.
func normalizeClarityProjectID(raw string) (string, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", nil
	}
	if !analyticsClarityPattern.MatchString(trimmed) {
		return "", fmt.Errorf("%w: the Clarity project id is a short lower-case token such as ymutupw1dp", ErrAnalyticsInvalid)
	}
	return trimmed, nil
}

// normalizeMatomo validates the two Matomo values together and returns what to
// store.
//
// They are resolved as a pair because the only rule that spans two fields is
// here. A site id on its own cannot produce a tracker, and clearing the URL is
// the obvious way to turn Matomo off — so in that direction the id is dropped
// rather than refused, because refusing would make clearing the field an error.
// The other direction is a real mistake: a URL with no site id would inject a
// tracker that reports to nobody.
func normalizeMatomo(rawURL, rawSiteID string) (string, string, error) {
	base, err := normalizeMatomoURL(rawURL)
	if err != nil {
		return "", "", err
	}
	// No URL means Matomo is off, and clearing this field is the obvious way to
	// turn it off — so whatever is left in the site id is dropped with it rather
	// than turning "clear the URL" into an error.
	if base == "" {
		return "", "", nil
	}
	siteID, err := normalizeMatomoSiteID(rawSiteID)
	if err != nil {
		return "", "", err
	}
	if siteID == "" {
		return "", "", fmt.Errorf("%w: a Matomo URL needs a site id", ErrAnalyticsInvalid)
	}
	return base, siteID, nil
}
