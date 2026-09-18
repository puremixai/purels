package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

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
// values is interpolated into an inline <script> that runs on every console
// page, so a value that escaped its character class would be stored XSS against
// the highest-privilege accounts in the deployment.
//
// web/src/lib/analytics-config.ts holds the same four patterns and validates
// again before it builds that script. That second check is the render boundary
// proper, because it is the one doing the interpolating; the two must stay
// character-for-character identical, and a divergence in either direction is a
// bug. Each one names the other for that reason.
var (
	analyticsGA4Pattern    = regexp.MustCompile(`^G-[A-Z0-9]{4,20}$`)
	analyticsGTMPattern    = regexp.MustCompile(`^GTM-[A-Z0-9]{4,12}$`)
	analyticsMatomoPattern = regexp.MustCompile(`^https?://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$`)
	analyticsSitePattern   = regexp.MustCompile(`^[1-9][0-9]{0,9}$`)
)

// AnalyticsService owns the deployment's tracking configuration: four ids the
// console injects into its own pages.
type AnalyticsService struct {
	Store *postgres.Store
}

// Get returns the current settings.
func (s *AnalyticsService) Get(ctx context.Context) (domain.AnalyticsSettings, error) {
	return s.Store.GetAnalyticsSettings(ctx)
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
	matomoURL, siteID, err := normalizeMatomo(input.MatomoURL, input.MatomoSiteID)
	if err != nil {
		return domain.AnalyticsSettings{}, err
	}

	return s.Store.UpdateAnalyticsSettings(ctx, domain.AnalyticsSettings{
		GA4MeasurementID: ga4,
		GTMContainerID:   gtm,
		MatomoURL:        matomoURL,
		MatomoSiteID:     siteID,
	})
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
