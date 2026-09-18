package postgres

import (
	"context"
	"errors"
	"time"

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

// GetOIDCProviderSecret returns the encrypted client secret.
//
// It is a separate call rather than a field on OIDCProvider so the value cannot
// reach a handler by accident: the only caller is the token exchange. A provider
// with no secret is not an error — that is a public client, which authenticates
// with PKCE alone.
func (s *Store) GetOIDCProviderSecret(ctx context.Context, id string) ([]byte, error) {
	var sealed []byte
	err := s.Pool.QueryRow(ctx, `SELECT client_secret FROM oidc_providers WHERE id=$1`, id).Scan(&sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return sealed, nil
}

// GetOIDCProviderBySlug returns the enabled provider a sign-in is starting for.
//
// A disabled provider is reported as missing rather than as disabled: the start
// endpoint is reachable without a session, and it has no business telling an
// unauthenticated caller which providers exist but are switched off.
func (s *Store) GetOIDCProviderBySlug(ctx context.Context, slug string) (domain.OIDCProvider, error) {
	provider, err := scanOIDCProvider(s.Pool.QueryRow(ctx, `SELECT `+oidcProviderColumns+` FROM oidc_providers p WHERE p.slug=$1 AND p.enabled`, slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return provider, ErrNotFound
	}
	return provider, err
}

// FindOIDCIdentity returns the account a (provider, subject) pair is bound to.
//
// A miss is ErrNotFound and is not a failure: it is the ordinary state of a
// first sign-in, which is what auto-provisioning exists for.
func (s *Store) FindOIDCIdentity(ctx context.Context, providerID, subject string) (domain.OIDCIdentity, error) {
	var identity domain.OIDCIdentity
	var email *string
	err := s.Pool.QueryRow(ctx, `
		SELECT id, provider_id, user_id, subject, email, last_login_at
		FROM oidc_identities WHERE provider_id=$1 AND subject=$2`, providerID, subject).
		Scan(&identity.ID, &identity.ProviderID, &identity.UserID, &identity.Subject, &email, &identity.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity, ErrNotFound
	}
	if err != nil {
		return identity, err
	}
	if email != nil {
		identity.Email = *email
	}
	return identity, nil
}

// TouchOIDCIdentity records a successful sign-in and refreshes the stored email,
// because the IdP is the authority on it.
//
// The COALESCE is what keeps an absent or unverified address from erasing one
// that was previously verified: a provider that stops sending the claim would
// otherwise quietly blank the column, and the binding — which is what actually
// authenticated — carries no email at all.
func (s *Store) TouchOIDCIdentity(ctx context.Context, id, email string) error {
	result, err := s.Pool.Exec(ctx, `UPDATE oidc_identities SET last_login_at=now(), email=COALESCE($2, email) WHERE id=$1`, id, nullableText(email))
	if err != nil {
		return normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ProvisionOIDCUser creates an account for a first-time external identity and
// binds it, in one transaction: an identity row pointing at an account that was
// never created, or an account nothing points at, are both worse than a failed
// sign-in.
//
// Two callbacks for the same subject can arrive at once — a double click, or a
// browser retrying a slow redirect. The loser hits the (provider_id, subject)
// unique constraint, which normalizeDBError turns into ErrConflict; rather than
// failing the sign-in it re-reads the winner's row and returns the account that
// now exists. Letting the conflict through would make the second of two
// simultaneous first logins fail for no reason the operator could see.
//
// The account is a regular one and its password hash is a sentinel no password
// can match: CheckPassword splits on "$" and needs six segments, so '!oidc'
// never authenticates. It has to be *something*, because the column is NOT NULL.
func (s *Store) ProvisionOIDCUser(ctx context.Context, providerID, subject, email, username string) (domain.User, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return domain.User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	userID := NewID()
	if _, err := tx.Exec(ctx, `INSERT INTO admin_users (id, username, password_hash, role) VALUES ($1,$2,'!oidc',$3)`,
		userID, username, domain.RoleUser); err != nil {
		return domain.User{}, normalizeDBError(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO oidc_identities (provider_id, user_id, subject, email, last_login_at)
		VALUES ($1,$2,$3,$4,now())`, providerID, userID, subject, nullableText(email)); err != nil {
		if errors.Is(normalizeDBError(err), ErrConflict) {
			// Somebody else won the race; their row is the one that counts.
			_ = tx.Rollback(ctx)
			identity, findErr := s.FindOIDCIdentity(ctx, providerID, subject)
			if findErr != nil {
				return domain.User{}, findErr
			}
			return s.GetUserByID(ctx, identity.UserID)
		}
		return domain.User{}, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, err
	}
	return s.GetUserByID(ctx, userID)
}

// CreateOIDCRequest records an authorization request in flight.
//
// Expired rows are swept here rather than by a background job, for the same
// reason CreateMFAChallenge does it: the table only grows when somebody starts a
// sign-in, so the write is the natural place to remove what nobody can use, and
// no separate schedule has to be kept in step. The rate limiter is per-address
// and fail-open, so nothing else bounds the table's growth.
func (s *Store) CreateOIDCRequest(ctx context.Context, providerID string, stateHash []byte, nonce string, codeVerifier []byte, expiresAt time.Time) error {
	if _, err := s.Pool.Exec(ctx, `DELETE FROM oidc_auth_requests WHERE expires_at < now()`); err != nil {
		return err
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO oidc_auth_requests (provider_id, state_hash, nonce, code_verifier, expires_at)
		VALUES ($1,$2,$3,$4,$5)`, providerID, stateHash, nonce, codeVerifier, expiresAt)
	return normalizeDBError(err)
}

// ClaimOIDCRequest spends an authorization request and reports what it was for.
//
// The claim is one statement and happens before the code is exchanged, so a
// replayed callback cannot retry: the second attempt finds consumed_at set and
// gets a false. That is what stops a login-CSRF — an attacker cannot bind their
// own IdP session to a victim's browser by replaying a callback, because the
// state they would need is only ever in the victim's cookie.
//
// A false return covers unknown, expired and already-consumed alike; the caller
// must not distinguish them.
func (s *Store) ClaimOIDCRequest(ctx context.Context, stateHash []byte) (domain.OIDCRequest, bool, error) {
	var request domain.OIDCRequest
	err := s.Pool.QueryRow(ctx, `
		UPDATE oidc_auth_requests SET consumed_at=now()
		WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at > now()
		RETURNING id, provider_id, nonce, code_verifier`, stateHash).
		Scan(&request.ID, &request.ProviderID, &request.Nonce, &request.CodeVerifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return request, false, nil
	}
	if err != nil {
		return request, false, err
	}
	return request, true, nil
}

// nullableText keeps "absent" as NULL rather than as an empty string, so a
// missing value reads the same however it is queried.
func nullableText(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
