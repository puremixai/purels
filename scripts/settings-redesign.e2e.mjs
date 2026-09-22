// Isolated browser regression checks for the settings information architecture.
// All API requests are intercepted; this suite never edits live settings.
// Run against an existing dev server: node scripts/settings-redesign.e2e.mjs
// Optional: BASE_URL, PLAYWRIGHT_MODULE, SETTINGS_E2E_OUTPUT, E2E_PHASE.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT = resolve(process.env.SETTINGS_E2E_OUTPUT || "coverage/settings-redesign");
const PHASE = process.env.E2E_PHASE || "all";
const ALL_SCOPES = ["settings:manage", "captcha:manage", "oidc:manage", "analytics:manage", "roles:manage", "users:manage", "tokens:manage", "links:read", "links:write", "stats:read", "audit:read"];
const results = [];
const screenshotPaths = [];
const unexpectedApiRequests = [];
const pageErrors = [];
mkdirSync(OUTPUT, { recursive: true });

const baseRuntime = {
  alias_mode: "random", unique_urls: false, registration_enabled: false,
  count_bots: false, forward_query: true, fallback_url: "", auto_prune_expired: false,
  prune_grace_seconds: 2592000, max_links_per_user: 100, destination_denylist: ["blocked.example"],
  short_domains: ["sho.rt"], health_check_enabled: false, health_check_interval_seconds: 3600,
  rate_limit_enabled: true, rate_limit_login: 10, rate_limit_api: 120,
  rate_limit_redirect: 1000, rate_limit_register: 5, rate_limit_2fa: 10, rate_limit_oidc: 20,
  revision: 7, updated_at: "2026-09-22T00:00:00Z",
};
const emptyAnalytics = { ga4_measurement_id: "", gtm_container_id: "", matomo_url: "", matomo_site_id: "", updated_at: "2026-09-22T00:00:00Z" };
const captcha = { provider: "turnstile", enabled: false, site_key: "", has_secret: false, expected_hostname: "", expected_action: "register", updated_at: "2026-09-22T00:00:00Z" };

async function check(name, action) {
  const started = Date.now();
  try {
    await action();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error.stack || String(error) });
    console.error(`[FAIL] ${name}: ${error.message}`);
  }
}

async function eventually(predicate, message, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 75));
  }
  throw new Error(message);
}

const browser = await chromium.launch({ headless: true });

async function fixture({ scopes = ALL_SCOPES, locale = "en", width = 1280, theme = "dark", reducedMotion = "reduce" } = {}) {
  const context = await browser.newContext({ locale, viewport: { width, height: 1000 }, reducedMotion });
  await context.addCookies([{ name: "purels_locale", value: locale, url: BASE }]);
  await context.addInitScript((value) => localStorage.setItem("purels-theme", value), theme);
  const state = { scopes, runtime: structuredClone(baseRuntime), runtimeFailure: false, conflict: false, calls: [], patches: [], tokens: [] };
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.calls.push({ path, method });
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/v1/auth/me") return json({ user: { id: "test-account", username: "settings-review", role: "admin", scopes: state.scopes, mfa_enabled: false } });
    if (path === "/api/v1/auth/csrf") return json({ token: "mock-csrf" });
    if (path === "/api/v1/analytics") return json({ analytics: emptyAnalytics });
    if (path === "/api/v1/captcha") return json({ captcha });
    if (path === "/api/v1/oidc/providers") return json({ providers: [], redirect_base: "https://links.example.test" });
    if (path === "/api/v1/roles") return json({ roles: [{ name: "user", scopes: ["links:read", "links:write"], unrestricted: false }] });
    if (path === "/api/v1/users") return json({ users: [] });
    if (path === "/api/v1/config") return json({ short_domains: ["sho.rt"], default_domain: "sho.rt" });
    if (path === "/api/v1/auth/2fa") return json({ available: true, enabled: false, pending: false, recovery_codes_remaining: 0 });
    if (path === "/api/v1/auth/tokens") {
      if (!state.scopes.includes("tokens:manage")) return json({ error: { code: "insufficient_scope" } }, 403);
      if (method === "POST") {
        const input = request.postDataJSON();
        const token = { id: "mock-token", name: input.name, token_prefix: "pls_test_", scopes: [], created_at: "2026-09-22T00:00:00Z" };
        state.tokens.push(token);
        return json({ token, secret: "mock-secret-shown-once" }, 201);
      }
      return json({ tokens: state.tokens });
    }
    if (path.startsWith("/api/v1/auth/tokens/") && method === "DELETE") {
      state.tokens = [];
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/settings/runtime") {
      if (!state.scopes.includes("settings:manage")) return json({ error: { code: "insufficient_scope" } }, 403);
      if (method === "GET") return state.runtimeFailure ? json({ error: { message: "Simulated runtime load failure" } }, 503) : json({ settings: state.runtime });
      if (method === "PATCH") {
        const body = request.postDataJSON();
        state.patches.push(body);
        if (state.conflict) return json({ error: { code: "settings_conflict", message: "Runtime settings changed concurrently" } }, 409);
        assert.equal(body.revision, state.runtime.revision);
        state.runtime = { ...state.runtime, ...body.changes, revision: state.runtime.revision + 1 };
        return json({ settings: state.runtime });
      }
    }
    unexpectedApiRequests.push(`${method} ${path}`);
    return json({ error: { message: `Unhandled mocked endpoint: ${method} ${path}` } }, 501);
  });
  await context.route("**/readyz", (route) => route.fulfill({ contentType: "application/json", body: '{"status":"ready"}' }));
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  async function go(path) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator("main h1").waitFor();
  }
  return { context, page, state, go };
}

