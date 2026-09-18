package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/purels/purels/internal/domain"
)

// analyticsSettingsColumns is the one column list both analytics reads use, so
// the scan below cannot drift away from it.
//
// The nullable text columns are coalesced here rather than in Go: "absent" and
// "empty" mean the same thing to every reader — that provider is off — so
// collapsing them at the database boundary keeps a nullable type out of the
// service and out of the JSON the console reads.
const analyticsSettingsColumns = `COALESCE(ga4_measurement_id,''), COALESCE(gtm_container_id,''),
	COALESCE(matomo_url,''), COALESCE(matomo_site_id,''), updated_at`

// GetAnalyticsSettings reads the singleton row.
//
// The row is created by migration 000012, so a missing one means the database is
// older than the binary. That reads as ErrNotFound rather than as an empty
// configuration: reporting "nothing is configured" would hide a half-finished
// upgrade behind a plausible-looking answer.
func (s *Store) GetAnalyticsSettings(ctx context.Context) (domain.AnalyticsSettings, error) {
	var settings domain.AnalyticsSettings
	err := s.Pool.QueryRow(ctx, `SELECT `+analyticsSettingsColumns+` FROM analytics_settings WHERE id=1`).Scan(
		&settings.GA4MeasurementID, &settings.GTMContainerID,
		&settings.MatomoURL, &settings.MatomoSiteID, &settings.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, ErrNotFound
	}
	return settings, err
}

// UpdateAnalyticsSettings replaces all four values. An empty string is stored as
// NULL, which is what turns that provider off.
func (s *Store) UpdateAnalyticsSettings(ctx context.Context, settings domain.AnalyticsSettings) (domain.AnalyticsSettings, error) {
	result, err := s.Pool.Exec(ctx, `
		UPDATE analytics_settings SET
			ga4_measurement_id=$1, gtm_container_id=$2,
			matomo_url=$3, matomo_site_id=$4, updated_at=now()
		WHERE id=1`,
		nullableText(settings.GA4MeasurementID), nullableText(settings.GTMContainerID),
		nullableText(settings.MatomoURL), nullableText(settings.MatomoSiteID))
	if err != nil {
		return settings, normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return settings, ErrNotFound
	}
	// Re-read rather than RETURN the columns, so the row shape has one
	// definition and the caller gets exactly what a later read would return.
	return s.GetAnalyticsSettings(ctx)
}
