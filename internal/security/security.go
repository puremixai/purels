package security

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/crypto/argon2"
)

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

var aliasPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`)
var reserved = map[string]struct{}{
	"api": {}, "admin": {}, "login": {}, "healthz": {}, "readyz": {}, "metrics": {},
	"favicon.ico": {}, "robots.txt": {},
}

const (
	maxTitleLength = 255
	maxTagLength   = 64
	maxTagsPerLink = 20
)

// tagPattern allows Unicode letters so non-Latin tags work, plus the two
// separators that survive a round trip through a URL query string unescaped.
var tagPattern = regexp.MustCompile(`^[\p{L}\p{N}_-]+$`)

// usernamePattern is deliberately narrower than the alias pattern: an account
// name is typed by a human and read by an administrator, so it stays lower-case
// ASCII with the two separators that never need URL escaping.
var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,31}$`)

const (
	minPasswordLength = 12
	maxPasswordLength = 128
)

// NormalizeUsername trims and lower-cases a username, then validates it.
// Lower-casing is what makes usernames case-insensitive: "Admin" and "admin"
// are the same account, so the unique index can stay a plain one.
func NormalizeUsername(raw string) (string, error) {
	username := strings.ToLower(strings.TrimSpace(raw))
	if !usernamePattern.MatchString(username) {
		return "", errors.New("username must be 3-32 characters of a-z, 0-9, underscore or hyphen, starting with a letter or digit")
	}
	return username, nil
}

// ValidatePassword enforces the same floor as the bootstrap password. The
// ceiling only exists so a hostile registration cannot force a huge hash.
func ValidatePassword(password string) error {
	if len([]rune(password)) < minPasswordLength {
		return fmt.Errorf("password must be at least %d characters", minPasswordLength)
	}
	if len([]rune(password)) > maxPasswordLength {
		return fmt.Errorf("password must be at most %d characters", maxPasswordLength)
	}
	return nil
}

// NormalizeTitle trims a link title and enforces the column width.
func NormalizeTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if len([]rune(title)) > maxTitleLength {
		return "", fmt.Errorf("title must be at most %d characters", maxTitleLength)
	}
	return title, nil
}

