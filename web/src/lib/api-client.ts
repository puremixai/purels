const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
let csrfToken = "";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The API's machine-readable code, when it sent one. Empty means it did not,
   * which happens for field-level validation messages: those name a rule that a
   * code could not, so the message is the only thing worth showing.
   *
   * Transport failures that never reached the API use the console's own codes —
   * `network`, `session_expired`, `http_error`.
   */
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code = "", details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * A preset role name. Roles are rows in the database, so this list is the
 * shipped set, not a closed one: the console always renders whatever the API
 * returns and treats an unrecognised name as "show the raw value".
 */
export type RoleName = "admin" | "operator" | "readonly" | "user";

export type AdminUser = {
  id?: string;
  username: string;
  role?: RoleName;
  /** The permissions this account's role grants, as the API reports them. */
  scopes?: string[];
  /** True when the account sees every link rather than only its own. */
  unrestricted?: boolean;
  /** True when a confirmed second factor is stored on the account. */
  mfa_enabled?: boolean;
  displayName?: string;
};

/** One row of the administrator's user list. */
export type AccountRecord = {
  id: string;
  username: string;
  role: RoleName;
  disabled: boolean;
  mfa_enabled: boolean;
  created_at: string;
};

/** The deployment's and this account's second-factor state. */
export type MFAStatus = {
  /** The deployment can use 2FA at all: the switch is on and a key is set. */
  available: boolean;
  /** This account has a confirmed secret. */
  enabled: boolean;
  /** An enrolment was started and never confirmed. It affects nothing. */
  pending: boolean;
  recovery_codes_remaining: number;
};

/** An in-progress enrolment: what the authenticator app needs. */
export type MFAEnrollment = {
  secret: string;
  otpauth_url: string;
  /** A data URI, so the secret never travels in a URL or a proxy log. */
  qr: string;
};

/** What a sign-in returns: a session, or the challenge that precedes one. */
export type LoginResponse = {
  user?: AdminUser;
  csrf_token?: string;
  /** Set instead of a session when a second factor is due. */
  mfa_required?: boolean;
  challenge?: string;
};

/** One row of the role editor: a named bundle of permissions. */
export type RoleRecord = {
  name: string;
  scopes: string[];
  unrestricted: boolean;
};

/** One configured sign-in provider, as the console sees it. */
export type OIDCProvider = {
  id: string;
  /** The path segment of the callback URL. Fixed once created. */
  slug: string;
  display_name: string;
  issuer: string;
  client_id: string;
  /** Whether a secret is stored. The secret itself is never returned. */
  has_secret: boolean;
  scopes: string[];
  /** Whether a first sign-in may create an account. */
  auto_provision: boolean;
  enabled: boolean;
  /** Accounts bound to this provider. Deleting it strands every one of them. */
  identity_count: number;
  created_at: string;
  updated_at: string;
};

/** What a visitor who is not signed in may see: a slug and a label. */
export type PublicProvider = {
  slug: string;
  display_name: string;
};

/**
 * A create or edit. An update leaves every omitted field alone.
 *
 * An omitted or empty `client_secret` keeps the stored one and never clears it:
 * reading "empty" as "clear" would break every sign-in through the provider
 * without saying so. On create there is nothing to keep, so an empty secret
 * means a public client.
 */
export type OIDCProviderInput = {
  slug?: string;
  display_name?: string;
  issuer?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  auto_provision?: boolean;
  enabled?: boolean;
};

/** A divert rule: send a matching visitor somewhere else. */
export type LinkRule = {
  id?: string;
  position: number;
  match_type: "ua_contains" | "device";
  match_value: string;
  destination_url: string;
  /** 0 inherits the link's own redirect code. */
  redirect_code: number;
};

/** One rule as submitted. Order is the match order, so there is no position. */
export type LinkRuleInput = {
  match_type: string;
  match_value: string;
  destination_url: string;
  redirect_code: number;
};

export type LinkRecord = {
  id: string;
  alias: string;
  destination_url: string;
  title: string;
  tags: string[];
  redirect_code: number;
  status: string;
  version: number;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  /** Lifetime clicks. Present in list and ranking responses. */
  clicks?: number;
  /** Result of the last destination check. Absent means never checked. */
  last_checked_at?: string;
  /** 0 records a check that could not reach the destination at all. */
  last_status_code?: number;
  /** Only single-link reads load these; a list row leaves the field absent. */
  rules?: LinkRule[];
  /**
   * The configured short domain the link is filed under. Absent means the
   * default host, which is also what an empty string means on the wire.
   */
  domain?: string;
  /**
   * Seconds to hold the visitor on a page showing the destination before
   * sending them on. 0 redirects immediately.
   */
  interstitial_seconds: number;
};

