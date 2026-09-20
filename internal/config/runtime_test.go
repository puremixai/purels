package config

import (
	"reflect"
	"testing"
	"time"

	"github.com/purels/purels/internal/domain"
)

func TestNormalizeRuntimeSettingsCanonicalizesLists(t *testing.T) {
	input := domain.RuntimeSettingsInput{
		AliasMode:                  " RANDOM ",
		FallbackURL:                " https://example.com/fallback ",
		PruneGraceSeconds:          int64((24 * time.Hour) / time.Second),
		HealthCheckIntervalSeconds: 300,
		MaxLinksPerUser:            0,
		ShortDomains:               []string{" Go.Example.com ", "go.example.com", "api.example.com"},
		DestinationDenylist:        []string{" Evil.Example.com ", "evil.example.com"},
		RateLimitEnabled:           true,
		RateLimitLogin:             10,
		RateLimitAPI:               120,
		RateLimitRedirect:          600,
		RateLimitRegister:          5,
		RateLimit2FA:               10,
		RateLimitOIDC:              60,
		UniqueURLs:                 true,
		RegistrationEnabled:        true,
		CountBots:                  false,
		ForwardQuery:               true,
		AutoPruneExpired:           false,
		HealthCheckEnabled:         false,
	}

	got, err := NormalizeRuntimeSettings(input)
	if err != nil {
		t.Fatalf("NormalizeRuntimeSettings() error = %v", err)
	}
	if got.AliasMode != "random" || got.FallbackURL != "https://example.com/fallback" {
		t.Fatalf("normalized scalar settings = %#v", got)
	}
	if !reflect.DeepEqual(got.ShortDomains, []string{"go.example.com", "api.example.com"}) {
		t.Fatalf("ShortDomains = %#v", got.ShortDomains)
	}
	if !reflect.DeepEqual(got.DestinationDenylist, []string{"evil.example.com"}) {
		t.Fatalf("DestinationDenylist = %#v", got.DestinationDenylist)
	}
}

func TestNormalizeRuntimeSettingsRejectsInvalidValues(t *testing.T) {
	base := domain.RuntimeSettingsInput{
		AliasMode:                  "random",
		PruneGraceSeconds:          86400,
		HealthCheckIntervalSeconds: 300,
		RateLimitLogin:             10,
		RateLimitAPI:               120,
		RateLimitRedirect:          600,
		RateLimitRegister:          5,
		RateLimit2FA:               10,
		RateLimitOIDC:              60,
	}
	for name, mutate := range map[string]func(*domain.RuntimeSettingsInput){
		"alias mode":      func(v *domain.RuntimeSettingsInput) { v.AliasMode = "enumerable" },
		"fallback URL":    func(v *domain.RuntimeSettingsInput) { v.FallbackURL = "javascript:alert(1)" },
		"prune grace":     func(v *domain.RuntimeSettingsInput) { v.PruneGraceSeconds = -1 },
		"health interval": func(v *domain.RuntimeSettingsInput) { v.HealthCheckIntervalSeconds = 0 },
		"rate limit":      func(v *domain.RuntimeSettingsInput) { v.RateLimitAPI = -1 },
		"domain":          func(v *domain.RuntimeSettingsInput) { v.ShortDomains = []string{"https://example.com"} },
	} {
		t.Run(name, func(t *testing.T) {
			input := base
			mutate(&input)
			if _, err := NormalizeRuntimeSettings(input); err == nil {
				t.Fatal("expected invalid runtime settings to be rejected")
			}
		})
	}
}

func TestRuntimeDefaultsUseDeploymentConfig(t *testing.T) {
	cfg := Config{
		AliasMode:           "sequential",
		UniqueURLs:          false,
		RegistrationEnabled: false,
		CountBots:           true,
		ForwardQuery:        false,
		FallbackURL:         "https://example.com/missing",
		AutoPruneExpired:    true,
		PruneGrace:          48 * time.Hour,
		MaxLinksPerUser:     77,
		DestinationDenylist: []string{"evil.example"},
		ShortDomains:        []string{"go.example"},
		HealthCheckEnabled:  true,
		HealthCheckInterval: 2 * time.Hour,
		RateLimitEnabled:    false,
		RateLimitLogin:      1,
		RateLimitAPI:        2,
		RateLimitRedirect:   3,
		RateLimitRegister:   4,
		RateLimit2FA:        5,
		RateLimitOIDC:       6,
	}
	got := RuntimeDefaults(cfg)
	if got.AliasMode != "sequential" || got.MaxLinksPerUser != 77 || got.PruneGraceSeconds != 48*60*60 {
		t.Fatalf("runtime defaults lost deployment values: %#v", got)
	}
	if !reflect.DeepEqual(got.ShortDomains, cfg.ShortDomains) || !reflect.DeepEqual(got.DestinationDenylist, cfg.DestinationDenylist) {
		t.Fatalf("runtime defaults lost list values: %#v", got)
	}
}
