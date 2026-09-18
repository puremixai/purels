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

func (c *Cache) GetLink(ctx context.Context, alias string) (*domain.Link, error) {
	value, err := c.Client.Get(ctx, "purels:link:v1:"+alias).Result()
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
	return c.Client.Set(ctx, "purels:link:v1:"+link.Alias, payload, 5*time.Minute).Err()
}

func (c *Cache) DeleteLink(ctx context.Context, alias string) error {
	return c.Client.Del(ctx, "purels:link:v1:"+alias).Err()
}
