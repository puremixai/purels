package handler

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/purels/purels/internal/config"
	"github.com/purels/purels/internal/domain"
	httpmw "github.com/purels/purels/internal/http/middleware"
	"github.com/purels/purels/internal/service"
	"github.com/purels/purels/internal/store/postgres"
	qrcode "github.com/skip2/go-qrcode"
)

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]any{"error": map[string]string{"message": message}})
}

func Decode(r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

type Handler struct {
	Config config.Config
	Auth   *service.AuthService
	Links  *service.LinkService
	Stats  *service.StatsService
	Tokens *service.TokenService
	Audit  *service.AuditService
	Users  *service.UserService
	Probe  *service.HealthChecker
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.Auth.Store.Pool.Ping(ctx); err != nil {
		Error(w, 503, "database unavailable")
		return
	}
	JSON(w, 200, map[string]string{"status": "ready"})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req domain.LoginRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	result, err := h.Auth.Login(r.Context(), strings.TrimSpace(req.Username), req.Password, r.UserAgent(), clientIP(r))
	if err != nil {
		Error(w, 401, "invalid credentials")
		return
	}
	setCookie(w, "purels_session", result.SessionToken, true, h.Config)
	setCookie(w, "purels_csrf", result.CSRFToken, false, h.Config)
	// Login happens before the auth middleware runs, so seed the actor here to
	// keep the trail entry attributed.
	h.Audit.Record(domain.WithUser(r.Context(), result.User), service.ActionSessionLogin, "session", "", nil)
	JSON(w, 200, map[string]any{"user": result.User, "csrf_token": result.CSRFToken})
}

// Register creates a regular account and signs it in. It sits outside the
// authenticated group because the caller has no session yet, which also means
// it is not cookie-authenticated and so is not subject to the CSRF check.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.Config.RegistrationEnabled {
		Error(w, http.StatusForbidden, "registration is disabled")
		return
	}
	var req domain.LoginRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	result, err := h.Auth.Register(r.Context(), req.Username, req.Password, r.UserAgent(), clientIP(r))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	setCookie(w, "purels_session", result.SessionToken, true, h.Config)
	setCookie(w, "purels_csrf", result.CSRFToken, false, h.Config)
	// Registration happens before the auth middleware runs, so seed the actor
	// here to keep the trail entry attributed.
	h.Audit.Record(domain.WithUser(r.Context(), result.User), service.ActionUserRegister, "user", result.User.ID, nil)
	JSON(w, http.StatusCreated, map[string]any{"user": result.User, "csrf_token": result.CSRFToken})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	_ = h.Auth.Logout(r.Context(), r)
	h.Audit.Record(r.Context(), service.ActionSessionEnd, "session", "", nil)
	expireCookie(w, "purels_session", h.Config)
	expireCookie(w, "purels_csrf", h.Config)
	JSON(w, 200, map[string]string{"status": "ok"})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	user, _ := domain.UserFromContext(r.Context())
	JSON(w, 200, map[string]any{"user": user})
}
func (h *Handler) CSRF(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("purels_csrf")
	if err != nil || cookie.Value == "" {
		Error(w, 404, "csrf token unavailable")
		return
	}
	JSON(w, 200, map[string]string{"token": cookie.Value})
}

func (h *Handler) Redirect(w http.ResponseWriter, r *http.Request) {
	alias := strings.Trim(r.URL.Path, "/")
	if alias == "" || strings.Contains(alias, "/") {
		h.notFound(w, r)
		return
	}
	// A trailing "+" asks for the preview page instead of the redirect. It is
	// handled here rather than as a route of its own because "+" cannot appear
	// in a valid alias, so there is nothing for it to shadow, and because a
	// preview must not be recorded as a visit.
	if strings.HasSuffix(alias, "+") {
		h.preview(w, r, strings.TrimSuffix(alias, "+"))
		return
	}
	link, err := h.Links.Resolve(r.Context(), alias)
	if err != nil {
		h.notFound(w, r)
		return
	}
	if r.Method != http.MethodHead {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		h.Links.RecordClick(ctx, link, clientIP(r), r.UserAgent(), r.Referer())
		cancel()
	}
	destination, code := link.DestinationURL, link.RedirectCode
	if ruleDestination, ruleCode, matched := service.MatchRule(link, r.UserAgent()); matched {
		destination, code = ruleDestination, ruleCode
	}
	if h.Config.ForwardQuery {
		destination = mergeQuery(destination, r.URL.RawQuery)
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, destination, int(code))
}

