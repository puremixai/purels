package handler

import (
	"net/http"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
)

// GetAnalyticsSettings returns the tracking ids the console injects.
//
// This route is deliberately not gated by a scope. The settings form is what
// reads it, and the values are not secrets in any case — a measurement id is
// visible in any page's source.
func (h *Handler) GetAnalyticsSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Analytics.Get(r.Context())
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	JSON(w, 200, map[string]any{"analytics": settings})
}

// PublicAnalytics returns the same values to a caller who has no session.
//
// The landing page, sign-in and registration are rendered before anybody signs
// in, and they carry the same trackers the console does — so the console's
// server render has to read this before it has a cookie to send. The values are
// not secrets; they are in the page source of every visitor either way.
//
// It answers from the process's cached snapshot rather than the database, so
// the one unauthenticated read in this file costs no query. The console caches
// the answer, which is why sharing the OIDC rate-limit bucket with the other
// anonymous reads is not a concern.
func (h *Handler) PublicAnalytics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	JSON(w, 200, h.Analytics.Current())
}

// UpdateAnalyticsSettings replaces the tracking configuration. Requires the
// analytics:manage capability.
//
// The body is the whole configuration, and an empty field turns that provider
// off, so this is a PUT rather than a PATCH.
func (h *Handler) UpdateAnalyticsSettings(w http.ResponseWriter, r *http.Request) {
	var req domain.AnalyticsSettingsInput
	if err := Decode(r, &req); err != nil {
		ErrorCode(w, 400, domain.CodeInvalidRequest, "invalid request")
		return
	}
	settings, err := h.Analytics.Update(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionAnalyticsUpdate, "analytics", "", map[string]any{
		"ga4":        settings.GA4MeasurementID,
		"gtm":        settings.GTMContainerID,
		"google_tag": settings.GoogleTagID,
		"matomo":     settings.MatomoURL,
		"clarity":    settings.ClarityProjectID,
	})
	JSON(w, 200, map[string]any{"analytics": settings})
}
