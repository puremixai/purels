package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/http/handler"
	httpmw "github.com/purels/purels/internal/http/middleware"
)

func NewRouter(h *handler.Handler, limiter httpmw.RateLimiter) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(httpmw.CORS(h.Config))
	r.Use(middleware.Timeout(30 * time.Second))

	// limit builds a per-IP rate limit middleware, or a pass-through when
	// rate limiting is switched off.
	limit := func(name string, perMinute int) func(http.Handler) http.Handler {
		if !h.Config.RateLimitEnabled {
			return func(next http.Handler) http.Handler { return next }
		}
		return limiter.Limit(name, perMinute, time.Minute)
	}

	r.Get("/healthz", h.Health)
	r.Get("/readyz", h.Ready)
	r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("# purels_up 1\npurels_up 1\n"))
	})
	// Keep direct API-port visits usable by sending browser pages to Next.js.
	r.Get("/admin/*", func(w http.ResponseWriter, r *http.Request) {
		target := strings.TrimRight(h.Config.AdminOrigin, "/") + r.URL.Path
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	})
	r.Get("/login", func(w http.ResponseWriter, r *http.Request) {
		target := strings.TrimRight(h.Config.AdminOrigin, "/") + "/login"
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	})
	r.Get("/register", func(w http.ResponseWriter, r *http.Request) {
		target := strings.TrimRight(h.Config.AdminOrigin, "/") + "/register"
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	})

	r.With(limit("login", h.Config.RateLimitLogin)).Post("/api/v1/auth/login", h.Login)
	// Sign-up sits beside login: outside the authenticated group, and therefore
	// also outside the CSRF check, which only applies to cookie sessions.
	r.With(limit("register", h.Config.RateLimitRegister)).Post("/api/v1/auth/register", h.Register)
	// The second step of a login, for the same reason: the caller holds a
	// challenge, not a session. Its own bucket, and the attempt counter stored
	// with the challenge is the limit that actually holds.
	r.With(limit("2fa", h.Config.RateLimit2FA)).Post("/api/v1/auth/2fa/verify", h.VerifySecondFactor)
	r.Get("/api/v1/auth/csrf", h.CSRF)
	// The sign-in buttons on the login page, for a visitor who has no session
	// yet. It reveals only the enabled providers' slug and label.
	r.With(limit("oidc", h.Config.RateLimitOIDC)).Get("/api/v1/auth/oidc/providers", h.PublicOIDCProviders)
	// The two legs of an external sign-in, for the same reason: the caller is a
	// browser with no session, arriving by navigation. They share the oidc
	// bucket with the list above, which is what the name is for.
	r.With(limit("oidc", h.Config.RateLimitOIDC)).Get("/api/v1/auth/oidc/{slug}/start", h.OIDCStart)
	r.With(limit("oidc", h.Config.RateLimitOIDC)).Get("/api/v1/auth/oidc/{slug}/callback", h.OIDCCallback)

	auth := httpmw.Auth{Store: h.Auth.Store}
	r.Route("/api/v1", func(api chi.Router) {
		api.Use(auth.Require)
		api.Use(auth.CSRF)
		api.Use(limit("api", h.Config.RateLimitAPI))

		// Any authenticated principal may inspect and end its own session.
		api.Post("/auth/logout", h.Logout)
		api.Get("/auth/me", h.Me)

		// The second factor is self-service: every one of these acts on the
		// caller's own account, so no scope is involved. Resetting somebody
		// else's is the administrator's action and lives under /users.
		api.Get("/auth/2fa", h.MFAStatus)
		api.Post("/auth/2fa/enroll", h.EnrollMFA)
		api.Post("/auth/2fa/confirm", h.ConfirmMFA)
		api.Post("/auth/2fa/disable", h.DisableMFA)

		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/links", h.ListLinks)
		api.With(httpmw.RequireScope(domain.ScopeLinksWrite)).Post("/links", h.CreateLink)
		// Registered before /links/{id} so the literal segments win.
		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/links/export", h.ExportLinks)
		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/links/expand", h.ExpandLink)
		api.With(httpmw.RequireScope(domain.ScopeLinksWrite)).Post("/links/import", h.ImportLinks)
		api.With(httpmw.RequireScope(domain.ScopeLinksWrite)).Post("/links/bulk", h.BulkLinks)
		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/links/{id}", h.GetLink)
		api.With(httpmw.RequireScope(domain.ScopeLinksWrite)).Patch("/links/{id}", h.UpdateLink)
		api.With(httpmw.RequireScope(domain.ScopeLinksWrite)).Delete("/links/{id}", h.DeleteLink)
		// A check writes to the destination's operator as much as to our own
		// database, so it is a write rather than a read.
		api.With(httpmw.RequireScope(domain.ScopeLinksWrite)).Post("/links/{id}/check", h.CheckLink)
		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/links/{id}/qr", h.QRCode)
		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/tags", h.ListTags)
		// The console's own settings, not the deployment's: it needs the same
		// scope as the link forms that consume it.
		api.With(httpmw.RequireScope(domain.ScopeLinksRead)).Get("/config", h.AppConfig)
		api.With(httpmw.RequireScope(domain.ScopeStatsRead)).Get("/links/{id}/stats", h.LinkStats)
		api.With(httpmw.RequireScope(domain.ScopeStatsRead)).Get("/links/{id}/clicks", h.LinkClicks)
		api.With(httpmw.RequireScope(domain.ScopeStatsRead)).Get("/stats/summary", h.Summary)
		api.With(httpmw.RequireScope(domain.ScopeStatsRead)).Get("/stats/top", h.TopLinks)
		api.With(httpmw.RequireScope(domain.ScopeStatsRead)).Get("/stats/overview", h.Overview)

		// The audit trail is readable by whoever holds the scope.
		api.With(httpmw.RequireScope(domain.ScopeAuditRead)).Get("/audit", h.ListAuditLogs)

		// Account administration is gated by capability: any role granted
		// users:manage may reach it, with a session or a token alike.
		api.With(httpmw.RequireScope(domain.ScopeUsersManage)).Get("/users", h.ListUsers)
		api.With(httpmw.RequireScope(domain.ScopeUsersManage)).Patch("/users/{id}", h.UpdateUser)
		// The only way back in after the encryption key is lost or changed, so
		// it requires nothing from the account being reset.
		api.With(httpmw.RequireScope(domain.ScopeUsersManage)).Post("/users/{id}/2fa/reset", h.ResetUserMFA)

		// Role definitions are editable, so they need their own capability.
		api.With(httpmw.RequireScope(domain.ScopeRolesManage)).Get("/roles", h.ListRoles)
		api.With(httpmw.RequireScope(domain.ScopeRolesManage)).Patch("/roles/{name}", h.UpdateRole)

		// Sign-in methods are configuration rather than credentials, but editing
		// one is effectively "who may sign in" — and the issuer is a URL the API
		// will fetch — so they get their own capability rather than riding on
		// roles:manage.
		api.With(httpmw.RequireScope(domain.ScopeOIDCManage)).Get("/oidc/providers", h.ListOIDCProviders)
		api.With(httpmw.RequireScope(domain.ScopeOIDCManage)).Post("/oidc/providers", h.CreateOIDCProvider)
		api.With(httpmw.RequireScope(domain.ScopeOIDCManage)).Patch("/oidc/providers/{id}", h.UpdateOIDCProvider)
		api.With(httpmw.RequireScope(domain.ScopeOIDCManage)).Delete("/oidc/providers/{id}", h.DeleteOIDCProvider)

		// Token management is intentionally not reachable with an API token.
		api.With(httpmw.RequireScope(domain.ScopeTokensManage)).Get("/auth/tokens", h.ListTokens)
		api.With(httpmw.RequireScope(domain.ScopeTokensManage)).Post("/auth/tokens", h.CreateToken)
		api.With(httpmw.RequireScope(domain.ScopeTokensManage)).Delete("/auth/tokens/{id}", h.RevokeToken)
	})

	r.With(limit("redirect", h.Config.RateLimitRedirect)).Get("/{alias}", h.Redirect)
	r.With(limit("redirect", h.Config.RateLimitRedirect)).Head("/{alias}", h.Redirect)
	return r
}
