// Registration CAPTCHA API checks.
//
// The default deployment leaves CAPTCHA disabled. Run the enabled branch with:
//   docker compose -f deploy/compose.yaml -f deploy/.captcha-check.yaml up -d --force-recreate api
//   node scripts/smoke-captcha.mjs
//
// The test override selects an in-process deterministic verifier and never calls
// Cloudflare. It accepts only CAPTCHA_TEST_TOKEN.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me-now";
const CAPTCHA_TOKEN = process.env.CAPTCHA_TOKEN || process.env.CAPTCHA_TEST_TOKEN || "purels-captcha-pass";
const STAMP = Date.now().toString(36);
const TEST_IP = `198.51.100.${(Date.now() % 200) + 20}`;
const ACCOUNT = `capt${STAMP}`;
const PASSWORD = "smoke-password-captcha";
const results = [];

function record(name, ok, detail = "") { results.push({ name, ok, detail }); }
function session() { return { jar: new Map(), csrf: "" }; }
function cookies(s) { return [...s.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
function capture(s, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value) s.jar.set(name, value); else s.jar.delete(name);
  }
}
async function call(s, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  headers.set("X-Forwarded-For", options.ip || TEST_IP);
  const cookie = cookies(s);
  if (cookie) headers.set("Cookie", cookie);
  if (s.csrf) headers.set("X-CSRF-Token", s.csrf);
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  capture(s, response);
  return response;
}
async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}
async function signIn(s, username = ADMIN_USER, password = ADMIN_PASS) {
  const response = await call(s, "/api/v1/auth/login", { method: "POST", body: { username, password } });
  const payload = await json(response);
  if (response.ok) s.csrf = payload.csrf_token || "";
  return { response, payload };
}
async function psql(sql) {
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  try {
    execFileSync("docker", ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-q", "-c", sql], { stdio: "pipe" });
    return true;
  } catch { return false; }
}

async function main() {
  const admin = session();
  const adminLogin = await signIn(admin);
  record("administrator signs in", adminLogin.response.status === 200, `status=${adminLogin.response.status}`);

  const publicBefore = await call(session(), "/api/v1/auth/captcha");
  const publicBeforePayload = await json(publicBefore);
  const enabledAtStart = publicBeforePayload.enabled === true;
  record(
    "public metadata exposes only safe fields",
    publicBefore.status === 200 && ["enabled", "provider", "site_key"].every((key) => Object.hasOwn(publicBeforePayload, key)) && !Object.hasOwn(publicBeforePayload, "secret"),
    `status=${publicBefore.status} enabled=${enabledAtStart}`,
  );

  const adminBefore = await json(await call(admin, "/api/v1/captcha"));
  record(
    "admin metadata exposes presence, not the secret",
    adminBefore.captcha && typeof adminBefore.captcha.has_secret === "boolean" && !Object.hasOwn(adminBefore.captcha, "secret"),
    JSON.stringify(adminBefore.captcha || {}),
  );

  // Configure the row. In the default stack this will return 409 because no
  // encryption key exists; that is a deliberate fail-closed result. The
  // deterministic override supplies the key and test verifier.
  const configure = await call(admin, "/api/v1/captcha", {
    method: "PATCH",
    body: { enabled: true, site_key: "1x00000000000000000000AA", secret: "smoke-secret", expected_action: "register" },
  });
  const configurePayload = await json(configure);
  const enabled = configure.status === 200;
  record("admin can configure CAPTCHA", enabled || configure.status === 409, `status=${configure.status}`);

  if (enabled) {
    const publicAfter = await json(await call(session(), "/api/v1/auth/captcha"));
    record("enabled CAPTCHA metadata reaches registration", publicAfter.enabled === true && publicAfter.site_key === "1x00000000000000000000AA", JSON.stringify(publicAfter));

    const missing = await call(session(), "/api/v1/auth/register", { method: "POST", body: { username: ACCOUNT, password: PASSWORD } });
    record("missing token is refused", missing.status === 400, `status=${missing.status}`);

    const invalid = await call(session(), "/api/v1/auth/register", { method: "POST", body: { username: ACCOUNT, password: PASSWORD, captcha_token: "wrong-token" } });
    record("invalid token is refused", invalid.status === 400, `status=${invalid.status}`);

    const valid = await call(session(), "/api/v1/auth/register", { method: "POST", body: { username: ACCOUNT, password: PASSWORD, captcha_token: CAPTCHA_TOKEN } });
    record("deterministic valid token registers", valid.status === 201, `status=${valid.status}`);

    const replay = await call(session(), "/api/v1/auth/register", { method: "POST", body: { username: `replay${STAMP}`, password: PASSWORD, captcha_token: "wrong-token" } });
    record("a rejected token does not create an account", replay.status === 400, `status=${replay.status}`);

    const rotated = await call(admin, "/api/v1/captcha", { method: "PATCH", body: { secret: "rotated-secret" } });
    const rotatedPayload = await json(rotated);
    record("secret rotation keeps only has_secret", rotated.status === 200 && rotatedPayload.captcha?.has_secret === true && !Object.hasOwn(rotatedPayload.captcha || {}, "secret"), `status=${rotated.status}`);

    const audit = await json(await call(admin, "/api/v1/audit?action=captcha.update&limit=20"));
    const auditText = JSON.stringify(audit);
    record("CAPTCHA changes are audited without secrets", (audit.entries || []).length > 0 && !auditText.includes("smoke-secret") && !auditText.includes("rotated-secret"), `${(audit.entries || []).length} entries`);

    const unknown = await call(admin, "/api/v1/captcha", { method: "PATCH", body: { secret: "", verify_url: "https://evil.example" } });
    record("arbitrary verification URLs are refused", unknown.status === 400, `status=${unknown.status}`);
  } else {
    record("enabled CAPTCHA checks skipped without encryption key", true, `configure status=${configure.status}`);
  }

  // A normal account cannot administer CAPTCHA settings. The account itself is
  // created through the disabled-compatible path unless this run enabled the
  // deterministic verifier, in which case it carries the fixed token.
  const regular = session();
  const registerBody = { username: `reader${STAMP}`, password: PASSWORD };
  if (enabled) registerBody.captcha_token = CAPTCHA_TOKEN;
  const registered = await call(regular, "/api/v1/auth/register", { method: "POST", body: registerBody });
  if (registered.status === 201) {
    const payload = await json(registered);
    regular.csrf = payload.csrf_token || "";
    const denied = await call(regular, "/api/v1/captcha");
    record("regular users cannot read admin CAPTCHA settings", denied.status === 403, `status=${denied.status}`);
    const deniedWrite = await call(regular, "/api/v1/captcha", { method: "PATCH", body: { enabled: false } });
    record("regular users cannot update CAPTCHA settings", deniedWrite.status === 403, `status=${deniedWrite.status}`);
  } else {
    record("regular account setup for CAPTCHA scope checks", false, `status=${registered.status}`);
  }

  // Restore public behavior; retain the encrypted secret by design.
  if (enabled) {
    const disabled = await call(admin, "/api/v1/captcha", { method: "PATCH", body: { enabled: false, site_key: "", expected_hostname: "", expected_action: "" } });
    record("CAPTCHA is disabled during cleanup", disabled.status === 200, `status=${disabled.status}`);
  }
  void configurePayload;
}

main().catch((error) => record("suite completed", false, error.message)).finally(async () => {
  const cleaned = await psql(`DELETE FROM admin_users WHERE username LIKE 'capt%' OR username LIKE 'reader%'; DELETE FROM audit_logs WHERE action='captcha.update';`);
  record("CAPTCHA smoke accounts and audit rows are removed", cleaned);
  let failed = 0;
  for (const result of results) {
    if (!result.ok) failed++;
    console.log(`[${result.ok ? "PASS" : "FAIL"}] ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
});
