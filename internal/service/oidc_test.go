package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
)

const testKey = "0123456789abcdef0123456789abcdef"

func newOIDCService(t *testing.T, allowInsecure bool, key string) *OIDCService {
	t.Helper()
	box, err := security.NewSecretBox(key)
	if err != nil && key != "" {
		t.Fatalf("could not build the secret box: %v", err)
	}
	return &OIDCService{
		Config: config.Config{OIDCAllowInsecureIssuers: allowInsecure, SecretEncryptionKey: key},
		Box:    box,
	}
}

// A complete, valid submission, so each case can change exactly one thing.
func validInput() domain.OIDCProvider {
	return domain.OIDCProvider{
		Slug:        "dex",
		DisplayName: "公司账号",
		Issuer:      "https://idp.example.com",
		ClientID:    "purels",
		Scopes:      []string{"openid", "profile"},
	}
}

func TestNormalizeProviderAcceptsAValidSubmission(t *testing.T) {
	service := newOIDCService(t, false, testKey)
	provider, err := service.normalizeProvider(validInput())
	if err != nil {
		t.Fatalf("a valid provider was refused: %v", err)
	}
	if provider.Slug != "dex" || provider.Issuer != "https://idp.example.com" {
		t.Fatalf("unexpected canonical form: %#v", provider)
	}
	if len(provider.Scopes) != 2 || provider.Scopes[0] != "openid" {
		t.Fatalf("scopes were not preserved: %#v", provider.Scopes)
	}
}