/** Outcome of one destination check. */
export type LinkHealth = {
  checked_at: string;
  status_code: number;
  ok: boolean;
  error?: string;
};

export type BulkAction = "delete" | "disable" | "enable" | "tag" | "untag" | "set_expiry";

export type BulkLinkInput = {
  action: BulkAction;
  ids: string[];
  tags?: string[];
  /** An empty string clears the expiry. */
  expires_at?: string;
};

export type LinkInput = {
  destination_url: string;
  alias?: string;
  title?: string;
  tags?: string[];
  redirect_code?: number;
  expires_at?: string;
  /** The whole list is replaced on every save. */
  rules?: LinkRuleInput[];
  /** An empty string moves the link back to the default domain. */
  domain?: string;
  /**
   * Omitting it on create takes the default (2); omitting it on update leaves
   * the delay alone. 0 turns the interstitial off.
   */
  interstitial_seconds?: number;
};

/** The deployment's own settings, as the console needs to know them. */
export type AppConfig = {
  short_domains: string[];
  default_domain: string;
};

/**
 * The tracking ids the console injects into its own pages. An empty field means
 * that provider is off.
 *
 * The console does not trust these values: lib/analytics-config.ts validates
 * every one of them before it builds the script, because a value that got
 * through would run as code in every administrator's browser.
 */
export type AnalyticsSettings = {
  ga4_measurement_id: string;
  gtm_container_id: string;
  matomo_url: string;
  matomo_site_id: string;
  updated_at: string;
};

/** The four editable fields, which is the whole of what a save replaces. */
export type AnalyticsInput = {
  ga4_measurement_id: string;
  gtm_container_id: string;
  matomo_url: string;
  matomo_site_id: string;
};

/** Administrative registration CAPTCHA configuration. The secret is write-only. */
export type CaptchaSettings = {
  provider: string;
  enabled: boolean;
  site_key: string;
  has_secret: boolean;
  expected_hostname: string;
  expected_action: string;
  updated_at: string;
};

/** Public registration-page CAPTCHA configuration. */
export type PublicCaptchaSettings = {
  enabled: boolean;
  provider: string;
  site_key: string;
};

/** Fields accepted by the administrative CAPTCHA settings endpoint. */
export type CaptchaInput = {
  enabled?: boolean;
  site_key?: string;
  secret?: string;
  expected_hostname?: string;
  expected_action?: string;
};

export type TagStat = {
  name: string;
  links: number;
};

export type ImportError = {
  line: number;
  alias?: string;
  reason: string;
};

export type ImportReport = {
  created: number;
  failed: number;
  errors: ImportError[];
};

export type AuditEntry = {
  id: string;
  user_id?: string;
  username?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type AuditPage = {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type LinkPage = {
  links: LinkRecord[];
  total: number;
  limit: number;
  offset: number;
};

export type LinkSort = "created_at_desc" | "created_at_asc" | "alias_asc" | "alias_desc" | "clicks_desc" | "clicks_asc";
export type LinkStatusFilter = "all" | "active" | "disabled" | "expired";

export type ListParams = {
  limit?: number;
  offset?: number;
  sort?: LinkSort;
  status?: LinkStatusFilter;
  search?: string;
  tag?: string;
};

export type StatsSummary = {
  total_links: number;
  total_clicks: number;
};

export type DailyStat = {
  day: string;
  clicks: number;
};

export type ReferrerStat = {
  referrer: string;
  clicks: number;
};

export type LinkStats = {
  total_clicks: number;
  daily: DailyStat[];
  referrers: ReferrerStat[];
};

export type DateRange = { from: string; to: string };

export type TrendPoint = {
  day: string;
  clicks: number;
};

export type DeviceStat = {
  device: string;
  clicks: number;
};

export type RecentClick = {
  link_id: string;
  alias: string;
  occurred_at: string;
  referrer: string;
  user_agent: string;
};

/** Paginated raw click log for a single link. */
export type ClickPage = {
  clicks: RecentClick[];
  total: number;
  limit: number;
  offset: number;
  from: string;
  to: string;
};

export type StatsOverview = {
  total_links: number;
  total_clicks: number;
  unique_visitors: number;
  trend: TrendPoint[];
  referrers: ReferrerStat[];
  devices: DeviceStat[];
  recent_clicks: RecentClick[];
  from: string;
  to: string;
  /**
   * The deployment's IP_HASH_MODE. Under "none" no address is stored, so
   * unique_visitors is structurally zero rather than genuinely zero.
   */
  ip_mode: string;
};

export type TokenRecord = {
  id: string;
  name: string;
  token_prefix: string;
  scopes?: string[];
  created_at: string;
};

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * Endpoints that are reachable before a session exists. They need no CSRF token
 * because there is no cookie to protect yet, and a 401 from them is the
 * endpoint's own answer rather than an expired session — bouncing the browser to
 * /login on a wrong second-factor code would throw away the challenge the user
 * is halfway through.
 */
const preSessionPaths = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/2fa/verify",
]);

