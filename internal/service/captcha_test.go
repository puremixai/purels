package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
)

type captchaStoreStub struct {
	settings domain.CaptchaSettings
	secret   []byte
	updated  domain.CaptchaSettings
	sealed   []byte
}

func (s *captchaStoreStub) GetCaptchaSettings(context.Context) (domain.CaptchaSettings, error) {
	return s.settings, nil
}
func (s *captchaStoreStub) GetPublicCaptchaSettings(context.Context) (domain.PublicCaptchaSettings, error) {
	return domain.PublicCaptchaSettings{Enabled: s.settings.Enabled, Provider: s.settings.Provider, SiteKey: s.settings.SiteKey}, nil
}
func (s *captchaStoreStub) GetCaptchaSecret(context.Context) ([]byte, error) {
	if s.secret == nil {
		return nil, errors.New("missing secret")
	}
	return s.secret, nil
}
func (s *captchaStoreStub) UpdateCaptchaSettings(_ context.Context, settings domain.CaptchaSettings, secret []byte) (domain.CaptchaSettings, error) {
	s.updated = settings
	s.sealed = secret
	return settings, nil
}

type turnstileVerifierStub struct {
	err    error
	secret string
	token  string
	host   string
	action string
}

func (v *turnstileVerifierStub) Verify(_ context.Context, token, secret, remoteIP, hostname, action string) error {
	v.token, v.secret, v.host, v.action = token, secret, hostname, action
	_ = remoteIP
	return v.err
}

func TestCaptchaServiceVerifyUsesEncryptedSecretAndVerifier(t *testing.T) {
	box, err := security.NewSecretBox(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := box.Seal([]byte("turnstile-secret"))
	if err != nil {
		t.Fatal(err)
	}
	verifier := &turnstileVerifierStub{}
	store := &captchaStoreStub{
		settings: domain.CaptchaSettings{
			Provider: "turnstile", Enabled: true, SiteKey: "site-key", HasSecret: true,
			ExpectedHostname: "example.test", ExpectedAction: "register",
		},
		secret: sealed,
	}
	service := &CaptchaService{Store: store, Box: box, Verifier: verifier}
	if err := service.VerifyRegistration(context.Background(), "token", "203.0.113.5"); err != nil {
		t.Fatalf("Verify returned error: %v", err)
	}
	if verifier.secret != "turnstile-secret" || verifier.token != "token" || verifier.host != "example.test" || verifier.action != "register" {
		t.Fatalf("verifier inputs = %#v", verifier)
	}
}

func TestCaptchaServiceVerifyMapsRejectedToken(t *testing.T) {
	box, _ := security.NewSecretBox(strings.Repeat("k", 32))
	sealed, _ := box.Seal([]byte("secret"))
	store := &captchaStoreStub{
		settings: domain.CaptchaSettings{Provider: "turnstile", Enabled: true, SiteKey: "site-key", HasSecret: true},
		secret:   sealed,
	}
	verifier := &turnstileVerifierStub{err: ErrTurnstileRejected}
	service := &CaptchaService{Store: store, Box: box, Verifier: verifier}
	if err := service.VerifyRegistration(context.Background(), "token", ""); !errors.Is(err, ErrCaptchaInvalid) {
		t.Fatalf("error = %v, want ErrCaptchaInvalid", err)
	}
}

func TestCaptchaServiceVerifyDisabledDoesNotCallProvider(t *testing.T) {
	verifier := &turnstileVerifierStub{err: ErrTurnstileUnavailable}
	store := &captchaStoreStub{settings: domain.CaptchaSettings{Provider: "turnstile"}}
	service := &CaptchaService{Store: store, Verifier: verifier}
	if err := service.VerifyRegistration(context.Background(), "", ""); err != nil {
		t.Fatalf("Verify returned error: %v", err)
	}
	if verifier.token != "" {
		t.Fatal("disabled CAPTCHA called verifier")
	}
}

// The registration flag rides on this projection because it is the one public
// bootstrap call the console already makes. It has to survive with CAPTCHA off,
// and it must not be confused with Enabled: a deployment can accept new accounts
// without protecting the form, and can protect the form with sign-up closed.
func TestCaptchaServicePublicProjectsRegistrationFlag(t *testing.T) {
	store := &captchaStoreStub{settings: domain.CaptchaSettings{Provider: "turnstile"}}

	open := &CaptchaService{Store: store, Config: config.Config{RegistrationEnabled: true}}
	got, err := open.Public(context.Background())
	if err != nil {
		t.Fatalf("Public returned error: %v", err)
	}
	if !got.RegistrationEnabled || got.Enabled {
		t.Fatalf("public settings = %#v", got)
	}

	closed := &CaptchaService{Store: store, Config: config.Config{RegistrationEnabled: false}}
	got, err = closed.Public(context.Background())
	if err != nil {
		t.Fatalf("Public returned error: %v", err)
	}
	if got.RegistrationEnabled {
		t.Fatalf("registration reported as open while it is closed")
	}
}

func TestCaptchaServiceUpdateSealsNewSecret(t *testing.T) {
	key := strings.Repeat("k", 32)
	box, _ := security.NewSecretBox(key)
	store := &captchaStoreStub{settings: domain.CaptchaSettings{Provider: "turnstile"}}
	service := &CaptchaService{Store: store, Config: config.Config{SecretEncryptionKey: key}, Box: box}
	enabled := true
	siteKey := "site-key"
	secret := "new-secret"
	got, err := service.Update(context.Background(), domain.CaptchaSettingsInput{Enabled: &enabled, SiteKey: &siteKey, Secret: &secret})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if !got.Enabled || !got.HasSecret || !reflect.DeepEqual(got, store.updated) {
		t.Fatalf("settings = %#v", got)
	}
	opened, err := box.Open(store.sealed)
	if err != nil || string(opened) != secret {
		t.Fatalf("sealed secret = %q, err %v", opened, err)
	}
}

func TestTurnstileClientPostsFixedFormAndChecksResponse(t *testing.T) {
	var request *http.Request
	client := NewTurnstileVerifier(&http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		request = r
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"success":true,"hostname":"Example.Test","action":"register"}`)), Header: make(http.Header)}, nil
	})})
	if err := client.Verify(context.Background(), "token", "secret", "203.0.113.5", "example.test", "register"); err != nil {
		t.Fatalf("Verify returned error: %v", err)
	}
	if request == nil || request.Method != http.MethodPost || request.URL.String() != TurnstileVerifyURL || request.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
		t.Fatalf("request = %#v", request)
	}
	body, _ := io.ReadAll(request.Body)
	if string(body) != "remoteip=203.0.113.5&response=token&secret=secret" {
		t.Fatalf("form body = %q", body)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
