package redis

import (
	"context"
	"encoding/json"
	"time"

	"github.com/purels/purels/internal/domain"
	"github.com/redis/go-redis/v9"
)

type Cache struct{ Client *redis.Client }

func New(redisURL string) (*Cache, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return &Cache{Client: redis.NewClient(options)}, nil
}

func (c *Cache) Close() error { return c.Client.Close() }

// linkKey is the one place the cache key is built, so the version below cannot
// drift between the reader and the two writers.
//
// The version moved to v2 when links gained interstitial_seconds. It moves to
// v3 because aliases are case-sensitive now; a lower-cased key could make two
// distinct links share a cache entry. A cached
// record is the whole domain.Link as JSON, so a blob written before that column
// existed would unmarshal with a zero delay — the interstitial off — and the
// link would keep redirecting immediately for up to the TTL. Bumping the
// version retires those blobs at once instead of leaving the new default to
// arrive link by link. The old keys hold nothing but public link data and
// expire on their own.
func linkKey(alias string) string { return "purels:link:v3:" + alias }

func (c *Cache) GetLink(ctx context.Context, alias string) (*domain.Link, error) {
	value, err := c.Client.Get(ctx, linkKey(alias)).Result()
	if err != nil {
		return nil, err
	}
	var link domain.Link
	if err := json.Unmarshal([]byte(value), &link); err != nil {
		return nil, err
	}
	return &link, nil
}

func (c *Cache) SetLink(ctx context.Context, link domain.Link) error {
	payload, err := json.Marshal(link)
	if err != nil {
		return err
	}
	return c.Client.Set(ctx, linkKey(link.Alias), payload, 5*time.Minute).Err()
}

func (c *Cache) DeleteLink(ctx context.Context, alias string) error {
	return c.Client.Del(ctx, linkKey(alias)).Err()
}
