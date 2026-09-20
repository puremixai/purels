package config

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

const runtimeRefreshInterval = 5 * time.Second

// RuntimeProvider keeps one validated database snapshot in each process. The
// API updates its own snapshot immediately; the worker refreshes the same row
// on the short polling interval, so a page change takes effect without a
// container restart while the database remains the source of truth.
type RuntimeProvider struct {
	store   *postgres.Store
	current atomic.Pointer[domain.RuntimeSettings]
}

func NewRuntimeProvider(ctx context.Context, store *postgres.Store, defaults domain.RuntimeSettingsInput) (*RuntimeProvider, error) {
	normalized, err := NormalizeRuntimeSettings(defaults)
	if err != nil {
		return nil, err
	}
	if err := store.EnsureRuntimeSettings(ctx, normalized); err != nil {
		return nil, err
	}
	provider := &RuntimeProvider{store: store}
	if err := provider.Refresh(ctx); err != nil {
		return nil, err
	}
	return provider, nil
}

func (p *RuntimeProvider) Current() domain.RuntimeSettings {
	current := p.current.Load()
	if current == nil {
		return domain.RuntimeSettings{}
	}
	return cloneRuntimeSettings(*current)
}

func (p *RuntimeProvider) Refresh(ctx context.Context) error {
	settings, err := p.store.GetRuntimeSettings(ctx)
	if err != nil {
		return err
	}
	p.current.Store(&settings)
	return nil
}

func (p *RuntimeProvider) Update(ctx context.Context, input domain.RuntimeSettingsInput) (domain.RuntimeSettings, error) {
	normalized, err := NormalizeRuntimeSettings(input)
	if err != nil {
		return domain.RuntimeSettings{}, err
	}
	settings, err := p.store.UpdateRuntimeSettings(ctx, normalized)
	if err != nil {
		return domain.RuntimeSettings{}, err
	}
	p.current.Store(&settings)
	return cloneRuntimeSettings(settings), nil
}

func (p *RuntimeProvider) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(runtimeRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := p.Refresh(ctx); err != nil && ctx.Err() == nil {
					// A transient database failure leaves the last known-good
					// snapshot in place; the next tick retries it.
				}
			}
		}
	}()
}

func cloneRuntimeSettings(settings domain.RuntimeSettings) domain.RuntimeSettings {
	if settings.DestinationDenylist != nil {
		settings.DestinationDenylist = append([]string{}, settings.DestinationDenylist...)
	}
	if settings.ShortDomains != nil {
		settings.ShortDomains = append([]string{}, settings.ShortDomains...)
	}
	return settings
}
