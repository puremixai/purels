package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
)

var (
	// ErrCaptchaInvalid covers an empty, rejected or otherwise invalid
	// registration token. The caller must not learn whether a token was unknown,
	// expired or rejected by the provider.
	ErrCaptchaInvalid = errors.New("invalid CAPTCHA verification")
	// ErrInvalidCaptcha is kept as the concise name used by authentication
	// callers; it is the same stable error as ErrCaptchaInvalid.
	ErrInvalidCaptcha = ErrCaptchaInvalid
	// ErrCaptchaUnavailable means the deployment could not complete the remote
	// verification. It is distinct from a token rejection so callers can report a
	// temporary service failure without exposing provider response details.
	ErrCaptchaUnavailable = errors.New("CAPTCHA verification is unavailable")
	// ErrCaptchaInvalidSettings is returned when an enabled CAPTCHA cannot work
	// with the supplied site key, secret or matching constraints.
	ErrCaptchaInvalidSettings = errors.New("invalid CAPTCHA settings")
	// ErrCaptchaSecretsUnavailable is returned when the configured encryption key
	// cannot seal or open the provider secret.
	ErrCaptchaSecretsUnavailable = errors.New("CAPTCHA secret encryption is unavailable")

	// These are the verifier-level stable outcomes. CaptchaService maps them to
	// the public errors above, while direct verifier users can still distinguish
	// a provider rejection from an unavailable provider.
	ErrTurnstileRejected    = errors.New("Turnstile verification rejected")
	ErrTurnstileUnavailable = errors.New("Turnstile verification is unavailable")
)

const (
	// TurnstileVerifyURL is intentionally fixed. A database setting must never
	// choose the endpoint, or CAPTCHA configuration would become an SSRF input.
	TurnstileVerifyURL       = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	turnstileHTTPTimeout     = 5 * time.Second
	turnstileMaxTokenLength  = 2048
	turnstileMaxResponseBody = 64 << 10
	captchaMaxSecretLength   = 4096
	captchaMaxSiteKeyLength  = 256
	captchaMaxHostnameLength = 255
	captchaMaxActionLength   = 128
)

