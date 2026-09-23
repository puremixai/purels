# Purels

[English](README.md) | 简体中文

Purels 是可自行部署的短链接服务，提供链接管理、点击统计、审计记录、角色权限和多用户控制台。HTTP API 与短链接入口由 Go 服务提供，后台任务由独立 worker 执行；PostgreSQL 保存业务数据，Redis 用于缓存和限流，Next.js 提供控制台。

[![CI](https://github.com/puremixai/purels/actions/workflows/ci.yml/badge.svg)](https://github.com/puremixai/purels/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Go 1.27](https://img.shields.io/badge/Go-1.27-00ADD8.svg)](go.mod)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](web/package.json)

## 功能

### 短链接

- 自定义别名，或生成随机别名；也可通过 `ALIAS_MODE` 选择顺序递增的 Base36 别名。别名区分大小写，`AbC` 与 `abc` 是两个不同的短码。
- 可设置标题、标签、有效期、短域名，以及每条链接的 301 或 302 跳转方式。生成别名时，`UNIQUE_URLS` 可复用同一账号指向相同目标网址的已有链接；显式指定别名则会创建新链接。
- 访问 `/{alias}` 时，默认先展示目标地址与画作组成的跳转页，**2 秒后继续**。每条链接可设置 `interstitial_seconds` 为 **0–60 秒**；设为 `0` 时直接按所选的 301/302 状态码跳转。跳转页可暂停倒计时，也可立即继续。进入跳转页时已经记录一次点击，即使访客没有等到倒计时结束。
- 访问 `/{alias}+` 可预览实际目标地址。预览页没有倒计时，不会自动跳转，也**不计入点击**。跳转页和预览页会按请求的 `Accept-Language` 显示中文或英文。
- 支持按 User-Agent 匹配的分流规则、按需生成二维码、目标主机黑名单、CSV 导入导出，以及批量启用、停用、删除、加减标签和设置有效期。CSV 导出列也定义了导入格式。

### 统计与账号

- 按链接查看点击总数、趋势、来源、设备类型和逐次点击记录；识别机器人流量，并通过 `COUNT_BOTS` 决定是否将其纳入报表。
- 可选择 `none`、`anonymised` 或 `pseudonymised` 三种 IP 哈希模式；`STATS_TZ` 决定统计日的时区，API 与 worker 必须使用相同值。
- 会话登录支持 CSRF 防护，可选 TOTP 双因素认证；也可配置存储在数据库中的 OIDC 登录提供方。密码登录始终保留。
- API 令牌带明确的权限范围；角色权限存于数据库，可在控制台编辑。普通用户只看自己的链接，具有全局访问权的管理员可查看全部链接。
- 支持公开注册及可选的 Cloudflare Turnstile 验证；控制台提供简体中文和英文。

### 运维

- 审计记录、登录和接口等入口的按 IP 限流、`/healthz`、`/readyz`、Prometheus `/metrics`。
- Worker 汇总点击；启用对应设置后，还可清理过期链接并定期检查目标地址的可达性。
- 可选的 GA4、Google Tag Manager、Google 代码、Matomo、Microsoft Clarity 埋点，注入本部署提供的**所有页面**：落地页、登录与注册、控制台，以及 API 自己渲染的中转页和预览页。

## 快速启动

需要 Docker 和 Compose。仓库中的 Compose 文件已经包含开发环境所需的数据库、Redis、迁移、API、worker、控制台和 Caddy 网关：

```sh
git clone https://github.com/puremixai/purels.git
cd purels
docker compose -f deploy/compose.yaml up -d --build
```

待 <http://localhost/readyz> 返回 `{"status":"ready"}` 后，打开公共首页 <http://localhost>，或前往 <http://localhost/login>，使用 `admin` / `change-me-now` 登录。登录后的控制台位于 `/home`。

在 `/home/links/new` 创建短链接后，访问 `http://localhost/<alias>` 可查看跳转页，在地址末尾加 `+` 可预览且不计入点击。

> **此 Compose 配置仅供本地开发。** 它使用公开的默认密码、HTTP Cookie 和无 TLS 网关；部署到可被他人访问的环境前，请先阅读[部署注意事项](#部署注意事项)。

停止并保留数据：

```sh
docker compose -f deploy/compose.yaml down
```

确实需要删除 PostgreSQL 和 Redis 卷时，才在 `down` 命令末尾添加 `-v`。

## 配置

[`.env.example`](.env.example) 列出直接运行 API/worker 时可用的环境变量。Compose 的开发值直接写在 [`deploy/compose.yaml`](deploy/compose.yaml) 中；复制或修改 `.env` 不会更改这个示例栈。主要配置如下：

| 变量 | 开发默认值 | 用途 |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost` | 短链接及默认 OIDC 回调的基础地址 |
| `DATABASE_URL` / `REDIS_URL` | 见 Compose 或 `.env.example` | PostgreSQL 与 Redis 连接 |
| `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` | `admin` / `change-me-now` | 首次启动时创建的账号 |
| `COOKIE_SECURE` | `false` | 控制会话 Cookie 的 HTTPS 要求；生产 HTTPS 环境应设为 `true` |
| `SECRET_ENCRYPTION_KEY` | 空 | 加密 TOTP 密钥和 OIDC 客户端密钥；启用这些功能前必须配置 |
| `IP_HASH_MODE` / `IP_HASH_KEY` | `pseudonymised` / 空 | 点击记录中的地址衍生值及可选 HMAC 密钥 |
| `STATS_TZ` | `UTC` | 统计日边界；API 与 worker 要一致 |
| `TOTP_ENABLED` | `false` | 内置双因素认证首次启动的默认值；之后以控制台中的运行时设置为准 |

### 控制台中的运行时设置

`000018` 迁移增加了数据库中的运行时设置。首次启动 API 或 worker 时，这些设置从对应的环境变量写入数据库；此后数据库值为准，修改环境变量不会覆盖已经保存的设置。它们包括别名生成、重复网址处理、公开注册、内置双因素认证、机器人统计、查询参数转发、找不到短码时的回退地址、过期清理、用户链接上限、目标主机黑名单、额外短域名、目标健康检查，以及各类按 IP 限流。需要 `settings:manage` 权限；迁移会为 `admin` 角色补上此权限。API 会立即读取变更，worker 在短轮询后读取。

内置双因素认证的开关在 `000019` 迁移中并入运行时设置：该列以可空方式添加，首次启动时用 `TOTP_ENABLED` 填充一次，因此升级不会把已经在用的双因素认证悄悄关掉；此后由控制台写入具体值。

外部埋点 ID 存在独立的一行，在 `/home/settings/analytics` 配置。GTM 容器（`GTM-…`）与 Google 代码（`GT-…`）是两个独立字段，因为二者加载路径不同（分别走 `gtm.js` 与 `gtag.js`）：填错字段照样能保存，但永远不会上报。这些值会注入本部署提供的所有页面，因此控制台的服务端渲染在任何人登录之前就要读取它们，走免鉴权的 `GET /api/v1/analytics/public`；API 自己渲染的中转页与预览页则读进程内快照，不在跳转路径上查库。`000020` 迁移为这两类新增了对应的列。

控制台入口是 `/home`；站点设置在 `/home/settings`，按链接、注册与登录、用户与权限、流量防护、统计与集成分组，并可在当前账号有权访问的设置中搜索。个人双因素认证及 API 令牌在 `/home/account`。旧版设置路径仍有兼容跳转，`/admin` 也会跳转到 `/home`。

运行时设置的编辑接口是 `PATCH /api/v1/settings/runtime`。先用 `GET` 取得当前 `revision`，再只提交改动字段：

```json
{"revision":1,"changes":{"count_bots":true}}
```

若期间已有其他人保存设置，过期的 `revision` 会收到 `409 conflict`，需要重新读取并重试。省略的字段保持原值；兼容的 `PUT` 接口会替换整份设置，但整份文档必须包含 `totp_enabled`——该开关是在这个接口发布之后才加入的，文档中缺少它会被当成 `false`，从而静默关闭双因素认证，因此这类请求会直接返回 `400`。OIDC、角色、用户、注册验证和外部埋点仍使用各自的配置接口与权限。

## 部署注意事项

`deploy/compose.yaml` 面向本地开发，不是生产部署模板：默认密码已公开，`COOKIE_SECURE=false`，`SECRET_ENCRYPTION_KEY` 为空，Caddy 关闭了自动 HTTPS。部署时应替换密码、配置加密密钥和 TLS，并检查公开端口与 `ADMIN_ORIGIN`。Compose 将 API 的 `8080` 端口仅绑定在本机回环地址，但 PostgreSQL、Redis 和 Web 分别向宿主发布 `5432`、`6379`、`3000`；生产环境应限制这些端口。

API 在 Cloudflare 后读取 `CF-Connecting-IP`，否则使用代理追加的 `X-Forwarded-For`。让客户端直接访问 API 端口会使客户端能够伪造其来源地址，影响限流和审计记录；应让受信任的反向代理成为唯一入口。

备份 PostgreSQL：链接、账号、会话及审计记录都保存在其中。Redis 存放跳转缓存和限流计数器。更改或丢失 `SECRET_ENCRYPTION_KEY` 会让已存的 TOTP 密钥及 OIDC 客户端密钥无法解密。

## HTTP API

业务接口位于 `/api/v1`。认证方式是会话 Cookie（写入请求需带 `X-CSRF-Token`）或 Bearer 令牌。路由及所需权限以 [`internal/http/router.go`](internal/http/router.go) 为准；项目目前没有生成的 OpenAPI 文档。

| 接口组 | 主要路径 | 权限 |
| --- | --- | --- |
| 登录与账号 | `/auth/login`、`/auth/logout`、`/auth/me`、`/auth/csrf`、`/auth/register`、`/auth/2fa/*`、`/auth/oidc/*` | 登录状态或公开接口，见路由定义 |
| 链接 | `/links`、`/links/{id}`、`/links/export`、`/links/import`、`/links/bulk`、`/links/{id}/qr` | `links:read` / `links:write` |
| 统计 | `/stats/{summary,top,overview}`、`/links/{id}/{stats,clicks}` | `stats:read` |
| 审计 | `/audit` | `audit:read` |
| 用户与角色 | `/users`、`/users/{id}`、`/roles`、`/roles/{name}` | `users:manage` / `roles:manage` |
| 登录提供方、埋点和注册验证 | `/oidc/providers`、`/analytics`、`/captcha` | 各自的管理权限；`GET /analytics` 对已登录用户开放，`GET /analytics/public` 完全公开（控制台服务端渲染在登录前就要读它） |
| 运行时设置 | `GET/PUT/PATCH /settings/runtime` | `settings:manage` |
| API 令牌 | `/auth/tokens` | `tokens:manage` |

短链接入口与健康检查位于 `/api/v1` 之外：`GET /{alias}` 是跳转或跳转页，`GET /{alias}+` 是不计点击的预览页；`GET /healthz`、`GET /readyz`、`GET /metrics` 分别提供存活、就绪和指标信息。

## 架构

```text
浏览器 ──▶ Caddy :80 ──▶ /、/home/*、/login、/register、/_next/* ──▶ web (Next.js)
                     ├─▶ /api/*、/healthz、/readyz、/metrics ──▶ api (Go)
                     └─▶ 其余短码路径 ───────────────────────▶ api (Go)
```

| 目录 | 作用 |
| --- | --- |
| `cmd/purels-api` | HTTP API、短链接跳转和预览页 |
| `cmd/purels-worker` | 点击汇总、可选的过期清理与目标健康检查 |
| `internal/` | 配置、领域模型、服务、数据库、缓存、HTTP 与 worker 实现 |
| `web/` | Next.js 控制台 |
| `migrations/` | **20 组** golang-migrate 数据库迁移，由 Compose 中的一次性容器执行 |
| `deploy/` | Compose 与 Caddy 配置 |
| `scripts/` | HTTP 与浏览器冒烟测试 |

API 与 worker 使用同一镜像的不同入口。统计日计算依赖两者使用一致的 `STATS_TZ`。

## 开发

本地开发需要 Go 1.27、Node.js 24、Docker 和 Compose。先启动 PostgreSQL、Redis，再执行迁移：

```sh
docker compose -f deploy/compose.yaml up -d postgres redis
docker compose -f deploy/compose.yaml run --rm migrate
```

在一个终端运行 API，在另一个终端运行控制台（<http://localhost:3000>）：

```sh
go run ./cmd/purels-api
```

```sh
cd web
npm ci
npm run dev
```

直接运行时，程序从进程环境读取配置；可参考 `.env.example` 设置变量，文件本身不会自动加载。开发默认连接指向 `localhost:5432` 和 `localhost:6379`。若使用 GNU Make 和 `/bin/sh`，仓库还提供下列目标：

| 命令 | 作用 |
| --- | --- |
| `make dev` | 运行 API |
| `make build` | 构建两个 Go 入口 |
| `make fmt` | 对 Go 源码运行 `gofmt -w` |
| `make test` | 运行 `go test ./...` |
| `make migrate-up` | 用 `$DATABASE_URL` 执行迁移；需要安装 `migrate` 命令 |
| `make compose-up` | 用 Compose 构建并启动完整开发栈 |
| `make smoke-all` | 顺序运行所有冒烟测试 |

前端可运行 `npm run lint`、`npm run typecheck`、`npm run build`；[`CI`](.github/workflows/ci.yml) 在每次向 `main` 推送或创建拉取请求时执行 Go 格式检查、构建、`go vet`、单元测试，及前端类型检查与构建。随后 CI 启动 Compose 栈并运行全部冒烟测试。

## 测试

Go 单元测试：

```sh
go test ./...
```

冒烟测试需要正在运行的完整 Compose 栈。`scripts/` 下的 Node.js 脚本测试 HTTP 接口，`smoke-pages` 通过 Chrome DevTools 协议测试浏览器页面：

| 命令 | 覆盖范围 |
| --- | --- |
| `make smoke-api` | API、权限、统计、二维码、CSV、画册跳转页与预览页等 |
| `make smoke-users` | 注册、角色、账号与所有权边界 |
| `make smoke-lifecycle` | 链接创建、编辑、到期和删除 |
| `make smoke-totp` | 双因素认证 |
| `make smoke-oidc` | OIDC 配置与登录 |
| `make smoke-analytics` | 外部埋点配置、匿名读取接口，以及绝不允许被存储的内容 |
| `make smoke-captcha` | 注册验证 |
| `make smoke-pages` | 控制台页面及主要浏览器操作 |

`make smoke-all` 按顺序执行以上测试，并在非浏览器套件之间等待 65 秒。它们共享 API 的按 IP 限流桶，**不要并行运行**。`smoke-pages` 需要在 `9222` 端口提供 DevTools 协议的无头 Chrome，例如在支持该命令的环境中运行：

```sh
chrome --headless=new --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir=/tmp/purels-chrome about:blank
make smoke-pages
```

也可以不依赖 Make，直接运行单个脚本，例如 `node scripts/smoke-api.mjs`。画册页面另有专门的测试，未包含在 CI 的冒烟测试序列中：

```sh
node --test scripts/redirect-gallery.test.mjs
node scripts/redirect-gallery.e2e.mjs
```

第二条命令需要安装 Playwright；若模块不在 `node_modules` 中，可设置 `PLAYWRIGHT_MODULE`。参见[画册页面说明](docs/redirect-gallery/README.md)。控制台另提供 `npm run test:navigation` 和 `npm run test:settings`。

TOTP、CAPTCHA 和 OIDC 的完整确定性分支使用 `deploy/.totp-check.yaml`、`deploy/.captcha-check.yaml`、`deploy/.oidc-check.yaml` 覆盖配置；默认栈下相关测试仍会检查功能被正确拒绝的路径。

## 安全

- 密码使用 Argon2id 哈希。TOTP 密钥与 OIDC 客户端密钥使用部署密钥加密；没有配置密钥时，服务会拒绝存储这些密钥。
- 会话保存在服务端；Cookie 会话的写入请求需通过 CSRF 校验。API 令牌以哈希形式保存，默认权限仅含链接读取、写入和统计读取。
- 链接目标只允许 HTTP(S)，拒绝含凭据及明显的本地地址，并可按主机名及子域名设置黑名单。主动检查目标可达性时另有出站请求保护。
- 点击和审计记录的来源地址按 `IP_HASH_MODE` 哈希，审计 API 不返回来源 IP。选择 `none` 时不保存地址衍生值，同时无法提供独立访客统计。
- Redis 不可用时限流器会放行请求；双因素验证另有挑战次数限制。

Purels 的管理员可以访问全部链接。OIDC 提供方和外部埋点设置有独立权限，应谨慎授予。报告漏洞请使用仓库的私密安全公告，不要提交公开 issue。

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE)。
