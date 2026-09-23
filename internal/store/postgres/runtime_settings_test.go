package postgres

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/purels/purels/internal/domain"
)

// Run with PURELS_TEST_DATABASE_URL pointing to a disposable test database.
// Each invocation uses its own schema and the production runtime table DDL.
func runtimeSettingsTestStore(t *testing.T) *Store {
	t.Helper()
	databaseURL := os.Getenv("PURELS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PURELS_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := "purels_runtime_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quotedSchema := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quotedSchema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := admin.Exec(cleanupCtx, "DROP SCHEMA "+quotedSchema+" CASCADE"); err != nil {
			t.Errorf("remove test schema: %v", err)
		}
		admin.Close()
	})
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	ddl, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000018_runtime_settings.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	// Role grants belong to the full installation and are unrelated to CAS.
	tableDDL := strings.SplitN(string(ddl), "-- The existing administrator", 2)[0]
	if _, err := pool.Exec(ctx, tableDDL); err != nil {
		t.Fatal(err)
	}
	// The later migrations are replayed too, because the queries under test read
	// every column they add. Keeping the schema one migration behind the store
	// would make these tests fail for a reason that cannot happen in production,
	// where the API waits for `migrate` to finish.
	alter, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000019_runtime_settings_totp.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(alter)); err != nil {
		t.Fatal(err)
	}
	return &Store{Pool: pool}
}

func TestRuntimeSettingsCompareAndSwapIsAtomic(t *testing.T) {
	store := runtimeSettingsTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	base := domain.RuntimeSettingsInput{
		AliasMode: "random", UniqueURLs: true, RegistrationEnabled: true, TOTPEnabled: true,
		RateLimitAPI: 120, HealthCheckIntervalSeconds: 86400,
		DestinationDenylist: []string{"blocked.example.com"}, ShortDomains: []string{"go.example.com"},
	}
	if err := store.EnsureRuntimeSettings(ctx, base); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetRuntimeSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first := base
	first.RegistrationEnabled = false
	second := base
	second.RateLimitAPI = 0
	type result struct {
		settings domain.RuntimeSettings
		err      error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	var writers sync.WaitGroup
	for _, input := range []domain.RuntimeSettingsInput{first, second} {
		writers.Add(1)
		go func(input domain.RuntimeSettingsInput) {
			defer writers.Done()
			<-start
			settings, err := store.CompareAndSwapRuntimeSettings(ctx, input, before.Revision)
			results <- result{settings: settings, err: err}
		}(input)
	}
	close(start)
	writers.Wait()
	close(results)
	var winner domain.RuntimeSettings
	successes, conflicts := 0, 0
	for result := range results {
		switch {
		case result.err == nil:
			successes++
			winner = result.settings
		case errors.Is(result.err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("CAS failed unexpectedly: %v", result.err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d; exactly one concurrent writer must win", successes, conflicts)
	}
	after, err := store.GetRuntimeSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != before.Revision+1 || after.RegistrationEnabled != winner.RegistrationEnabled || after.RateLimitAPI != winner.RateLimitAPI {
		t.Fatalf("database does not contain the winning snapshot: %+v", after)
	}
	if !after.UniqueURLs || after.ShortDomains[0] != "go.example.com" || after.DestinationDenylist[0] != "blocked.example.com" {
		t.Fatal("unrelated fields changed")
	}
	if !after.TOTPEnabled {
		t.Fatal("the second factor's switch did not survive a write")
	}

	// The legacy full-document writer must still work and invalidate an older
	// PATCH revision, even though legacy clients do not send a revision.
	legacy := after.RuntimeSettingsInput
	legacy.FallbackURL = "https://example.com/new"
	saved, err := store.UpdateRuntimeSettings(ctx, legacy)
	if err != nil || saved.Revision != after.Revision+1 {
		t.Fatalf("legacy PUT update failed: settings=%+v err=%v", saved, err)
	}
	if _, err := store.CompareAndSwapRuntimeSettings(ctx, after.RuntimeSettingsInput, after.Revision); !errors.Is(err, ErrConflict) {
		t.Fatalf("CAS overwrote a concurrent legacy update: %v", err)
	}
	latest, err := store.GetRuntimeSettings(ctx)
	if err != nil || latest.FallbackURL != legacy.FallbackURL || latest.Revision != saved.Revision {
		t.Fatalf("rejected CAS changed the database: settings=%+v err=%v", latest, err)
	}
}

// A deployment that predates migration 000019 has a row already, and
// EnsureRuntimeSettings inserts with ON CONFLICT (id) DO NOTHING — so the new
// column stays NULL until the first boot adopts TOTP_ENABLED into it. This is
// the test that an upgrade cannot silently switch the second factor off, and
// that the adoption happens exactly once.
func TestAdoptTOTPDefaultFillsTheColumnOnlyOnce(t *testing.T) {
	store := runtimeSettingsTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := store.EnsureRuntimeSettings(ctx, domain.RuntimeSettingsInput{AliasMode: "random"}); err != nil {
		t.Fatal(err)
	}
	// Recreate the upgrade state: the row predates the column, so it is NULL
	// even though EnsureRuntimeSettings has just run.
	if _, err := store.Pool.Exec(ctx, "UPDATE runtime_settings SET totp_enabled = NULL WHERE id = 1"); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetRuntimeSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if before.TOTPEnabled {
		t.Fatal("a NULL column must read as off before it is adopted")
	}

	if err := store.AdoptTOTPDefault(ctx, true); err != nil {
		t.Fatal(err)
	}
	adopted, err := store.GetRuntimeSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !adopted.TOTPEnabled {
		t.Fatal("AdoptTOTPDefault did not fill the column")
	}
	// Adopting a bootstrap default is not an edit an operator made, so it must
	// not move the revision: a console with an in-flight save would be rejected
	// for no reason.
	if adopted.Revision != before.Revision {
		t.Fatalf("adoption moved the revision from %d to %d", before.Revision, adopted.Revision)
	}

	// The next boot must not overwrite a value that is now concrete, whether the
	// operator chose it or the previous boot adopted it.
	if err := store.AdoptTOTPDefault(ctx, false); err != nil {
		t.Fatal(err)
	}
	after, err := store.GetRuntimeSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !after.TOTPEnabled {
		t.Fatal("AdoptTOTPDefault overwrote a concrete value")
	}
}
