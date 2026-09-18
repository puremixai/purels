package middleware

import (
	"net/http"
	"testing"
)

func TestClientIPPrefersRightmostForwardedEntry(t *testing.T) {
	request := &http.Request{
		RemoteAddr: "172.18.0.5:41234",
		Header:     http.Header{},
	}
	// A client may prepend anything it likes; only the entry appended by our
	// own proxy (the rightmost one) is trustworthy.
	request.Header.Set("X-Forwarded-For", "1.2.3.4, 203.0.113.9")

	if got := ClientIP(request); got != "203.0.113.9" {
		t.Fatalf("expected 203.0.113.9, got %q", got)
	}
}

func TestClientIPFallsBackToRemoteAddr(t *testing.T) {
	request := &http.Request{RemoteAddr: "198.51.100.7:5555", Header: http.Header{}}
	if got := ClientIP(request); got != "198.51.100.7" {
		t.Fatalf("expected 198.51.100.7, got %q", got)
	}
}

func TestClientIPHandlesMissingPort(t *testing.T) {
	request := &http.Request{RemoteAddr: "198.51.100.7", Header: http.Header{}}
	if got := ClientIP(request); got != "198.51.100.7" {
		t.Fatalf("expected 198.51.100.7, got %q", got)
	}
}

func TestClientIPIgnoresBlankForwardedValue(t *testing.T) {
	request := &http.Request{RemoteAddr: "198.51.100.7:5555", Header: http.Header{}}
	request.Header.Set("X-Forwarded-For", " , ")
	if got := ClientIP(request); got != "198.51.100.7" {
		t.Fatalf("expected fallback to remote addr, got %q", got)
	}
}
