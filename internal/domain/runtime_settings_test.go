package domain

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestRuntimeSettingsPatchPreservesOmittedFieldsAndExplicitZeroValues(t *testing.T) {
	base := RuntimeSettingsInput{
		AliasMode: "random", UniqueURLs: true, RegistrationEnabled: true,
		MaxLinksPerUser: 1000, RateLimitAPI: 120, FallbackURL: "https://example.com/missing",
		ShortDomains: []string{"go.example.com"}, DestinationDenylist: []string{"bad.example.com"},
	}
	var patch RuntimeSettingsPatch
	if err := json.Unmarshal([]byte(`{"revision":4,"changes":{"registration_enabled":false,"max_links_per_user":0,"fallback_url":"","short_domains":[]}}`), &patch); err != nil {
		t.Fatal(err)
	}
	got, err := patch.Apply(base)
	if err != nil {
		t.Fatal(err)
	}
	if got.RegistrationEnabled || got.MaxLinksPerUser != 0 || got.FallbackURL != "" || got.ShortDomains == nil || len(got.ShortDomains) != 0 {
		t.Fatalf("explicit zero values were not applied: %+v", got)
	}
	if got.AliasMode != base.AliasMode || got.UniqueURLs != base.UniqueURLs || got.RateLimitAPI != base.RateLimitAPI || !reflect.DeepEqual(got.DestinationDenylist, base.DestinationDenylist) {
		t.Fatalf("omitted fields changed: %+v", got)
	}
}

func TestRuntimeSettingsPatchRejectsMissingOrInvalidChanges(t *testing.T) {
	for _, body := range []string{
		`{}`, `{"changes":{"count_bots":true}}`, `{"revision":0,"changes":{"count_bots":true}}`,
		`{"revision":1}`, `{"revision":1,"changes":{}}`, `{"revision":1,"changes":null}`,
		`{"revision":1,"changes":{"count_bots":null}}`, `{"revision":1,"changes":{"short_domains":null}}`,
		`{"revision":1,"changes":{"unknown":true}}`, `{"revision":1,"changes":{"count_bots":"false"}}`,
		`{"revision":1,"changes":{"rate_limit_api":1.5}}`, `{"revision":1,"changes":{"revision":2}}`,
	} {
		t.Run(body, func(t *testing.T) {
			var patch RuntimeSettingsPatch
			if err := json.Unmarshal([]byte(body), &patch); err != nil {
				t.Fatal(err)
			}
			if _, err := patch.Apply(RuntimeSettingsInput{}); !errors.Is(err, ErrInvalidRuntimePatch) {
				t.Fatalf("Apply() error = %v, want invalid patch", err)
			}
		})
	}
}

func TestRuntimeSettingsPatchDoesNotMutateBaseLists(t *testing.T) {
	base := RuntimeSettingsInput{ShortDomains: []string{"old.example.com", "other.example.com"}}
	patch := RuntimeSettingsPatch{Revision: 1, Changes: map[string]json.RawMessage{"short_domains": json.RawMessage(`["new.example.com"]`)}}
	if _, err := patch.Apply(base); err != nil {
		t.Fatal(err)
	}
	if base.ShortDomains[0] != "old.example.com" {
		t.Fatal("Apply mutated the base snapshot")
	}
}
