package config

import (
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	// Embed the IANA database so STATS_TZ works on images without tzdata
	// installed (the runtime image is plain alpine).
	_ "time/tzdata"

	"github.com/purels/purels/internal/security"
)

type Config struct {
	Addr              string
	DatabaseURL       string
	RedisURL          string
	PublicURL         string
	AdminOrigin       string
	AdminOrigins      []string
	CookieSecure      bool
	SessionTTL        time.Duration
	BootstrapUsername string
	BootstrapPassword string

	// AliasMode selects how a short code is generated when the caller does not
	// supply one: "random" (default) or "sequential" (Base36 from a sequence).
	AliasMode string

	// StatsTZ is the IANA zone the statistics day boundaries and daily buckets
	// are computed in. Everything is stored as UTC; this only decides where a
	// "day" starts.
	StatsTZ       string
	StatsLocation *time.Location

	// UniqueURLs makes shortening a destination that already has a live link
	// return that link instead of creating a second one. An explicit alias
	// always wins, so a caller can still force a duplicate deliberately.
	UniqueURLs bool

	// RegistrationEnabled opens the public sign-up endpoint. Turning it off
	// leaves existing accounts working and only blocks new ones.
	RegistrationEnabled bool

	// CountBots includes crawler traffic in the statistics. Bot clicks are
	// always recorded, so this only decides whether they are reported.
	CountBots bool

	// IPHashMode decides what goes into the ip_hash columns: "none",
	// "anonymised" or "pseudonymised" (the default). Always a value from that
	// vocabulary, even when IP_HASH_MODE was unset or misspelled.
	IPHashMode string
	// IPHashKey turns the digest into an HMAC. Empty keeps the historical
	// plain-SHA-256 digest, so an upgrade that only adds this setting does not
	// invalidate the visitor counts already recorded.
	IPHashKey []byte

	// ForwardQuery appends the visitor's query string to the destination, which
	// is what keeps utm_* and similar parameters intact through the redirect.
	ForwardQuery bool

	// FallbackURL is where an unknown short code sends the visitor. Empty means
	// a plain 404.
	FallbackURL string

	// AutoPruneExpired hard-deletes links whose expiry passed more than
	// PruneGrace ago. Off by default: it takes the click history with it, and
	// an operator who wants the rows kept must not lose them to an upgrade.
	AutoPruneExpired bool
	// PruneGrace is how long an expired link is kept before pruning.
	PruneGrace time.Duration

	// MaxLinksPerUser caps how many live links one regular account may own.
	// Zero disables the cap. Administrators are exempt: the cap exists to
	// contain self-service sign-ups, not to constrain the operator.
	MaxLinksPerUser int

	// DestinationDenylist holds host names that may not be shortened. An entry
	// also covers its subdomains.
	DestinationDenylist []string

	// ShortDomains are the extra bare host names a link may be filed under,
	// besides the host in PublicURL. A link stores which one it picked; the
	// scheme always comes from PublicURL. Empty leaves only the default.
	ShortDomains []string

	// HealthCheckEnabled runs the background destination sweep. Off by default:
	// it makes the server issue outbound requests on a schedule, which is a
	// behaviour change an upgrade should not introduce on its own.
	HealthCheckEnabled bool
	// HealthCheckInterval is both how often the sweep runs and how stale a
	// link's last result must be before it is checked again.
	HealthCheckInterval time.Duration

	// TOTPEnabled is the master switch for the built-in second factor. Off by
	// default, and off means "never challenge anyone" even for an account that
	// already has a confirmed secret — which is what lets a deployment that
	// enforces MFA on the OIDC side turn the local one off without unbinding
	// every account.
	TOTPEnabled bool
	// TOTPEncryptionKey is the AES-256-GCM key the TOTP secrets are stored
	// under. Empty means enrolment is refused, because a secret the server
	// cannot read back is worse than no secret.
	TOTPEncryptionKey string
	// TOTPChallengeTTL is how long the half-session between a correct password
	// and a correct second factor stays usable.
	TOTPChallengeTTL time.Duration

	// Rate limiting (per client IP, per minute).
	RateLimitEnabled  bool
	RateLimitLogin    int
	RateLimitAPI      int
	RateLimitRedirect int
	RateLimitRegister int
	// RateLimit2FA guards the second-factor endpoint. It is defence in depth
	// only: the real brute-force bound is the attempt counter stored with the
	// challenge, because the limiter is fail-open when Redis is unavailable.
	RateLimit2FA int
}

