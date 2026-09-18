package worker

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

// LinkChecker probes a destination and records the outcome. The worker depends
// on the behaviour rather than on the link service, so the two packages stay
// independent.
type LinkChecker interface {
	Check(ctx context.Context, linkID, destination string) (domain.LinkHealth, error)
}

type Worker struct {
	Store    *postgres.Store
	Interval time.Duration
	Logger   *slog.Logger

	// AutoPruneExpired hard-deletes links whose expiry passed more than
	// PruneGrace ago. PruneInterval defaults to an hour.
	AutoPruneExpired bool
	PruneGrace       time.Duration
	PruneInterval    time.Duration
	PruneLimit       int

	// Checker drives the destination sweep when HealthCheckEnabled is set.
	// HealthCheckInterval is both the sweep cadence and how stale a result must
	// be before a link is checked again.
	Checker             LinkChecker
	HealthCheckEnabled  bool
	HealthCheckInterval time.Duration
	HealthCheckBatch    int
}

// Run keeps the background jobs going until the context is cancelled. Each job
// gets its own goroutine: a destination sweep can take minutes, and aggregation
// must keep its cadence while it runs.
func (w *Worker) Run(ctx context.Context) error {
	if w.Interval <= 0 {
		w.Interval = 5 * time.Second
	}
	var group sync.WaitGroup
	group.Add(1)
	go func() { defer group.Done(); w.aggregateLoop(ctx) }()
	if w.AutoPruneExpired {
		group.Add(1)
		go func() { defer group.Done(); w.pruneLoop(ctx) }()
	}
	if w.HealthCheckEnabled && w.Checker != nil {
		group.Add(1)
		go func() { defer group.Done(); w.healthLoop(ctx) }()
	}
	<-ctx.Done()
	group.Wait()
	return ctx.Err()
}

// aggregateLoop rolls raw clicks into the daily table. It runs once at start-up
// so a backlog left by a restart is drained immediately.
func (w *Worker) aggregateLoop(ctx context.Context) {
	ticker := time.NewTicker(w.Interval)
	defer ticker.Stop()
	for {
		if err := w.Store.AggregateClicks(ctx, 500); err != nil && ctx.Err() == nil {
			w.Logger.Error("aggregate clicks", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// pruneLoop hard-deletes expired links once at start-up and then on its
// interval. The first run happens immediately so turning the setting on has an
// effect you can see, rather than one that appears an hour later.
func (w *Worker) pruneLoop(ctx context.Context) {
	interval := w.PruneInterval
	if interval <= 0 {
		interval = time.Hour
	}
	limit := w.PruneLimit
	if limit <= 0 {
		limit = 1000
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		deleted, err := w.Store.PruneExpiredLinks(ctx, w.PruneGrace, limit)
		switch {
		case err != nil && ctx.Err() == nil:
			w.Logger.Error("prune expired links", "error", err)
		case deleted > 0:
			w.Logger.Info("pruned expired links", "deleted", deleted, "grace", w.PruneGrace.String())
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// healthLoop re-checks destinations once at start-up and then on its interval.
func (w *Worker) healthLoop(ctx context.Context) {
	interval := w.HealthCheckInterval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	batch := w.HealthCheckBatch
	if batch <= 0 {
		batch = 50
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		w.sweepHealth(ctx, batch, interval)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// sweepHealth checks the links whose last result is missing or older than
// staleAfter, least recently checked first. A link that fails to check is
// logged and skipped: one unreachable destination must not stop the sweep.
func (w *Worker) sweepHealth(ctx context.Context, batch int, staleAfter time.Duration) {
	targets, err := w.Store.LinksDueForCheck(ctx, time.Now().UTC().Add(-staleAfter), batch)
	if err != nil {
		if ctx.Err() == nil {
			w.Logger.Error("list links to check", "error", err)
		}
		return
	}
	for _, target := range targets {
		if ctx.Err() != nil {
			return
		}
		health, err := w.Checker.Check(ctx, target.ID, target.DestinationURL)
		if err != nil {
			w.Logger.Error("check destination", "alias", target.Alias, "error", err)
			continue
		}
		w.Logger.Info("checked destination", "alias", target.Alias, "status_code", health.StatusCode)
	}
}
