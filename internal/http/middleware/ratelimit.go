package middleware

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/purels/purels/internal/cache/redis"
	"github.com/purels/purels/internal/domain"
)

type RateLimiter struct{ Cache *redis.Cache }

// Limit applies a fixed-window, per-IP rate limit for the named bucket.
//
// A Redis failure fails open: the request is allowed through. Rate limiting is
// a protective measure, and letting a cache outage reject all traffic would be
// a worse outcome than briefly running unthrottled.
func (rl RateLimiter) Limit(name string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return rl.DynamicLimit(name, func() (bool, int) { return true, limit }, window)
}

// DynamicLimit reads the enabled switch and the current bucket size for every
// request. This keeps a settings change effective without rebuilding the
// router, while Limit above preserves the fixed-value API for other callers.
func (rl RateLimiter) DynamicLimit(name string, settings func() (bool, int), window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			enabled, limit := true, 0
			if settings != nil {
				enabled, limit = settings()
			}
			if !enabled || rl.Cache == nil || rl.Cache.Client == nil || limit <= 0 {
				next.ServeHTTP(w, r)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			defer cancel()

			key := "purels:rl:" + name + ":" + ClientIP(r)
			count, err := rl.Cache.Client.Incr(ctx, key).Result()
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			if count == 1 {
				rl.Cache.Client.Expire(ctx, key, window)
			}

			remaining := int64(limit) - count
			if remaining < 0 {
				remaining = 0
			}
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(remaining, 10))

			if count > int64(limit) {
				retryAfter := int(window.Seconds())
				if ttl, ttlErr := rl.Cache.Client.TTL(ctx, key).Result(); ttlErr == nil && ttl > 0 {
					retryAfter = int(ttl.Seconds()) + 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				writeJSONError(w, http.StatusTooManyRequests, domain.CodeRateLimited, "too many requests, please slow down")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
