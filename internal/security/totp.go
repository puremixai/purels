package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// TOTP parameters. These are the values the otpauth URI advertises, and they
// are the interoperable defaults every authenticator app assumes.
const (
	TOTPPeriod = 30 * time.Second
	TOTPDigits = 6
)

const (
	// 160 bits is the key size RFC 4226 recommends for HMAC-SHA-1, and what
	// every authenticator app generates.
	totpSecretBytes = 20
	// How many steps either side of "now" are accepted. One step absorbs a
	// clock that is slightly fast or slow without widening the window enough to
	// matter for a six-digit code.
	totpSkew = 1
)

// Secrets travel as base32 without padding, which is what the otpauth URI uses.
var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// recoveryAlphabet omits 0, 1, i, l and o: a recovery code is read off a screen
// and typed by hand, and those five are where people go wrong.
const recoveryAlphabet = "23456789abcdefghjkmnpqrstuvwxyz"

const (
	recoveryCodeLength = 10
	// recoveryCodeGroup splits the code in half for legibility. The dash is
	// presentation only: NormalizeRecoveryCode strips it before comparison.
	recoveryCodeGroup = 5
)

// NewTOTPSecret returns a fresh base32 secret. The caller stores it encrypted;
// the string form is what goes into the QR code and into the account's
// authenticator app.
func NewTOTPSecret() (string, error) {
	buf := make([]byte, totpSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return totpEncoding.EncodeToString(buf), nil
}

// DecodeTOTPSecret accepts what a person or a scanned QR code actually produces
// rather than what the encoder emitted: mixed case, embedded spaces, and the
// padding an authenticator may have added. Rejecting those would be a support
// burden for no security gain, since the decoded bytes are what matter.
func DecodeTOTPSecret(secret string) ([]byte, error) {
	normalized := strings.ToUpper(strings.TrimSpace(secret))
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.TrimRight(normalized, "=")
	if normalized == "" {
		return nil, errors.New("totp secret is empty")
	}
	key, err := totpEncoding.DecodeString(normalized)
	if err != nil {
		return nil, errors.New("totp secret is not valid base32")
	}
	if len(key) == 0 {
		return nil, errors.New("totp secret is empty")
	}
	return key, nil
}

// TOTPCode returns the code for a specific instant. It is used by the tests and
// by anything that needs to display a current code; verification should use
// VerifyTOTP so the drift window is applied consistently.
func TOTPCode(secret string, at time.Time) (string, error) {
	key, err := DecodeTOTPSecret(secret)
	if err != nil {
		return "", err
	}
	return hotp(key, uint64(counterAt(at)), TOTPDigits), nil
}

// VerifyTOTP reports whether a code is valid for the given instant, accepting
// one step of clock drift either way.
//
// The comparison is constant time and the loop does not stop early, so the time
// taken says nothing about which step — if any — matched.
func VerifyTOTP(secret, code string, at time.Time) bool {
	candidate := strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(candidate) != TOTPDigits {
		return false
	}
	key, err := DecodeTOTPSecret(secret)
	if err != nil {
		return false
	}
	base := counterAt(at)
	matched := false
	for offset := -totpSkew; offset <= totpSkew; offset++ {
		step := base + int64(offset)
		if step < 0 {
			continue
		}
		expected := hotp(key, uint64(step), TOTPDigits)
		if subtle.ConstantTimeCompare([]byte(expected), []byte(candidate)) == 1 {
			matched = true
		}
	}
	return matched
}

// OTPAuthURL is the URI an authenticator app scans. The label carries the
// issuer as well as the account because most apps show only the label, and
// "admin" alone does not say which service it belongs to.
func OTPAuthURL(issuer, account, secret string) string {
	query := url.Values{}
	query.Set("secret", secret)
	query.Set("issuer", issuer)
	query.Set("algorithm", "SHA1")
	query.Set("digits", strconv.Itoa(TOTPDigits))
	query.Set("period", strconv.Itoa(int(TOTPPeriod.Seconds())))
	return "otpauth://totp/" + url.PathEscape(issuer+":"+account) + "?" + query.Encode()
}

// NewRecoveryCodes returns freshly generated single-use codes.
//
// They are hashed with a plain SHA-256 rather than argon2id, which is the
// opposite of the password rule: a password is low-entropy and needs a slow
// hash, while these carry roughly 49 bits of entropy and are spent on first use,
// so a slow hash would only make verification expensive for the server.
func NewRecoveryCodes(count int) ([]string, error) {
	codes := make([]string, 0, count)
	for i := 0; i < count; i++ {
		buf := make([]byte, recoveryCodeLength)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		var builder strings.Builder
		for index, value := range buf {
			if index == recoveryCodeGroup {
				builder.WriteByte('-')
			}
			builder.WriteByte(recoveryAlphabet[int(value)%len(recoveryAlphabet)])
		}
		codes = append(codes, builder.String())
	}
	return codes, nil
}

// NormalizeRecoveryCode puts a typed code into the form the hash was taken
// from: lower case, no dashes, no surrounding space.
func NormalizeRecoveryCode(code string) string {
	normalized := strings.ToLower(strings.TrimSpace(code))
	normalized = strings.ReplaceAll(normalized, "-", "")
	return strings.ReplaceAll(normalized, " ", "")
}

// counterAt is the RFC 6238 time step: seconds since the epoch divided by the
// period. Truncating division on a negative Unix time would round toward zero,
// but no supported clock is before 1970.
func counterAt(at time.Time) int64 { return at.Unix() / int64(TOTPPeriod.Seconds()) }

// hotp is the RFC 4226 construction: HMAC-SHA-1 over the big-endian counter,
// then dynamic truncation to the low `digits` decimal digits. It is generic over
// the digit count because RFC 6238's own test vectors are eight digits long.
func hotp(key []byte, counter uint64, digits int) string {
	var message [8]byte
	binary.BigEndian.PutUint64(message[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(message[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff

	modulo := uint32(1)
	for i := 0; i < digits; i++ {
		modulo *= 10
	}
	return fmt.Sprintf("%0*d", digits, value%modulo)
}