// preview renders the page a trailing "+" asks for: where this link would send
// the visitor who is looking at it. It deliberately does not record a click —
// opening a preview is not a visit, and counting it would inflate a link's
// statistics the moment somebody checked one.
func (h *Handler) preview(w http.ResponseWriter, r *http.Request, alias string) {
	link, err := h.Links.Resolve(r.Context(), alias)
	if err != nil {
		h.notFound(w, r)
		return
	}
	// The visitor's own user agent decides, so the page shows what this visitor
	// would actually get rather than what most visitors get.
	destination := link.DestinationURL
	if ruleDestination, _, matched := service.MatchRule(link, r.UserAgent()); matched {
		destination = ruleDestination
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// The page echoes a destination, so it has no business in a search index.
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, previewPage(link.Alias, destination))
}

// previewPage renders the preview as a self-contained document. The styling is
// inline and minimal on purpose: this page is served by the API, which has no
// access to the admin UI's stylesheet, and it has to stay readable without one.
func previewPage(alias, destination string) string {
	escaped := html.EscapeString(destination)
	var page strings.Builder
	page.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`)
	page.WriteString(`<meta name="viewport" content="width=device-width, initial-scale=1">`)
	page.WriteString(`<meta name="robots" content="noindex, nofollow">`)
	page.WriteString(`<title>` + html.EscapeString(alias) + `</title></head>`)
	page.WriteString(`<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7fb;color:#172033;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">`)
	page.WriteString(`<main style="width:min(560px,calc(100% - 32px));padding:28px;border:1px solid #e6e9ef;border-radius:14px;background:#fff;box-shadow:0 2px 8px rgb(32 43 75 / 4%)">`)
	page.WriteString(`<h1 style="margin:0 0 16px;font-size:20px">` + html.EscapeString(alias) + `</h1>`)
	page.WriteString(`<p style="margin:0 0 24px;color:#67738a;word-break:break-all">` + escaped + `</p>`)
	page.WriteString(`<a href="` + escaped + `" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#3855d9;color:#fff;text-decoration:none">继续</a>`)
	page.WriteString(`</main></body></html>`)
	return page.String()
}

// notFound answers a short code that does not resolve. A configured fallback
// keeps the visitor on a real page instead of showing a bare 404.
func (h *Handler) notFound(w http.ResponseWriter, r *http.Request) {
	if h.Config.FallbackURL == "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, h.Config.FallbackURL, http.StatusFound)
}

// mergeQuery appends the visitor's query string to the destination.
//
// The query is inserted before any fragment, and the separator is chosen so a
// destination that already carries one keeps working. The raw query is used
// as-is: it is already percent-encoded by the client, and re-encoding it would
// change what the caller asked for.
func mergeQuery(destination, rawQuery string) string {
	if rawQuery == "" {
		return destination
	}
	base, fragment := destination, ""
	if index := strings.IndexByte(destination, '#'); index >= 0 {
		base, fragment = destination[:index], destination[index:]
	}
	switch {
	case strings.HasSuffix(base, "?"), strings.HasSuffix(base, "&"):
		return base + rawQuery + fragment
	case strings.Contains(base, "?"):
		return base + "&" + rawQuery + fragment
	default:
		return base + "?" + rawQuery + fragment
	}
}

// parsePaging reads limit/offset, clamping both to sane bounds so a hostile
// query string cannot ask for the whole table.
func parsePaging(query url.Values, defaultLimit, maxLimit int) (int, int) {
	limit := defaultLimit
	if raw := query.Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= maxLimit {
			limit = parsed
		}
	}
	offset := 0
	if raw := query.Get("offset"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 {
			offset = parsed
		}
	}
	return limit, offset
}

func (h *Handler) ListLinks(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, offset := parsePaging(query, 20, 100)
	page, err := h.Links.List(r.Context(), domain.ListFilter{
		Search: strings.TrimSpace(query.Get("search")),
		Status: query.Get("status"),
		Tag:    strings.ToLower(strings.TrimSpace(query.Get("tag"))),
		Sort:   query.Get("sort"),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		Error(w, 500, "could not list links")
		return
	}
	JSON(w, 200, page)
}

func (h *Handler) ListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.Links.ListTags(r.Context())
	if err != nil {
		Error(w, 500, "could not list tags")
		return
	}
	JSON(w, 200, map[string]any{"tags": tags})
}

