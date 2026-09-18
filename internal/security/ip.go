package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"net"
	"strings"
)

// IP hash modes. These strings are both the values IP_HASH_MODE accepts and the
// value reported back to the UI, so this is the vocabulary's only home.
const (
	// IPModeNone stores nothing. The ip_hash columns stay NULL, which means no
	// per-visitor figure can be reconstructed later — the point of the mode.
	IPModeNone = "none"
	// IPModeAnonymised stores a digest of a truncated address, so two visitors
	// behind the same IPv4 /24 or IPv6 /48 are indistinguishable.
	IPModeAnonymised = "anonymised"
	// IPModePseudonymised stores a digest of the full address. Stable enough to
	// count a returning visitor, and unguessable when a key is set.
	IPModePseudonymised = "pseudonymised"
)

// DefaultIPMode is what an unset IP_HASH_MODE means. It is also the mode the
// service used before the setting existed, so an upgrade that changes nothing
// else keeps COUNT(DISTINCT ip_hash) continuous.
const DefaultIPMode = IPModePseudonymised

// IPHasher produces the value stored in the ip_hash columns. It is a value
// type and its zero value is the default mode, so a service can hold one
// without a nil check and one that was never configured still behaves.
type IPHasher struct {
	Mode string
	// Key turns the digest into an HMAC. Without it the stored value is a bare
	// SHA-256 of the address, which anyone holding the database can brute-force
	// over the whole IPv4 space.
	Key []byte
}

// NormalizeIPMode maps a configured mode onto the vocabulary, falling back to
// the default. A typo must not quietly pick a privacy setting on the operator's
// behalf, so it lands on the default and the caller decides whether to warn.
func NormalizeIPMode(mode string) string {
	switch normalized := strings.ToLower(strings.TrimSpace(mode)); normalized {
	case IPModeNone, IPModeAnonymised, IPModePseudonymised:
		return normalized
	default:
		return DefaultIPMode
	}
}

// Name is the effective mode, never empty.
func (h IPHasher) Name() string { return NormalizeIPMode(h.Mode) }

// Hash returns the digest to store for a client address, or nil when the mode
// is "none" or the address is empty. Storing nothing is the point of "none": a
// NULL column cannot be joined back to a visitor.
func (h IPHasher) Hash(ip string) []byte {
	ip = strings.TrimSpace(ip)
	mode := h.Name()
	if ip == "" || mode == IPModeNone {
		return nil
	}
	if mode == IPModeAnonymised {
		ip = truncateIP(ip)
	}
	if len(h.Key) > 0 {
		mac := hmac.New(sha256.New, h.Key)
		mac.Write([]byte(ip))
		return mac.Sum(nil)
	}
	hash := sha256.Sum256([]byte(ip))
	return hash[:]
}

// truncateIP zeroes the part of an address that picks out a single host: the
// last octet of an IPv4 address (/24) or the last ten bytes of an IPv6 address
// (/48). An address that does not parse comes back unchanged — there is nothing
// to truncate, and a digest of what was sent beats a silent gap.
func truncateIP(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	// To4 also matches the IPv4-mapped form, which is what a dual-stack socket
	// reports for an IPv4 client.
	if v4 := parsed.To4(); v4 != nil {
		masked := net.IP{0, 0, 0, 0}
		copy(masked, v4[:3])
		return masked.String()
	}
	v6 := parsed.To16()
	if v6 == nil {
		return ip
	}
	masked := make(net.IP, net.IPv6len)
	copy(masked, v6[:6])
	return masked.String()
}
