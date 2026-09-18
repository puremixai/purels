package security

import (
	"bytes"
	"crypto/sha256"
	"testing"
)

// TestIPHasherModes covers what each mode stores, including the property the
// default has to keep: without a key, pseudonymised is a bare SHA-256 of the
// address, which is the digest every row written before this setting existed
// already holds.
func TestIPHasherModes(t *testing.T) {
	const ip = "203.0.113.9"

	if got := (IPHasher{Mode: IPModeNone}).Hash(ip); got != nil {
		t.Errorf("none: got %x, want nil", got)
	}
	if got := (IPHasher{Mode: IPModeNone, Key: []byte("secret")}).Hash(ip); got != nil {
		t.Errorf("none with a key: got %x, want nil", got)
	}

	plain := sha256.Sum256([]byte(ip))
	if got := (IPHasher{Mode: IPModePseudonymised}).Hash(ip); !bytes.Equal(got, plain[:]) {
		t.Errorf("pseudonymised without a key: got %x, want the plain SHA-256 %x", got, plain)
	}

	keyed := (IPHasher{Mode: IPModePseudonymised, Key: []byte("secret")}).Hash(ip)
	if bytes.Equal(keyed, plain[:]) {
		t.Error("pseudonymised with a key: got the plain SHA-256, want an HMAC")
	}
	if again := (IPHasher{Mode: IPModePseudonymised, Key: []byte("secret")}).Hash(ip); !bytes.Equal(keyed, again) {
		t.Error("pseudonymised with a key: the digest is not stable")
	}
	if other := (IPHasher{Mode: IPModePseudonymised, Key: []byte("other")}).Hash(ip); bytes.Equal(keyed, other) {
		t.Error("pseudonymised with a key: two keys produced the same digest")
	}
}

// TestIPHasherZeroValue pins the property the three holding services rely on:
// an IPHasher that was never configured behaves like the default mode.
func TestIPHasherZeroValue(t *testing.T) {
	var zero IPHasher
	if zero.Name() != DefaultIPMode {
		t.Fatalf("zero value mode = %q, want %q", zero.Name(), DefaultIPMode)
	}
	if got := zero.Hash("203.0.113.9"); len(got) == 0 {
		t.Error("zero value hashed to nothing")
	}
	if got := (IPHasher{Mode: "PSEUDONYMISED "}).Name(); got != IPModePseudonymised {
		t.Errorf("Name() = %q, want the trimmed lower-case mode", got)
	}
	if got := (IPHasher{Mode: "obfuscated"}).Name(); got != DefaultIPMode {
		t.Errorf("unknown mode = %q, want %q", got, DefaultIPMode)
	}
}

// TestIPHasherEmptyAddress makes sure an absent address stores nothing rather
// than a digest of the empty string, which would otherwise look like a visitor.
func TestIPHasherEmptyAddress(t *testing.T) {
	for _, mode := range []string{IPModeNone, IPModeAnonymised, IPModePseudonymised} {
		if got := (IPHasher{Mode: mode}).Hash("  "); got != nil {
			t.Errorf("%s: got %x, want nil", mode, got)
		}
	}
}

// TestIPHasherAnonymisedTruncates is the whole point of the mode: visitors in
// the same network collapse into one digest, and a different network does not.
func TestIPHasherAnonymisedTruncates(t *testing.T) {
	hasher := IPHasher{Mode: IPModeAnonymised}

	if a, b := hasher.Hash("203.0.113.9"), hasher.Hash("203.0.113.200"); !bytes.Equal(a, b) {
		t.Error("IPv4: two addresses in the same /24 hashed differently")
	}
	if a, b := hasher.Hash("203.0.113.9"), hasher.Hash("203.0.114.9"); bytes.Equal(a, b) {
		t.Error("IPv4: two addresses in different /24s hashed the same")
	}
	// The IPv4-mapped form is what a dual-stack socket reports for an IPv4
	// client, so it has to truncate as IPv4 rather than as an IPv6 address.
	if a, b := hasher.Hash("::ffff:203.0.113.9"), hasher.Hash("203.0.113.9"); !bytes.Equal(a, b) {
		t.Error("IPv4-mapped address did not truncate as IPv4")
	}

	if a, b := hasher.Hash("2001:db8:1234:1::1"), hasher.Hash("2001:db8:1234:ffff::2"); !bytes.Equal(a, b) {
		t.Error("IPv6: two addresses in the same /48 hashed differently")
	}
	if a, b := hasher.Hash("2001:db8:1234:1::1"), hasher.Hash("2001:db8:9999::1"); bytes.Equal(a, b) {
		t.Error("IPv6: two addresses in different /48s hashed the same")
	}

	// Truncation must actually change the digest, otherwise the mode would be
	// indistinguishable from pseudonymised.
	full := IPHasher{Mode: IPModePseudonymised}
	if bytes.Equal(hasher.Hash("203.0.113.9"), full.Hash("203.0.113.9")) {
		t.Error("anonymised stored the same digest as pseudonymised")
	}
}

// TestIPHasherUnparseableAddress keeps a malformed address from silently
// vanishing: there is nothing to truncate, but the caller still gets a digest.
func TestIPHasherUnparseableAddress(t *testing.T) {
	hasher := IPHasher{Mode: IPModeAnonymised}
	got := hasher.Hash("not-an-address")
	if len(got) == 0 {
		t.Fatal("got nothing for an unparseable address")
	}
	plain := sha256.Sum256([]byte("not-an-address"))
	if !bytes.Equal(got, plain[:]) {
		t.Error("an unparseable address was not hashed verbatim")
	}
}
