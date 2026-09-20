package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/purels/purels/internal/domain"
)

const (
	maxRuntimeLinks       = 1_000_000
	maxRuntimeRateLimit   = 1_000_000
	maxRuntimeGrace       = int64((10 * 365 * 24 * time.Hour) / time.Second)
	maxRuntimeHealthCheck = int64((30 * 24 * time.Hour) / time.Second)
)

// RuntimeDefaults converts the existing environment-backed configuration into
// the first database row. It is only used when the row does not exist yet, so
// an operator's later edits are not overwritten on every restart.
func RuntimeDefaults(cfg Config) domain.RuntimeSettingsInput {
	input := domain.RuntimeSettingsInput{
		AliasMode:                  cfg.AliasMode,
		UniqueURLs:                 cfg.UniqueURLs,
		RegistrationEnabled:        cfg.RegistrationEnabled,
		CountBots:                  cfg.CountBots,
		ForwardQuery:               cfg.ForwardQuery,
		FallbackURL:                cfg.FallbackURL,
		AutoPruneExpired:           cfg.AutoPruneExpired,
		PruneGraceSeconds:          int64(cfg.PruneGrace / time.Second),
		MaxLinksPerUser:            cfg.MaxLinksPerUser,
		DestinationDenylist:        append([]string(nil), cfg.DestinationDenylist...),
		ShortDomains:               append([]string(nil), cfg.ShortDomains...),
		HealthCheckEnabled:         cfg.HealthCheckEnabled,
		HealthCheckIntervalSeconds: int64(cfg.HealthCheckInterval / time.Second),
		RateLimitEnabled:           cfg.RateLimitEnabled,
		RateLimitLogin:             cfg.RateLimitLogin,
		RateLimitAPI:               cfg.RateLimitAPI,
		RateLimitRedirect:          cfg.RateLimitRedirect,
		RateLimitRegister:          cfg.RateLimitRegister,
		RateLimit2FA:               cfg.RateLimit2FA,
		RateLimitOIDC:              cfg.RateLimitOIDC,
	}
	// A few older env parsers intentionally tolerated zero or negative values
	// by falling back at the point of use. Keep that deployment behaviour when
	// the first database row is seeded, while all later UI writes stay strict.
	input.AliasMode = strings.ToLower(strings.TrimSpace(input.AliasMode))
	if input.AliasMode != "random" && input.AliasMode != "sequential" {
		input.AliasMode = "random"
	}
	if input.PruneGraceSeconds < 0 {
		input.PruneGraceSeconds = 0
	}
	if input.PruneGraceSeconds > maxRuntimeGrace {
		input.PruneGraceSeconds = maxRuntimeGrace
	}
	if input.MaxLinksPerUser < 0 {
		input.MaxLinksPerUser = 0
	}
	if input.MaxLinksPerUser > maxRuntimeLinks {
		input.MaxLinksPerUser = maxRuntimeLinks
	}
	if input.HealthCheckIntervalSeconds <= 0 {
		input.HealthCheckIntervalSeconds = int64((24 * time.Hour) / time.Second)
	}
	if input.HealthCheckIntervalSeconds > maxRuntimeHealthCheck {
		input.HealthCheckIntervalSeconds = maxRuntimeHealthCheck
	}
	for _, value := range []*int{
		&input.RateLimitLogin,
		&input.RateLimitAPI,
		&input.RateLimitRedirect,
		&input.RateLimitRegister,
		&input.RateLimit2FA,
		&input.RateLimitOIDC,
	} {
		if *value < 0 {
			*value = 0
		}
		if *value > maxRuntimeRateLimit {
			*value = maxRuntimeRateLimit
		}
	}
	if parsed, err := url.Parse(input.FallbackURL); input.FallbackURL != "" && (err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https")) {
		input.FallbackURL = ""
	}
	if normalized, err := normalizeRuntimeHosts(input.ShortDomains, "short_domains"); err == nil {
		input.ShortDomains = normalized
	} else {
		input.ShortDomains = []string{}
	}
	if normalized, err := normalizeRuntimeHosts(input.DestinationDenylist, "destination_denylist"); err == nil {
		input.DestinationDenylist = normalized
	} else {
		input.DestinationDenylist = []string{}
	}
	return input
}

// NormalizeRuntimeSettings validates and canonicalizes one complete settings
// replacement before it reaches PostgreSQL. Lists are compared as host names,
// so keeping them lower-case and duplicate-free makes later lookups stable.
func NormalizeRuntimeSettings(input domain.RuntimeSettingsInput) (domain.RuntimeSettingsInput, error) {
	input.AliasMode = strings.ToLower(strings.TrimSpace(input.AliasMode))
	if input.AliasMode != "random" && input.AliasMode != "sequential" {
		return domain.RuntimeSettingsInput{}, errors.New("alias_mode must be random or sequential")
	}

	input.FallbackURL = strings.TrimSpace(input.FallbackURL)
	if input.FallbackURL != "" {
		parsed, err := url.Parse(input.FallbackURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return domain.RuntimeSettingsInput{}, errors.New("fallback_url must be an absolute http(s) URL")
		}
	}
	if input.PruneGraceSeconds < 0 || input.PruneGraceSeconds > maxRuntimeGrace {
		return domain.RuntimeSettingsInput{}, fmt.Errorf("prune_grace_seconds must be between 0 and %d", maxRuntimeGrace)
	}
	if input.HealthCheckIntervalSeconds <= 0 || input.HealthCheckIntervalSeconds > maxRuntimeHealthCheck {
		return domain.RuntimeSettingsInput{}, fmt.Errorf("health_check_interval_seconds must be between 1 and %d", maxRuntimeHealthCheck)
	}
	if input.MaxLinksPerUser < 0 || input.MaxLinksPerUser > maxRuntimeLinks {
		return domain.RuntimeSettingsInput{}, fmt.Errorf("max_links_per_user must be between 0 and %d", maxRuntimeLinks)
	}
	for name, value := range map[string]int{
		"rate_limit_login":    input.RateLimitLogin,
		"rate_limit_api":      input.RateLimitAPI,
		"rate_limit_redirect": input.RateLimitRedirect,
		"rate_limit_register": input.RateLimitRegister,
		"rate_limit_2fa":      input.RateLimit2FA,
		"rate_limit_oidc":     input.RateLimitOIDC,
	} {
		if value < 0 || value > maxRuntimeRateLimit {
			return domain.RuntimeSettingsInput{}, fmt.Errorf("%s must be between 0 and %d", name, maxRuntimeRateLimit)
		}
	}

	var err error
	if input.ShortDomains, err = normalizeRuntimeHosts(input.ShortDomains, "short_domains"); err != nil {
		return domain.RuntimeSettingsInput{}, err
	}
	if input.DestinationDenylist, err = normalizeRuntimeHosts(input.DestinationDenylist, "destination_denylist"); err != nil {
		return domain.RuntimeSettingsInput{}, err
	}
	return input, nil
}

func normalizeRuntimeHosts(values []string, field string) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, raw := range values {
		host := strings.ToLower(strings.TrimSpace(raw))
		if host == "" {
			continue
		}
		if strings.ContainsAny(host, "/:@ \t\r\n") {
			return nil, fmt.Errorf("%s must contain bare host names", field)
		}
		parsed, err := url.Parse("//" + host)
		if err != nil || parsed.Hostname() == "" || parsed.Port() != "" || parsed.Hostname() != host {
			return nil, fmt.Errorf("%s contains invalid host %q", field, raw)
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		result = append(result, host)
	}
	return result, nil
}
