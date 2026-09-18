package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

// probeUserAgent identifies the checker to the destination's operator, so an
// unexpected request in their logs can be traced back to this server.
const probeUserAgent = "purels-healthcheck/1.0"

// HealthChecker probes link destinations. It is separate from LinkService
// because the background worker needs only this, and because the probe is the
// one place where the server issues an outbound request on a user's behalf.
//
// Client must come from security.NewProbeClient: a plain http.Client would
// follow a user-supplied destination into the server's own network.
type HealthChecker struct {
	Store  *postgres.Store
	Client *http.Client
}

// Check probes one destination and records the outcome against the link.
//
// A destination that cannot be reached is a result, not an error: it is
// recorded as status code 0 and reported back. An error means the check could
// not be performed or stored at all.
func (h *HealthChecker) Check(ctx context.Context, linkID, destination string) (domain.LinkHealth, error) {
	health := domain.LinkHealth{CheckedAt: time.Now().UTC()}
	if h.Client == nil {
		// The zero value of this struct has no SSRF guard, so it refuses to
		// probe rather than falling back to the default transport.
		return health, errors.New("destination checks are not configured")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, destination, nil)
	if err != nil {
		return health, err
	}
	request.Header.Set("User-Agent", probeUserAgent)

	response, err := h.Client.Do(request)
	if err != nil {
		if recordErr := h.Store.RecordLinkHealth(ctx, linkID, health.CheckedAt, 0); recordErr != nil {
			return health, recordErr
		}
		health.Error = err.Error()
		return health, nil
	}
	// The status is the whole answer, so the body is closed unread. Keep-alives
	// are off on this client, so nothing is left half-drained.
	_ = response.Body.Close()

	health.StatusCode = response.StatusCode
	health.OK = response.StatusCode < 400
	if err := h.Store.RecordLinkHealth(ctx, linkID, health.CheckedAt, response.StatusCode); err != nil {
		return health, err
	}
	return health, nil
}
