package handler

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/service"
	"github.com/purels/purels/internal/store/postgres"
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

// OIDCStart sends the browser to the identity provider.
//
// The state is parked in an HttpOnly cookie rather than in the URL the browser
// leaves with, so a referrer, a proxy log or a screenshot of the address bar
// does not carry the value that proves the callback belongs to this browser.
func (h *Handler) OIDCStart(w http.ResponseWriter, r *http.Request) {
	start, err := h.OIDC.Start(r.Context(), chi.URLParam(r, "slug"))
	if err != nil {
		h.redirectOIDCFailure(w, r, err)
		return
	}
	setShortCookie(w, "purels_oidc", start.State, true, start.MaxAge, h.Config)
	http.Redirect(w, r, start.AuthURL, http.StatusFound)
}

// OIDCCallback finishes a sign-in that began at the identity provider.
//
// Every outcome here is a redirect rather than a JSON body, because the caller
// is a browser that arrived by navigation: a failure has to be readable on the
// login page, and a session has to be in place before the browser lands on the
// console.
func (h *Handler) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	query := r.URL.Query()
	cookieState := ""
	if cookie, err := r.Cookie("purels_oidc"); err == nil {
		cookieState = cookie.Value
	}
	// Spent either way: a request that reached this point is never replayable.
	expireCookie(w, "purels_oidc", h.Config)

	if providerError := query.Get("error"); providerError != "" {
		// The provider refused, or the person cancelled. There is no code to
		// exchange, so this is not a state problem however much it looks like
		// one — the state was fine and the browser is simply back.
		h.redirectOIDCFailure(w, r, fmt.Errorf("%w: %s", service.ErrOIDCExchange, providerError))
		return
	}
	user, err := h.OIDC.Callback(r.Context(), slug, query.Get("code"), query.Get("state"), cookieState)
	if err != nil {
		h.redirectOIDCFailure(w, r, err)
		return
	}
	result, err := h.Auth.CompleteLogin(r.Context(), user, r.UserAgent(), clientIP(r))
	if err != nil {
		h.redirectOIDCFailure(w, r, err)
		return
	}
	if result.MFAChallenge != "" {
		// A navigation cannot return a challenge in a body, so it goes into a
		// short-lived HttpOnly cookie and the page is told only that a code is
		// due. The challenge therefore never reaches the URL, the referrer, a
		// proxy log or the browser's history.
		setShortCookie(w, "purels_mfa", result.MFAChallenge, true, int(h.Config.OIDCRequestTTL.Seconds()), h.Config)
		http.Redirect(w, r, "/login?mfa=1", http.StatusFound)
		return
	}
	// The trail shows how the account got in, not merely that it did.
	h.Audit.Record(domain.WithUser(r.Context(), result.User), service.ActionSessionLogin, "session", "",
		map[string]any{"method": "oidc", "provider": slug})
	setCookie(w, "purels_session", result.SessionToken, true, h.Config)
	setCookie(w, "purels_csrf", result.CSRFToken, false, h.Config)
	http.Redirect(w, r, "/admin", http.StatusFound)
}

// redirectOIDCFailure sends a failed sign-in back to the login page with a code
// the page can explain.
//
// The code is a fixed string rather than the error's text: the message can name
// an issuer, a host or a provider, and the login page is reachable without a
// session. The detail goes to the log, where an operator can see it.
func (h *Handler) redirectOIDCFailure(w http.ResponseWriter, r *http.Request, err error) {
	code := "oidc_failed"
	switch {
	case errors.Is(err, service.ErrOIDCNotProvisioned):
		code = "oidc_not_provisioned"
	case errors.Is(err, service.ErrOIDCState):
		code = "oidc_state"
	case errors.Is(err, service.ErrOIDCExchange):
		code = "oidc_exchange"
	case errors.Is(err, service.ErrOIDCDiscovery), errors.Is(err, service.ErrOIDCRedirectBase),
		errors.Is(err, service.ErrSecretsUnavailable), errors.Is(err, postgres.ErrNotFound):
		code = "oidc_unavailable"
	}
	slog.Warn("OIDC sign-in failed", "slug", chi.URLParam(r, "slug"), "code", code, "error", err)
	http.Redirect(w, r, "/login?error="+code, http.StatusFound)
}
