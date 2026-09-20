# Purels

A self-hosted URL shortener with an operations console: short links, click
analytics, an audit trail, role-based access control and multi-user accounts.

[![CI](https://github.com/puremixai/purels/actions/workflows/ci.yml/badge.svg)](https://github.com/puremixai/purels/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Go 1.27](https://img.shields.io/badge/Go-1.27-00ADD8.svg)](go.mod)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](web/package.json)

---

## Contents

- [What this is](#what-this-is)
- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [HTTP API](#http-api)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [Security](#security)
- [License](#license)

## What this is

Purels shortens URLs and then tells you what happened to them. It is built as a
service you run yourself: one Go binary for the API and the redirect path, one
background worker, one PostgreSQL database, one Redis, and a Next.js console
behind a reverse proxy.

It is not a link-management SaaS and not a drop-in clone of anything. The design
decisions that shape it:

- **Ownership is real.** A regular account sees only its own links; an
  administrator sees everything. The visibility scope comes from the session,
  never from a query parameter.
- **Authority is data.** Roles and their scopes live in a table and are edited in
  the console, not compiled in.
- **Nothing is inferred from the client.** Client IPs, redirect destinations and
  role names are all validated server-side; see [Security](#security).

## Features

### Links

- Custom aliases, or generated ones — random by default, or opt-in sequential
  Base36 (`ALIAS_MODE`)
- Aliases preserve their casing and are matched case-sensitively: `AbC` and
  `abc` are different short codes
- Optional reuse of an existing code for a destination that was shortened before
  (`UNIQUE_URLS`), so re-shortening the same page does not mint a second alias
- Multiple short domains (`SHORT_DOMAINS`), with a configurable default
- Titles, tags and expiry dates
- 301 or 302 redirects, chosen per link
- Destination allow/deny checking, with a configurable denylist
- A `/{alias}+` preview page that shows the destination before following it
- QR codes, rendered on demand
- User-agent divert rules: send matching visitors to a different destination
  without changing the short link
- CSV import and export, where the export column set *is* the import contract
- Bulk operations over a selected set: disable, enable, delete, tag, untag and
  set an expiry

### Analytics

- Per-link click totals, trends, top links, referrers and device breakdown
- A raw per-click log with timestamps, referrers and device class
- Bot detection by user agent, with bot traffic recorded but excluded from
  reported statistics unless asked for (`COUNT_BOTS`)
- Three IP-hash modes (`none`, `anonymised`, `pseudonymised`), optionally keyed as
  an HMAC, so unique-visitor counts can be had without storing addresses
- A configurable statistics timezone, applied to the database session so the API
  and the worker bucket days identically

### Accounts and access

- Session sign-in with CSRF protection, plus optional TOTP two-factor
  authentication
- OIDC sign-in providers configured in the console and stored in the database.
  Password login remains the primary path
- API tokens with an explicit scope list, and a default scope set that
  deliberately excludes token minting, the audit trail and all administration
- Eleven scopes and four role presets, all editable
- Open registration with anti-abuse, optionally gated by Cloudflare Turnstile

### Operations

- An audit trail covering 21 actions, with the actor, the address it came from
  and the changed values
- Per-IP rate limiting on login, registration, the API, redirects, the
  second-factor endpoint and OIDC
- `/healthz`, `/readyz` and Prometheus `/metrics`
- A background worker that aggregates clicks, prunes expired links and probes
  destinations for reachability
- Optional injection of a GA4, Google Tag Manager or Matomo tag into the console,
  configurable in the console itself
- An English and Simplified Chinese console. The language follows an explicit
  choice, then `Accept-Language`, then English

## Quick start

Requires Docker with Compose.

```sh
git clone https://github.com/puremixai/purels.git
cd purels
make compose-up
```

Then open <http://localhost> and sign in as `admin` with the password
`change-me-now`.

> The bundled stack is a **development** stack. It ships a known default
> password, plain-HTTP cookies and no TLS. Read [Deploying](#deploying) before
> putting it anywhere reachable.

The stack brings up PostgreSQL, Redis, the migrations, the API, the worker, the
console and a Caddy gateway. Nothing else is required.

To stop it and keep the data:

```sh
docker compose -f deploy/compose.yaml down
```

To remove the volumes as well, add `-v`.

## Configuration

Infrastructure and secret settings remain environment variables, documented in
[`.env.example`](.env.example) — including the ones that are easy to get wrong,
such as `SECRET_ENCRYPTION_KEY`, which encrypts stored TOTP secrets and OIDC
client secrets and cannot be changed without invalidating them. The first API
or worker boot after migration seeds the mutable policy row from the matching
environment values; after that, the database row is authoritative.

The administrator can edit the following runtime settings from
`/admin/settings/runtime` with the `settings:manage` scope: alias generation,
duplicate URL handling, registration, bot counting, query forwarding, fallback
URL, expiry pruning, per-user link quota, destination denylist, extra short
domains, destination health checks and all per-IP rate-limit buckets. Changes
are picked up by the API immediately and by the worker on its short poll; the
admin role receives this scope in migration `000018`.

The compose file under `deploy/` carries the same variables with development
values. The ones that matter most:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost` | Base used to render short links and the OIDC redirect |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` | `admin` / `change-me-now` | The first account, created on boot if the table is empty |
| `COOKIE_SECURE` | `false` | Set to `true` whenever the console is served over HTTPS |
| `SECRET_ENCRYPTION_KEY` | empty | Required before TOTP enrolment or an OIDC client secret can be stored |
| `ALIAS_MODE` | `random` | `random` keeps codes unguessable; `sequential` makes them enumerable |
| `UNIQUE_URLS` | `true` | Reuse the existing code when a destination is shortened again |
| `REGISTRATION_ENABLED` | `true` | `false` closes public sign-up without touching existing accounts |
| `IP_HASH_MODE` | `pseudonymised` | `none` stores no address-derived value at all |
| `STATS_TZ` | `UTC` | Where a statistics "day" starts. Must match between the API and the worker |
| `RATE_LIMIT_*` | see `.env.example` | Per-IP, per-minute, per bucket |

The values above that are listed as runtime settings are bootstrap defaults
only after `000018`; changing them in `.env` later does not overwrite an
operator's database edit. Keep `PUBLIC_URL`, database/Redis URLs, CORS origins,
cookie/session settings, IP hash mode/key, encryption keys, OIDC bootstrap
settings and other infrastructure/security material in the environment.

## Deploying

The `deploy/compose.yaml` stack is intended for local use. It is not a
production configuration, and the differences are not cosmetic:

- `BOOTSTRAP_PASSWORD` is a published default
- `COOKIE_SECURE=false` sends the session cookie over plain HTTP
- `SECRET_ENCRYPTION_KEY` is empty, so no secret can be stored
- The gateway runs with `auto_https off`, so there is no TLS
- `ADMIN_ORIGIN` allows `http://localhost` origins only

A real deployment needs all of those addressed, a TLS-terminating proxy in front,
and the API port left unpublished — it is bound to loopback in the bundled stack
on purpose. Behind Cloudflare, the API uses the `CF-Connecting-IP` header and
otherwise falls back to the proxy-appended `X-Forwarded-For`; a caller who can
reach the API directly can name their own address. The reasoning is recorded in
`internal/http/middleware/clientip.go`.

Back up PostgreSQL. That is where links, accounts, sessions and the audit trail
live; Redis holds only a redirect cache and rate-limit counters and can be
flushed.

## HTTP API

All endpoints are under `/api/v1`. Authentication is a session cookie (with the
`X-CSRF-Token` header on writes) or a bearer token. Every route below is checked
against the caller's scopes; a token holds the scopes it was minted with, and a
session holds the scopes of its role.

| Group | Endpoints | Scope |
| --- | --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/csrf` | — |
| Registration | `POST /auth/register` | — |
| Two-factor | `POST /auth/2fa/verify`, `GET /auth/2fa`, `POST /auth/2fa/{enroll,confirm,disable}` | — |
| OIDC | `GET /auth/oidc/providers`, `GET /auth/oidc/{slug}/{start,callback}` | — |
| Links | `GET/POST /links`, `GET/PATCH/DELETE /links/{id}` | `links:read`, `links:write` |
| Links | `GET /links/export`, `GET /links/expand`, `POST /links/import`, `POST /links/bulk` | `links:read`, `links:write` |
| Links | `POST /links/{id}/check`, `GET /links/{id}/qr`, `GET /tags`, `GET /config` | `links:write`, `links:read` |
| Statistics | `GET /stats/{summary,top,overview}`, `GET /links/{id}/{stats,clicks}` | `stats:read` |
| Audit | `GET /audit` | `audit:read` |
| Users | `GET /users`, `PATCH /users/{id}`, `POST /users/{id}/2fa/reset` | `users:manage` |
| Roles | `GET /roles`, `PATCH /roles/{name}` | `roles:manage` |
| Sign-in methods | `GET/POST /oidc/providers`, `PATCH/DELETE /oidc/providers/{id}` | `oidc:manage` |
| Tracking | `GET /analytics` | — (any authenticated caller: every console page needs it) |
| Tracking | `PUT /analytics` | `analytics:manage` |
| CAPTCHA | `GET/PATCH /captcha` | `captcha:manage` |
| Runtime settings | `GET/PUT /settings/runtime` | `settings:manage` |
| Tokens | `GET/POST /auth/tokens`, `DELETE /auth/tokens/{id}` | `tokens:manage` |

Outside `/api/v1`:

| Endpoint | Purpose |
| --- | --- |
| `GET /{alias}` | The redirect. Rate-limited separately and more generously |
| `GET /{alias}+` | The preview page, localized from `Accept-Language` |
| `GET /healthz`, `GET /readyz`, `GET /metrics` | Liveness, readiness, Prometheus |

There is no generated OpenAPI document. The API surface is described here and
enforced by the router in `internal/http/router.go`, which is the single place a
route is declared along with the scope it requires.

## Architecture

```
             ┌──────────┐
  browser ──▶│  Caddy   │──▶ /admin, /login, /register, /_next  ──▶ web (Next.js)
             │  :80     │──▶ /api/*, /healthz, /readyz, /metrics ─▶ api (Go)
             └──────────┘──▶ everything else (a short code) ─────▶ api (Go)
```

| Component | What it is |
| --- | --- |
| `cmd/purels-api` | The HTTP API, the redirect handler and the preview page |
| `cmd/purels-worker` | Click aggregation, expiry pruning, destination health checks |
| `web/` | The Next.js console. Calls the API same-origin through a proxy |
| `migrations/` | 13 golang-migrate migrations, applied by a one-shot container |
| `deploy/` | The Compose stack and the Caddyfile |

The API and the worker are the same image with different entrypoints, so they
cannot drift apart. Both read the same `STATS_TZ`, which is applied as the
PostgreSQL session timezone — that is what keeps a "day" meaning the same thing
to the process that writes a rollup and the process that reads it.

### Layout

```
cmd/            entrypoints
internal/
  config/       environment parsing
  domain/       types, scopes, error codes — no dependencies
  security/     validation, hashing, bot detection, secret encryption
  service/      business logic; the only layer that decides what is allowed
  store/postgres/  SQL, and the translation of database errors
  cache/redis/  the redirect cache
  http/         router, middleware, handlers
  worker/       the background loop
web/src/
  app/          the console, one directory per page
  components/   shared UI
  lib/          API client, i18n, formatting
scripts/        the smoke suites
```

The dependency direction is one-way: `http` depends on `service`, `service`
depends on `store` and `domain`, and `domain` depends on nothing.

## Development

Requires Go 1.27, Node 24 or newer (the console image builds on
`node:24-alpine`), and a reachable PostgreSQL and Redis. For the latter two, the
quickest route is to start just those from the bundled stack:

```sh
docker compose -f deploy/compose.yaml up -d postgres redis
```

Then:

```sh
make dev                 # run the API against .env / the environment
cd web && npm install && npm run dev
```

Useful targets:

| Command | Does |
| --- | --- |
| `make dev` | Run the API |
| `make build` | Build both binaries |
| `make fmt` | `gofmt -w` over the Go tree |
| `make test` | `go test ./...` |
| `make migrate-up` | Apply migrations to `$DATABASE_URL` |
| `make compose-up` | Bring up the whole stack |
| `make smoke-*` | Run one smoke suite — see [Testing](#testing) |

Console checks:

```sh
cd web && npm run typecheck && npm run build
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs all of this on every
push to `main` and every pull request: the Go and console jobs in parallel, then
the smoke suites against a stack built from the same Compose file you run
locally. The integration job is the slow one and the one that matters — it is
what makes the table above a promise rather than a suggestion.

### Conventions worth knowing

- **A missing translation is a compile error.** `web/src/lib/i18n/messages/en.ts`
  is the source of truth and is declared with `satisfies`, so `keyof typeof en`
  stays a union of literal keys. `zh-CN.ts` is typed against it. Adding a key
  means adding it to both.
- **Client input is never trusted.** Anything that reaches SQL as an id is
  validated or cast by PostgreSQL, and the resulting error is classified rather
  than echoed — see `normalizeDBError` and `postgres.IsDBError`.
- **The store translates database errors, nothing else does.** A service returns
  a sentinel; the handler maps it to a status and a stable error code.

## Testing

Two layers, both run by hand.

**Go unit tests** — 108 test functions across the domain, security, service,
store and HTTP layers:

```sh
make test
```

**Smoke suites** — Node scripts with no dependencies, driving a *running* stack
over HTTP, plus one browser suite. They are the integration gate:

| Suite | Covers |
| --- | --- |
| `make smoke-api` | Pagination, sorting, scopes, rate limits, statistics, QR, CSV, domains, error hygiene |
| `make smoke-users` | Registration, roles, ownership boundaries, account administration |
| `make smoke-lifecycle` | Link creation, editing, expiry, deletion |
| `make smoke-totp` | Two-factor enrolment and verification |
| `make smoke-oidc` | Provider configuration and the sign-in flow |
| `make smoke-analytics` | Tracker configuration and what must *not* be stored |
| `make smoke-captcha` | Registration protection, mostly the refusal cases |
| `make smoke-pages` | Every console page in a real browser, plus the language switcher |

`make smoke-all` runs them in sequence. **They share the API's per-IP rate-limit
bucket**, so they are spaced apart and must not be run in parallel — running two
at once makes them fail each other's limits rather than test anything.

The browser suite needs a headless Chrome with the DevTools protocol enabled:

```sh
chrome --headless=new --disable-gpu --remote-debugging-port=9222 \
       --user-data-dir=/tmp/purels-chrome about:blank
make smoke-pages
```

Some suites have a deterministic branch that needs a stack configured for it —
`deploy/.totp-check.yaml`, `deploy/.captcha-check.yaml` and
`deploy/.oidc-check.yaml` are Compose overlays layered on top of the base file.
Without one, the suite still runs: it asserts that the feature is refused rather
than skipping.

## Security

What the project does:

- Passwords are hashed with Argon2id. TOTP secrets and OIDC client secrets are
  encrypted with a key that never leaves the deployment, and enrolment is
  refused outright when no key is configured, so the deployment cannot accumulate
  secrets it cannot read back.
- Sessions are server-side and cookie-borne; writes require a CSRF token.
- API tokens are stored hashed and carry an explicit scope list. The default set
  excludes token minting, the audit trail and every administration scope.
- The audit trail records the actor, the action, the target and the address it
  came from.
- Destinations are validated and can be denied by host, so the shortener cannot
  be pointed at internal addresses.
- Unique visitors are counted from a hash of the address, never the address, and
  the mode that stores nothing is available.
- Rate limits cover login, registration, the API, redirects, the second factor
  and OIDC. The limiter fails open when Redis is unavailable, deliberately: a
  cache outage should not take the service down with it. The second-factor
  endpoint therefore also carries its own attempt counter, which is the real
  brute-force bound.

What it does not do: it is not a hardened multi-tenant service. An administrator
can read every link, and the scopes that configure OIDC and the tracking tag are
effectively remote-content and script-injection capabilities, which is why they
are separate from the others and granted sparingly.

To report a vulnerability, open a private security advisory on the repository
rather than a public issue.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