// NormalizeTags trims, lower-cases, de-duplicates and validates tags.
//
// Lower-casing is deliberate: tag names are the filter key, so "News" and
// "news" have to collapse into one tag rather than two indistinguishable ones.
func NormalizeTags(tags []string) ([]string, error) {
	out := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, raw := range tags {
		name := strings.ToLower(strings.TrimSpace(raw))
		if name == "" {
			continue
		}
		if len([]rune(name)) > maxTagLength {
			return nil, fmt.Errorf("tag must be at most %d characters", maxTagLength)
		}
		if !tagPattern.MatchString(name) {
			return nil, fmt.Errorf("tag %q may only contain letters, digits, underscore or hyphen", name)
		}
		if _, duplicate := seen[name]; duplicate {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	if len(out) > maxTagsPerLink {
		return nil, fmt.Errorf("a link may have at most %d tags", maxTagsPerLink)
	}
	return out, nil
}

func RandomString(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	result := make([]byte, length)
	for i, value := range buf {
		result[i] = alphabet[int(value)%len(alphabet)]
	}
	return string(result), nil
}

func HashBytes(value string) []byte {
	hash := sha256.Sum256([]byte(value))
	return hash[:]
}

func ConstantTimeEqual(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// AliasReserved reports whether an alias collides with a path the server serves
// itself. Generated aliases are checked against it so a short code can never
// shadow a built-in route.
func AliasReserved(alias string) bool {
	_, ok := reserved[strings.ToLower(alias)]
	return ok
}

func ValidateAlias(alias string) error {
	if AliasReserved(alias) {
		return errors.New("alias is reserved")
	}
	if !aliasPattern.MatchString(alias) {
		return errors.New("alias must be 3-64 ASCII letters, digits, underscore or hyphen")
	}
	return nil
}

// NormalizeAlias lower-cases a caller-supplied alias and validates it. Aliases
// are case-insensitive, which the unique index on lower(alias) enforces for rows
// written outside the application.
func NormalizeAlias(alias string) (string, error) {
	normalized := strings.ToLower(alias)
	if err := ValidateAlias(normalized); err != nil {
		return "", err
	}
	return normalized, nil
}

// botMarkers identify a non-human visitor. The list is the same one the device
// breakdown used in SQL, so a click that is left out of the totals is also the
// one classified as a bot.
var botMarkers = []string{"bot", "crawler", "spider", "curl/", "wget"}

// IsBotUA reports whether a user agent belongs to a crawler or a command-line
// client. Note that curl and wget count as bots, so a hand-run curl against a
// short link will not show up in the statistics.
func IsBotUA(userAgent string) bool {
	lowered := strings.ToLower(userAgent)
	for _, marker := range botMarkers {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}

// tabletMarkers and mobileMarkers are deliberately mirrored by the ILIKE
// patterns in Store.DeviceBreakdown. The two must stay in step: a "device" rule
// has to fire for exactly the visitors that the chart counts under that label,
// otherwise the redirect and the statistics would disagree about the same click.
var tabletMarkers = []string{"ipad", "tablet"}
var mobileMarkers = []string{"mobile", "android", "iphone", "ipod"}

// deviceClasses is the vocabulary a "device" rule may match on: exactly the
// values DeviceClass can return.
var deviceClasses = map[string]struct{}{
	"unknown": {}, "bot": {}, "tablet": {}, "mobile": {}, "desktop": {},
}

// IsDeviceClass reports whether a value is one DeviceClass can return. Rule
// validation uses it so a mistyped device name is a clear error rather than a
// rule that silently never fires.
func IsDeviceClass(value string) bool {
	_, ok := deviceClasses[value]
	return ok
}

// DeviceClass names the coarse device bucket a user agent falls into. It
// mirrors the CASE in Store.DeviceBreakdown clause for clause, including the
// order: a crawler that calls itself mobile is a bot.
func DeviceClass(userAgent string) string {
	if userAgent == "" {
		return "unknown"
	}
	if IsBotUA(userAgent) {
		return "bot"
	}
	lowered := strings.ToLower(userAgent)
	if containsAny(lowered, tabletMarkers) {
		return "tablet"
	}
	if containsAny(lowered, mobileMarkers) {
		return "mobile"
	}
	return "desktop"
}

func containsAny(lowered string, markers []string) bool {
	for _, marker := range markers {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}

// EncodeBase36 renders a positive integer in lowercase Base36 — the alphabet
// YOURLS uses for its sequential short codes.
func EncodeBase36(value int64) string {
	if value <= 0 {
		return "0"
	}
	// A signed 64-bit integer needs at most 13 Base36 digits.
	var buf [13]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = alphabet[value%36]
		value /= 36
	}
	return string(buf[i:])
}

func ValidateDestination(raw string) error {
	if len(raw) == 0 || len(raw) > 8192 {
		return errors.New("destination URL must be 1-8192 characters")
	}
	if strings.IndexFunc(raw, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return errors.New("destination URL contains control characters")
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Host == "" {
		return errors.New("destination URL is invalid")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("destination URL must use http or https")
	}
	if parsed.User != nil {
		return errors.New("destination URL must not include credentials")
	}
	if host := strings.Trim(parsed.Hostname(), "[]"); isLocalHost(host) {
		return errors.New("destination host is not allowed")
	}
	return nil
}

func isLocalHost(host string) bool {
	if strings.EqualFold(host, "localhost") || host == "" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
	}
	return false
}

// HostDenied reports whether a destination's host is on the denylist. Entries
// are bare host names and also cover their subdomains, so "bit.ly" blocks
// "www.bit.ly" as well. An unparseable destination is left to
// ValidateDestination to reject.
func HostDenied(destination string, denylist []string) bool {
	if len(denylist) == 0 {
		return false
	}
	parsed, err := url.Parse(destination)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, entry := range denylist {
		if host == entry || strings.HasSuffix(host, "."+entry) {
			return true
		}
	}
	return false
}

func HashPassword(password string) (string, error) {
	if password == "" {
		return "", errors.New("password cannot be empty")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func CheckPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[4])
	expected, err2 := base64.RawStdEncoding.DecodeString(parts[5])
	if err1 != nil || err2 != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
