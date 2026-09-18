package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
)

// ErrSecretsUnavailable is returned when a client secret is supplied but the
// deployment has no encryption key to store it under. Refusing is the same
// fail-closed posture enrolment takes: a secret the server cannot read back is
// worse than no secret, and accepting one would leave a provider that can never
// complete a sign-in.
var ErrSecretsUnavailable = errors.New("this deployment cannot store encrypted secrets; set SECRET_ENCRYPTION_KEY")

// ErrOIDCSlugImmutable is returned when an update tries to move a provider to a
// different slug. The slug is part of the callback URL registered at the IdP, so
// changing it would silently invalidate that registration — the provider would
// look configured and every sign-in would fail at the IdP with a redirect
// mismatch.
var ErrOIDCSlugImmutable = errors.New("the slug cannot be changed; add a separate provider instead")

// oidcSlugPattern mirrors the CHECK constraint on oidc_providers.slug. It is
// enforced here as well because a CHECK violation arrives as SQLSTATE 23514,
// which normalizeDBError does not map, so the raw constraint text would reach
// the client.
var oidcSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,31}$`)

const (
	oidcMaxDisplayNameLength = 128
	// oidcDefaultScopes is what a provider gets when no scope list is given.
	oidcDefaultScopes = "openid profile email"
)

// OIDCService owns the sign-in provider configuration: the rows themselves, the
// validation the database constraints cannot report usefully, and the one secret
// that has to be encrypted at rest.
//
// It does not run the sign-in flow yet — that is the other half of this batch and
// brings its own dependencies (a discovery cache, an HTTP client that may reach
// private addresses, the ID-token verifier).
type OIDCService struct {
	Store  *postgres.Store
	Config config.Config
	// Box holds the key client secrets are stored under. Its zero value refuses
	// every operation, which is what makes a missing key fail closed rather than
	// storing a secret nothing can read back.
	Box security.SecretBox
}

// List returns every provider, for the console.
func (s *OIDCService) List(ctx context.Context) ([]domain.OIDCProvider, error) {
	return s.Store.ListOIDCProviders(ctx)
}

// PublicProviders returns what an unauthenticated visitor may see: the enabled
// providers' slug and label, and nothing else.
func (s *OIDCService) PublicProviders(ctx context.Context) ([]domain.PublicProvider, error) {
	return s.Store.ListPublicOIDCProviders(ctx)
}

// Create stores a new provider.
func (s *OIDCService) Create(ctx context.Context, req domain.OIDCProviderInput) (domain.OIDCProvider, error) {
	provider := domain.OIDCProvider{
		Slug:          stringValue(req.Slug),
		DisplayName:   stringValue(req.DisplayName),
		Issuer:        stringValue(req.Issuer),
		ClientID:      stringValue(req.ClientID),
		Scopes:        sliceValue(req.Scopes),
		AutoProvision: boolValue(req.AutoProvision, true),
		Enabled:       boolValue(req.Enabled, true),
	}
	provider, err := s.normalizeProvider(provider)
	if err != nil {
		return provider, err
	}
	secret, err := s.sealClientSecret(req.ClientSecret)
	if err != nil {
		return provider, err
	}
	return s.Store.CreateOIDCProvider(ctx, provider, secret)
}

// Update applies a partial edit.
//
// Every field the request omits keeps its stored value, which is what lets the
// console flip one toggle without restating the issuer and client id. A supplied
// client secret replaces the stored one; an omitted or empty one leaves it
// alone, because reading "empty" as "clear it" would break every sign-in through
// the provider without saying so.
func (s *OIDCService) Update(ctx context.Context, id string, req domain.OIDCProviderInput) (domain.OIDCProvider, error) {
	provider, err := s.Store.GetOIDCProvider(ctx, id)
	if err != nil {
		return provider, err
	}
	if req.Slug != nil {
		// Refused rather than ignored: silently dropping the change would leave
		// the operator believing the callback URL had moved.
		if normalized := strings.ToLower(strings.TrimSpace(*req.Slug)); normalized != provider.Slug {
			return provider, ErrOIDCSlugImmutable
		}
	}
	if req.DisplayName != nil {
		provider.DisplayName = *req.DisplayName
	}
	if req.Issuer != nil {
		provider.Issuer = *req.Issuer
	}
	if req.ClientID != nil {
		provider.ClientID = *req.ClientID
	}
	if req.Scopes != nil {
		provider.Scopes = *req.Scopes
	}
	if req.AutoProvision != nil {
		provider.AutoProvision = *req.AutoProvision
	}
	if req.Enabled != nil {
		provider.Enabled = *req.Enabled
	}
	provider, err = s.normalizeProvider(provider)
	if err != nil {
		return provider, err
	}
	secret, err := s.sealClientSecret(req.ClientSecret)
	if err != nil {
		return provider, err
	}
	return s.Store.UpdateOIDCProvider(ctx, provider, secret)
}

// Delete removes a provider and returns the row as it was.
//
// The console warns first: the accounts it provisioned keep a password hash no
// password can match, and no screen in the application would set a new one. The
// row comes back so the trail can name what was removed — by the time the entry
// is written the row is gone.
func (s *OIDCService) Delete(ctx context.Context, id string) (domain.OIDCProvider, error) {
	provider, err := s.Store.GetOIDCProvider(ctx, id)
	if err != nil {
		return provider, err
	}
	if err := s.Store.DeleteOIDCProvider(ctx, id); err != nil {
		return provider, err
	}
	return provider, nil
}

// sealClientSecret encrypts a submitted client secret.
//
// nil and the empty string both mean "there is no secret in this request", which
// on create is a public client and on update is "keep the stored one". The value
// is sealed byte for byte and never trimmed: it is a credential, and quietly
// removing characters from it would produce a provider that fails to
// authenticate for reasons nobody could see.
func (s *OIDCService) sealClientSecret(value *string) ([]byte, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	if !s.Config.SecretsAvailable() {
		return nil, ErrSecretsUnavailable
	}
	return s.Box.Seal([]byte(*value))
}

// normalizeProvider validates a provider as it will be stored and returns it in
// canonical form.
func (s *OIDCService) normalizeProvider(provider domain.OIDCProvider) (domain.OIDCProvider, error) {
	// The slug is a URL segment, so it is lower-cased rather than rejected for
	// case: the operator types the name they know it by, and the callback URL
	// the console shows them is built from what was stored.
	provider.Slug = strings.ToLower(strings.TrimSpace(provider.Slug))
	if !oidcSlugPattern.MatchString(provider.Slug) {
		return provider, errors.New("the slug must be 2-32 characters of a-z, 0-9, '-' or '_', and must start with a letter or a digit")
	}

	provider.DisplayName = strings.TrimSpace(provider.DisplayName)
	if provider.DisplayName == "" {
		return provider, errors.New("a display name is required")
	}
	// Counted in characters, not bytes: the column is varchar(128), which
	// counts characters, and a name with non-ASCII letters would otherwise be
	// refused here for being longer than the database would consider it.
	if utf8.RuneCountInString(provider.DisplayName) > oidcMaxDisplayNameLength {
		return provider, fmt.Errorf("the display name must be at most %d characters", oidcMaxDisplayNameLength)
	}

	issuer, err := s.normalizeIssuer(provider.Issuer)
	if err != nil {
		return provider, err
	}
	provider.Issuer = issuer

	provider.ClientID = strings.TrimSpace(provider.ClientID)
	if provider.ClientID == "" {
		return provider, errors.New("a client id is required")
	}

	scopes, err := normalizeOIDCScopes(provider.Scopes)
	if err != nil {
		return provider, err
	}
	provider.Scopes = scopes
	return provider, nil
}

// normalizeIssuer validates the issuer and returns it without a trailing slash.
//
// The trailing slash matters more than it looks: the IdP echoes `iss` back
// exactly as it was configured, so an extra one here makes every ID token fail
// its issuer check with an error that points at the IdP rather than at this
// field.
func (s *OIDCService) normalizeIssuer(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("an issuer is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("the issuer must be a URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && s.Config.OIDCAllowInsecureIssuers) {
		return "", errors.New("the issuer must use https; set OIDC_ALLOW_INSECURE_ISSUERS to allow http")
	}
	if parsed.Host == "" {
		return "", errors.New("the issuer must include a host")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("the issuer must not carry credentials, a query string or a fragment")
	}
	// Host names are case-insensitive but the path is not, so only the host is
	// folded. The IdP compares `iss` as a string, and one capital letter is
	// enough to make it disagree.
	parsed.Host = strings.ToLower(parsed.Host)
	return strings.TrimRight(parsed.String(), "/"), nil
}

// normalizeOIDCScopes cleans a submitted scope list.
//
// "openid" is required rather than merely defaulted: without it the IdP returns
// no ID token, so the provider could never complete a sign-in. Catching that here
// turns a confusing failure at the IdP into a message next to the field.
func normalizeOIDCScopes(scopes []string) ([]string, error) {
	if len(scopes) == 0 {
		scopes = strings.Fields(oidcDefaultScopes)
	}
	normalized := make([]string, 0, len(scopes))
	seen := make(map[string]bool, len(scopes))
	for _, scope := range scopes {
		trimmed := strings.TrimSpace(scope)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		normalized = append(normalized, trimmed)
	}
	if !seen["openid"] {
		return nil, errors.New(`the scope list must include "openid"`)
	}
	return normalized, nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func sliceValue(value *[]string) []string {
	if value == nil {
		return nil
	}
	return *value
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}
