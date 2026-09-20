package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
	"golang.org/x/oauth2"
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

// ErrOIDCDiscovery is returned when the provider's discovery document cannot be
// read. It covers an unreachable host, a bad certificate and a document that is
// not OpenID Connect at all, because from the operator's side those are one
// problem: the issuer in the form does not describe a usable provider.
var ErrOIDCDiscovery = errors.New("could not read the identity provider's configuration")

// ErrOIDCRedirectBase is returned when the callback URL cannot be built. It is
// refused rather than guessed from the request, because the redirect URI is
// registered verbatim at the IdP and a caller who could choose it could choose
// where the authorization code is delivered.
var ErrOIDCRedirectBase = errors.New("the OIDC redirect base is not configured; set OIDC_REDIRECT_BASE")

// ErrOIDCState covers an unknown, expired, replayed or mismatched sign-in
// request. The cases share one error because the caller must not be able to
// tell them apart.
var ErrOIDCState = errors.New("the sign-in request is unknown, expired or already used")

// ErrOIDCExchange covers a failed token exchange or a rejected ID token.
var ErrOIDCExchange = errors.New("the identity provider could not complete the sign-in")

// ErrOIDCNotProvisioned is returned when a verified identity has no account
// bound to it and the provider is not allowed to create one.
var ErrOIDCNotProvisioned = errors.New("this identity is not linked to an account, and automatic account creation is off")

