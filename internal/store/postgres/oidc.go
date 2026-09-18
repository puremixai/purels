package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/purels/purels/internal/domain"
)

// oidcProviderColumns is the one column list every provider read uses, so the
// scan order below cannot drift away from it. The identity count is a correlated
// subquery rather than a join: the table is tiny, and a join would need a GROUP
// BY over every other column.
//
// client_secret is never selected. The console only needs to know whether one
// exists, and HasSecret is that fact without the credential.
const oidcProviderColumns = `p.id, p.slug, p.display_name, p.issuer, p.client_id,
	(p.client_secret IS NOT NULL), p.scopes, p.auto_provision, p.enabled,
	(SELECT COUNT(*) FROM oidc_identities i WHERE i.provider_id = p.id),
	p.created_at, p.updated_at`

// rowScanner is the part of pgx.Row and pgx.Rows that reading a provider needs,
// so List and Get share one scan function.
type rowScanner interface{ Scan(dest ...any) error }

func scanOIDCProvider(row rowScanner) (domain.OIDCProvider, error) {
	var provider domain.OIDCProvider
	var rawScopes []byte
	err := row.Scan(
		&provider.ID, &provider.Slug, &provider.DisplayName, &provider.Issuer,
		&provider.ClientID, &provider.HasSecret, &rawScopes,
		&provider.AutoProvision, &provider.Enabled, &provider.IdentityCount,
		&provider.CreatedAt, &provider.UpdatedAt,
	)
	if err != nil {
		return provider, err
	}
	provider.Scopes = parseScopes(rawScopes)
	return provider, nil
}

// ListOIDCProviders returns every configured provider, ordered by slug so the
// console list and the sign-in buttons show the same order.
func (s *Store) ListOIDCProviders(ctx context.Context) ([]domain.OIDCProvider, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+oidcProviderColumns+` FROM oidc_providers p ORDER BY p.slug ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := make([]domain.OIDCProvider, 0)
	for rows.Next() {
		provider, err := scanOIDCProvider(rows)
		if err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return providers, rows.Err()
}

// GetOIDCProvider returns one provider by id.
func (s *Store) GetOIDCProvider(ctx context.Context, id string) (domain.OIDCProvider, error) {
	provider, err := scanOIDCProvider(s.Pool.QueryRow(ctx, `SELECT `+oidcProviderColumns+` FROM oidc_providers p WHERE p.id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return provider, ErrNotFound
	}
	return provider, err
}

// ListPublicOIDCProviders returns what an unauthenticated visitor may see:
// the enabled providers' slug and label, and nothing else. Issuer and client id
// describe the deployment's internals and the login page has no use for them.
func (s *Store) ListPublicOIDCProviders(ctx context.Context) ([]domain.PublicProvider, error) {
	rows, err := s.Pool.Query(ctx, `SELECT slug, display_name FROM oidc_providers WHERE enabled ORDER BY slug ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := make([]domain.PublicProvider, 0)
	for rows.Next() {
		var provider domain.PublicProvider
		if err := rows.Scan(&provider.Slug, &provider.DisplayName); err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return providers, rows.Err()
}

// CreateOIDCProvider stores a new provider and returns it as the console will
// read it back.
//
// secret is the encrypted client secret, or nil for a public client that
// authenticates with PKCE alone — a legitimate configuration, not an error.
func (s *Store) CreateOIDCProvider(ctx context.Context, provider domain.OIDCProvider, secret []byte) (domain.OIDCProvider, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO oidc_providers (slug, display_name, issuer, client_id, client_secret, scopes, auto_provision, enabled)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id`,
		provider.Slug, provider.DisplayName, provider.Issuer, provider.ClientID,
		secret, provider.Scopes, provider.AutoProvision, provider.Enabled).Scan(&id)
	if err != nil {
		// A duplicate slug arrives as 23505 and becomes ErrConflict; the service
		// turns that into a 409 rather than a server fault.
		return provider, normalizeDBError(err)
	}
	// Re-read rather than RETURN the columns: the identity count is a subquery
	// over another table, and re-reading keeps one definition of the row shape.
	return s.GetOIDCProvider(ctx, id)
}

// UpdateOIDCProvider replaces a provider's editable fields.
//
// The slug is not among them: it is part of the callback URL registered at the
// IdP, so changing it would silently invalidate that registration.
//
// secret nil means "leave the stored one alone". That is the whole reason the
// CASE is there — an edit that does not restate the secret must not clear it,
// because clearing it breaks every sign-in through the provider and the console
// gives no hint that it happened.
func (s *Store) UpdateOIDCProvider(ctx context.Context, provider domain.OIDCProvider, secret []byte) (domain.OIDCProvider, error) {
	result, err := s.Pool.Exec(ctx, `
		UPDATE oidc_providers SET
			display_name=$2, issuer=$3, client_id=$4, scopes=$5,
			auto_provision=$6, enabled=$7, updated_at=now(),
			client_secret = CASE WHEN $8::boolean THEN $9::bytea ELSE client_secret END
		WHERE id=$1`,
		provider.ID, provider.DisplayName, provider.Issuer, provider.ClientID,
		provider.Scopes, provider.AutoProvision, provider.Enabled, secret != nil, secret)
	if err != nil {
		return provider, normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return provider, ErrNotFound
	}
	// A concurrent delete between the two statements reads as ErrNotFound, which
	// is the same answer the console would have got a moment later anyway.
	return s.GetOIDCProvider(ctx, provider.ID)
}

// DeleteOIDCProvider removes a provider. Identity bindings cascade with it,
// which strands the accounts it provisioned: they keep a password hash no
// password can match, and there is no screen that would set a new one. The
// console shows how many accounts that is before asking to confirm.
func (s *Store) DeleteOIDCProvider(ctx context.Context, id string) error {
	result, err := s.Pool.Exec(ctx, `DELETE FROM oidc_providers WHERE id=$1`, id)
	if err != nil {
		return normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
