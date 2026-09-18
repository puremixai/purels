package middleware

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP returns the caller's address.
//
// In the bundled deployment the service runs behind Caddy, which appends the
// peer address it observed to X-Forwarded-For. We therefore trust the
// *rightmost* entry — the one written by our own proxy — and ignore earlier
// entries, which a client could have supplied itself. When there is no
// forwarding header the TCP peer address is used.
func ClientIP(r *http.Request) string {
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
