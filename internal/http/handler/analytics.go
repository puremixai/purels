package handler

import (
	"net/http"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
)

// GetAnalyticsSettings returns the tracking ids the console injects.
//
// This route is deliberately not gated by a scope. The console fetches it on
// every admin page for every signed-in account, because the script it decides
// to inject has to reach all of them; gating the read behind analytics:manage
// would silently switch tracking off for everyone else. The values are not
// secrets in any case — a measurement id is visible in any page's source.
func (h *Handler) GetAnalyticsSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Analytics.Get(r.Context())
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	JSON(w, 200, map[string]any{"analytics": settings})
}

// UpdateAnalyticsSettings replaces the tracking configuration. Requires the
// analytics:manage capability.
//
// The body is the whole configuration, and an empty field turns that provider
// off, so this is a PUT rather than a PATCH.
func (h *Handler) UpdateAnalyticsSettings(w http.ResponseWriter, r *http.Request) {
	var req domain.AnalyticsSettingsInput
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	settings, err := h.Analytics.Update(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionAnalyticsUpdate, "analytics", "", map[string]any{
		"ga4":    settings.GA4MeasurementID,
		"gtm":    settings.GTMContainerID,
		"matomo": settings.MatomoURL,
	})
	JSON(w, 200, map[string]any{"analytics": settings})
}
