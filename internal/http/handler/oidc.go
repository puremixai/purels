package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
)

// PublicOIDCProviders lists the sign-in buttons for a visitor who is not signed
// in yet.
//
// It sits outside the authenticated group, so like /auth/login it is exempt from
// the session requirement and the CSRF check. Only the enabled providers' slug
// and label are returned: the issuer and the client id describe the deployment's
// internals, and the login page has no use for either.
func (h *Handler) PublicOIDCProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := h.OIDC.PublicProviders(r.Context())
	if err != nil {
		Error(w, 500, "could not load sign-in methods")
		return
	}
	JSON(w, 200, map[string]any{"providers": providers})
}

// ListOIDCProviders lists every configured provider for the console.
//
// redirect_base travels with the list because the callback URL the operator has
// to register at the IdP is built from it, and it is not always the console's own
// origin — PUBLIC_URL is the short link domain and the two are allowed to differ.
// Returning the server's value means the operator registers the URL the API will
// actually send, rather than one the browser guessed.
func (h *Handler) ListOIDCProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := h.OIDC.List(r.Context())
	if err != nil {
		Error(w, 500, "could not load sign-in methods")
		return
	}
	JSON(w, 200, map[string]any{"providers": providers, "redirect_base": h.Config.OIDCRedirectBase})
}

// CreateOIDCProvider adds a sign-in method. Requires the oidc:manage capability.
func (h *Handler) CreateOIDCProvider(w http.ResponseWriter, r *http.Request) {
	var req domain.OIDCProviderInput
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	provider, err := h.OIDC.Create(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.recordOIDCChange(r, service.ActionOIDCProviderCreate, provider)
	JSON(w, 201, map[string]any{"provider": provider})
}

// UpdateOIDCProvider edits a sign-in method. Requires the oidc:manage
// capability.
func (h *Handler) UpdateOIDCProvider(w http.ResponseWriter, r *http.Request) {
	var req domain.OIDCProviderInput
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	provider, err := h.OIDC.Update(r.Context(), chi.URLParam(r, "id"), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.recordOIDCChange(r, service.ActionOIDCProviderUpdate, provider)
	JSON(w, 200, map[string]any{"provider": provider})
}

// DeleteOIDCProvider removes a sign-in method. Requires the oidc:manage
// capability.
//
// The console confirms first: deleting a provider takes its identity bindings
// with it, and the accounts it provisioned keep a password hash no password can
// match — with no screen in the application that would set a new one. Disabling
// is the reversible version of this.
func (h *Handler) DeleteOIDCProvider(w http.ResponseWriter, r *http.Request) {
	provider, err := h.OIDC.Delete(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.recordOIDCChange(r, service.ActionOIDCProviderDelete, provider)
	w.WriteHeader(http.StatusNoContent)
}

// recordOIDCChange appends the trail entry for a provider edit.
//
// The metadata describes the provider without its client secret: the trail is
// readable by anyone holding audit:read, which is a wider audience than
// oidc:manage, and a secret in an audit row would outlive every rotation of it.
func (h *Handler) recordOIDCChange(r *http.Request, action string, provider domain.OIDCProvider) {
	h.Audit.Record(r.Context(), action, "oidc_provider", provider.ID, map[string]any{
		"slug":           provider.Slug,
		"issuer":         provider.Issuer,
		"client_id":      provider.ClientID,
		"enabled":        provider.Enabled,
		"auto_provision": provider.AutoProvision,
		"has_secret":     provider.HasSecret,
	})
}
