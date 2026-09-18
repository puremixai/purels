package domain

import "time"

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

// IsAdmin reports whether the account may see and manage every link.
func (u User) IsAdmin() bool { return u.Role == RoleAdmin }

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
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	Disabled  bool      `json:"disabled"`
	CreatedAt time.Time `json:"created_at"`
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