/** Bodies that are already serialised must reach fetch untouched. */
function isRawBody(body: unknown): body is BodyInit {
  return body instanceof FormData || body instanceof Blob || typeof body === "string";
}

/**
 * The human message the API sent, if it sent one.
 *
 * This is English and the console renders its own wording from the code
 * whenever it can, so this is a fallback rather than the normal path. It still
 * has to survive the trip: an uncoded validation message is the only place a
 * broken rule is named.
 */
function serverMessage(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (typeof payload !== "object" || payload === null) return "";
  const envelope = (payload as { error?: unknown }).error;
  if (typeof envelope === "object" && envelope !== null) {
    const message = (envelope as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/** The machine-readable code the API sent, if it sent one. */
function serverCode(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const envelope = (payload as { error?: unknown }).error;
  if (typeof envelope !== "object" || envelope === null) return "";
  const code = (envelope as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !isRawBody(options.body)) {
    headers.set("Content-Type", "application/json");
  }
  const isMutation = options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
  if (isMutation && !csrfToken && !preSessionPaths.has(path)) {
    try {
      const csrfResponse = await fetch(`${API_BASE_URL}/api/v1/auth/csrf`, { credentials: "include" });
      if (csrfResponse.ok) {
        const csrfPayload = (await csrfResponse.json()) as { token?: string };
        csrfToken = csrfPayload.token || "";
      }
    } catch { /* the actual request reports the connection error */ }
  }
  if (isMutation && csrfToken) headers.set("X-CSRF-Token", csrfToken);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      body:
        options.body === undefined || isRawBody(options.body)
          ? (options.body as BodyInit | null | undefined)
          : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("Cannot reach the API server. Check the backend address.", 0, "network");
  }

  const contentType = response.headers.get("content-type") || "";
  let payload: unknown;
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => undefined);
  } else {
    payload = await response.text().catch(() => undefined);
  }

  if (!response.ok) {
    // An expired or missing session should send the operator back to the login page
    // instead of leaving every admin page showing a generic load error.
    if (response.status === 401 && !preSessionPaths.has(path) && typeof window !== "undefined") {
      if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
      throw new ApiError("Your session has expired. Please sign in again.", 401, "session_expired", payload);
    }
    throw new ApiError(
      serverMessage(payload) || `Request failed (${response.status}).`,
      response.status,
      serverCode(payload) || "http_error",
      payload,
    );
  }

  return payload as T;
}

