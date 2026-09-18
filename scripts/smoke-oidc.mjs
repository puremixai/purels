// OIDC sign-in method checks: the providers are data, configured in the console.
//
//   node scripts/smoke-oidc.mjs
//
// Talks straight to the Go API (default :8080). Every provider it creates lives
// under the smk* slug namespace and is removed through psql at the end.
//
// Two configurations are meaningful and this one script verifies both, deciding
// which it is in by trying to store a secret and reading the answer:
//
//   SECRET_ENCRYPTION_KEY unset   storing a client secret is refused, so only
//                                 public clients (PKCE alone) can be configured
//   SECRET_ENCRYPTION_KEY set     the whole round trip, including that an edit
//                                 which does not restate the secret leaves it
//                                 alone
//
// The probe is the behaviour under test rather than a guess: without a key the
// deployment must refuse to store a secret it could never read back.
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me-now";
const STAMP = Date.now().toString(36);

// The slug is a URL segment, so it is lower-case and free of punctuation. The
// prefix is what the psql sweep keys on.
const SLUG = `smk${STAMP}`;
const SECRET_VALUE = "smoke-client-secret";
const TEST_IP = "203.0.113.41";

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

// ---------- HTTP plumbing ----------

function newSession() {
  return { jar: new Map(), csrf: "" };
}

function cookieHeader(session) {
  return [...session.jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(session, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "") session.jar.delete(name);
    else session.jar.set(name, value);
  }
}

