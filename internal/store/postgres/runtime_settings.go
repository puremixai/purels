package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/purels/purels/internal/domain"
)

const runtimeSettingsColumns = `alias_mode, unique_urls, registration_enabled, count_bots,
	forward_query, fallback_url, auto_prune_expired, prune_grace_seconds,
	max_links_per_user, destination_denylist, short_domains, health_check_enabled,
	health_check_interval_seconds, rate_limit_enabled, rate_limit_login, rate_limit_api,
	rate_limit_redirect, rate_limit_register, rate_limit_2fa, rate_limit_oidc,
	revision, updated_at`

func scanRuntimeSettings(row rowScanner) (domain.RuntimeSettings, error) {
	var settings domain.RuntimeSettings
	err := row.Scan(
		&settings.AliasMode,
		&settings.UniqueURLs,
		&settings.RegistrationEnabled,
		&settings.CountBots,
		&settings.ForwardQuery,
		&settings.FallbackURL,
		&settings.AutoPruneExpired,
		&settings.PruneGraceSeconds,
		&settings.MaxLinksPerUser,
		&settings.DestinationDenylist,
		&settings.ShortDomains,
		&settings.HealthCheckEnabled,
		&settings.HealthCheckIntervalSeconds,
		&settings.RateLimitEnabled,
		&settings.RateLimitLogin,
		&settings.RateLimitAPI,
		&settings.RateLimitRedirect,
		&settings.RateLimitRegister,
		&settings.RateLimit2FA,
		&settings.RateLimitOIDC,
		&settings.Revision,
		&settings.UpdatedAt,
	)
	if settings.DestinationDenylist == nil {
		settings.DestinationDenylist = []string{}
	}
	if settings.ShortDomains == nil {
		settings.ShortDomains = []string{}
	}
	return settings, err
}

// EnsureRuntimeSettings creates the singleton row only when this is the first
// boot after the migration. Existing database edits always win over env values.
func (s *Store) EnsureRuntimeSettings(ctx context.Context, input domain.RuntimeSettingsInput) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO runtime_settings (
			id, `+runtimeSettingsColumns+`
		) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
			$14, $15, $16, $17, $18, $19, $20, 1, now())
		ON CONFLICT (id) DO NOTHING`,
		input.AliasMode,
		input.UniqueURLs,
		input.RegistrationEnabled,
		input.CountBots,
		input.ForwardQuery,
		input.FallbackURL,
		input.AutoPruneExpired,
		input.PruneGraceSeconds,
		input.MaxLinksPerUser,
		input.DestinationDenylist,
		input.ShortDomains,
		input.HealthCheckEnabled,
		input.HealthCheckIntervalSeconds,
		input.RateLimitEnabled,
		input.RateLimitLogin,
		input.RateLimitAPI,
		input.RateLimitRedirect,
		input.RateLimitRegister,
		input.RateLimit2FA,
		input.RateLimitOIDC,
	)
	return normalizeDBError(err)
}

func (s *Store) GetRuntimeSettings(ctx context.Context) (domain.RuntimeSettings, error) {
	settings, err := scanRuntimeSettings(s.Pool.QueryRow(ctx,
		`SELECT `+runtimeSettingsColumns+` FROM runtime_settings WHERE id=1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, ErrNotFound
	}
	return settings, err
}

// UpdateRuntimeSettings replaces the whole validated singleton and increments
// revision so API and worker snapshots can cheaply detect a change.
func (s *Store) UpdateRuntimeSettings(ctx context.Context, input domain.RuntimeSettingsInput) (domain.RuntimeSettings, error) {
	settings, err := scanRuntimeSettings(s.Pool.QueryRow(ctx, `
		UPDATE runtime_settings SET
			alias_mode=$1, unique_urls=$2, registration_enabled=$3, count_bots=$4,
			forward_query=$5, fallback_url=$6, auto_prune_expired=$7,
			prune_grace_seconds=$8, max_links_per_user=$9, destination_denylist=$10,
			short_domains=$11, health_check_enabled=$12, health_check_interval_seconds=$13,
			rate_limit_enabled=$14, rate_limit_login=$15, rate_limit_api=$16,
			rate_limit_redirect=$17, rate_limit_register=$18, rate_limit_2fa=$19,
			rate_limit_oidc=$20, revision=revision+1, updated_at=now()
		WHERE id=1
		RETURNING `+runtimeSettingsColumns,
		input.AliasMode,
		input.UniqueURLs,
		input.RegistrationEnabled,
		input.CountBots,
		input.ForwardQuery,
		input.FallbackURL,
		input.AutoPruneExpired,
		input.PruneGraceSeconds,
		input.MaxLinksPerUser,
		input.DestinationDenylist,
		input.ShortDomains,
		input.HealthCheckEnabled,
		input.HealthCheckIntervalSeconds,
		input.RateLimitEnabled,
		input.RateLimitLogin,
		input.RateLimitAPI,
		input.RateLimitRedirect,
		input.RateLimitRegister,
		input.RateLimit2FA,
		input.RateLimitOIDC,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, ErrNotFound
	}
	return settings, normalizeDBError(err)
}
