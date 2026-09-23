package config

import (
	"testing"
	"time"
)

func TestLoadLocation(t *testing.T) {
	location, name := loadLocation("Asia/Shanghai")
	if name != "Asia/Shanghai" || location.String() != "Asia/Shanghai" {
		t.Fatalf("loadLocation returned %q / %v", name, location)
	}
	// 23:30 UTC on the 18th is already the 19th in Shanghai, which is the whole
	// point of the setting: the bucket a click lands in must follow the zone.
	utc := time.Date(2026, 9, 18, 23, 30, 0, 0, time.UTC)
	if got := utc.In(location).Format("2006-01-02"); got != "2026-09-19" {
		t.Fatalf("Shanghai day = %s, want 2026-09-19", got)
	}

	// An unknown or empty zone must degrade to UTC rather than panic or refuse
	// to start: a bad display setting should not take the service down.
	for _, bad := range []string{"", "Not/AZone"} {
		location, name := loadLocation(bad)
		if name != "UTC" || location != time.UTC {
			t.Fatalf("loadLocation(%q) = %q / %v, want UTC", bad, name, location)
		}
	}
}

func TestLocationIsNeverNil(t *testing.T) {
	var empty Config
	if empty.Location() != time.UTC {
		t.Fatal("a zero Config must report UTC, not a nil location")
	}
	if (&Config{StatsLocation: time.FixedZone("X", 3600)}).Location().String() != "X" {
		t.Fatal("Location must return the configured zone")
	}
}

// The key was renamed when it stopped being TOTP-only. The old name still has to
// work, because the stored ciphertext records nothing about which name wrote it:
// an operator who renames the variable without carrying the value over would
// make every existing enrolment undecryptable.
func TestSecretEncryptionKeyAcceptsBothNames(t *testing.T) {
	const current, legacy = "0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210"
	cases := []struct {
		name    string
		current string
		legacy  string
		want    string
	}{
		{"the new name wins when both are set", current, legacy, current},
		{"the old name is read when the new one is empty", "", legacy, legacy},
		{"neither set leaves the feature off", "", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SECRET_ENCRYPTION_KEY", tc.current)
			t.Setenv("TOTP_ENCRYPTION_KEY", tc.legacy)
			if got := secretEncryptionKey(); got != tc.want {
				t.Fatalf("secretEncryptionKey() = %q, want %q", got, tc.want)
			}
		})
	}
}

// Both features are fail-closed on the same key: TOTP enrolment and OIDC client
// secrets are both refused when it is absent.
//
// The second factor's own switch is deliberately not checked here. It is a
// runtime setting rather than a field of this struct, so the pairing between it
// and this key is answered where both are in scope — service.AuthService and
// service.TwoFactorService.
func TestSecretsAvailable(t *testing.T) {
	if (Config{}).SecretsAvailable() {
		t.Fatal("a key-less deployment must not report secrets as available")
	}
	withKey := Config{SecretEncryptionKey: "0123456789abcdef0123456789abcdef"}
	if !withKey.SecretsAvailable() {
		t.Fatal("a configured key must report secrets as available")
	}
}

// The redirect URI is registered verbatim at the IdP, so it is taken from
// configuration and never from the request. The default is the origin of
// PUBLIC_URL, which is right when the console shares a host with the API.
func TestOIDCRedirectBase(t *testing.T) {
	cases := []struct {
		name      string
		override  string
		publicURL string
		want      string
	}{
		{"an explicit base wins", "https://console.example.com", "http://links.example.com", "https://console.example.com"},
		{"a trailing slash is trimmed", "https://console.example.com/", "", "https://console.example.com"},
		{"otherwise the origin of PUBLIC_URL", "", "http://localhost", "http://localhost"},
		{"a port is kept", "", "http://localhost:8080", "http://localhost:8080"},
		{"a path is dropped", "", "https://links.example.com/some/path", "https://links.example.com"},
		{"an unusable PUBLIC_URL yields nothing", "", "not-a-url", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("OIDC_REDIRECT_BASE", tc.override)
			if got := oidcRedirectBase(tc.publicURL); got != tc.want {
				t.Fatalf("oidcRedirectBase(%q) = %q, want %q", tc.publicURL, got, tc.want)
			}
		})
	}
}

// A non-positive TTL would expire every authorization request before the browser
// could come back, which reads as a broken IdP rather than a bad setting.
func TestOIDCRequestTTLIsClamped(t *testing.T) {
	for _, bad := range []string{"0s", "-5m"} {
		t.Setenv("OIDC_REQUEST_TTL", bad)
		if got := Load().OIDCRequestTTL; got != 10*time.Minute {
			t.Fatalf("OIDC_REQUEST_TTL=%s produced %v, want 10m", bad, got)
		}
	}
	t.Setenv("OIDC_REQUEST_TTL", "3m")
	if got := Load().OIDCRequestTTL; got != 3*time.Minute {
		t.Fatalf("OIDC_REQUEST_TTL=3m produced %v, want 3m", got)
	}
}

func TestLoadToleratesEmptyAdminOriginList(t *testing.T) {
	t.Setenv("ADMIN_ORIGIN", ", ,")

	cfg := Load()
	if cfg.AdminOrigin != "" {
		t.Fatalf("AdminOrigin = %q, want empty", cfg.AdminOrigin)
	}
	if len(cfg.AdminOrigins) != 0 {
		t.Fatalf("AdminOrigins = %#v, want an empty list", cfg.AdminOrigins)
	}
}