async function call(session, path, { ip = TEST_IP, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const cookie = cookieHeader(session);
  if (cookie) headers.set("Cookie", cookie);
  headers.set("X-Forwarded-For", ip);
  if (session.csrf) headers.set("X-CSRF-Token", session.csrf);
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  captureCookies(session, response);
  return response;
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function signIn(session, username, password) {
  const response = await call(session, "/api/v1/auth/login", { method: "POST", body: { username, password } });
  const payload = await json(response);
  if (response.ok && payload && payload.csrf_token) session.csrf = payload.csrf_token;
  return { response, payload };
}

// The API offers no way to delete a provider through psql's absence, and a run
// that dies part way through would otherwise leave rows that make the next run's
// assertions ambiguous.
function purgeProviders() {
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  try {
    execFileSync(
      "docker",
      ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-q", "-c", "DELETE FROM oidc_providers WHERE slug LIKE 'smk%';"],
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

function createBody(slug, extra = {}) {
  return { slug, display_name: "冒烟登录", issuer: "https://idp.example.com", client_id: "purels", ...extra };
}

async function main() {
  purgeProviders();

  const admin = newSession();
  const signedIn = await signIn(admin, ADMIN_USER, ADMIN_PASS);
  record("the administrator signs in", signedIn.response.status === 200, `status=${signedIn.response.status}`);

  const anon = newSession();

  // ---------- what an unauthenticated visitor may see ----------
  const publicBefore = await call(anon, "/api/v1/auth/oidc/providers");
  const publicBeforeBody = await json(publicBefore);
  record("the sign-in methods are readable without a session", publicBefore.status === 200, `status=${publicBefore.status}`);
  record(
    "no provider is offered before one is configured",
    !(publicBeforeBody.providers || []).some((provider) => provider.slug === SLUG),
    `${publicBeforeBody.providers?.length ?? 0} providers`,
  );

  const consoleAnon = await call(anon, "/api/v1/oidc/providers");
  record("an unauthenticated caller cannot read the console list", consoleAnon.status === 401, `status=${consoleAnon.status}`);

  // ---------- can this deployment store a secret at all? ----------
  const withSecret = await call(admin, "/api/v1/oidc/providers", {
    method: "POST",
    body: createBody(`${SLUG}sec`, { client_secret: SECRET_VALUE }),
  });
  const secretsAvailable = withSecret.status === 201;
  if (secretsAvailable) {
    record("a provider with a client secret can be created", true, "status=201");
  } else {
    record("storing a client secret is refused while SECRET_ENCRYPTION_KEY is empty", withSecret.status === 409, `status=${withSecret.status}`);
  }

  if (secretsAvailable) {
    const withSecretBody = await json(withSecret);
    const secretProviderId = withSecretBody.provider?.id || "";

    const listed = await json(await call(admin, "/api/v1/oidc/providers"));
    const serialized = JSON.stringify(listed);
    const row = (listed.providers || []).find((provider) => provider.slug === `${SLUG}sec`);
    record("the console list reports that a secret is stored", row?.has_secret === true, `has_secret=${row?.has_secret}`);
    record("the console list returns no client_secret field", !serialized.includes("client_secret"), "field absent");
    record("the console list returns no secret value", !serialized.includes(SECRET_VALUE), "value absent");
    record("creating a provider returns no secret value either", !JSON.stringify(withSecretBody).includes(SECRET_VALUE), "value absent");

    const renamed = await call(admin, `/api/v1/oidc/providers/${secretProviderId}`, { method: "PATCH", body: { display_name: "冒烟密钥改名" } });
    const renamedBody = await json(renamed);
    record(
      "an edit that does not restate the secret keeps it",
      renamed.status === 200 && renamedBody.provider?.has_secret === true,
      `status=${renamed.status} has_secret=${renamedBody.provider?.has_secret}`,
    );

    // Reading "empty" as "clear it" would break every sign-in through the
    // provider without saying so, which is why the console omits the field and
    // the API treats an empty one as "leave it alone".
    const emptied = await call(admin, `/api/v1/oidc/providers/${secretProviderId}`, { method: "PATCH", body: { client_secret: "" } });
    const emptiedBody = await json(emptied);
    record(
      "an empty secret does not clear the stored one",
      emptied.status === 200 && emptiedBody.provider?.has_secret === true,
      `status=${emptied.status} has_secret=${emptiedBody.provider?.has_secret}`,
    );

    const moved = await call(admin, `/api/v1/oidc/providers/${secretProviderId}`, { method: "PATCH", body: { slug: "moved-elsewhere" } });
    record("the slug cannot be changed", moved.status === 409, `status=${moved.status}`);

    const audit = await json(await call(admin, "/api/v1/audit?action=oidc.create&limit=5"));
    record("the creation is recorded in the audit trail", (audit.entries || []).length > 0, `${audit.entries?.length ?? 0} entries`);
    record("the audit trail never carries the client secret", !JSON.stringify(audit).includes(SECRET_VALUE), "value absent");
  }

  // ---------- the public-client path, available in both configurations ----------
  const created = await call(admin, "/api/v1/oidc/providers", {
    method: "POST",
    // A trailing slash, to prove the issuer is canonicalised rather than stored
    // as typed: the IdP echoes `iss` back and one extra character is enough to
    // make every ID token fail its issuer check.
    body: createBody(SLUG, { issuer: "https://idp.example.com/" }),
  });
  const createdBody = await json(created);
  // A placeholder when the create failed, so the checks that follow report an
  // honest 404 against a well-formed UUID instead of a routing edge case. The
  // check above names the real problem.
  const id = createdBody.provider?.id || "00000000-0000-0000-0000-000000000000";
  record("a public client can be created", created.status === 201, `status=${created.status}`);
  record("the trailing slash is stripped from the issuer", createdBody.provider?.issuer === "https://idp.example.com", `issuer=${createdBody.provider?.issuer}`);
  record("a provider with no secret reports has_secret false", createdBody.provider?.has_secret === false, `has_secret=${createdBody.provider?.has_secret}`);
  record("an omitted auto_provision defaults to on", createdBody.provider?.auto_provision === true, `auto_provision=${createdBody.provider?.auto_provision}`);
  record("the stored slug is the one that was submitted", createdBody.provider?.slug === SLUG, `slug=${createdBody.provider?.slug}`);

  // ---------- validation ----------
  const duplicate = await call(admin, "/api/v1/oidc/providers", { method: "POST", body: createBody(SLUG) });
  record("a duplicate slug is refused", duplicate.status === 409, `status=${duplicate.status}`);

  const plainHTTP = await call(admin, "/api/v1/oidc/providers", { method: "POST", body: createBody(`${SLUG}h`, { issuer: "http://idp.example.com" }) });
  record("an http issuer is refused unless explicitly allowed", plainHTTP.status === 400, `status=${plainHTTP.status}`);

  const noOpenID = await call(admin, "/api/v1/oidc/providers", { method: "POST", body: createBody(`${SLUG}s`, { scopes: ["profile", "email"] }) });
  record("a scope list without openid is refused", noOpenID.status === 400, `status=${noOpenID.status}`);

  const badSlug = await call(admin, "/api/v1/oidc/providers", { method: "POST", body: createBody("Not A Slug") });
  record("a malformed slug is refused", badSlug.status === 400, `status=${badSlug.status}`);

  const noClientID = await call(admin, "/api/v1/oidc/providers", {
    method: "POST",
    body: { slug: `${SLUG}c`, display_name: "缺少 id", issuer: "https://idp.example.com" },
  });
  record("a missing client id is refused", noClientID.status === 400, `status=${noClientID.status}`);

  // The decoder runs with DisallowUnknownFields, so the console and the API are
  // a single contract: one extra key is a 400 rather than a silently ignored
  // field the operator believes took effect.
  const unknownField = await call(admin, "/api/v1/oidc/providers", {
    method: "POST",
    body: createBody(`${SLUG}u`, { redirect_uri: "https://evil.example.com/callback" }),
  });
  record("an unknown field is refused", unknownField.status === 400, `status=${unknownField.status}`);

  // ---------- the sign-in buttons ----------
  const publicAfter = await json(await call(anon, "/api/v1/auth/oidc/providers"));
  const button = (publicAfter.providers || []).find((provider) => provider.slug === SLUG);
  record("a configured provider is offered as a sign-in button", Boolean(button), `${publicAfter.providers?.length ?? 0} providers`);
  record(
    "the button carries only a slug and a label",
    Boolean(button) && Object.keys(button).sort().join(",") === "display_name,slug",
    `keys=${button ? Object.keys(button).sort().join(",") : "none"}`,
  );
  record(
    "the public list leaks neither the issuer nor the client id",
    !JSON.stringify(publicAfter).includes("idp.example.com") && !JSON.stringify(publicAfter).includes("purels"),
    "absent",
  );

  // ---------- disabling and enabling ----------
  const disabled = await call(admin, `/api/v1/oidc/providers/${id}`, { method: "PATCH", body: { enabled: false } });
  const disabledBody = await json(disabled);
  record("a provider can be disabled", disabled.status === 200 && disabledBody.provider?.enabled === false, `status=${disabled.status} enabled=${disabledBody.provider?.enabled}`);

  const publicDisabled = await json(await call(anon, "/api/v1/auth/oidc/providers"));
  record("a disabled provider is not offered as a sign-in button", !(publicDisabled.providers || []).some((provider) => provider.slug === SLUG), "absent");

  const reenabled = await call(admin, `/api/v1/oidc/providers/${id}`, { method: "PATCH", body: { enabled: true } });
  const reenabledBody = await json(reenabled);
  record("a provider can be enabled again", reenabled.status === 200 && reenabledBody.provider?.enabled === true, `status=${reenabled.status}`);

  // ---------- the callback base ----------
  // It comes from the server rather than from the browser: the operator has to
  // register this exact string at the IdP, and the console is not always served
  // from the same origin as the API.
  const consoleList = await json(await call(admin, "/api/v1/oidc/providers"));
  record("the console list reports the callback base", typeof consoleList.redirect_base === "string" && consoleList.redirect_base !== "", `redirect_base=${consoleList.redirect_base}`);

  // ---------- deleting ----------
  const deleted = await call(admin, `/api/v1/oidc/providers/${id}`, { method: "DELETE" });
  record("a provider can be deleted", deleted.status === 204, `status=${deleted.status}`);

  const deletedAgain = await call(admin, `/api/v1/oidc/providers/${id}`, { method: "DELETE" });
  record("deleting an unknown provider is a 404", deletedAgain.status === 404, `status=${deletedAgain.status}`);

  const afterDelete = await json(await call(admin, "/api/v1/oidc/providers"));
  record("the deleted provider is gone from the console list", !(afterDelete.providers || []).some((provider) => provider.slug === SLUG), "absent");

  const publicGone = await json(await call(anon, "/api/v1/auth/oidc/providers"));
  record("the deleted provider is gone from the sign-in buttons", !(publicGone.providers || []).some((provider) => provider.slug === SLUG), "absent");

  // ---------- report ----------
  const purged = purgeProviders();
  record("the suite's providers are removed", purged, purged ? "purged" : "psql failed");

  const failed = results.filter((r) => !r.ok).length;
  for (const r of results) {
    console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`secrets available: ${secretsAvailable ? "yes" : "no (SECRET_ENCRYPTION_KEY is empty)"}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
