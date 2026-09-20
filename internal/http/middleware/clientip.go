package middleware

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP returns the caller's address.
//
// Cloudflare authenticates and forwards the original visitor address in
// CF-Connecting-IP. Prefer it when it is a valid IP; it is the only header that
// survives the Cloudflare hop without being mixed with client-supplied entries.
// For local/Caddy-only deployments, fall back to the rightmost X-Forwarded-For
// entry, which is the address appended by the proxy, and finally the TCP peer.
//
// This holds only while the proxy is the sole way in. A caller who reaches the
// API directly controls the whole header, so every entry looks proxy-written and
// the rightmost one is simply whatever they chose. The deployment therefore
// publishes the API port on loopback only (see deploy/compose.yaml); publishing
// it on the network reopens a rate-limit bypass and lets a caller forge the
// address recorded against their own audit entries.
func ClientIP(r *http.Request) string {
	if candidate := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); net.ParseIP(candidate) != nil {
		return candidate
	}
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		if candidate := strings.TrimSpace(parts[len(parts)-1]); candidate != "" {
			return candidate
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
