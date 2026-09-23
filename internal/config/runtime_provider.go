package config

import (
	"context"
	"errors"
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
	store   runtimeSettingsStore
	current atomic.Pointer[domain.RuntimeSettings]
}

type runtimeSettingsStore interface {
	GetRuntimeSettings(context.Context) (domain.RuntimeSettings, error)
	UpdateRuntimeSettings(context.Context, domain.RuntimeSettingsInput) (domain.RuntimeSettings, error)
	CompareAndSwapRuntimeSettings(context.Context, domain.RuntimeSettingsInput, int64) (domain.RuntimeSettings, error)
	AdoptTOTPDefault(context.Context, bool) error
}

func NewRuntimeProvider(ctx context.Context, store *postgres.Store, defaults domain.RuntimeSettingsInput) (*RuntimeProvider, error) {
	normalized, err := NormalizeRuntimeSettings(defaults)
	if err != nil {
		return nil, err
	}
	if err := store.EnsureRuntimeSettings(ctx, normalized); err != nil {
		return nil, err
	}
	// A column a migration added as NULL is resolved from the environment once,
	// before the first read, so nothing downstream has to know about it.
	if err := store.AdoptTOTPDefault(ctx, normalized.TOTPEnabled); err != nil {
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
	p.publish(settings)
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
	p.publish(settings)
	return cloneRuntimeSettings(settings), nil
}

// Patch starts from the database, not the process-local cache, then uses a
// revision predicate in the update itself. A concurrent PUT or PATCH therefore
// cannot silently be overwritten between this read and write.
func (p *RuntimeProvider) Patch(ctx context.Context, patch domain.RuntimeSettingsPatch) (domain.RuntimeSettings, error) {
	if _, err := patch.Apply(domain.RuntimeSettingsInput{}); err != nil {
		return domain.RuntimeSettings{}, err
	}
	current, err := p.store.GetRuntimeSettings(ctx)
	if err != nil {
		return domain.RuntimeSettings{}, err
	}
	p.publish(current)
	if current.Revision != patch.Revision {
		return domain.RuntimeSettings{}, postgres.ErrConflict
	}
	input, err := patch.Apply(current.RuntimeSettingsInput)
	if err != nil {
		return domain.RuntimeSettings{}, err
	}
	normalized, err := NormalizeRuntimeSettings(input)
	if err != nil {
		return domain.RuntimeSettings{}, err
	}
	settings, err := p.store.CompareAndSwapRuntimeSettings(ctx, normalized, patch.Revision)
	if err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			// The caller is told to reload. Publish the winning revision now so
			// an immediate GET need not wait for the periodic refresh.
			_ = p.Refresh(ctx)
		}
		return domain.RuntimeSettings{}, err
	}
	p.publish(settings)
	return cloneRuntimeSettings(settings), nil
}

// A slow refresh or response must not replace a newer successful write in this
// process. Database revisions only increase, including through legacy PUT.
func (p *RuntimeProvider) publish(settings domain.RuntimeSettings) {
	for {
		current := p.current.Load()
		if current != nil && current.Revision >= settings.Revision {
			return
		}
		if p.current.CompareAndSwap(current, &settings) {
			return
		}
	}
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
