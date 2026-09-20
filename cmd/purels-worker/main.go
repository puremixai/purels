package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/service"
	"github.com/purels/purels/internal/store/postgres"
	"github.com/purels/purels/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	store, err := postgres.New(ctx, cfg.DatabaseURL, cfg.StatsTZ)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	runtimeSettings, err := config.NewRuntimeProvider(ctx, store, config.RuntimeDefaults(cfg))
	if err != nil {
		logger.Error("runtime settings bootstrap failed", "error", err)
		os.Exit(1)
	}
	runtimeSettings.Start(ctx)
	store.CountBots = cfg.CountBots
	store.CountBotsProvider = func() bool { return runtimeSettings.Current().CountBots }
	// The probe client is always built: it carries the guard that keeps a
	// user-supplied destination out of the server's own network, and the sweep
	// is the one place the worker makes an outbound request.
	checker := &service.HealthChecker{Store: store, Client: security.NewProbeClient()}
	runner := &worker.Worker{
		Store:               store,
		Logger:              logger,
		Runtime:             runtimeSettings,
		AutoPruneExpired:    cfg.AutoPruneExpired,
		PruneGrace:          cfg.PruneGrace,
		Checker:             checker,
		HealthCheckEnabled:  cfg.HealthCheckEnabled,
		HealthCheckInterval: cfg.HealthCheckInterval,
	}
	if err := runner.Run(ctx); err != nil && err != context.Canceled {
		logger.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}
