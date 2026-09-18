const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
let csrfToken = "";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type AdminUser = {
  id?: string;
  username: string;
  role?: "admin" | "user";
  displayName?: string;
};

/** One row of the administrator's user list. */
export type AccountRecord = {
  id: string;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  created_at: string;
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
};

export type TokenRecord = {
  id: string;
  name: string;
  token_prefix: string;
  scopes?: string[];
  created_at: string;
};

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

/** Bodies that are already serialised must reach fetch untouched. */
function isRawBody(body: unknown): body is BodyInit {
  return body instanceof FormData || body instanceof Blob || typeof body === "string";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !isRawBody(options.body)) {
    headers.set("Content-Type", "application/json");
  }
  const isMutation = options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
  // Login and sign-up are not cookie-authenticated, so there is no CSRF token
  // to fetch yet and the API does not ask for one.
  const csrfExempt = path === "/api/v1/auth/login" || path === "/api/v1/auth/register";
  if (isMutation && !csrfToken && !csrfExempt) {
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
    throw new ApiError("无法连接到 API 服务，请检查后端地址。", 0);
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
    if (response.status === 401 && path !== "/api/v1/auth/login" && typeof window !== "undefined") {
      if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
      throw new ApiError("登录已过期，请重新登录。", 401, payload);
    }
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof (payload as { error?: unknown }).error === "object" && (payload as { error: { message?: unknown } }).error?.message
        ? String((payload as { error: { message: unknown } }).error.message)
        : typeof payload === "object" && payload !== null && "message" in payload
          ? String((payload as { message: unknown }).message)
          : typeof payload === "string" && payload.trim()
            ? payload
            : `请求失败（${response.status}）`;
    throw new ApiError(message, response.status, payload);
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
      const result = await request<{ user?: AdminUser; csrf_token?: string }>("/api/v1/auth/login", {
        method: "POST",
        body: { username, password },
      });
      csrfToken = result.csrf_token || "";
      return result;
    },
    /** Creates a regular account and signs it in. */
    async register(username: string, password: string) {
      const result = await request<{ user?: AdminUser; csrf_token?: string }>("/api/v1/auth/register", {
        method: "POST",
        body: { username, password },
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
    update(id: string, input: { role?: "admin" | "user"; disabled?: boolean }) {
      return request<void>(`/api/v1/users/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
    },
  },
  tags: {
    async list() {
      const payload = await request<{ tags: TagStat[] } | TagStat[]>("/api/v1/tags");
      return unwrapKey<TagStat[]>(payload, "tags") || [];
    },
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