func (h *Handler) CreateLink(w http.ResponseWriter, r *http.Request) {
	var req domain.CreateLinkRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	result, err := h.Links.Create(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	link := result.Link
	// 201 only when a code was actually minted; UNIQUE_URLS handing back an
	// existing link is a successful read, so it reports 200.
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
		h.Audit.Record(r.Context(), service.ActionLinkCreate, "link", link.ID, map[string]any{"alias": link.Alias, "destination_url": link.DestinationURL, "rules": len(link.Rules)})
	}
	JSON(w, status, map[string]any{"link": link, "short_url": h.Links.ShortURL(link)})
}

// ExpandLink resolves a short code, or a full short URL, back to its link.
func (h *Handler) ExpandLink(w http.ResponseWriter, r *http.Request) {
	code, err := h.shortCode(r.URL.Query().Get("url"))
	if err != nil {
		Error(w, 400, err.Error())
		return
	}
	link, err := h.Links.Expand(r.Context(), code)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	JSON(w, 200, map[string]any{"link": link, "short_url": h.Links.ShortURL(link)})
}

// shortCode accepts a bare code ("abc") or a full short URL ("http://sho.rt/abc").
// A URL is only accepted when it points at one of our own hosts, so this cannot
// be turned into a lookup service for other shorteners.
func (h *Handler) shortCode(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("url is required")
	}
	if !strings.Contains(raw, "://") {
		if strings.Contains(raw, "/") {
			return "", errors.New("url must be a short code or a short URL")
		}
		return raw, nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("url is not a valid URL")
	}
	if !h.isShortHost(parsed.Hostname()) {
		return "", errors.New("url must point at this shortener")
	}
	code := strings.Trim(parsed.Path, "/")
	if code == "" || strings.Contains(code, "/") {
		return "", errors.New("url does not contain a short code")
	}
	return code, nil
}

// isShortHost reports whether a host name is one this deployment serves: the
// host in PUBLIC_URL or any configured extra short domain. Ports are ignored,
// because the port is not what makes a host ours.
func (h *Handler) isShortHost(host string) bool {
	if host == "" {
		return false
	}
	if public, err := url.Parse(h.Config.PublicURL); err == nil && strings.EqualFold(host, public.Hostname()) {
		return true
	}
	for _, configured := range h.Config.ShortDomains {
		if strings.EqualFold(host, configured) {
			return true
		}
	}
	return false
}

// AppConfig is the console's view of this deployment's own settings. It exists
// so the link forms can offer the configured short domains without the list
// being duplicated into the front-end build.
func (h *Handler) AppConfig(w http.ResponseWriter, r *http.Request) {
	// An empty list rather than null, so the picker can read the length without
	// a nil check.
	domains := h.Config.ShortDomains
	if domains == nil {
		domains = []string{}
	}
	JSON(w, 200, map[string]any{
		"short_domains":  domains,
		"default_domain": h.defaultDomain(),
	})
}

// defaultDomain is the host in PUBLIC_URL: the domain a link that names no
// domain of its own is shown on.
func (h *Handler) defaultDomain() string {
	public, err := url.Parse(h.Config.PublicURL)
	if err != nil {
		return ""
	}
	return public.Hostname()
}

func (h *Handler) LinkClicks(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r, h.Config.Location())
	id := chi.URLParam(r, "id")
	if _, err := h.Links.Get(r.Context(), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	limit, offset := parsePaging(r.URL.Query(), 20, 100)
	page, err := h.Stats.LinkClicks(r.Context(), id, from, to.AddDate(0, 0, 1), limit, offset)
	if err != nil {
		Error(w, 500, "could not load the click log")
		return
	}
	JSON(w, 200, map[string]any{
		"clicks": page.Clicks, "total": page.Total, "limit": page.Limit, "offset": page.Offset,
		"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"),
	})
}

// maxImportBytes caps an uploaded CSV. A full export of the largest allowed
// table is far smaller than this, so the limit only stops abusive uploads.
const maxImportBytes = 8 << 20