/** The Go API wraps single resources in a named envelope, e.g. `{"link": {...}}`. */
function unwrapKey<T>(payload: unknown, key: string): T {
  if (payload && typeof payload === "object" && key in payload) {
    return (payload as Record<string, T>)[key];
  }
  return payload as T;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export const api = {
  auth: {
    async login(username: string, password: string) {
      const result = await request<LoginResponse>("/api/v1/auth/login", {
        method: "POST",
        body: { username, password },
      });
      csrfToken = result.csrf_token || "";
      return result;
    },
    /** Creates a regular account and signs it in. */
    async register(username: string, password: string, captchaToken = "") {
      const result = await request<LoginResponse>("/api/v1/auth/register", {
        method: "POST",
        body: { username, password, ...(captchaToken ? { captcha_token: captchaToken } : {}) },
      });
      csrfToken = result.csrf_token || "";
      return result;
    },
    async csrf() {
      const result = await request<{ token: string }>("/api/v1/auth/csrf");
      csrfToken = result.token;
      return result.token;
    },
    async me() {
      const payload = await request<{ user: AdminUser } | AdminUser>("/api/v1/auth/me");
      return unwrapKey<AdminUser>(payload, "user");
    },
    logout() {
      return request<void>("/api/v1/auth/logout", { method: "POST" });
    },
  },
  /** The caller's own second factor. Resetting somebody else's is `users.resetMfa`. */
  mfa: {
    status() {
      return request<MFAStatus>("/api/v1/auth/2fa");
    },
    /** Second step of a login. Returns a session on success. */
    async verify(challenge: string, code: string) {
      const result = await request<LoginResponse>("/api/v1/auth/2fa/verify", {
        method: "POST",
        body: { challenge, code },
      });
      csrfToken = result.csrf_token || "";
      return result;
    },
    enroll() {
      return request<MFAEnrollment>("/api/v1/auth/2fa/enroll", { method: "POST" });
    },
    confirm(code: string) {
      return request<{ recovery_codes: string[] }>("/api/v1/auth/2fa/confirm", { method: "POST", body: { code } });
    },
    disable(password: string, code: string) {
      return request<void>("/api/v1/auth/2fa/disable", { method: "POST", body: { password, code } });
    },
  },
  links: {
    list(params: ListParams = {}) {
      const query = buildQuery({
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
        status: params.status && params.status !== "all" ? params.status : undefined,
        search: params.search,
        tag: params.tag,
      });
      return request<LinkPage>(`/api/v1/links${query}`);
    },
    /**
     * The link together with its absolute short URL. The envelope is kept
     * because the short URL is the only way to build a working link to the
     * public host: the admin UI and the shortener are not always the same
     * origin, so a relative path would point at the wrong server.
     */
    get(id: string) {
      return request<{ link: LinkRecord; short_url: string }>(`/api/v1/links/${encodeURIComponent(id)}`);
    },
    /** The public preview page, which the API serves at `/{alias}+`. */
    previewUrl(shortUrl: string) {
      return `${shortUrl}+`;
    },
    create(input: LinkInput) {
      return request<{ link: LinkRecord; short_url: string }>("/api/v1/links", { method: "POST", body: input });
    },
    update(id: string, input: Partial<LinkInput> & { status?: string }) {
      return request<{ link: LinkRecord; short_url: string }>(`/api/v1/links/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
      });
    },
    remove(id: string) {
      return request<void>(`/api/v1/links/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    /** Applies one edit to many links; ids belonging to somebody else are skipped. */
    bulk(input: BulkLinkInput) {
      return request<{ action: string; affected: number }>("/api/v1/links/bulk", { method: "POST", body: input });
    },
    /** Probes the destination now and records the result. */
    check(id: string) {
      return request<LinkHealth>(`/api/v1/links/${encodeURIComponent(id)}/check`, { method: "POST" });
    },
    /** Direct image URL; the browser sends the session cookie with the <img> request. */
    qrUrl(id: string, size = 320) {
      return `${API_BASE_URL}/api/v1/links/${encodeURIComponent(id)}/qr${buildQuery({ size })}`;
    },
    /** CSV text for the links matching the current filters. */
    exportCsv(params: ListParams = {}) {
      const query = buildQuery({
        sort: params.sort,
        status: params.status && params.status !== "all" ? params.status : undefined,
        search: params.search,
        tag: params.tag,
      });
      return request<string>(`/api/v1/links/export${query}`);
    },
    importCsv(csv: string) {
      return request<ImportReport>("/api/v1/links/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: csv,
      });
    },
  },
  audit: {
    list(params: { action?: string; limit?: number; offset?: number } = {}) {
      return request<AuditPage>(`/api/v1/audit${buildQuery({ action: params.action, limit: params.limit, offset: params.offset })}`);
    },
  },
  users: {
    async list() {
      const payload = await request<{ users: AccountRecord[] } | AccountRecord[]>("/api/v1/users");
      return unwrapKey<AccountRecord[]>(payload, "users") || [];
    },
    update(id: string, input: { role?: string; disabled?: boolean }) {
      return request<void>(`/api/v1/users/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
    },
    /**
     * Removes another account's second factor. The only way back in after the
     * encryption key is lost or changed, so it asks the target for nothing.
     */
    resetMfa(id: string) {
      return request<void>(`/api/v1/users/${encodeURIComponent(id)}/2fa/reset`, { method: "POST" });
    },
  },
  roles: {
    async list() {
      const payload = await request<{ roles: RoleRecord[] } | RoleRecord[]>("/api/v1/roles");
      return unwrapKey<RoleRecord[]>(payload, "roles") || [];
    },
    update(name: string, input: { scopes: string[]; unrestricted: boolean }) {
      return request<void>(`/api/v1/roles/${encodeURIComponent(name)}`, { method: "PATCH", body: input });
    },
  },
  /** Sign-in methods. Password login stays the primary path; these are extra doors. */
  oidc: {
    /** What the login page renders. Reachable before a session exists. */
    async publicProviders() {
      const payload = await request<{ providers: PublicProvider[] } | PublicProvider[]>("/api/v1/auth/oidc/providers");
      return unwrapKey<PublicProvider[]>(payload, "providers") || [];
    },
    /**
     * Every provider, with the origin the callback URL is built from. The base
     * comes from the server rather than from `window.location` because it is not
     * always the console's origin — PUBLIC_URL is the short link domain, and the
     * operator has to register the URL the API will actually send.
     */
    list() {
      return request<{ providers: OIDCProvider[]; redirect_base: string }>("/api/v1/oidc/providers");
    },
    async create(input: OIDCProviderInput) {
      const payload = await request<{ provider: OIDCProvider }>("/api/v1/oidc/providers", { method: "POST", body: input });
      return unwrapKey<OIDCProvider>(payload, "provider");
    },
    async update(id: string, input: OIDCProviderInput) {
      const payload = await request<{ provider: OIDCProvider }>(`/api/v1/oidc/providers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
      });
      return unwrapKey<OIDCProvider>(payload, "provider");
    },
    remove(id: string) {
      return request<void>(`/api/v1/oidc/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },
  /** Registration CAPTCHA settings. The public read contains no secret. */
  captcha: {
    async publicSettings() {
      const payload = await request<{ captcha: PublicCaptchaSettings } | PublicCaptchaSettings>("/api/v1/auth/captcha");
      return unwrapKey<PublicCaptchaSettings>(payload, "captcha");
    },
    async get() {
      const payload = await request<{ captcha: CaptchaSettings } | CaptchaSettings>("/api/v1/captcha");
      return unwrapKey<CaptchaSettings>(payload, "captcha");
    },
    async update(input: CaptchaInput) {
      const payload = await request<{ captcha: CaptchaSettings } | CaptchaSettings>("/api/v1/captcha", {
        method: "PATCH",
        body: input,
      });
      return unwrapKey<CaptchaSettings>(payload, "captcha");
    },
  },
  /**
   * The tracking ids the console injects into its own pages.
   *
   * The read is open to every signed-in account, because the console fetches it
   * on every admin page for all of them; only the write needs a capability. A
   * save replaces all four fields, so an empty one turns that provider off.
   */
  analytics: {
    async get() {
      const payload = await request<{ analytics: AnalyticsSettings } | AnalyticsSettings>("/api/v1/analytics");
      return unwrapKey<AnalyticsSettings>(payload, "analytics");
    },
    async update(input: AnalyticsInput) {
      const payload = await request<{ analytics: AnalyticsSettings } | AnalyticsSettings>("/api/v1/analytics", {
        method: "PUT",
        body: input,
      });
      return unwrapKey<AnalyticsSettings>(payload, "analytics");
    },
  },
  tags: {
    async list() {
      const payload = await request<{ tags: TagStat[] } | TagStat[]>("/api/v1/tags");
      return unwrapKey<TagStat[]>(payload, "tags") || [];
    },
  },
  /** Deployment settings the forms need, not user data. */
  config() {
    return request<AppConfig>("/api/v1/config");
  },
  stats: {
    summary() {
      return request<StatsSummary>("/api/v1/stats/summary");
    },
    async top(order: "top" | "bottom" = "top", limit = 10, range?: DateRange) {
      const payload = await request<{ links: LinkRecord[] } | LinkRecord[]>(
        `/api/v1/stats/top${buildQuery({ order, limit, from: range?.from, to: range?.to })}`,
      );
      return unwrapKey<LinkRecord[]>(payload, "links") || [];
    },
    overview(range: DateRange) {
      return request<StatsOverview>(`/api/v1/stats/overview${buildQuery({ from: range.from, to: range.to })}`);
    },
    link(id: string, range?: DateRange) {
      return request<{ stats: LinkStats; from: string; to: string }>(
        `/api/v1/links/${encodeURIComponent(id)}/stats${buildQuery({ from: range?.from, to: range?.to })}`,
      );
    },
    linkClicks(id: string, range: DateRange, paging: { limit?: number; offset?: number } = {}) {
      return request<ClickPage>(
        `/api/v1/links/${encodeURIComponent(id)}/clicks${buildQuery({
          from: range.from,
          to: range.to,
          limit: paging.limit,
          offset: paging.offset,
        })}`,
      );
    },
  },
  tokens: {
    async list() {
      const payload = await request<{ tokens: TokenRecord[] } | TokenRecord[]>("/api/v1/auth/tokens");
      return unwrapKey<TokenRecord[]>(payload, "tokens") || [];
    },
    create(name: string) {
      return request<{ token: TokenRecord; secret: string }>("/api/v1/auth/tokens", { method: "POST", body: { name } });
    },
    revoke(id: string) {
      return request<void>(`/api/v1/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  },
};