async function screenshot(page, name) {
  const path = resolve(OUTPUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  screenshotPaths.push(path);
}

async function noOverflow(page, name) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1, `${name}: horizontal overflow ${JSON.stringify(dimensions)}`);
  assert.equal(await page.locator("main h1").count(), 1, `${name}: one main heading`);
}

async function functionalChecks() {
  const f = await fixture();
  const { page, state, go } = f;
  try {
    await check("overview exposes five purpose-based categories and real status", async () => {
      await go("/home/settings");
      assert.equal(await page.locator(".settings-category").count(), 5);
      assert.deepEqual(await page.locator(".settings-category").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))), ["/home/settings/links", "/home/settings/registration", "/home/users", "/home/settings/traffic", "/home/settings/analytics"]);
      assert.ok((await page.locator(".settings-category-status").allTextContents()).filter(Boolean).length >= 4);
      assert.equal(await page.locator('aside a[href="/home/settings/security"]').count(), 0);
    });
    await check("field search crosses languages and links to the exact setting", async () => {
      await go("/home/settings");
      await page.locator("#settings-search").fill("health_check_interval_seconds");
      const result = page.locator('.settings-search-results a[href="/home/settings/links/maintenance#health_check_interval_seconds"]');
      await result.waitFor();
      assert.equal(await page.locator(".settings-search-results a").count(), 1);
      await result.click();
      await page.waitForURL("**/maintenance#health_check_interval_seconds");
      await page.locator("#health_check_interval_seconds").waitFor();
      await go("/home/settings");
      await page.locator("#settings-search").fill("健康");
      await eventually(async () => (await page.locator(".settings-search-results a").count()) > 0, "Chinese search returned no matching health settings in English UI");
    });
    await check("failed runtime loading cannot expose an editable or savable form", async () => {
      state.runtimeFailure = true;
      await go("/home/settings/links");
      await page.locator('main [role="alert"]').waitFor();
      await screenshot(page, "state-runtime-load-error");
      assert.equal(await page.locator("main form").count(), 0);
      assert.equal(await page.locator('main button[type="submit"]').count(), 0);
      state.runtimeFailure = false;
      await page.locator("main .btn-secondary").click();
      await page.locator("#max_links_per_user").waitFor();
    });
    await check("PATCH includes only changed fields and the loaded revision", async () => {
      await go("/home/settings/links");
      const previous = state.runtime.revision;
      await page.locator("#max_links_per_user").fill("200");
      await page.locator('.settings-savebar button[type="submit"]').click();
      await eventually(() => state.patches.length > 0, "PATCH was not sent");
      assert.deepEqual(state.patches.at(-1), { revision: previous, changes: { max_links_per_user: 200 } });
      await page.locator(".console-notice").waitFor();
      await screenshot(page, "state-runtime-saved");
      assert.equal(await page.locator('.settings-savebar button[type="submit"]').isDisabled(), true);
    });
    await check("409 preserves the draft and offers explicit reload", async () => {
      state.conflict = true;
      await page.locator("#max_links_per_user").fill("205");
      await page.locator('.settings-savebar button[type="submit"]').click();
      await page.locator('main [role="alert"]').waitFor();
      assert.equal(await page.locator("#max_links_per_user").inputValue(), "205");
      assert.equal(await page.locator('.settings-savebar button[type="submit"]').isDisabled(), true);
      assert.match(await page.locator(".settings-savebar .btn-secondary").innerText(), /reload/i);
      await screenshot(page, "state-runtime-conflict");
      state.conflict = false;
      await page.locator(".settings-savebar .btn-secondary").click();
      await eventually(async () => await page.locator("#max_links_per_user").inputValue().catch(() => "") === "200", "Reload did not restore server settings");
    });
    await check("disabled maintenance switches disable their duration controls", async () => {
      await go("/home/settings/links/maintenance");
      assert.equal(await page.locator("#health_check_interval_seconds").isDisabled(), true);
      assert.equal(await page.locator("#prune_grace_seconds").isDisabled(), true);
      await page.locator("#health_check_enabled").focus();
      await page.keyboard.press("Space");
      assert.equal(await page.locator("#health_check_interval_seconds").isDisabled(), false);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#health_check_interval_seconds").evaluate((node) => node === document.activeElement), true);
      await page.locator("#health_check_interval_seconds").fill("2");
      await page.locator('.settings-savebar button[type="submit"]').click();
      await page.locator(".console-notice").waitFor();
      assert.deepEqual(state.patches.at(-1).changes, { health_check_enabled: true, health_check_interval_seconds: 7200 });
      await page.locator("#health_check_enabled").uncheck();
      assert.equal(await page.locator("#health_check_interval_seconds").isDisabled(), true);
      await page.locator(".settings-savebar .btn-secondary").click();
    });
    await check("domain textareas preserve newlines while editing and save arrays", async () => {
      await go("/home/settings/links");
      const domains = "first.example\nsecond.example\n";
      await page.locator("#short_domains").fill(domains);
      assert.equal(await page.locator("#short_domains").inputValue(), domains);
      await page.locator('.settings-savebar button[type="submit"]').click();
      await page.locator(".console-notice").waitFor();
      assert.deepEqual(state.patches.at(-1).changes, { short_domains: ["first.example", "second.example"] });
    });
    await check("account menu opens with keyboard and Escape restores focus", async () => {
      await page.locator(".rare-account-trigger").focus();
      await page.keyboard.press("Enter");
      await page.locator(".rare-account-popover").waitFor();
      assert.equal(await page.locator('.rare-account-popover a[href="/home/account/security"]').count(), 1);
      assert.equal(await page.locator('.rare-account-popover a[href="/home/account/tokens"]').count(), 1);
      await page.keyboard.press("Escape");
      await page.locator(".rare-account-popover").waitFor({ state: "hidden" });
      assert.equal(await page.locator(".rare-account-trigger").evaluate((node) => node === document.activeElement), true);
    });
    await check("personal token creation preserves the one-time secret until acknowledged", async () => {
      await go("/home/account/tokens");
      await page.getByLabel("Token name", { exact: true }).fill("E2E integration");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.getByText("mock-secret-shown-once", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Token name", { exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "I have saved this token", exact: true }).click();
      assert.equal(await page.getByLabel("Token name", { exact: true }).isDisabled(), false);
      assert.equal(await page.getByText("mock-secret-shown-once", { exact: true }).count(), 0);
    });
    await check("legacy security route resolves to the independent MFA page", async () => {
      await go("/home/settings/security");
      assert.equal(new URL(page.url()).pathname, "/home/account/security");
      await page.getByRole("heading", { name: "Two-factor authentication" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "API tokens", exact: true }).count(), 0);
    });
  } finally {
    await screenshot(page, "functional-final");
    await f.context.close();
  }
}

