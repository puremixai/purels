package security

import (
	"net"
	"testing"
)

func TestRoutableIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1",        // loopback
		"::1",              // loopback, v6
		"::ffff:127.0.0.1", // loopback, v4-mapped
		"10.0.0.1",         // RFC 1918
		"172.16.5.4",       // RFC 1918
		"192.168.1.1",      // RFC 1918
		"fd00::1",          // RFC 4193
		"169.254.169.254",  // link-local, the cloud metadata address
		"fe80::1",          // link-local, v6
		"0.0.0.0",          // unspecified
		"255.255.255.255",  // broadcast
		"224.0.0.1",        // multicast
		"ff02::1",          // multicast, v6
	}
	for _, raw := range blocked {
		if RoutableIP(net.ParseIP(raw)) {
			t.Errorf("expected %s to be blocked", raw)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"}
	for _, raw := range allowed {
		if !RoutableIP(net.ParseIP(raw)) {
			t.Errorf("expected %s to be allowed", raw)
		}
	}
}

func TestHostDenied(t *testing.T) {
	denylist := []string{"bit.ly", "spam.example"}
	for _, destination := range []string{
		"https://bit.ly/abc",
		"http://www.bit.ly/abc", // subdomains are covered
		"https://deep.spam.example/x",
	} {
		if !HostDenied(destination, denylist) {
			t.Errorf("expected %s to be denied", destination)
		}
	}
	for _, destination := range []string{
		"https://example.com/bit.ly", // the path is not the host
		"https://notbit.ly/x",        // a suffix match must fall on a dot
		"https://bit.ly.evil.example/x",
	} {
		if HostDenied(destination, denylist) {
			t.Errorf("expected %s to be allowed", destination)
		}
	}
	if HostDenied("https://bit.ly/abc", nil) {
		t.Error("an empty denylist must deny nothing")
	}
}
