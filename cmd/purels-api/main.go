package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/purels/purels/internal/cache/redis"
	"github.com/purels/purels/internal/config"
	httpapi "github.com/purels/purels/internal/http"
	"github.com/purels/purels/internal/http/handler"
	httpmw "github.com/purels/purels/internal/http/middleware"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/service"
	"github.com/purels/purels/internal/store/postgres"
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
	// Bot clicks are always recorded; this decides whether the read paths report
	// them, so it is a store-wide switch rather than a per-query argument.
	store.CountBots = cfg.CountBots
	runtimeSettings, err := config.NewRuntimeProvider(ctx, store, config.RuntimeDefaults(cfg))
	if err != nil {
		logger.Error("runtime settings bootstrap failed", "error", err)
		os.Exit(1)
	}
	runtimeSettings.Start(ctx)
	store.CountBotsProvider = func() bool { return runtimeSettings.Current().CountBots }
	cache, err := redis.New(cfg.RedisURL)
	if err != nil {
		logger.Error("redis configuration failed", "error", err)
		os.Exit(1)
	}
	defer cache.Close()

	// One hasher for every write site, so the three ip_hash columns cannot drift
	// apart as the setting changes.
	hasher := security.IPHasher{Mode: cfg.IPHashMode, Key: cfg.IPHashKey}
	// The warning belongs here rather than in config.Load, because it is a claim
	// about what gets written to ip_hash and this is the only process with a
	// write site. The worker loads the same config and never hashes an address,
	// so warning there reported a gap that did not exist for it. It is also not
	// fatal: an unkeyed digest is weaker than a keyed one, not wrong, and every
	// count already recorded was written that way.
	if cfg.IPHashMode != security.IPModeNone && len(cfg.IPHashKey) == 0 {
		logger.Warn("IP_HASH_KEY is not set: ip_hash holds a plain SHA-256 digest, which is reversible by brute force over the IPv4 space")
	}

	// Built once and shared: the login path and the enrolment path have to
	// agree on the key, and a box that failed to build stays unusable so
	// storing a secret is refused rather than silently writing one nothing can
	// read back. The error is not fatal — both features are optional.
	box, err := security.NewSecretBox(cfg.SecretEncryptionKey)
	if err != nil {
		logger.Warn("storing encrypted secrets is unavailable", "error", err)
	}
	// The second factor needs two things that live in different places: a
	// runtime switch in the database and a key in the environment. Neither file
	// alone can say whether it is actually in force, so the pairing is checked
	// here, once the database has been read, and reported on the effective
	// values rather than on either half.
	if totpEnabled := runtimeSettings.Current().TOTPEnabled; totpEnabled && !cfg.SecretsAvailable() {
		logger.Warn("the second factor is enabled but SECRET_ENCRYPTION_KEY is not set: enrolment is refused and nobody will be challenged")
	} else if !totpEnabled && cfg.SecretsAvailable() {
		logger.Warn("an encryption key is configured but the second factor is off: nobody will be challenged. The key still covers OIDC client secrets")
	}

	turnstile := service.NewTurnstileVerifier()
	captchaService := &service.CaptchaService{
		Store:    store,
		Config:   cfg,
		Settings: runtimeSettings,
		Box:      box,
		Verifier: turnstile,
	}
	authService := &service.AuthService{Store: store, Config: cfg, Settings: runtimeSettings, Hasher: hasher, Box: box, Captcha: captchaService}
	if err := authService.Bootstrap(ctx); err != nil {
		logger.Error("bootstrap failed", "error", err)
		os.Exit(1)
	}
	linkService := &service.LinkService{
		Store:             store,
		Cache:             cache,
		Settings:          runtimeSettings,
		SequentialAliases: cfg.SequentialAliases(),
		UniqueURLs:        cfg.UniqueURLs,
		MaxLinksPerUser:   cfg.MaxLinksPerUser,
		Denylist:          cfg.DestinationDenylist,
		PublicURL:         cfg.PublicURL,
		ShortDomains:      cfg.ShortDomains,
		Hasher:            hasher,
	}
	h := &handler.Handler{
		Config:   cfg,
		Settings: runtimeSettings,
		Auth:     authService,
		Links:    linkService,
		Stats:    &service.StatsService{Store: store, IPMode: cfg.IPHashMode},
		Tokens:   &service.TokenService{Store: store},
		Audit:    &service.AuditService{Store: store, Hasher: hasher},
		Users:    &service.UserService{Store: store},
		Roles:    &service.RoleService{Store: store},
		MFA:      &service.TwoFactorService{Store: store, Config: cfg, Settings: runtimeSettings, Box: box},
		OIDC: &service.OIDCService{
			Store: store, Config: cfg, Box: box,
			// Built by the service so the timeout that bounds a call to an
			// identity provider has one definition. It is deliberately not
			// security.NewProbeClient: that one refuses private addresses, and
			// a self-hosted IdP is a private address.
			Client: service.NewOIDCHTTPClient(),
		},
		// Built here rather than in the service so the SSRF guard is part of
		// the wiring: a checker without it must never be constructed.
		Probe: &service.HealthChecker{Store: store, Client: security.NewProbeClient()},
		Analytics: &service.AnalyticsService{
			Store: store,
		},
		Captcha: captchaService,
	}
	router := httpapi.NewRouter(h, httpmw.RateLimiter{Cache: cache})
	server := &http.Server{Addr: cfg.Addr, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		logger.Info("api listening", "addr", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server stopped", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}