async function permissionChecks() {
  const cases = [
    { scope: "settings:manage", categories: 4, route: "/home/settings/registration", present: "#registration_enabled", absent: "#captcha", disallowed: ["/api/v1/captcha", "/api/v1/oidc/providers"] },
    { scope: "captcha:manage", categories: 1, route: "/home/settings/registration", present: "#captcha", absent: "#registration_enabled", disallowed: ["/api/v1/settings/runtime", "/api/v1/oidc/providers"] },
    { scope: "oidc:manage", categories: 1, route: "/home/settings/registration", present: 'main a[href="/home/settings/oidc"]', absent: "#registration_enabled", disallowed: ["/api/v1/settings/runtime", "/api/v1/captcha"] },
    { scope: "analytics:manage", categories: 1, route: "/home/settings/analytics", present: "#integrations", absent: "#count_bots", disallowed: ["/api/v1/settings/runtime", "/api/v1/captcha", "/api/v1/oidc/providers"] },
    { scope: "roles:manage", categories: 1, route: "/home/settings/roles", present: '.settings-tabs a[href="/home/settings/roles"]', absent: '.settings-tabs a[href="/home/users"]', disallowed: ["/api/v1/users", "/api/v1/settings/runtime", "/api/v1/captcha", "/api/v1/oidc/providers"] },
  ];
  for (const item of cases) {
    const f = await fixture({ scopes: [item.scope] });
    await check(`scope isolation: ${item.scope}`, async () => {
      try {
        await f.go("/home/settings");
        assert.equal(await f.page.locator(".settings-category").count(), item.categories);
        if (item.scope === "roles:manage") assert.equal(await f.page.locator(".settings-category").getAttribute("href"), "/home/settings/roles");
        await f.page.locator("#settings-search").fill("Token");
        assert.equal(await f.page.locator(".settings-search-results a").count(), 0);
        await f.go(item.route);
        await f.page.locator(item.present).first().waitFor();
        assert.equal(await f.page.locator(item.absent).count(), 0);
        for (const endpoint of item.disallowed) assert.equal(f.state.calls.some((call) => call.path === endpoint), false, `Unexpected request to ${endpoint} with ${item.scope}`);
        if (item.scope === "oidc:manage") {
          await f.page.locator('.settings-tabs a[href="/home/settings/oidc"]').click();
          await f.page.getByRole("heading", { name: "Add a sign-in method" }).waitFor();
        }
      } finally { await f.context.close(); }
    });
  }
  const f = await fixture({ scopes: [] });
  await check("MFA remains available without token permission; token page makes no token request", async () => {
    try {
      await f.go("/home/account/security");
      await f.page.getByRole("heading", { name: "Two-factor authentication" }).waitFor();
      await f.page.locator(".rare-account-trigger").click();
      assert.equal(await f.page.locator('.rare-account-popover a[href="/home/account/security"]').count(), 1);
      assert.equal(await f.page.locator('.rare-account-popover a[href="/home/account/tokens"]').count(), 0);
      await f.go("/home/account/tokens");
      await f.page.getByText("You do not have permission to manage API tokens.", { exact: true }).waitFor();
      assert.equal(f.state.calls.some((call) => call.path === "/api/v1/auth/tokens"), false);
    } finally { await f.context.close(); }
  });
}

