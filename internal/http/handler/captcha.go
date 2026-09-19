package handler

import (
	"net/http"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
)

// PublicCaptcha returns only the registration-page metadata. The secret and
// administrative matching fields never leave the API.
//
// The settings are the response body, not a field of it: this is the one captcha
// read whose caller wants nothing but them, and the two administrative reads
// below are the ones wrapped in a "captcha" envelope. A client that expects the
// envelope here gets undefined rather than an error, so the difference is worth
// knowing about.
func (h *Handler) PublicCaptcha(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Captcha.Public(r.Context())
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	JSON(w, http.StatusOK, settings)
}

// GetCaptchaSettings returns the administrative view; it contains has_secret,
// never the secret itself.
func (h *Handler) GetCaptchaSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.Captcha.Get(r.Context())
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	JSON(w, http.StatusOK, map[string]any{"captcha": settings})
}

// UpdateCaptchaSettings applies a partial edit. An omitted or empty secret
// retains the encrypted value, matching the OIDC write-only secret contract.
func (h *Handler) UpdateCaptchaSettings(w http.ResponseWriter, r *http.Request) {
	var req domain.CaptchaSettingsInput
	if err := Decode(r, &req); err != nil {
		ErrorCode(w, http.StatusBadRequest, domain.CodeInvalidRequest, "invalid request")
		return
	}
	settings, err := h.Captcha.Update(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionCaptchaUpdate, "captcha", "", map[string]any{
		"provider":          settings.Provider,
		"enabled":           settings.Enabled,
		"site_key":          settings.SiteKey,
		"expected_hostname": settings.ExpectedHostname,
		"expected_action":   settings.ExpectedAction,
		"has_secret":        settings.HasSecret,
		"secret_rotated":    req.Secret != nil && *req.Secret != "",
	})
	JSON(w, http.StatusOK, map[string]any{"captcha": settings})
}
