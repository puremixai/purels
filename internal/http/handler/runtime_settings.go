package handler

import (
	"errors"
	"net/http"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
	"github.com/purels/purels/internal/store/postgres"
)

// GetRuntimeSettings returns the validated, non-secret settings that drive
// link creation, redirects, limits and background jobs. It is scoped because
// these values describe deployment policy rather than an individual account.
func (h *Handler) GetRuntimeSettings(w http.ResponseWriter, r *http.Request) {
	JSON(w, http.StatusOK, map[string]any{"settings": h.runtimeSettings()})
}

// PatchRuntimeSettings allows settings groups to save independently without
// weakening the full-document validation or the settings:manage permission.
func (h *Handler) PatchRuntimeSettings(w http.ResponseWriter, r *http.Request) {
	if h.Settings == nil {
		ErrorCode(w, http.StatusServiceUnavailable, domain.CodeInternalError, "runtime settings are unavailable")
		return
	}
	var patch domain.RuntimeSettingsPatch
	if err := Decode(r, &patch); err != nil {
		ErrorCode(w, http.StatusBadRequest, domain.CodeInvalidRequest, "invalid request")
		return
	}
	if _, err := patch.Apply(domain.RuntimeSettingsInput{}); err != nil {
		ErrorCode(w, http.StatusBadRequest, domain.CodeInvalidRequest, err.Error())
		return
	}
	settings, err := h.Settings.Patch(r.Context(), patch)
	if err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			ErrorCode(w, http.StatusConflict, domain.CodeConflict, "settings changed; reload and retry")
		} else if errors.Is(err, domain.ErrInvalidRuntimePatch) {
			ErrorCode(w, http.StatusBadRequest, domain.CodeInvalidRequest, err.Error())
		} else {
			h.writeServiceError(w, err)
		}
		return
	}
	h.Audit.Record(r.Context(), service.ActionRuntimeSettingsUpdate, "runtime_settings", "", map[string]any{
		"revision": settings.Revision,
	})
	JSON(w, http.StatusOK, map[string]any{"settings": settings})
}

// UpdateRuntimeSettings replaces the mutable runtime policy as one validated
// snapshot. A whole-document update keeps related switches from being saved in
// a half-valid combination and makes the revision visible to the console.
func (h *Handler) UpdateRuntimeSettings(w http.ResponseWriter, r *http.Request) {
	if h.Settings == nil {
		ErrorCode(w, http.StatusServiceUnavailable, domain.CodeInternalError, "runtime settings are unavailable")
		return
	}
	var input domain.RuntimeSettingsInput
	if err := Decode(r, &input); err != nil {
		ErrorCode(w, http.StatusBadRequest, domain.CodeInvalidRequest, "invalid request")
		return
	}
	settings, err := h.Settings.Update(r.Context(), input)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionRuntimeSettingsUpdate, "runtime_settings", "", map[string]any{
		"revision": settings.Revision,
	})
	JSON(w, http.StatusOK, map[string]any{"settings": settings})
}
