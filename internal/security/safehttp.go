package security

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
)

// ProbeTimeout bounds one destination check. It is well under the API's own
// request timeout, so a slow destination cannot hold a request open.
const ProbeTimeout = 10 * time.Second

// NewProbeClient returns the client used to check a link's destination.
//
// Destinations are chosen by whoever creates a link and sign-up is open, so a
// probe that followed them blindly would let any account reach loopback,
// private and link-local addresses through the server. The dialer therefore
// resolves the name itself and refuses to connect to an address that is not
// routable from the public internet. Redirects are not followed: the status of
// the link is the whole answer, and following one would be a second chance to
// reach a blocked address.
//
// Note that this resolves the name again on every dial, so a record that
// changes between the check and the connection cannot redirect the probe
// inwards.
func NewProbeClient() *http.Client {
	dialer := &net.Dialer{Timeout: ProbeTimeout}
	return &http.Client{
		Timeout:       ProbeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
				return probeDial(ctx, dialer, network, address)
			},
			DisableKeepAlives:   true,
			TLSHandshakeTimeout: ProbeTimeout,
		},
	}
}

// probeDial resolves a destination and connects to the first address the server
// is allowed to reach, rather than handing the name to the resolver.
func probeDial(ctx context.Context, dialer *net.Dialer, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, candidate := range resolved {
		if !RoutableIP(candidate.IP) {
			lastErr = fmt.Errorf("refusing to connect to %s", candidate.IP)
			continue
		}
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no address found for %s", host)
	}
	return nil, lastErr
}

// RoutableIP reports whether an address is one the server may reach on behalf
// of a user-supplied URL. Global unicast excludes loopback, multicast,
// link-local, unspecified and the broadcast address; the private check adds
// RFC 1918 and RFC 4193 ranges on top.
func RoutableIP(ip net.IP) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate()
}
