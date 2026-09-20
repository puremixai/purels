package domain

import (
	"context"
	"time"
)

// RuntimeSettingsInput is the full set of deployment options that the
// administrator may change from the console. Secrets and process/infrastructure
// settings deliberately do not appear here.
type RuntimeSettingsInput struct {
	AliasMode                  string   `json:"alias_mode"`
	UniqueURLs                 bool     `json:"unique_urls"`
	RegistrationEnabled        bool     `json:"registration_enabled"`
	CountBots                  bool     `json:"count_bots"`
	ForwardQuery               bool     `json:"forward_query"`
	FallbackURL                string   `json:"fallback_url"`
	AutoPruneExpired           bool     `json:"auto_prune_expired"`
	PruneGraceSeconds          int64    `json:"prune_grace_seconds"`
	MaxLinksPerUser            int      `json:"max_links_per_user"`
	DestinationDenylist        []string `json:"destination_denylist"`
	ShortDomains               []string `json:"short_domains"`
	HealthCheckEnabled         bool     `json:"health_check_enabled"`
	HealthCheckIntervalSeconds int64    `json:"health_check_interval_seconds"`
	RateLimitEnabled           bool     `json:"rate_limit_enabled"`
	RateLimitLogin             int      `json:"rate_limit_login"`
	RateLimitAPI               int      `json:"rate_limit_api"`
	RateLimitRedirect          int      `json:"rate_limit_redirect"`
	RateLimitRegister          int      `json:"rate_limit_register"`
	RateLimit2FA               int      `json:"rate_limit_2fa"`
	RateLimitOIDC              int      `json:"rate_limit_oidc"`
}

// RuntimeSettings is the validated, persisted snapshot shared by the API and
// worker. Durations are stored as seconds so the database and JSON contract do
// not expose Go's nanosecond representation.
type RuntimeSettings struct {
	RuntimeSettingsInput
	Revision  int64     `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s RuntimeSettings) PruneGrace() time.Duration {
	return time.Duration(s.PruneGraceSeconds) * time.Second
}

func (s RuntimeSettings) HealthCheckInterval() time.Duration {
	return time.Duration(s.HealthCheckIntervalSeconds) * time.Second
}

// RuntimeSettingsReader is intentionally small so services can consume a
// live snapshot without depending on the persistence implementation.
type RuntimeSettingsReader interface {
	Current() RuntimeSettings
}

// RuntimeSettingsManager is the boundary used by the settings API: reads are
// cheap in-memory snapshots, while writes validate and persist the whole row.
type RuntimeSettingsManager interface {
	RuntimeSettingsReader
	Update(context.Context, RuntimeSettingsInput) (RuntimeSettings, error)
}