// oidcSlugPattern mirrors the CHECK constraint on oidc_providers.slug. It is
// enforced here as well because a CHECK violation arrives as SQLSTATE 23514,
// which normalizeDBError does not map, so the raw constraint text would reach
// the client.
var oidcSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,31}$`)

const (
	oidcMaxDisplayNameLength = 128
	// oidcDefaultScopes is what a provider gets when no scope list is given.
	oidcDefaultScopes = "openid profile email"
	// oidcStateLength and oidcNonceLength are the lengths of the two random
	// values that tie a callback to the browser that started it. The state is
	// also the database key, and the nonce is checked against the ID token.
	oidcStateLength = 48
	oidcNonceLength = 48
	// oidcHTTPTimeout bounds one call to the IdP. Without it a provider that
	// accepts the connection and never answers would hold a sign-in open until
	// the client gives up. One sign-in makes a handful of calls — the discovery
	// document, the token exchange, the key set — and they all have to fit
	// inside the server's response timeout, which is why this is seconds rather
	// than tens of seconds: the documents involved are small.
	oidcHTTPTimeout = 5 * time.Second
	// oidcProvisionAttempts bounds the retry when the derived account name is
	// taken between the check and the insert.
	oidcProvisionAttempts = 3
)

// cachedProvider is a provider's discovery document together with the ID-token
// verifier built from it.
//
// The verifier is cached alongside the document because it carries the JWKS key
// set: building one per callback would fetch the provider's keys on every
// sign-in, which is both a needless round trip and a new way for a sign-in to
// fail while the IdP is briefly unreachable.
type cachedProvider struct {
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	// storedAt is the row's updated_at when this entry was built. A newer value
	// means somebody edited the provider and the entry is stale.
	storedAt time.Time
}

// oidcClaims is the part of the ID token the account resolution reads. The rest
// — name, picture, locale — is deliberately not decoded: nothing here displays
// it, and a field nobody reads is a field nobody keeps correct.
type oidcClaims struct {
	PreferredUsername string `json:"preferred_username"`
	Email             string `json:"email"`
	EmailVerified     bool   `json:"email_verified"`
	AuthorizedParty   string `json:"azp"`
}

// OIDCStart is what the handler needs to send a browser to the IdP: where to
// go, and the state to keep in a cookie until the callback returns.
//
// The state is returned rather than set here because the service does not write
// responses, and the cookie's attributes belong with the rest of the cookie
// handling.
type OIDCStart struct {
	AuthURL string
	State   string
	MaxAge  int
}

// OIDCService owns the sign-in provider configuration and the sign-in flow: the
// rows themselves, the validation the database constraints cannot report
// usefully, the one secret that has to be encrypted at rest, and the
// authorization-code exchange.
type OIDCService struct {
	Store  *postgres.Store
	Config config.Config
	// Box holds the key client secrets and PKCE verifiers are stored under. Its
	// zero value refuses every operation, which is what makes a missing key
	// fail closed rather than storing a secret nothing can read back.
	Box security.SecretBox
	// Client fetches the discovery document, the token and the key set. Build
	// it with NewOIDCHTTPClient, not with security.NewProbeClient — see the
	// comment there for why.
	Client *http.Client

	mu    sync.Mutex
	cache map[string]cachedProvider
}

// NewOIDCHTTPClient returns the client every call to an identity provider goes
// through.
//
// It is a plain client with a timeout, deliberately not security.NewProbeClient:
// that one refuses private and loopback addresses, and a self-hosted IdP on a
// private network is exactly the deployment this feature is for. The SSRF
// surface that leaves is bounded by the https requirement on the issuer and by
// oidc:manage.
func NewOIDCHTTPClient() *http.Client {
	return &http.Client{Timeout: oidcHTTPTimeout}
}

// httpClient returns the configured client, or the default one when a service
// was built without one, so a missing client is a slow sign-in rather than a
// panic.
func (s *OIDCService) httpClient() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return NewOIDCHTTPClient()
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
	created, err := s.Store.CreateOIDCProvider(ctx, provider, secret)
	if err != nil {
		return created, err
	}
	s.evict(created.ID)
	return created, nil
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
	updated, err := s.Store.UpdateOIDCProvider(ctx, provider, secret)
	if err != nil {
		return updated, err
	}
	// Dropped so an edited issuer or client id takes effect on the next
	// sign-in. Waiting for the process to restart would leave the operator
	// staring at a corrected form that behaves exactly like the broken one.
	s.evict(updated.ID)
	return updated, nil
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
	s.evict(id)
	return provider, nil
}

// Start begins a sign-in: it records the request and returns where to send the
// browser.
//
// The state goes into an HttpOnly cookie and never into the URL, so a link that
// leaks — a referrer, a proxy log, a screenshot of the address bar — does not
// carry the value that proves a callback belongs to this browser.
func (s *OIDCService) Start(ctx context.Context, slug string) (OIDCStart, error) {
	if s.Config.OIDCRedirectBase == "" {
		return OIDCStart{}, ErrOIDCRedirectBase
	}
	provider, err := s.Store.GetOIDCProviderBySlug(ctx, slug)
	if err != nil {
		return OIDCStart{}, err
	}
	entry, err := s.discover(ctx, provider)
	if err != nil {
		return OIDCStart{}, err
	}
	// The PKCE verifier is sealed with the same key client secrets use, so a
	// deployment without one cannot run a sign-in at all. That is the same
	// fail-closed posture as storing a secret: a verifier in the clear, next to
	// a code that leaked, is the whole exchange.
	if !s.Config.SecretsAvailable() {
		return OIDCStart{}, ErrSecretsUnavailable
	}
	state, err := security.RandomString(oidcStateLength)
	if err != nil {
		return OIDCStart{}, err
	}
	nonce, err := security.RandomString(oidcNonceLength)
	if err != nil {
		return OIDCStart{}, err
	}
	verifier := oauth2.GenerateVerifier()
	sealed, err := s.Box.Seal([]byte(verifier))
	if err != nil {
		return OIDCStart{}, ErrSecretsUnavailable
	}
	expires := time.Now().UTC().Add(s.Config.OIDCRequestTTL)
	if err := s.Store.CreateOIDCRequest(ctx, provider.ID, security.HashBytes(state), nonce, sealed, expires); err != nil {
		return OIDCStart{}, err
	}
	// PKCE is on even for a confidential client: the client secret proves which
	// application is asking, the verifier proves the same application is
	// finishing, and only the second one survives an intercepted code.
	//
	// response_mode is asked for explicitly rather than left to the provider's
	// default. The state cookie is SameSite=Lax, which a browser sends on a
	// top-level GET navigation and not on a cross-site POST, so a provider that
	// answered with form_post would deliver a callback whose cookie the browser
	// had withheld — every sign-in failing as an invalid state.
	authURL := s.oauthConfig(provider, entry, "").AuthCodeURL(state,
		oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("response_mode", "query"))
	return OIDCStart{AuthURL: authURL, State: state, MaxAge: int(s.Config.OIDCRequestTTL.Seconds())}, nil
}

// Callback finishes a sign-in: it checks that the callback belongs to a request
// this browser started, exchanges the code, verifies the ID token, and resolves
// the account it names.
//
// It returns the account rather than a session because a session has exactly
// one creator — AuthService.CompleteLogin — and this path must not grow a
// second one.
func (s *OIDCService) Callback(ctx context.Context, slug, code, state, cookieState string) (domain.User, error) {
	// Both halves must be present and must match. The comparison is
	// constant-time because a byte-by-byte one reports how much of a guessed
	// state was right, and the state is the only thing standing between a
	// callback and a session.
	if state == "" || cookieState == "" || !security.ConstantTimeEqual([]byte(state), []byte(cookieState)) {
		return domain.User{}, ErrOIDCState
	}
	provider, err := s.Store.GetOIDCProviderBySlug(ctx, slug)
	if err != nil {
		return domain.User{}, err
	}
	entry, err := s.discover(ctx, provider)
	if err != nil {
		return domain.User{}, err
	}
	// Claimed before the code is exchanged, so a replayed callback finds the
	// request spent and cannot make a second attempt with the same code. A
	// failed exchange therefore costs the sign-in, which is the right trade:
	// the alternative is a code that can be retried.
	request, claimed, err := s.Store.ClaimOIDCRequest(ctx, security.HashBytes(state))
	if err != nil {
		return domain.User{}, err
	}
	// The slug in the path and the provider the request was started for must
	// agree; otherwise a state harvested from one provider could be presented
	// at another.
	if !claimed || request.ProviderID != provider.ID {
		return domain.User{}, ErrOIDCState
	}
	verifier, err := s.Box.Open(request.CodeVerifier)
	if err != nil {
		return domain.User{}, fmt.Errorf("%w: the PKCE verifier cannot be decrypted", ErrOIDCExchange)
	}
	secret, err := s.clientSecret(ctx, provider)
	if err != nil {
		return domain.User{}, err
	}
	clientCtx := oidc.ClientContext(ctx, s.httpClient())
	token, err := s.oauthConfig(provider, entry, secret).Exchange(clientCtx, code, oauth2.VerifierOption(string(verifier)))
	if err != nil {
		return domain.User{}, fmt.Errorf("%w: %v", ErrOIDCExchange, err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return domain.User{}, fmt.Errorf("%w: no id_token was returned", ErrOIDCExchange)
	}
	idToken, err := entry.verifier.Verify(clientCtx, rawIDToken)
	if err != nil {
		return domain.User{}, fmt.Errorf("%w: %v", ErrOIDCExchange, err)
	}
	// go-oidc checks the issuer, the audience, the validity window and the
	// signature, and rejects an unsigned token. It does not check the nonce or
	// azp and does not require a subject, so those three are checked here.
	//
	// The window is compared against this host's clock, so a server whose clock
	// has drifted reports the failure as the provider's rather than as its own:
	// when every sign-in fails with an error naming the issuer, the clock is
	// the first thing worth checking.
	if !security.ConstantTimeEqual([]byte(idToken.Nonce), []byte(request.Nonce)) {
		return domain.User{}, fmt.Errorf("%w: the nonce does not match", ErrOIDCExchange)
	}
	if idToken.Subject == "" {
		return domain.User{}, fmt.Errorf("%w: the id_token has no subject", ErrOIDCExchange)
	}
	var claims oidcClaims
	if err := idToken.Claims(&claims); err != nil {
		return domain.User{}, fmt.Errorf("%w: %v", ErrOIDCExchange, err)
	}
	// azp is required only when the token carries more than one audience. With
	// exactly one, go-oidc has already established that it is our client id.
	if len(idToken.Audience) > 1 && claims.AuthorizedParty != provider.ClientID {
		return domain.User{}, fmt.Errorf("%w: the id_token was issued to another client", ErrOIDCExchange)
	}
	return s.resolveAccount(ctx, provider, idToken.Subject, claims)
}

// RedirectURI is the callback URL registered verbatim at the IdP.
//
// It is built from the configured base and never from the request's Host
// header: taking it from the request would let the caller choose where the
// authorization code is delivered.
func (s *OIDCService) RedirectURI(provider domain.OIDCProvider) string {
	return s.Config.OIDCRedirectBase + "/api/v1/auth/oidc/" + provider.Slug + "/callback"
}

// discover returns the provider's endpoints and verifier, reading the discovery
// document at most once per stored version of the row.
//
// The entry is keyed on the row's updated_at as well as its id, so an operator
// who corrects a misspelled issuer does not have to restart the API for it to
// take effect — which is the reason the cache is versioned rather than merely
// filled.
func (s *OIDCService) discover(ctx context.Context, provider domain.OIDCProvider) (cachedProvider, error) {
	s.mu.Lock()
	entry, cached := s.cache[provider.ID]
	s.mu.Unlock()
	if cached && !provider.UpdatedAt.After(entry.storedAt) {
		return entry, nil
	}
	// Logged because oidc:manage can point this at any host the server can
	// reach, so the fetch is the moment that capability is exercised.
	slog.Info("reading the OIDC discovery document", "provider", provider.Slug, "issuer", provider.Issuer)
	discovered, err := oidc.NewProvider(oidc.ClientContext(ctx, s.httpClient()), provider.Issuer)
	if err != nil {
		return cachedProvider{}, fmt.Errorf("%w: %s: %v", ErrOIDCDiscovery, provider.Issuer, err)
	}
	entry = cachedProvider{
		provider: discovered,
		verifier: discovered.Verifier(&oidc.Config{ClientID: provider.ClientID}),
		storedAt: provider.UpdatedAt,
	}
	s.mu.Lock()
	if s.cache == nil {
		s.cache = make(map[string]cachedProvider)
	}
	s.cache[provider.ID] = entry
	s.mu.Unlock()
	return entry, nil
}

// evict drops a provider's cached discovery document. Every write to the table
// calls it, so a change takes effect on the next sign-in rather than at the
// next restart.
func (s *OIDCService) evict(id string) {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()
}

// oauthConfig builds the OAuth2 client for one provider.
//
// PKCE is not configured here: the challenge goes on the authorization URL and
// the verifier on the exchange, and oauth2 has a field for neither.
func (s *OIDCService) oauthConfig(provider domain.OIDCProvider, entry cachedProvider, secret string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     provider.ClientID,
		ClientSecret: secret,
		Endpoint:     entry.provider.Endpoint(),
		RedirectURL:  s.RedirectURI(provider),
		Scopes:       provider.Scopes,
	}
}

// clientSecret returns the provider's client secret in the clear, or "" for a
// public client — a configuration, not a fault: PKCE alone is enough for a
// client that has nowhere to keep a secret.
func (s *OIDCService) clientSecret(ctx context.Context, provider domain.OIDCProvider) (string, error) {
	if !provider.HasSecret {
		return "", nil
	}
	sealed, err := s.Store.GetOIDCProviderSecret(ctx, provider.ID)
	if err != nil {
		return "", err
	}
	plaintext, err := s.Box.Open(sealed)
	if err != nil {
		// A changed key or a tampered row. Not the caller's fault, and there is
		// nothing they can do about it either: re-entering the secret is the
		// documented way out.
		return "", fmt.Errorf("%w: the stored client secret cannot be decrypted; re-enter it", ErrOIDCExchange)
	}
	return string(plaintext), nil
}

// resolveAccount maps a verified external identity to a local account.
//
// The binding is (provider, subject) and never the address: an IdP that lets an
// account holder change their email would otherwise let them claim whatever
// local account that address belongs to. Email is used to seed the name of a
// new account and for nothing else.
func (s *OIDCService) resolveAccount(ctx context.Context, provider domain.OIDCProvider, subject string, claims oidcClaims) (domain.User, error) {
	identity, err := s.Store.FindOIDCIdentity(ctx, provider.ID, subject)
	if err != nil && !errors.Is(err, postgres.ErrNotFound) {
		return domain.User{}, err
	}
	if err == nil {
		// The IdP is the authority on the address, so a changed one is
		// recorded. Failing the sign-in over it would be wrong — the binding is
		// what authenticated and it is already in place — so the error is
		// dropped; a binding deleted in the meantime is reported by the lookup
		// below.
		_ = s.Store.TouchOIDCIdentity(ctx, identity.ID, verifiedEmail(claims))
		user, err := s.Store.GetUserByID(ctx, identity.UserID)
		if err != nil {
			return domain.User{}, ErrOIDCNotProvisioned
		}
		return user, nil
	}
	if !provider.AutoProvision {
		return domain.User{}, ErrOIDCNotProvisioned
	}
	return s.provisionAccount(ctx, provider, subject, claims)
}

// provisionAccount creates an account for a first-time external identity.
//
// The name is chosen outside the insert, so two first-time sign-ins can both
// find the same name free and one then loses to the unique index. Retrying with
// a fresh candidate turns that into a sign-in that works instead of one that
// fails for a reason the person cannot act on.
func (s *OIDCService) provisionAccount(ctx context.Context, provider domain.OIDCProvider, subject string, claims oidcClaims) (domain.User, error) {
	email := verifiedEmail(claims)
	base := deriveUsername(claims.PreferredUsername, email, subject)
	var lastErr error
	for attempt := 0; attempt < oidcProvisionAttempts; attempt++ {
		username, err := s.uniqueUsername(ctx, base)
		if err != nil {
			return domain.User{}, err
		}
		user, err := s.Store.ProvisionOIDCUser(ctx, provider.ID, subject, email, username)
		if err == nil {
			return user, nil
		}
		// A clash on the identity itself is resolved inside ProvisionOIDCUser,
		// which returns the winner's account rather than an error, so a
		// conflict here is the name — and the next round picks another.
		if !errors.Is(err, postgres.ErrConflict) {
			return domain.User{}, err
		}
		lastErr = err
	}
	return domain.User{}, lastErr
}

// uniqueUsername resolves a derived name against the accounts that exist.
func (s *OIDCService) uniqueUsername(ctx context.Context, base string) (string, error) {
	var lookupErr error
	username := uniqueUsername(base, func(candidate string) bool {
		user, _, _, err := s.Store.FindUser(ctx, candidate)
		if err != nil {
			// An unreadable answer is treated as "taken" so the search moves
			// on; the error is returned below and the sign-in stops there.
			lookupErr = err
			return true
		}
		return user.ID != ""
	})
	return username, lookupErr
}

// verifiedEmail returns the address only when the IdP vouches for it. An
// unverified address is the account holder's claim, and this application never
// treats a claim as a fact — which is also why an address is never used to
// claim an existing account.
func verifiedEmail(claims oidcClaims) string {
	if !claims.EmailVerified {
		return ""
	}
	return claims.Email
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

// normalizeIssuer validates the issuer while preserving its path and trailing
// slash. OIDC issuer URLs are exact identifiers, so the stored value must match
// the issuer returned by the provider's discovery document.
//
// The trailing slash matters more than it looks: the IdP echoes `iss` back
// exactly as it was configured, and the discovery client compares its issuer
// value literally. Removing one here can make discovery fail before a user ever
// reaches the provider.
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
	return parsed.String(), nil
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
