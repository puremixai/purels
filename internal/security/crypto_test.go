package security

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
)

const testKey = "0123456789abcdef0123456789abcdef"

func TestSecretBoxRoundTrip(t *testing.T) {
	box, err := NewSecretBox(testKey)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !box.Available() {
		t.Fatal("a configured box must report itself available")
	}
	secret := []byte("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
	sealed, err := box.Seal(secret)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bytes.Contains(sealed, secret) {
		t.Fatal("the ciphertext must not contain the plaintext")
	}
	opened, err := box.Open(sealed)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !bytes.Equal(opened, secret) {
		t.Fatalf("expected %q, got %q", secret, opened)
	}
}

// Every seal must draw a fresh nonce, or two accounts with the same secret
// would produce identical ciphertext.
func TestSecretBoxSealsAreUnique(t *testing.T) {
	box, _ := NewSecretBox(testKey)
	first, _ := box.Seal([]byte("same plaintext"))
	second, _ := box.Seal([]byte("same plaintext"))
	if bytes.Equal(first, second) {
		t.Fatal("two seals of the same plaintext must differ")
	}
}

func TestSecretBoxRejectsTamperedCiphertext(t *testing.T) {
	box, _ := NewSecretBox(testKey)
	sealed, _ := box.Seal([]byte("a secret"))
	for _, index := range []int{0, len(sealed) / 2, len(sealed) - 1} {
		tampered := append([]byte(nil), sealed...)
		tampered[index] ^= 0x01
		if _, err := box.Open(tampered); err == nil {
			t.Fatalf("flipping byte %d must make the value unreadable", index)
		}
	}
}

func TestSecretBoxRejectsWrongKey(t *testing.T) {
	sealer, _ := NewSecretBox(testKey)
	sealed, _ := sealer.Seal([]byte("a secret"))
	other, _ := NewSecretBox(strings.Repeat("z", 32))
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("a different key must not decrypt the value")
	}
}

func TestSecretBoxRejectsShortCiphertext(t *testing.T) {
	box, _ := NewSecretBox(testKey)
	for _, input := range [][]byte{nil, {}, []byte("too short")} {
		if _, err := box.Open(input); err == nil {
			t.Fatalf("expected %d bytes to be rejected", len(input))
		}
	}
}

// The zero value has no key, and must refuse rather than invent one: a
// per-process key would make every restart lose the data the last one wrote.
func TestSecretBoxZeroValueIsUnavailable(t *testing.T) {
	var box SecretBox
	if box.Available() {
		t.Fatal("the zero value must not report itself available")
	}
	if _, err := box.Seal([]byte("a secret")); err == nil {
		t.Fatal("the zero value must refuse to seal")
	}
	if _, err := box.Open([]byte("ciphertext")); err == nil {
		t.Fatal("the zero value must refuse to open")
	}
}

func TestDecodeKeyAcceptsTheThreeForms(t *testing.T) {
	raw := []byte(testKey)
	forms := map[string]string{
		"32 raw bytes": testKey,
		"64 hex":       hex.EncodeToString(raw),
		"base64":       base64.StdEncoding.EncodeToString(raw),
		"raw base64":   base64.RawStdEncoding.EncodeToString(raw),
	}
	for name, form := range forms {
		t.Run(name, func(t *testing.T) {
			decoded, err := decodeKey(form)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !bytes.Equal(decoded, raw) {
				t.Fatalf("expected the same key bytes, got %x", decoded)
			}
		})
	}
	// An empty key is its own error, so the caller can say "not configured"
	// rather than "configured wrongly".
	if _, err := NewSecretBox(""); err != ErrNoEncryptionKey {
		t.Fatalf("expected ErrNoEncryptionKey, got %v", err)
	}
	for _, bad := range []string{"short", strings.Repeat("a", 31), strings.Repeat("a", 33), "not-a-key-at-all"} {
		if _, err := NewSecretBox(bad); err == nil {
			t.Fatalf("expected %q to be rejected", bad)
		}
	}
}