// SequentialAliases reports whether generated short codes should be drawn from
// the alias sequence instead of random strings.
func (c Config) SequentialAliases() bool { return c.AliasMode == "sequential" }

// TwoFactorAvailable reports whether the built-in second factor can be used at
// all. Both halves are required, and both the login challenge and enrolment read
// this: a switch-on without a key would otherwise start challenging accounts
// whose secrets can no longer be decrypted, locking out everyone who enrolled.
func (c Config) TwoFactorAvailable() bool {
	return c.TOTPEnabled && c.TOTPEncryptionKey != ""
}

// Location is the statistics timezone, never nil so callers can use it directly.
func (c Config) Location() *time.Location {
	if c.StatsLocation == nil {
		return time.UTC
	}
	return c.StatsLocation
}

// loadLocation resolves an IANA zone name, falling back to UTC. A bad name is
// warned about rather than fatal: refusing to boot over a display setting would
// take a working service down.
func loadLocation(name string) (*time.Location, string) {
	if name == "" {
		return time.UTC, "UTC"
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		slog.Warn("unknown STATS_TZ, falling back to UTC", "stats_tz", name, "err", err)
		return time.UTC, "UTC"
	}
	return location, name
}

func Load() Config {
	adminOrigin := env("ADMIN_ORIGIN", "http://localhost:3000,http://localhost")
	origins := make([]string, 0)
	for _, origin := range strings.Split(adminOrigin, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	statsLocation, statsTZ := loadLocation(strings.TrimSpace(os.Getenv("STATS_TZ")))
	// A negative grace would prune links that have not expired yet, and a
	// negative cap would block every create. Both are clamped rather than
	// trusted, in the direction that cannot destroy data.
	pruneGrace := durationEnv("PRUNE_GRACE", 720*time.Hour)
	if pruneGrace < 0 {
		slog.Warn("ignoring negative PRUNE_GRACE", "prune_grace", pruneGrace)
		pruneGrace = 0
	}
	maxLinksPerUser := intEnv("MAX_LINKS_PER_USER", 1000)
	if maxLinksPerUser < 0 {
		slog.Warn("ignoring negative MAX_LINKS_PER_USER", "max_links_per_user", maxLinksPerUser)
		maxLinksPerUser = 0
	}
	ipHashMode := ipHashModeEnv()
	// A zero or negative TTL would make every challenge expire before the
	// operator could type a code, so it is clamped rather than trusted.
	totpChallengeTTL := durationEnv("TOTP_CHALLENGE_TTL", 5*time.Minute)
	if totpChallengeTTL <= 0 {
		slog.Warn("ignoring non-positive TOTP_CHALLENGE_TTL", "totp_challenge_ttl", totpChallengeTTL)
		totpChallengeTTL = 5 * time.Minute
	}
	return Config{
		Addr:              env("API_ADDR", ":8080"),
		DatabaseURL:       env("DATABASE_URL", "postgres://purels:purels@localhost:5432/purels?sslmode=disable"),
		RedisURL:          env("REDIS_URL", "redis://localhost:6379/0"),
		PublicURL:         env("PUBLIC_URL", "http://localhost:8080"),
		AdminOrigin:       origins[0],
		AdminOrigins:      origins,
		CookieSecure:      boolEnv("COOKIE_SECURE", false),
		SessionTTL:        durationEnv("SESSION_TTL", 24*time.Hour),
		BootstrapUsername: env("BOOTSTRAP_USERNAME", "admin"),
		BootstrapPassword: env("BOOTSTRAP_PASSWORD", "change-me-now"),
		AliasMode:         strings.ToLower(env("ALIAS_MODE", "random")),
		StatsTZ:           statsTZ,
		StatsLocation:     statsLocation,
		UniqueURLs:        boolEnv("UNIQUE_URLS", true),

		RegistrationEnabled: boolEnv("REGISTRATION_ENABLED", true),
		CountBots:           boolEnv("COUNT_BOTS", false),
		IPHashMode:          ipHashMode,
		IPHashKey:           []byte(os.Getenv("IP_HASH_KEY")),
		ForwardQuery:        boolEnv("FORWARD_QUERY", true),
		FallbackURL:         fallbackURL(),

		AutoPruneExpired:    boolEnv("AUTO_PRUNE_EXPIRED", false),
		PruneGrace:          pruneGrace,
		MaxLinksPerUser:     maxLinksPerUser,
		DestinationDenylist: hostListEnv("DESTINATION_DENYLIST"),
		ShortDomains:        hostListEnv("SHORT_DOMAINS"),
		HealthCheckEnabled:  boolEnv("HEALTH_CHECK_ENABLED", false),
		HealthCheckInterval: durationEnv("HEALTH_CHECK_INTERVAL", 24*time.Hour),

		TOTPEnabled:       boolEnv("TOTP_ENABLED", false),
		TOTPEncryptionKey: totpEncryptionKey(),
		TOTPChallengeTTL:  totpChallengeTTL,

		RateLimitEnabled:  boolEnv("RATE_LIMIT_ENABLED", true),
		RateLimitLogin:    intEnv("RATE_LIMIT_LOGIN", 10),
		RateLimitAPI:      intEnv("RATE_LIMIT_API", 120),
		RateLimitRedirect: intEnv("RATE_LIMIT_REDIRECT", 600),
		// Sign-up is the cheapest way to fill the database, so it gets the
		// tightest bucket of the lot.
		RateLimitRegister: intEnv("RATE_LIMIT_REGISTER", 5),
		RateLimit2FA:      intEnv("RATE_LIMIT_2FA", 10),
	}
}

// totpEncryptionKey reads TOTP_ENCRYPTION_KEY and warns about the two ways the
// second factor can end up unusable. Neither warning is fatal: 2FA is off by
// default, and refusing to boot over an optional feature would take a working
// service down.
func totpEncryptionKey() string {
	key := strings.TrimSpace(os.Getenv("TOTP_ENCRYPTION_KEY"))
	enabled := boolEnv("TOTP_ENABLED", false)
	switch {
	case enabled && key == "":
		slog.Warn("TOTP_ENABLED is set but TOTP_ENCRYPTION_KEY is empty: the second factor stays off and enrolment is refused")
	case !enabled && key != "":
		slog.Warn("TOTP_ENCRYPTION_KEY is set but TOTP_ENABLED is false: nobody will be challenged")
	}
	if key != "" {
		// Validated here rather than at first use, so a wrong key is a boot-time
		// warning instead of a failed enrolment an operator has to decode.
		if _, err := security.NewSecretBox(key); err != nil {
			slog.Warn("TOTP_ENCRYPTION_KEY is not usable", "err", err)
		}
	}
	return key
}

// ipHashModeEnv resolves IP_HASH_MODE and warns about the two ways it can be
// set wrong. Both warnings are deliberately non-fatal: the first because a
// misspelling has a safe reading, the second because a missing key only weakens
// a digest that was already weak before this setting existed.
func ipHashModeEnv() string {
	raw := strings.TrimSpace(os.Getenv("IP_HASH_MODE"))
	mode := security.NormalizeIPMode(raw)
	if raw != "" && !strings.EqualFold(raw, mode) {
		slog.Warn("unknown IP_HASH_MODE, using the default", "ip_hash_mode", raw, "using", mode)
	}
	if mode != security.IPModeNone && os.Getenv("IP_HASH_KEY") == "" {
		slog.Warn("IP_HASH_KEY is not set: ip_hash holds a plain SHA-256 digest, which is reversible by brute force over the IPv4 space")
	}
	return mode
}

// fallbackURL validates FALLBACK_URL. Anything that is not an absolute http(s)
// URL would produce a broken Location header on every miss, so it is dropped
// with a warning rather than shipped.
func fallbackURL() string {
	raw := strings.TrimSpace(os.Getenv("FALLBACK_URL"))
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		slog.Warn("ignoring FALLBACK_URL: it must be an absolute http(s) URL", "fallback_url", raw)
		return ""
	}
	return raw
}

// hostListEnv reads a comma-separated host list, lower-casing each entry so the
// comparison against a parsed destination host is a plain equality. Entries
// are bare host names: a leading scheme or a trailing slash would silently
// never match, so they are left as typed.
func hostListEnv(key string) []string {
	hosts := make([]string, 0)
	for _, entry := range strings.Split(os.Getenv(key), ",") {
		if host := strings.ToLower(strings.TrimSpace(entry)); host != "" {
			hosts = append(hosts, host)
		}
	}
	return hosts
}

func intEnv(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func boolEnv(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
