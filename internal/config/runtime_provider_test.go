package config

import (
	"testing"

	"github.com/purels/purels/internal/domain"
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