var (
	captchaHostnamePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`)
	captchaActionPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// TurnstileVerifier is the narrow seam between registration policy and the
// remote provider. CaptchaService uses the concrete verifier by default, while
// tests can provide a deterministic implementation without an alternate URL.
type TurnstileVerifier interface {
	Verify(context.Context, string, string, string, string, string) error
}

// TurnstileClient verifies a token against Cloudflare's fixed siteverify
// endpoint. Client is injectable only as an HTTP transport seam; the URL is not
// configurable.
type TurnstileClient struct {
	Client *http.Client
}

// TurnstileVerifierClient is an alias that makes the concrete implementation's
// purpose explicit to callers that prefer the verifier name.
type TurnstileVerifierClient = TurnstileClient

// NewTurnstileVerifier creates a fixed-endpoint verifier. An optional client is
// useful for tests that install a RoundTripper while retaining the production
// endpoint and request shape.
func NewTurnstileVerifier(client ...*http.Client) *TurnstileClient {
	if len(client) > 0 && client[0] != nil {
		return &TurnstileClient{Client: client[0]}
	}
	return &TurnstileClient{Client: &http.Client{Timeout: turnstileHTTPTimeout}}
}

// NewTurnstileClient is the constructor name for callers that treat this as a
// provider client rather than as a verifier.
func NewTurnstileClient(client ...*http.Client) *TurnstileClient {
	return NewTurnstileVerifier(client...)
}

// Verify posts the token as an application/x-www-form-urlencoded request. The
// provider's response body is capped before decoding, and all network/protocol
// failures are reduced to ErrTurnstileUnavailable.
func (c *TurnstileClient) Verify(ctx context.Context, token, secret, remoteIP, expectedHostname, expectedAction string) error {
	if c == nil || c.Client == nil || strings.TrimSpace(secret) == "" {
		return ErrTurnstileUnavailable
	}
	if strings.TrimSpace(token) == "" || len(token) > turnstileMaxTokenLength {
		return ErrTurnstileRejected
	}
	if ctx == nil {
		ctx = context.Background()
	}
	requestContext, cancel := context.WithTimeout(ctx, turnstileHTTPTimeout)
	defer cancel()
	form := url.Values{
		"secret":   {secret},
		"response": {token},
	}
	if strings.TrimSpace(remoteIP) != "" {
		form.Set("remoteip", strings.TrimSpace(remoteIP))
	}
	request, err := http.NewRequestWithContext(requestContext, http.MethodPost, TurnstileVerifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return ErrTurnstileUnavailable
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.Client.Do(request)
	if err != nil {
		return ErrTurnstileUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return ErrTurnstileUnavailable
	}
	var result struct {
		Success  bool   `json:"success"`
		Hostname string `json:"hostname"`
		Action   string `json:"action"`
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, turnstileMaxResponseBody+1))
	if err != nil || len(body) > turnstileMaxResponseBody || json.Unmarshal(body, &result) != nil {
		return ErrTurnstileUnavailable
	}
	if !result.Success {
		return ErrTurnstileRejected
	}
	if expectedHostname != "" && !strings.EqualFold(strings.TrimSuffix(strings.TrimSpace(result.Hostname), "."), strings.TrimSuffix(strings.TrimSpace(expectedHostname), ".")) {
		return ErrTurnstileRejected
	}
	if expectedAction != "" && result.Action != expectedAction {
		return ErrTurnstileRejected
	}
	return nil
}

// CaptchaStore is the narrow persistence seam needed by CaptchaService. The
// postgres store satisfies it, while tests can exercise policy and decryption
// without opening a database.
type CaptchaStore interface {
	GetCaptchaSettings(context.Context) (domain.CaptchaSettings, error)
	GetPublicCaptchaSettings(context.Context) (domain.PublicCaptchaSettings, error)
	GetCaptchaSecret(context.Context) ([]byte, error)
	UpdateCaptchaSettings(context.Context, domain.CaptchaSettings, []byte) (domain.CaptchaSettings, error)
}

// CaptchaService owns the deployment-wide registration CAPTCHA settings and the
// encrypted provider credential. CAPTCHA is registration-only; this service
// does not make login or session decisions.
type CaptchaService struct {
	Store    CaptchaStore
	Config   config.Config
	Box      security.SecretBox
	Verifier TurnstileVerifier
}

// Get returns the administrative settings without the provider secret.
func (s *CaptchaService) Get(ctx context.Context) (domain.CaptchaSettings, error) {
	return s.Store.GetCaptchaSettings(ctx)
}

// Public returns the unauthenticated registration-page projection.
func (s *CaptchaService) Public(ctx context.Context) (domain.PublicCaptchaSettings, error) {
	settings, err := s.Store.GetCaptchaSettings(ctx)
	if err != nil {
		return domain.PublicCaptchaSettings{}, err
	}
	public := domain.PublicCaptchaSettings{
		Provider:            "turnstile",
		RegistrationEnabled: s.Config.RegistrationEnabled,
	}
	if settings.Enabled && settings.HasSecret && strings.TrimSpace(settings.SiteKey) != "" {
		public.Enabled = true
		public.SiteKey = settings.SiteKey
	}
	return public, nil
}

// Update applies a partial settings edit. An omitted or empty secret retains
// the existing ciphertext; there is intentionally no clear-secret operation in
// this batch.
func (s *CaptchaService) Update(ctx context.Context, input domain.CaptchaSettingsInput) (domain.CaptchaSettings, error) {
	settings, err := s.Store.GetCaptchaSettings(ctx)
	if err != nil {
		return settings, err
	}
	settings.Provider = "turnstile"
	if input.Enabled != nil {
		settings.Enabled = *input.Enabled
	}
	if input.SiteKey != nil {
		settings.SiteKey = strings.TrimSpace(*input.SiteKey)
	}
	if input.ExpectedHostname != nil {
		settings.ExpectedHostname = normalizeCaptchaHostname(*input.ExpectedHostname)
	}
	if input.ExpectedAction != nil {
		settings.ExpectedAction = strings.TrimSpace(*input.ExpectedAction)
	}

	var sealed []byte
	if input.Secret != nil && *input.Secret != "" {
		secret := *input.Secret
		if len(secret) > captchaMaxSecretLength {
			return settings, ErrCaptchaInvalidSettings
		}
		if !s.Config.SecretsAvailable() {
			return settings, ErrCaptchaSecretsUnavailable
		}
		sealed, err = s.Box.Seal([]byte(secret))
		if err != nil {
			return settings, ErrCaptchaSecretsUnavailable
		}
		settings.HasSecret = true
	}
	if settings.Enabled && (input.Secret == nil || *input.Secret == "") && settings.HasSecret {
		sealedExisting, readErr := s.Store.GetCaptchaSecret(ctx)
		if readErr != nil {
			return settings, ErrCaptchaSecretsUnavailable
		}
		if _, openErr := s.Box.Open(sealedExisting); openErr != nil {
			return settings, ErrCaptchaSecretsUnavailable
		}
	}
	if err := validateCaptchaSettings(settings); err != nil {
		return settings, err
	}
	return s.Store.UpdateCaptchaSettings(ctx, settings, sealed)
}

// VerifyRegistration enforces the currently configured CAPTCHA policy. Disabled
// CAPTCHA is deliberately a no-op. Once enabled, missing settings, a missing or
// undecryptable secret, a rejected token and a provider outage all fail closed.
func (s *CaptchaService) VerifyRegistration(ctx context.Context, token, remoteIP string) error {
	settings, err := s.Store.GetCaptchaSettings(ctx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return nil
	}
	if err := validateCaptchaSettings(settings); err != nil {
		return ErrCaptchaUnavailable
	}
	if strings.TrimSpace(token) == "" || len(token) > turnstileMaxTokenLength {
		return ErrCaptchaInvalid
	}
	if s.Config.CaptchaTestMode {
		if s.Config.CaptchaTestToken != "" && token == s.Config.CaptchaTestToken {
			return nil
		}
		return ErrCaptchaInvalid
	}
	sealed, err := s.Store.GetCaptchaSecret(ctx)
	if err != nil {
		return ErrCaptchaUnavailable
	}
	secret, err := s.Box.Open(sealed)
	if err != nil {
		// An enabled row with ciphertext that the current key cannot open is an
		// unavailable verifier, not a client-side token error. Registration must
		// fail closed with 503 rather than exposing the encryption problem as a
		// 409 configuration edit error.
		return ErrCaptchaUnavailable
	}
	verifier := s.Verifier
	if verifier == nil {
		verifier = NewTurnstileVerifier()
	}
	if err := verifier.Verify(ctx, token, string(secret), remoteIP, settings.ExpectedHostname, settings.ExpectedAction); err != nil {
		if errors.Is(err, ErrTurnstileRejected) || errors.Is(err, ErrCaptchaInvalid) || errors.Is(err, ErrInvalidCaptcha) {
			return ErrCaptchaInvalid
		}
		return ErrCaptchaUnavailable
	}
	return nil
}

func validateCaptchaSettings(settings domain.CaptchaSettings) error {
	if settings.Provider != "turnstile" {
		return ErrCaptchaInvalidSettings
	}
	if len(settings.SiteKey) > captchaMaxSiteKeyLength || len(settings.ExpectedHostname) > captchaMaxHostnameLength || len(settings.ExpectedAction) > captchaMaxActionLength {
		return ErrCaptchaInvalidSettings
	}
	if strings.TrimSpace(settings.SiteKey) != "" && strings.IndexFunc(settings.SiteKey, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return ErrCaptchaInvalidSettings
	}
	if settings.ExpectedHostname != "" && !captchaHostnamePattern.MatchString(settings.ExpectedHostname) {
		return ErrCaptchaInvalidSettings
	}
	if settings.ExpectedAction != "" && !captchaActionPattern.MatchString(settings.ExpectedAction) {
		return ErrCaptchaInvalidSettings
	}
	if settings.Enabled && (strings.TrimSpace(settings.SiteKey) == "" || !settings.HasSecret) {
		return ErrCaptchaInvalidSettings
	}
	return nil
}

func normalizeCaptchaHostname(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.TrimSuffix(value, ".")
}