async function visualChecks() {
  const routes = [
    ["overview", "/home/settings"], ["creation", "/home/settings/links"], ["maintenance", "/home/settings/links/maintenance"],
    ["registration", "/home/settings/registration"], ["traffic", "/home/settings/traffic"], ["analytics", "/home/settings/analytics"],
    ["security", "/home/account/security"], ["tokens", "/home/account/tokens"],
  ];
  if (PHASE !== "themes") for (const locale of ["en", "zh-CN"]) {
    for (const width of [360, 768, 1280, 1440]) {
      const f = await fixture({ locale, width });
      await check(`responsive layout and screenshots: ${locale} ${width}px`, async () => {
        try {
          for (const [name, route] of routes) {
            await f.go(route);
            await noOverflow(f.page, `${locale} ${width} ${name}`);
            assert.equal(await f.page.locator("html").getAttribute("lang"), locale);
            if (["overview", "maintenance", "registration"].includes(name)) await screenshot(f.page, `${locale}-${width}-${name}`);
          }
        } finally { await f.context.close(); }
      });
    }
  }
  for (const theme of ["light", "dark"]) {
    const f = await fixture({ theme, width: 360 });
    await check(`${theme} theme, reduced motion and mobile drawer`, async () => {
      try {
        await f.go("/home/settings/links/maintenance");
        assert.equal(await f.page.locator("html").getAttribute("data-theme"), theme);
        assert.equal(await f.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
        await noOverflow(f.page, `${theme} mobile`);
        const menu = f.page.locator('header button[aria-expanded]');
        assert.equal(await menu.count(), 1);
        await menu.click();
        await eventually(async () => await menu.getAttribute("aria-expanded") === "true", "Mobile drawer did not open");
        assert.equal(await f.page.locator("aside").getAttribute("inert"), null);
        await f.page.keyboard.press("Escape");
        await eventually(async () => await menu.getAttribute("aria-expanded") === "false", "Escape did not close mobile drawer");
        assert.equal(await menu.evaluate((node) => node === document.activeElement), true);
        await screenshot(f.page, `${theme}-reduced-motion-360`);
      } finally { await f.context.close(); }
    });
  }
}

async function enhancedChecks() {
  const f = await fixture();
  const { page, state, go } = f;
  try {
    await check("unsaved navigation guard keeps edits, ignores same-route hashes and can discard", async () => {
      await go("/home/settings/links");
      await page.locator("#max_links_per_user").fill("321");
      await page.locator('a[href="#main-content"]').focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(".rare-dialog").count(), 0);
      assert.equal(await page.locator("#max_links_per_user").inputValue(), "321");
      await page.locator('.settings-tabs a[href="/home/settings/links/redirects"]').click();
      await page.getByRole("dialog", { name: "Unsaved changes", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/home/settings/links");
      await screenshot(page, "state-unsaved-navigation");
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      await page.locator(".rare-dialog").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#max_links_per_user").inputValue(), "321");
      await page.locator('.settings-tabs a[href="/home/settings/links/redirects"]').click();
      await page.getByRole("button", { name: "Discard and leave", exact: true }).click();
      await page.waitForURL("**/settings/links/redirects");
      await page.locator("#forward_query").waitFor();
      assert.equal(state.runtime.max_links_per_user, 100);
    });
    await check("switching language preserves runtime and CAPTCHA drafts; saving one keeps the other guarded", async () => {
      await go("/home/settings/registration");
      await page.locator("#registration_enabled").check();
      await page.locator("#captcha input.field-control").first().fill("draft-site-key");
      const readsBefore = state.calls.filter((call) => call.method === "GET" && ["/api/v1/settings/runtime", "/api/v1/captcha"].includes(call.path)).length;
      await page.locator(".rare-account-trigger").click();
      await page.locator(".rare-account-locale").selectOption("zh-CN");
      await eventually(async () => await page.locator("html").getAttribute("lang") === "zh-CN", "Locale did not change");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#registration_enabled").isChecked(), true);
      assert.equal(await page.locator("#captcha input.field-control").first().inputValue(), "draft-site-key");
      assert.equal(state.calls.filter((call) => call.method === "GET" && ["/api/v1/settings/runtime", "/api/v1/captcha"].includes(call.path)).length, readsBefore);
      assert.equal(await page.locator(".rare-dialog").count(), 0);
      await page.locator('main form button[type="submit"]').click();
      await page.locator(".console-notice").waitFor();
      await page.locator('aside a[href="/home/settings/links"]').click();
      await page.locator(".rare-dialog").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#captcha input.field-control").first().inputValue(), "draft-site-key");
      await screenshot(page, "state-zh-drafts-preserved");
    });
    await check("blank dependent durations do not block saving disabled checks and cleanup", async () => {
      state.runtime.health_check_enabled = true;
      state.runtime.auto_prune_expired = true;
      await go("/home/settings/links/maintenance");
      await page.locator("#health_check_interval_seconds").fill("");
      await page.locator("#prune_grace_seconds").fill("");
      await page.locator("#health_check_enabled").uncheck();
      await page.locator("#auto_prune_expired").uncheck();
      await page.locator('.settings-savebar button[type="submit"]').click();
      await page.locator(".console-notice").waitFor();
      assert.deepEqual(state.patches.at(-1).changes, { health_check_enabled: false, auto_prune_expired: false });
      assert.equal(state.runtime.health_check_interval_seconds, 3600);
      assert.equal(state.runtime.prune_grace_seconds, 2592000);
    });
  } finally { await f.context.close(); }
}

try {
  if (["all", "functional"].includes(PHASE)) await functionalChecks();
  if (["all", "permissions"].includes(PHASE)) await permissionChecks();
  if (["all", "enhanced"].includes(PHASE)) await enhancedChecks();
  if (["all", "visual", "themes"].includes(PHASE)) await visualChecks();
  await check("all API requests remained mocked and expected", async () => assert.deepEqual(unexpectedApiRequests, []));
  await check("pages emitted no uncaught JavaScript errors", async () => assert.deepEqual(pageErrors, []));
} finally {
  await browser.close();
  const report = { baseUrl: BASE, phase: PHASE, generatedAt: new Date().toISOString(), results, screenshotPaths, unexpectedApiRequests, pageErrors };
  writeFileSync(resolve(OUTPUT, `report-${PHASE}.json`), JSON.stringify(report, null, 2) + "\n", "utf8");
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; ${screenshotPaths.length} screenshots in ${OUTPUT}`);
  process.exitCode = failed ? 1 : 0;
}
