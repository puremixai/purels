package domain

type CreateLinkRequest struct {
	DestinationURL string   `json:"destination_url"`
	Alias          string   `json:"alias"`
	Title          string   `json:"title"`
	Tags           []string `json:"tags"`
	RedirectCode   int16    `json:"redirect_code"`
	ExpiresAt      string   `json:"expires_at"`
	// Domain picks one of the configured short domains. Empty means the default
	// host from PUBLIC_URL; anything not on the SHORT_DOMAINS list is refused.
	Domain string `json:"domain"`
	// Rules are applied in the order they are sent; the position column is
	// assigned from that order rather than trusted from the caller.
	Rules []LinkRuleInput `json:"rules"`
}

// LinkRuleInput is one divert rule as submitted. It carries no id or position:
// rules are replaced wholesale, so the list order is the whole of the ordering.
type LinkRuleInput struct {
	MatchType      string `json:"match_type"`
	MatchValue     string `json:"match_value"`
	DestinationURL string `json:"destination_url"`
	// RedirectCode 0 inherits the link's own code.
	RedirectCode int16 `json:"redirect_code"`
}

type UpdateLinkRequest struct {
	DestinationURL string `json:"destination_url"`
	RedirectCode   int16  `json:"redirect_code"`
	// ExpiresAt is a pointer so callers can distinguish "leave unchanged"
	// (omitted / null) from "remove the expiry" (empty string).
	ExpiresAt *string `json:"expires_at"`
	// Title and Tags follow the same convention: omitted means unchanged, so a
	// partial update cannot silently wipe them.
	Title  *string   `json:"title"`
	Tags   *[]string `json:"tags"`
	Status string    `json:"status"`
	// Domain follows the same convention: nil leaves the link where it is, an
	// empty string moves it back to the default domain.
	Domain *string `json:"domain"`
	// Rules follows the same convention: nil leaves the existing rules alone,
	// an empty slice removes them all.
	Rules *[]LinkRuleInput `json:"rules"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// BulkLinkRequest applies one edit to many links at once. Which fields are
// meaningful depends on Action: Tags for tag/untag, ExpiresAt for set_expiry
// (where an empty string clears the expiry).
type BulkLinkRequest struct {
	Action    string   `json:"action"`
	IDs       []string `json:"ids"`
	Tags      []string `json:"tags"`
	ExpiresAt *string  `json:"expires_at"`
}

type CreateTokenRequest struct {
	Name string `json:"name"`
}

// UpdateUserRequest changes one account. Both fields are pointers so an
// omitted field means "leave unchanged" rather than "set to the zero value".
type UpdateUserRequest struct {
	Role     *string `json:"role"`
	Disabled *bool   `json:"disabled"`
}

// UpdateRoleRequest replaces a role's permissions. The scope list is the whole
// set, not a delta, and Unrestricted is always stated because the console
// always knows the current value.
type UpdateRoleRequest struct {
	Scopes       []string `json:"scopes"`
	Unrestricted bool     `json:"unrestricted"`
}

// VerifySecondFactorRequest completes a login that was interrupted for a code.
// The challenge is the half-session token a correct password returned; the code
// is either a TOTP code or one of the account's recovery codes.
type VerifySecondFactorRequest struct {
	Challenge string `json:"challenge"`
	Code      string `json:"code"`
}

// ConfirmMFARequest finishes an enrolment by proving the authenticator works.
type ConfirmMFARequest struct {
	Code string `json:"code"`
}

// DisableMFARequest turns the second factor off. The password is required so a
// stolen session cannot quietly remove it.
type DisableMFARequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

// OIDCProviderInput creates or updates a sign-in provider.
//
// Every field is a pointer so that an omitted one means "leave unchanged", which
// is what lets the console PATCH a single toggle without restating the issuer
// and the client id. The important case is ClientSecret: omitted and empty both
// mean "keep the stored secret", never "clear it", because clearing it would
// silently break every sign-in through that provider. Creating a public client
// is expressed by leaving it empty on create, where there is nothing to keep.
//
// Decode runs with DisallowUnknownFields, so this struct and the TypeScript type
// on the other side are a single contract: one extra key is a 400.
type OIDCProviderInput struct {
	Slug          *string   `json:"slug"`
	DisplayName   *string   `json:"display_name"`
	Issuer        *string   `json:"issuer"`
	ClientID      *string   `json:"client_id"`
	ClientSecret  *string   `json:"client_secret"`
	Scopes        *[]string `json:"scopes"`
	AutoProvision *bool     `json:"auto_provision"`
	Enabled       *bool     `json:"enabled"`
}

// AnalyticsSettingsInput replaces the deployment's tracking configuration.
//
// Unlike OIDCProviderInput none of these is a pointer. There is no write-only
// field here, the form always shows the whole state, and an empty string has an
// unambiguous meaning — turn that provider off — so the request is a full
// replacement rather than a partial edit, and PUT is the honest verb.
//
// Decode runs with DisallowUnknownFields, so this struct and the TypeScript
// type on the other side are a single contract: one extra key is a 400.
type AnalyticsSettingsInput struct {
	GA4MeasurementID string `json:"ga4_measurement_id"`
	GTMContainerID   string `json:"gtm_container_id"`
	MatomoURL        string `json:"matomo_url"`
	MatomoSiteID     string `json:"matomo_site_id"`
}

// ListFilter describes how the link list should be queried. OwnerID narrows the
// result to one account; nil means no restriction, which is the administrator's
// view. It is filled in from the request context, not from the query string.
type ListFilter struct {
	Search  string
	Status  string
	Tag     string
	Sort    string
	Limit   int
	Offset  int
	OwnerID *string
}

// LinkPage is the paginated response for the link list.
type LinkPage struct {
	Links  []LinkRank `json:"links"`
	Total  int64      `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

// ImportReport summarises a CSV import. Errors is capped by the importer so a
// malformed file cannot produce an unbounded response.
type ImportReport struct {
	Created int           `json:"created"`
	Failed  int           `json:"failed"`
	Errors  []ImportError `json:"errors"`
}

// ImportError describes one rejected CSV row, keyed by its 1-based line number
// so the operator can find it in a spreadsheet.
type ImportError struct {
	Line   int    `json:"line"`
	Alias  string `json:"alias,omitempty"`
	Reason string `json:"reason"`
}