// ExportLinks downloads the links matching the same filters the list page uses,
// so "export what I am looking at" behaves as expected.
func (h *Handler) ExportLinks(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	content, err := h.Links.ExportCSV(r.Context(), domain.ListFilter{
		Search: strings.TrimSpace(query.Get("search")),
		Status: query.Get("status"),
		Tag:    strings.ToLower(strings.TrimSpace(query.Get("tag"))),
		Sort:   query.Get("sort"),
	})
	if err != nil {
		Error(w, 500, "could not export links")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="purels-links.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, content)
}

func (h *Handler) ImportLinks(w http.ResponseWriter, r *http.Request) {
	report, err := h.Links.ImportCSV(r.Context(), io.LimitReader(r.Body, maxImportBytes))
	if err != nil {
		Error(w, 400, err.Error())
		return
	}
	h.Audit.Record(r.Context(), service.ActionLinkImport, "link", "", map[string]any{"created": report.Created, "failed": report.Failed})
	JSON(w, 200, report)
}

func (h *Handler) GetLink(w http.ResponseWriter, r *http.Request) {
	link, err := h.Links.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	JSON(w, 200, map[string]any{"link": link, "short_url": h.Links.ShortURL(link)})
}

func (h *Handler) UpdateLink(w http.ResponseWriter, r *http.Request) {
	var req domain.UpdateLinkRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	link, err := h.Links.Update(r.Context(), chi.URLParam(r, "id"), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionLinkUpdate, "link", link.ID, map[string]any{"alias": link.Alias, "destination_url": link.DestinationURL, "status": link.Status, "rules": len(link.Rules)})
	JSON(w, 200, map[string]any{"link": link, "short_url": h.Links.ShortURL(link)})
}

func (h *Handler) DeleteLink(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Links.Delete(r.Context(), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionLinkDelete, "link", id, nil)
	w.WriteHeader(http.StatusNoContent)
}

// BulkLinks applies one edit to many links at once. Ids the caller does not own
// are skipped, so the response reports how many of the caller's links changed.
func (h *Handler) BulkLinks(w http.ResponseWriter, r *http.Request) {
	var req domain.BulkLinkRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	affected, err := h.Links.Bulk(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionLinkBulk, "link", "", map[string]any{
		"action":    req.Action,
		"requested": len(req.IDs),
		"affected":  affected,
	})
	JSON(w, 200, map[string]any{"action": req.Action, "affected": affected})
}

// CheckLink probes a link's destination and records the outcome. The link is
// loaded first so the ownership scope decides whether the probe happens at all.
func (h *Handler) CheckLink(w http.ResponseWriter, r *http.Request) {
	link, err := h.Links.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	health, err := h.Probe.Check(r.Context(), link.ID, link.DestinationURL)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	JSON(w, 200, health)
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	stats, err := h.Stats.Summary(r.Context())
	if err != nil {
		Error(w, 500, "could not load stats")
		return
	}
	JSON(w, 200, stats)
}

func (h *Handler) LinkStats(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r, h.Config.Location())
	id := chi.URLParam(r, "id")
	if _, err := h.Links.Get(r.Context(), id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	stats, err := h.Stats.LinkStats(r.Context(), id, from, to.AddDate(0, 0, 1), 20)
	if err != nil {
		Error(w, 500, "could not load stats")
		return
	}
	JSON(w, 200, map[string]any{"stats": stats, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

func (h *Handler) TopLinks(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 50 {
			limit = parsed
		}
	}
	order := "top"
	if r.URL.Query().Get("order") == "bottom" {
		order = "bottom"
	}
	from, to := parseDateRange(r, h.Config.Location())
	links, err := h.Stats.Top(r.Context(), order, limit, from, to.AddDate(0, 0, 1))
	if err != nil {
		Error(w, 500, "could not load rankings")
		return
	}
	JSON(w, 200, map[string]any{"links": links, "order": order, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r, h.Config.Location())
	overview, err := h.Stats.Overview(r.Context(), from, to.AddDate(0, 0, 1), service.OverviewOptions{ReferrerLimit: 10, RecentLimit: 20})
	if err != nil {
		Error(w, 500, "could not load stats overview")
		return
	}
	overview.From = from.Format("2006-01-02")
	overview.To = to.Format("2006-01-02")
	JSON(w, 200, overview)
}

func (h *Handler) QRCode(w http.ResponseWriter, r *http.Request) {
	link, err := h.Links.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	size := 320
	if raw := r.URL.Query().Get("size"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 64 && parsed <= 1024 {
			size = parsed
		}
	}
	png, err := qrcode.Encode(h.Links.ShortURL(link), qrcode.Medium, size)
	if err != nil {
		Error(w, 500, "could not generate qr code")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(png)
}

func (h *Handler) ListTokens(w http.ResponseWriter, r *http.Request) {
	user, _ := domain.UserFromContext(r.Context())
	tokens, err := h.Tokens.List(r.Context(), user.ID)
	if err != nil {
		Error(w, 500, "could not load tokens")
		return
	}
	JSON(w, 200, map[string]any{"tokens": tokens})
}

func (h *Handler) CreateToken(w http.ResponseWriter, r *http.Request) {
	var req domain.CreateTokenRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	user, _ := domain.UserFromContext(r.Context())
	created, err := h.Tokens.Create(r.Context(), user.ID, req.Name)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionTokenCreate, "token", created.Token.ID, map[string]any{"name": created.Token.Name})
	JSON(w, 201, created)
}

func (h *Handler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	user, _ := domain.UserFromContext(r.Context())
	id := chi.URLParam(r, "id")
	if err := h.Tokens.Revoke(r.Context(), user.ID, id); err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.Audit.Record(r.Context(), service.ActionTokenRevoke, "token", id, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListAuditLogs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, offset := parsePaging(query, 20, 100)
	page, err := h.Audit.List(r.Context(), strings.TrimSpace(query.Get("action")), limit, offset)
	if err != nil {
		Error(w, 500, "could not load the audit log")
		return
	}
	JSON(w, 200, page)
}

// ListUsers returns every account. Administrator only.
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.Users.List(r.Context())
	if err != nil {
		Error(w, 500, "could not load users")
		return
	}
	JSON(w, 200, map[string]any{"users": accounts})
}

// UpdateUser changes an account's role and/or disabled flag. Administrator only.
func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	var req domain.UpdateUserRequest
	if err := Decode(r, &req); err != nil {
		Error(w, 400, "invalid request")
		return
	}
	actor, _ := domain.UserFromContext(r.Context())
	target := chi.URLParam(r, "id")
	if err := h.Users.Update(r.Context(), actor.ID, target, req); err != nil {
		h.writeServiceError(w, err)
		return
	}
	// Only the fields that actually changed are recorded, so the trail reads as
	// "disabled alice" rather than "role: null, disabled: true".
	metadata := map[string]any{}
	if req.Role != nil {
		metadata["role"] = *req.Role
	}
	if req.Disabled != nil {
		metadata["disabled"] = *req.Disabled
	}
	h.Audit.Record(r.Context(), service.ActionUserUpdate, "user", target, metadata)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrNotFound):
		Error(w, 404, "resource not found")
	case errors.Is(err, postgres.ErrConflict):
		Error(w, 409, "resource already exists")
	case errors.Is(err, service.ErrQuotaExceeded):
		Error(w, 429, err.Error())
	default:
		Error(w, 400, err.Error())
	}
}

func setCookie(w http.ResponseWriter, name, value string, httpOnly bool, cfg config.Config) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: httpOnly, Secure: cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(cfg.SessionTTL.Seconds())})
}
func expireCookie(w http.ResponseWriter, name string, cfg config.Config) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: name == "purels_session", Secure: cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}
func clientIP(r *http.Request) string {
	return httpmw.ClientIP(r)
}

// parseDateRange resolves the requested window into midnight-aligned days in
// loc, which must be the same zone the click days were bucketed in — otherwise
// "today" would mean two different things either side of the query.
// Both ends are inclusive; callers add one day to get an exclusive upper bound.
// The window is capped so an unbounded range cannot request a huge trend series.
func parseDateRange(r *http.Request, loc *time.Location) (time.Time, time.Time) {
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	to, err := time.ParseInLocation("2006-01-02", r.URL.Query().Get("to"), loc)
	if err != nil {
		to = today
	}
	from, err := time.ParseInLocation("2006-01-02", r.URL.Query().Get("from"), loc)
	if err != nil {
		from = to.AddDate(0, 0, -29)
	}
	if from.After(to) {
		from = to
	}
	const maxDays = 366
	if to.Sub(from) > maxDays*24*time.Hour {
		from = to.AddDate(0, 0, -(maxDays - 1))
	}
	return from, to
}
