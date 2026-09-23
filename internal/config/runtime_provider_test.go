package config

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

func TestRuntimeProviderCurrentReturnsIndependentLists(t *testing.T) {
	provider := &RuntimeProvider{}
	provider.current.Store(&domain.RuntimeSettings{
		RuntimeSettingsInput: domain.RuntimeSettingsInput{
			ShortDomains:        []string{"go.example.com"},
			DestinationDenylist: []string{"evil.example.com"},
		},
	})

	first := provider.Current()
	first.ShortDomains[0] = "changed.example.com"
	first.DestinationDenylist[0] = "changed.example.com"
	second := provider.Current()
	if second.ShortDomains[0] != "go.example.com" || second.DestinationDenylist[0] != "evil.example.com" {
		t.Fatalf("Current() exposed mutable internal slices: %#v", second)
	}
}

type runtimeSettingsStoreStub struct {
	settings  domain.RuntimeSettings
	beforeCAS func()
	writes    int
	// adopted records the value the provider passed to AdoptTOTPDefault, which
	// is nil when it was never called.
	adopted *bool
}

func (s *runtimeSettingsStoreStub) AdoptTOTPDefault(_ context.Context, enabled bool) error {
	s.adopted = &enabled
	return nil
}

func (s *runtimeSettingsStoreStub) GetRuntimeSettings(context.Context) (domain.RuntimeSettings, error) {
	return cloneRuntimeSettings(s.settings), nil
}

func (s *runtimeSettingsStoreStub) UpdateRuntimeSettings(_ context.Context, input domain.RuntimeSettingsInput) (domain.RuntimeSettings, error) {
	s.settings.RuntimeSettingsInput = input
	s.settings.Revision++
	s.writes++
	return cloneRuntimeSettings(s.settings), nil
}

func (s *runtimeSettingsStoreStub) CompareAndSwapRuntimeSettings(ctx context.Context, input domain.RuntimeSettingsInput, revision int64) (domain.RuntimeSettings, error) {
	if s.beforeCAS != nil {
		s.beforeCAS()
	}
	if s.settings.Revision != revision {
		return domain.RuntimeSettings{}, postgres.ErrConflict
	}
	return s.UpdateRuntimeSettings(ctx, input)
}

func TestRuntimeProviderPatchUsesDatabaseSnapshotAndPreservesOtherGroups(t *testing.T) {
	store := &runtimeSettingsStoreStub{settings: domain.RuntimeSettings{
		RuntimeSettingsInput: RuntimeDefaults(Config{AliasMode: "random", RegistrationEnabled: true, CountBots: true, RateLimitAPI: 987}),
		Revision:             4,
	}}
	provider := &RuntimeProvider{store: store}
	provider.current.Store(&domain.RuntimeSettings{Revision: 1})
	got, err := provider.Patch(context.Background(), domain.RuntimeSettingsPatch{Revision: 4, Changes: map[string]json.RawMessage{
		"registration_enabled": json.RawMessage(`false`),
		"short_domains":        json.RawMessage(`[" GO.Example.com ","go.example.com"]`),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 5 || got.RegistrationEnabled || !got.CountBots || got.RateLimitAPI != 987 || len(got.ShortDomains) != 1 || got.ShortDomains[0] != "go.example.com" {
		t.Fatalf("unexpected saved settings: %+v", got)
	}
	if provider.Current().Revision != 5 || store.writes != 1 {
		t.Fatal("successful patch was not published exactly once")
	}
}

func TestRuntimeProviderPatchRejectsStaleRevisionAndConcurrentWrite(t *testing.T) {
	for _, concurrent := range []bool{false, true} {
		t.Run(map[bool]string{false: "stale revision", true: "concurrent write"}[concurrent], func(t *testing.T) {
			store := &runtimeSettingsStoreStub{settings: domain.RuntimeSettings{RuntimeSettingsInput: RuntimeDefaults(Config{}), Revision: 4}}
			revision := int64(3)
			if concurrent {
				revision = 4
				store.beforeCAS = func() {
					store.settings.Revision++
					store.settings.RateLimitAPI = 432
				}
			}
			provider := &RuntimeProvider{store: store}
			_, err := provider.Patch(context.Background(), domain.RuntimeSettingsPatch{Revision: revision, Changes: map[string]json.RawMessage{"count_bots": json.RawMessage(`true`)}})
			if !errors.Is(err, postgres.ErrConflict) || store.writes != 0 || store.settings.CountBots {
				t.Fatalf("stale patch wrote settings: err=%v writes=%d", err, store.writes)
			}
			if concurrent && store.settings.RateLimitAPI != 432 {
				t.Fatal("concurrent group's change was overwritten")
			}
			if provider.Current().Revision != store.settings.Revision {
				t.Fatal("reload would return the stale revision after a conflict")
			}
		})
	}
}

func TestRuntimeProviderPatchValidatesMergedSettingsBeforeWriting(t *testing.T) {
	store := &runtimeSettingsStoreStub{settings: domain.RuntimeSettings{RuntimeSettingsInput: RuntimeDefaults(Config{}), Revision: 1}}
	provider := &RuntimeProvider{store: store}
	_, err := provider.Patch(context.Background(), domain.RuntimeSettingsPatch{Revision: 1, Changes: map[string]json.RawMessage{"health_check_interval_seconds": json.RawMessage(`0`)}})
	if err == nil || store.writes != 0 {
		t.Fatalf("invalid merged settings were saved: err=%v writes=%d", err, store.writes)
	}
}

// The second factor's switch reaches the database the same way every other
// runtime setting does, so this is the test that the console's toggle is not
// silently dropped by the patch merge.
func TestRuntimeProviderPatchFlipsTheSecondFactor(t *testing.T) {
	store := &runtimeSettingsStoreStub{settings: domain.RuntimeSettings{
		RuntimeSettingsInput: RuntimeDefaults(Config{TOTPEnabled: true, RateLimitAPI: 987}),
		Revision:             2,
	}}
	provider := &RuntimeProvider{store: store}
	got, err := provider.Patch(context.Background(), domain.RuntimeSettingsPatch{Revision: 2, Changes: map[string]json.RawMessage{
		"totp_enabled": json.RawMessage(`false`),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got.TOTPEnabled {
		t.Fatal("the patch did not turn the second factor off")
	}
	if got.RateLimitAPI != 987 {
		t.Fatal("a patch to one group changed another")
	}
}

func TestRuntimeProviderDoesNotPublishOlderSnapshot(t *testing.T) {
	provider := &RuntimeProvider{}
	provider.publish(domain.RuntimeSettings{Revision: 5})
	provider.publish(domain.RuntimeSettings{Revision: 4})
	if provider.Current().Revision != 5 {
		t.Fatal("a delayed response replaced a newer snapshot")
	}
}

func TestRuntimeProviderCurrentPreservesEmptyLists(t *testing.T) {
	provider := &RuntimeProvider{}
	provider.current.Store(&domain.RuntimeSettings{
		RuntimeSettingsInput: domain.RuntimeSettingsInput{
			ShortDomains:        []string{},
			DestinationDenylist: []string{},
		},
	})

	current := provider.Current()
	if current.ShortDomains == nil {
		t.Fatal("Current() changed an empty short-domain list into nil")
	}
	if current.DestinationDenylist == nil {
		t.Fatal("Current() changed an empty denylist into nil")
	}
}
