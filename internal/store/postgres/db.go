package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	Pool *pgxpool.Pool
	// CountBots includes bot traffic in the statistics. Bot clicks are always
	// recorded and rolled up; this only decides whether the read paths report
	// them, so flipping it needs no data migration.
	CountBots bool
}

// New opens the pool. timeZone sets the session TimeZone, which is what makes
// `occurred_at::date` bucket clicks into the operator's days rather than UTC
// days. The API and the worker share this pool configuration, so both agree on
// where a day starts.
func New(ctx context.Context, databaseURL, timeZone string) (*Store, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	if timeZone != "" {
		if poolConfig.ConnConfig.RuntimeParams == nil {
			poolConfig.ConnConfig.RuntimeParams = map[string]string{}
		}
		poolConfig.ConnConfig.RuntimeParams["TimeZone"] = timeZone
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{Pool: pool}, nil
}

func (s *Store) Close() { s.Pool.Close() }

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")
