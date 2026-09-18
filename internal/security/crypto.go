package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
)

// ErrNoEncryptionKey is returned when a secret is stored or read without a
// configured key. It is a distinct error so the caller can report "the operator
// has not configured this" rather than a generic failure.
var ErrNoEncryptionKey = errors.New("no encryption key configured")

// SecretBox encrypts short secrets at rest with AES-256-GCM.
//
// The zero value is deliberately unusable, unlike IPHasher whose zero value is
// its default mode: there is no safe default key here, and generating one per
// process would mean every restart silently loses the ability to read what the
// previous process wrote. Callers check Available and refuse the operation.
type SecretBox struct{ aead cipher.AEAD }

// NewSecretBox builds a box from a configured key. The key is accepted in the
// three forms an operator actually pastes — 32 raw bytes, 64 hex characters, or
// base64 for 32 bytes — and anything else is an error. Deriving a key from
// whatever length was supplied would turn a typo into silently unrecoverable
// data.
func NewSecretBox(key string) (SecretBox, error) {
	raw, err := decodeKey(key)
	if err != nil {
		return SecretBox{}, err
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return SecretBox{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return SecretBox{}, err
	}
	return SecretBox{aead: aead}, nil
}

// Available reports whether a key was configured. Enrolment is refused without
// it, so a deployment can never accumulate secrets it cannot read back.
func (b SecretBox) Available() bool { return b.aead != nil }

// Seal returns the random nonce followed by the ciphertext and its tag. The
// nonce is not secret and does not need to be stored separately; GCM is safe
// here because every call draws a fresh random nonce.
func (b SecretBox) Seal(plaintext []byte) ([]byte, error) {
	if b.aead == nil {
		return nil, ErrNoEncryptionKey
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return b.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Open reverses Seal. A wrong key and a tampered ciphertext are
// indistinguishable at this level and both mean the value cannot be trusted, so
// they share one error.
func (b SecretBox) Open(sealed []byte) ([]byte, error) {
	if b.aead == nil {
		return nil, ErrNoEncryptionKey
	}
	size := b.aead.NonceSize()
	if len(sealed) < size+b.aead.Overhead() {
		return nil, errors.New("stored secret is too short to be ciphertext")
	}
	plaintext, err := b.aead.Open(nil, sealed[:size], sealed[size:], nil)
	if err != nil {
		return nil, errors.New("could not decrypt the stored secret")
	}
	return plaintext, nil
}

// decodeKey resolves the configured key. A 32-character string is read as 32
// raw bytes rather than as hex, because hex for 32 bytes is 64 characters: a
// 32-character string can only be a usable key if it is taken literally.
func decodeKey(key string) ([]byte, error) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return nil, ErrNoEncryptionKey
	}
	if len(trimmed) == 32 {
		return []byte(trimmed), nil
	}
	if decoded, err := hex.DecodeString(trimmed); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if decoded, err := base64.StdEncoding.DecodeString(trimmed); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	return nil, errors.New("the encryption key must be 32 raw bytes, 64 hex characters, or base64 for 32 bytes")
}
