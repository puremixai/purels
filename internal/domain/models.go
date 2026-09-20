package domain

import "time"

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	// Scopes are the permissions the credential holds: the account's role for a
	// session, the token's own set for a bearer token. They travel with the user
	// so the console can hide what it cannot use, and so the middleware does not
	// have to look the role up a second time. Neither field is omitted when
	// empty: a client cannot tell "false" from "absent" on a boolean, and an
	// account with no permissions is exactly when it matters.
	Scopes []string `json:"scopes"`
	// Unrestricted reports whether the account sees and manages every link
	// rather than only its own. It is deliberately not a scope: capability
	// ("what may I do") and visibility ("whose links may I see") are different
	// questions, and one flag cannot answer both.
	Unrestricted bool `json:"unrestricted"`
	// MFAEnabled reports whether a confirmed second factor is stored. It travels
	// with the user so /auth/me is a complete description of the signed-in
	// account rather than one the console has to complete with a second call.
	MFAEnabled bool `json:"mfa_enabled"`
}

type Link struct {
	ID             string     `json:"id"`
	Alias          string     `json:"alias"`
	DestinationURL string     `json:"destination_url"`
	Title          string     `json:"title"`
	Tags           []string   `json:"tags"`
	RedirectCode   int16      `json:"redirect_code"`
	Status         string     `json:"status"`
	Version        int64      `json:"version"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	// InterstitialSeconds is how long to show the destination before sending the
	// visitor on. Zero means redirect immediately, which is the only other
	// behaviour there has ever been; the column defaults to 2.
	InterstitialSeconds int16 `json:"interstitial_seconds"`
	// Domain is the configured short domain the link is filed under. Empty means
	// the default host from PUBLIC_URL, which is also what a NULL column means.
	// It is display only: the code resolves on every configured host, so this
	// decides what the console shows and what the QR code encodes.
	Domain string `json:"domain,omitempty"`
	// LastCheckedAt and LastStatusCode describe the last destination probe.
	// Nil means the link has never been checked; a status code of 0 records a
	// probe that could not reach the destination at all.
	LastCheckedAt  *time.Time `json:"last_checked_at,omitempty"`
	LastStatusCode *int       `json:"last_status_code,omitempty"`
	// Rules divert a visitor whose user agent matches to another destination.
	// Only single-link reads load them: a list row has no use for them, and
	// they ride along in the redirect cache because the whole Link is cached.
	Rules []LinkRule `json:"rules,omitempty"`
}

// LinkRule diverts a link's traffic when the visitor's user agent matches.
// RedirectCode 0 means the rule inherits the link's own code.
type LinkRule struct {
	ID             string `json:"id,omitempty"`
	Position       int    `json:"position"`
	MatchType      string `json:"match_type"`
	MatchValue     string `json:"match_value"`
	DestinationURL string `json:"destination_url"`
	RedirectCode   int16  `json:"redirect_code"`
}

// LinkHealth is the outcome of one destination probe.
type LinkHealth struct {
	CheckedAt  time.Time `json:"checked_at"`
	StatusCode int       `json:"status_code"`
	OK         bool      `json:"ok"`
	Error      string    `json:"error,omitempty"`
}

// LinkTarget is the minimum a probe needs: where to go, and what to call the
// link in a log line.
type LinkTarget struct {
	ID             string `json:"id"`
	Alias          string `json:"alias"`
	DestinationURL string `json:"destination_url"`
}

type Session struct {
	ID        string
	User      User
	CSRFHash  []byte
	ExpiresAt time.Time
}

type Token struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"token_prefix"`
	Scopes     []string   `json:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type StatsSummary struct {
	TotalLinks  int64 `json:"total_links"`
	TotalClicks int64 `json:"total_clicks"`
}

// TagStat is a tag together with how many live links carry it.
type TagStat struct {
	Name  string `json:"name"`
	Links int64  `json:"links"`
}

// Account is one row of the administrator's user list.
type Account struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Disabled bool   `json:"disabled"`
	// AuthSource tells the administrator which sign-in path created this
	// account. It remains "oidc" for provisioned accounts even if the provider
	// is later removed, while AuthProvider names the current provider when one
	// is still configured.
	AuthSource   string `json:"auth_source"`
	AuthProvider string `json:"auth_provider,omitempty"`
	// MFAEnabled lets the administrator see whose second factor is in play, so
	// the reset action has a visible target rather than being a blind guess.
	MFAEnabled bool      `json:"mfa_enabled"`
	CreatedAt  time.Time `json:"created_at"`
}

// MFAState is what the login path needs to know about an account's second
// factor. Secret is the value as stored — ciphertext — because only the service
// holds the key, and the store must not make a trust decision about a value it
// cannot interpret.
type MFAState struct {
	Secret      []byte
	ConfirmedAt *time.Time
}

// Enrolled reports whether the account has a confirmed second factor. A secret
// without a confirmation is an enrolment nobody finished, and it never takes
// part in a login decision.
func (m MFAState) Enrolled() bool { return m.ConfirmedAt != nil && len(m.Secret) > 0 }

// MFAStatus is what the console needs to render the security page.
type MFAStatus struct {
	// Available is the deployment's side of the feature: TOTP_ENABLED with a
	// usable key. False means enrolment is refused, not merely hidden.
	Available bool `json:"available"`
	// Enabled is this account's side: a confirmed secret is stored.
	Enabled bool `json:"enabled"`
	// Pending reports an enrolment that was started and never confirmed. It has
	// no effect on sign-in, and the console offers to start over.
	Pending                bool `json:"pending"`
	RecoveryCodesRemaining int  `json:"recovery_codes_remaining"`
}

// MFAEnrollment is what an enrolment hands back: everything the authenticator
// app needs and nothing the console would have to look up again.
type MFAEnrollment struct {
	Secret     string `json:"secret"`
	OTPAuthURL string `json:"otpauth_url"`
	// QR is a data URI rather than a second endpoint, so the secret never
	// appears in a URL, a proxy log or a Referer header, and there is no
	// question of which pending secret a given image belongs to.
	QR string `json:"qr"`
}

// Role is a named bundle of scopes plus a visibility flag, stored in the roles
// table so the console can adjust what a preset role may do.
type Role struct {
	Name string `json:"name"`
	// Scopes are the permissions this role grants. A role edit replaces the
	// whole set, so the console sends the complete list.
	Scopes []string `json:"scopes"`
	// Unrestricted means the role sees and manages every link rather than only
	// its owner's.
	Unrestricted bool `json:"unrestricted"`
}

// OIDCProvider is one configured identity provider, as the console sees it.
//
// The client secret is deliberately absent: HasSecret says whether one is
// stored, which is all the form needs to render, and it is the only fact about
// the secret that can be returned without handing a credential back to every
// holder of oidc:manage.
type OIDCProvider struct {
	ID            string   `json:"id"`
	Slug          string   `json:"slug"`
	DisplayName   string   `json:"display_name"`
	Issuer        string   `json:"issuer"`
	ClientID      string   `json:"client_id"`
	HasSecret     bool     `json:"has_secret"`
	Scopes        []string `json:"scopes"`
	AutoProvision bool     `json:"auto_provision"`
	Enabled       bool     `json:"enabled"`
	// IdentityCount is how many accounts are bound to this provider. The console
	// shows it next to the delete button, because deleting a provider strands
	// the accounts it provisioned: they keep a password hash no password can
	// match, and the application has no password-change screen to rescue them.
	IdentityCount int       `json:"identity_count"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// PublicProvider is what an unauthenticated visitor may see: something to link
// to and something to label the button with. Issuer and client id are left out
// on purpose — the login page has no use for them, and they describe the
// deployment's internals to anyone who asks.
type PublicProvider struct {
	Slug        string `json:"slug"`
	DisplayName string `json:"display_name"`
}

// OIDCIdentity binds one external subject to one account.
type OIDCIdentity struct {
	ID          string     `json:"id"`
	ProviderID  string     `json:"provider_id"`
	UserID      string     `json:"user_id"`
	Subject     string     `json:"subject"`
	Email       string     `json:"email,omitempty"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

// OIDCRequest is an authorization request that has been claimed: what the
// callback needs to finish the exchange. CodeVerifier is the decrypted PKCE
// verifier, because only the service holds the key.
type OIDCRequest struct {
	ID           string
	ProviderID   string
	Nonce        string
	CodeVerifier []byte
}

// AnalyticsSettings is the deployment's tracking configuration, as the console
// sees it. An empty field means that provider is off, so there is no separate
// enabled flag to disagree with it.
//
// The console reads this on every admin page to decide what to inject, which
// makes the json tags a contract with web/src/lib/analytics-config.ts. The
// values end up inside an inline script, so they are validated on write by the
// service and validated again by the console before anything is interpolated.
type AnalyticsSettings struct {
	GA4MeasurementID string    `json:"ga4_measurement_id"`
	GTMContainerID   string    `json:"gtm_container_id"`
	MatomoURL        string    `json:"matomo_url"`
	MatomoSiteID     string    `json:"matomo_site_id"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// CaptchaSettings is the administrative view of registration CAPTCHA settings.
// The provider secret is deliberately absent; HasSecret is the only fact about
// it that a console needs, and a separate store method is the only path that
// reads the ciphertext for verification.
type CaptchaSettings struct {
	Provider         string    `json:"provider"`
	Enabled          bool      `json:"enabled"`
	SiteKey          string    `json:"site_key"`
	HasSecret        bool      `json:"has_secret"`
	ExpectedHostname string    `json:"expected_hostname"`
	ExpectedAction   string    `json:"expected_action"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// PublicCaptchaSettings is the unauthenticated registration-page view. It
// contains only values that are intended to be sent to the browser.
//
// RegistrationEnabled is deployment configuration rather than CAPTCHA
// configuration, and the type name is the narrower for it. It rides along
// because this is the one public bootstrap call the registration page already
// makes, and the landing page needs the same answer to decide whether to offer
// a Register link at all — a second endpoint for one boolean would cost a
// route, a handler and a second round trip on both pages. If a second
// non-CAPTCHA public value turns up, that is the moment to split out
// GET /api/v1/auth/config.
type PublicCaptchaSettings struct {
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"`
	SiteKey  string `json:"site_key"`
	// RegistrationEnabled reports whether this deployment accepts new accounts.
	// False means POST /auth/register answers 403 registration_disabled.
	// No omitempty: a client cannot tell false from absent on a boolean, and
	// that is exactly the case where the difference matters.
	RegistrationEnabled bool `json:"registration_enabled"`
}

type DailyStat struct {
	Day    time.Time `json:"day"`
	Clicks int64     `json:"clicks"`
}

// AuditEntry is one recorded mutation. Username is resolved on read so the
// trail stays readable after an admin account is removed.
type AuditEntry struct {
	ID           string         `json:"id"`
	UserID       *string        `json:"user_id,omitempty"`
	Username     string         `json:"username,omitempty"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type,omitempty"`
	ResourceID   *string        `json:"resource_id,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

// AuditPage is the paginated response for the audit trail.
type AuditPage struct {
	Entries []AuditEntry `json:"entries"`
	Total   int64        `json:"total"`
	Limit   int          `json:"limit"`
	Offset  int          `json:"offset"`
}
