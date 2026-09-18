package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/purels/purels/internal/domain"
)

// captchaSettingsColumns is shared by the administrative and internal reads so
// their scan order cannot drift apart. The nullable values are collapsed at the
// database boundary: an unset optional value has the same meaning as empty to
// every caller.
const captchaSettingsColumns = `provider, enabled, COALESCE(site_key,''),
	(secret IS NOT NULL), COALESCE(expected_hostname,''), COALESCE(expected_action,''), updated_at`

func scanCaptchaSettings(row rowScanner) (domain.CaptchaSettings, error) {
	var settings domain.CaptchaSettings
	err := row.Scan(
		&settings.Provider, &settings.Enabled, &settings.SiteKey,
		&settings.HasSecret, &settings.ExpectedHostname, &settings.ExpectedAction,
		&settings.UpdatedAt,
	)
	return settings, err
}

// GetCaptchaSettings reads the singleton registration CAPTCHA configuration.
// The row is created by migration 000013, so a missing row means the database
// is older than this binary rather than an intentionally empty configuration.
func (s *Store) GetCaptchaSettings(ctx context.Context) (domain.CaptchaSettings, error) {
	settings, err := scanCaptchaSettings(s.Pool.QueryRow(ctx,
		`SELECT `+captchaSettingsColumns+` FROM captcha_settings WHERE id=1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, ErrNotFound
	}
	return settings, err
}

// GetPublicCaptchaSettings returns only values registration clients may see.
// The secret and its presence are intentionally omitted from this projection.
func (s *Store) GetPublicCaptchaSettings(ctx context.Context) (domain.PublicCaptchaSettings, error) {
	var settings domain.PublicCaptchaSettings
	err := s.Pool.QueryRow(ctx,
		`SELECT enabled, provider, COALESCE(site_key,'') FROM captcha_settings WHERE id=1`).Scan(
		&settings.Enabled, &settings.Provider, &settings.SiteKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, ErrNotFound
	}
	return settings, err
}

// GetCaptchaSecret returns the encrypted Turnstile secret. It is separate from
// the settings projection so no administrative read can accidentally expose a
// credential to a handler.
func (s *Store) GetCaptchaSecret(ctx context.Context) ([]byte, error) {
	var sealed []byte
	err := s.Pool.QueryRow(ctx, `SELECT secret FROM captcha_settings WHERE id=1`).Scan(&sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sealed, err
}

// UpdateCaptchaSettings replaces the public and matching fields. A nil secret
// leaves the stored ciphertext unchanged; the service uses that to implement
// the write-only secret field, where empty or omitted means "keep existing".
func (s *Store) UpdateCaptchaSettings(ctx context.Context, settings domain.CaptchaSettings, secret []byte) (domain.CaptchaSettings, error) {
	result, err := s.Pool.Exec(ctx, `
		UPDATE captcha_settings SET
			provider='turnstile', enabled=$1, site_key=$2,
			expected_hostname=$3, expected_action=$4,
			secret=CASE WHEN $5::boolean THEN $6::bytea ELSE secret END,
			updated_at=now()
		WHERE id=1`,
		settings.Enabled, nullableText(settings.SiteKey), nullableText(settings.ExpectedHostname),
		nullableText(settings.ExpectedAction), secret != nil, secret)
	if err != nil {
		return settings, normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return settings, ErrNotFound
	}
	return s.GetCaptchaSettings(ctx)
}
