package domain

import "time"

// ReferrerStat is one row of a referrer breakdown.
// An empty Referrer means the visit had no Referer header (direct traffic).
type ReferrerStat struct {
	Referrer string `json:"referrer"`
	Clicks   int64  `json:"clicks"`
}

// LinkRank is a link together with its click count within the queried range.
type LinkRank struct {
	Link
	Clicks int64 `json:"clicks"`
	// ShortURL is filled for link-list responses. It is optional here because
	// the same rank type also powers statistics, where rendering a public URL
	// is unnecessary.
	ShortURL string `json:"short_url,omitempty"`
}

// LinkStats is the full statistics payload for a single link.
type LinkStats struct {
	TotalClicks int64          `json:"total_clicks"`
	Daily       []DailyStat    `json:"daily"`
	Referrers   []ReferrerStat `json:"referrers"`
}

// TrendPoint is one day of the global click series. Days without traffic are
// returned with a zero count so charts do not have to fill gaps themselves.
type TrendPoint struct {
	Day    time.Time `json:"day"`
	Clicks int64     `json:"clicks"`
}

// DeviceStat buckets clicks by a coarse classification of the user agent.
const (
	DeviceDesktop = "desktop"
	DeviceMobile  = "mobile"
	DeviceTablet  = "tablet"
	DeviceBot     = "bot"
	DeviceUnknown = "unknown"
)

type DeviceStat struct {
	Device string `json:"device"`
	Clicks int64  `json:"clicks"`
}

// RecentClick is a single entry of the raw click feed.
type RecentClick struct {
	LinkID     string    `json:"link_id"`
	Alias      string    `json:"alias"`
	OccurredAt time.Time `json:"occurred_at"`
	Referrer   string    `json:"referrer"`
	UserAgent  string    `json:"user_agent"`
}

// ClickPage is the paginated raw click log for one link.
type ClickPage struct {
	Clicks []RecentClick `json:"clicks"`
	Total  int64         `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

// StatsOverview is the aggregate payload behind the analytics dashboard.
type StatsOverview struct {
	TotalLinks     int64          `json:"total_links"`
	TotalClicks    int64          `json:"total_clicks"`
	UniqueVisitors int64          `json:"unique_visitors"`
	Trend          []TrendPoint   `json:"trend"`
	Referrers      []ReferrerStat `json:"referrers"`
	Devices        []DeviceStat   `json:"devices"`
	RecentClicks   []RecentClick  `json:"recent_clicks"`
	From           string         `json:"from"`
	To             string         `json:"to"`
	// IPMode is the effective IP_HASH_MODE. Under "none" no address is stored,
	// so UniqueVisitors is structurally zero rather than genuinely zero, and the
	// dashboard hides the card instead of reporting a misleading number.
	IPMode string `json:"ip_mode"`
}