// The slug is a URL segment, so it is folded rather than rejected for case: the
// operator types the name they know it by, and the callback URL is built from
// what was stored.
func TestNormalizeProviderFoldsTheSlug(t *testing.T) {
	service := newOIDCService(t, false, testKey)
	input := validInput()
	input.Slug = "  Company-SSO  "
	provider, err := service.normalizeProvider(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.Slug != "company-sso" {
		t.Fatalf("slug = %q, want %q", provider.Slug, "company-sso")
	}
}

func TestNormalizeProviderRejectsBadSlugs(t *testing.T) {
	service := newOIDCService(t, false, testKey)
	// The pattern is 2-32 characters starting with a letter or digit: a
	// one-character slug would produce a callback path nobody could read, and a
	// leading dash or underscore would not survive a round trip through a URL.
	for _, bad := range []string{"", "a", "-dex", "_dex", "dex sso", "dex/sso", "dex.sso", strings.Repeat("a", 33)} {
		input := validInput()
		input.Slug = bad
		if _, err := service.normalizeProvider(input); err == nil {
			t.Fatalf("slug %q was accepted", bad)
		}
	}
}

func TestNormalizeProviderRequiresTheVisibleFields(t *testing.T) {
	service := newOIDCService(t, false, testKey)
	for _, mutate := range []func(*domain.OIDCProvider){
		func(p *domain.OIDCProvider) { p.DisplayName = "   " },
		func(p *domain.OIDCProvider) { p.ClientID = "  " },
	} {
		input := validInput()
		mutate(&input)
		if _, err := service.normalizeProvider(input); err == nil {
			t.Fatalf("an incomplete provider was accepted: %#v", input)
		}
	}
}

// The column is varchar(128), which counts characters. Counting bytes here would
// refuse a name the database would happily store — and every non-ASCII name is
// longer in bytes than in characters.
func TestNormalizeProviderCountsDisplayNameInCharacters(t *testing.T) {
	service := newOIDCService(t, false, testKey)
	atLimit := validInput()
	atLimit.DisplayName = strings.Repeat("字", 128)
	if _, err := service.normalizeProvider(atLimit); err != nil {
		t.Fatalf("128 characters must be accepted: %v", err)
	}
	overLimit := validInput()
	overLimit.DisplayName = strings.Repeat("字", 129)
	if _, err := service.normalizeProvider(overLimit); err == nil {
		t.Fatal("129 characters must be refused")
	}
}

func TestNormalizeIssuer(t *testing.T) {
	cases := []struct {
		name          string
		raw           string
		allowInsecure bool
		want          string
		wantErr       bool
	}{
		{name: "https is kept as it is", raw: "https://idp.example.com", want: "https://idp.example.com"},
		{name: "a trailing slash is preserved", raw: "https://idp.example.com/", want: "https://idp.example.com/"},
		{name: "path and trailing slashes are preserved", raw: "https://idp.example.com/dex//", want: "https://idp.example.com/dex//"},
		{name: "the host is folded but the path is not", raw: "https://IDP.Example.COM/Dex", want: "https://idp.example.com/Dex"},
		{name: "a port is kept", raw: "https://idp.example.com:8443/dex", want: "https://idp.example.com:8443/dex"},
		{name: "http is refused by default", raw: "http://idp.example.com", wantErr: true},
		{name: "http is allowed when the operator asked for it", raw: "http://idp.example.com", allowInsecure: true, want: "http://idp.example.com"},
		// The test stack reaches Dex at host.docker.internal, which resolves to a
		// private address. A blanket private-address ban would make that
		// impossible, so the switch is the operator's explicit decision.
		{name: "a private address over http is refused by default", raw: "http://192.168.1.5/dex", wantErr: true},
		{name: "a private address over http is allowed with the switch", raw: "http://192.168.1.5/dex", allowInsecure: true, want: "http://192.168.1.5/dex"},
		{name: "an empty issuer is refused", raw: "", wantErr: true},
		{name: "a bare host is refused", raw: "idp.example.com", wantErr: true},
		{name: "another scheme is refused", raw: "ftp://idp.example.com", wantErr: true},
		{name: "a hostless URL is refused", raw: "https://", wantErr: true},
		{name: "credentials are refused", raw: "https://user:pw@idp.example.com", wantErr: true},
		{name: "a query string is refused", raw: "https://idp.example.com?x=1", wantErr: true},
		{name: "a fragment is refused", raw: "https://idp.example.com#x", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service := newOIDCService(t, tc.allowInsecure, testKey)
			got, err := service.normalizeIssuer(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("normalizeIssuer(%q) = %q, want an error", tc.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeIssuer(%q) failed: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Fatalf("normalizeIssuer(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestNormalizeOIDCScopes(t *testing.T) {
	// An empty list takes the default rather than producing a provider that
	// cannot work.
	scopes, err := normalizeOIDCScopes(nil)
	if err != nil {
		t.Fatalf("the default list was refused: %v", err)
	}
	if strings.Join(scopes, " ") != oidcDefaultScopes {
		t.Fatalf("scopes = %v, want %q", scopes, oidcDefaultScopes)
	}

	// Blanks and repeats are dropped without changing the operator's order.
	scopes, err = normalizeOIDCScopes([]string{"openid", " profile ", "", "openid", "email"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Join(scopes, " ") != "openid profile email" {
		t.Fatalf("scopes = %v", scopes)
	}

	// Without openid the IdP returns no ID token, so the provider could never
	// complete a sign-in. Refusing here turns a confusing failure at the IdP
	// into a message next to the field.
	if _, err := normalizeOIDCScopes([]string{"profile", "email"}); err == nil {
		t.Fatal("a scope list without openid was accepted")
	}
}

func TestSealClientSecret(t *testing.T) {
	service := newOIDCService(t, false, testKey)

	// nil and the empty string both mean "there is no secret in this request".
	for _, absent := range []*string{nil, ptr("")} {
		sealed, err := service.sealClientSecret(absent)
		if err != nil {
			t.Fatalf("an absent secret produced an error: %v", err)
		}
		if sealed != nil {
			t.Fatalf("an absent secret produced %d bytes", len(sealed))
		}
	}

	sealed, err := service.sealClientSecret(ptr("s3cr3t"))
	if err != nil {
		t.Fatalf("sealing failed: %v", err)
	}
	if len(sealed) == 0 {
		t.Fatal("sealing produced nothing")
	}
	// The value is sealed byte for byte, so leading and trailing spaces survive:
	// silently trimming a credential would produce a provider that fails to
	// authenticate for reasons nobody could see.
	padded, err := service.sealClientSecret(ptr(" s3cr3t "))
	if err != nil {
		t.Fatalf("sealing failed: %v", err)
	}
	opened, err := service.Box.Open(padded)
	if err != nil {
		t.Fatalf("the sealed value could not be read back: %v", err)
	}
	if string(opened) != " s3cr3t " {
		t.Fatalf("the secret was altered: %q", opened)
	}
}

// Without a key there is nowhere to put a secret, and accepting one would leave
// a provider that can never complete a sign-in.
func TestSealClientSecretWithoutAKey(t *testing.T) {
	service := newOIDCService(t, false, "")
	if _, err := service.sealClientSecret(ptr("s3cr3t")); !errors.Is(err, ErrSecretsUnavailable) {
		t.Fatalf("expected ErrSecretsUnavailable, got %v", err)
	}
	// A public client still works: there is nothing to store.
	if _, err := service.sealClientSecret(nil); err != nil {
		t.Fatalf("a public client must not need a key: %v", err)
	}
}

func TestSecretsAvailableTracksTheKey(t *testing.T) {
	if (config.Config{}).SecretsAvailable() {
		t.Fatal("a key-less config must report secrets as unavailable")
	}
	if !(config.Config{SecretEncryptionKey: testKey}).SecretsAvailable() {
		t.Fatal("a configured key must report secrets as available")
	}
}

func ptr(value string) *string { return &value }
