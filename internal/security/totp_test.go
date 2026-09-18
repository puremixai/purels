package security

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

// rfcSecret is the ASCII seed from RFC 6238 appendix B. The vectors below are
// defined against these 20 raw bytes, so they exercise hotp directly rather than
// going through base32.
const rfcSecret = "12345678901234567890"

func TestHOTPMatchesRFC6238Vectors(t *testing.T) {
	vectors := []struct {
		unix int64
		code string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	}
	key := []byte(rfcSecret)
	for _, vector := range vectors {
		counter := uint64(vector.unix / 30)
		if got := hotp(key, counter, 8); got != vector.code {
			t.Errorf("hotp at %d: expected %s, got %s", vector.unix, vector.code, got)
		}
	}
}

// The six-digit code is the eight-digit value modulo 10^6, so it must be the
// last six digits of the published vector. This is what ties the project's
// parameters to the standard rather than to a self-consistent implementation.
func TestTOTPCodeIsTheLowSixDigitsOfTheVector(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte(rfcSecret))
	for _, vector := range []struct {
		unix int64
		code string
	}{{59, "94287082"}, {1111111109, "07081804"}, {2000000000, "69279037"}} {
		got, err := TOTPCode(secret, time.Unix(vector.unix, 0))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if want := vector.code[2:]; got != want {
			t.Errorf("at %d: expected %s, got %s", vector.unix, want, got)
		}
	}
}

func TestVerifyTOTPAcceptsOneStepOfDrift(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte(rfcSecret))
	at := time.Unix(1111111109, 0)

	for _, offset := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		code, err := TOTPCode(secret, at.Add(offset))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !VerifyTOTP(secret, code, at) {
			t.Errorf("expected the code from %s away to be accepted", offset)
		}
	}
	// Two steps is 60 seconds, which is a clock that is genuinely wrong rather
	// than merely drifting.
	for _, offset := range []time.Duration{-60 * time.Second, 60 * time.Second} {
		code, err := TOTPCode(secret, at.Add(offset))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if VerifyTOTP(secret, code, at) {
			t.Errorf("expected the code from %s away to be rejected", offset)
		}
	}
}

func TestVerifyTOTPRejectsMalformedInput(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte(rfcSecret))
	at := time.Unix(1111111109, 0)
	for _, code := range []string{"", "12345", "1234567", "abcdef", "12345a", " "} {
		if VerifyTOTP(secret, code, at) {
			t.Errorf("expected %q to be rejected", code)
		}
	}
	// A secret that is not base32 cannot verify anything, and must not panic.
	if VerifyTOTP("not!base32", "123456", at) {
		t.Error("expected a malformed secret to verify nothing")
	}
}

func TestDecodeTOTPSecretAcceptsTypedForms(t *testing.T) {
	want := totpEncoding.EncodeToString([]byte(rfcSecret))
	// What an operator or an authenticator might hand back: padded, lower case,
	// grouped, or with the padding stripped.
	for _, input := range []string{want, strings.ToLower(want), want + "====", "  " + want + "  "} {
		key, err := DecodeTOTPSecret(input)
		if err != nil {
			t.Errorf("expected %q to decode, got %v", input, err)
			continue
		}
		if string(key) != rfcSecret {
			t.Errorf("expected %q, got %q", rfcSecret, string(key))
		}
	}
	for _, input := range []string{"", "   ", "not!base32", "===="} {
		if _, err := DecodeTOTPSecret(input); err == nil {
			t.Errorf("expected %q to be rejected", input)
		}
	}
}

func TestNewTOTPSecretIsUsable(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		secret, err := NewTOTPSecret()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if seen[secret] {
			t.Fatalf("secret %q was generated twice", secret)
		}
		seen[secret] = true
		// It has to survive its own round trip, and a code has to come out of it.
		key, err := DecodeTOTPSecret(secret)
		if err != nil {
			t.Fatalf("generated secret does not decode: %v", err)
		}
		if len(key) != totpSecretBytes {
			t.Fatalf("expected %d key bytes, got %d", totpSecretBytes, len(key))
		}
		code, err := TOTPCode(secret, time.Now())
		if err != nil || len(code) != TOTPDigits {
			t.Fatalf("expected a %d-digit code, got %q (%v)", TOTPDigits, code, err)
		}
		if !VerifyTOTP(secret, code, time.Now()) {
			t.Fatal("a freshly generated code must verify")
		}
	}
}

func TestOTPAuthURL(t *testing.T) {
	secret := totpEncoding.EncodeToString([]byte(rfcSecret))
	raw := OTPAuthURL("Purels", "admin", secret)

	if !strings.HasPrefix(raw, "otpauth://totp/") {
		t.Fatalf("unexpected scheme: %s", raw)
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("the URI must parse: %v", err)
	}
	if parsed.Host != "totp" {
		t.Fatalf("expected host totp, got %q", parsed.Host)
	}
	if label := strings.TrimPrefix(parsed.Path, "/"); label != "Purels:admin" {
		t.Fatalf("expected the label Purels:admin, got %q", label)
	}
	query := parsed.Query()
	for key, want := range map[string]string{
		"secret":    secret,
		"issuer":    "Purels",
		"algorithm": "SHA1",
		"digits":    "6",
		"period":    "30",
	} {
		if got := query.Get(key); got != want {
			t.Errorf("expected %s=%s, got %q", key, want, got)
		}
	}
}

func TestRecoveryCodes(t *testing.T) {
	codes, err := NewRecoveryCodes(10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(codes) != 10 {
		t.Fatalf("expected 10 codes, got %d", len(codes))
	}
	seen := map[string]bool{}
	for _, code := range codes {
		if seen[code] {
			t.Fatalf("code %q was generated twice", code)
		}
		seen[code] = true

		normalized := NormalizeRecoveryCode(code)
		if len(normalized) != recoveryCodeLength {
			t.Fatalf("expected %d characters, got %q", recoveryCodeLength, normalized)
		}
		for _, char := range normalized {
			if !strings.ContainsRune(recoveryAlphabet, char) {
				t.Fatalf("code %q contains the ambiguous character %q", code, char)
			}
		}
		// Normalising must be idempotent, and must accept what a person types
		// back: upper case, with the dash, with stray spaces.
		if again := NormalizeRecoveryCode(normalized); again != normalized {
			t.Fatalf("normalising %q twice changed it to %q", normalized, again)
		}
		typed := strings.ToUpper(normalized[:recoveryCodeGroup]) + " " + strings.ToUpper(normalized[recoveryCodeGroup:])
		if NormalizeRecoveryCode(typed) != normalized {
			t.Fatalf("expected %q to normalise to %q", typed, normalized)
		}
	}
}
