// OIDC sign-in method checks: the providers are data, configured in the console,
// and the sign-in flow that uses them.
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
// The second half drives a real sign-in against a real identity provider, and
// is skipped unless one is reachable:
//
//   docker compose -f deploy/compose.yaml -f deploy/.oidc-check.yaml up -d --force-recreate
//   node scripts/smoke-oidc.mjs
//
// That override starts Dex on :5556 with two static users. It also has to be
// the configuration with a key, because a sign-in seals its PKCE verifier with
// it. The slug is fixed at "dex" rather than stamped: it is part of the callback
// URL registered at the provider, and Dex compares redirect URIs exactly.
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS, OIDC_ISSUER,
//      OIDC_USER, OIDC_OTHER, OIDC_PASS

import { createHmac } from "node:crypto";
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

// The test identity provider. host.docker.internal rather than a compose service
// name because three parties have to resolve it: the API container, the host
// browser and this script.
const IDP = (process.env.OIDC_ISSUER || "http://host.docker.internal:5556/dex").replace(/\/$/, "");
const IDP_SLUG = "dex";
const IDP_CLIENT_ID = "purels";
const IDP_SECRET = "purels-dex-secret";
const IDP_USER = process.env.OIDC_USER || "dexuser@example.com";
const IDP_OTHER = process.env.OIDC_OTHER || "dexother@example.com";
const IDP_PASS = process.env.OIDC_PASS || "purels-dex-pass";
// The name the account is derived as. Dex sends no preferred_username, so the
// local part of the verified address is what seeds it.
const IDP_ACCOUNT = IDP_USER.split("@")[0];

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail, skipped: false });
}

function skip(name, detail) {
  results.push({ name, ok: true, detail, skipped: true });
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
  // An absolute URL is passed through: the callback leg arrives on the public
  // origin, which is not the API port, and it has to be requested where the
  // provider was told to send the browser.
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
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
//
// One helper rather than three: the sweeps below all need the same invocation,
// and -t -A is what makes a count readable as a bare number.
function psql(sql) {
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  try {
    return execFileSync(
      "docker",
      ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-t", "-A", "-c", sql],
      { stdio: "pipe" },
    ).toString().trim();
  } catch {
    return null;
  }
}

// Keyed on the issuer rather than the slug, so a run only ever removes a
// provider that points at the test identity provider.
function purgeProviders() {
  return psql(`DELETE FROM oidc_providers WHERE slug LIKE 'smk%' OR issuer = '${IDP}';`) !== null;
}

// The accounts an external sign-in provisions are named after the address the
// provider verified. The provider's own row takes their identity bindings with
// it, so this only has to remove the accounts.
function purgeAccounts() {
  if (!/^[a-z0-9_-]+$/.test(IDP_ACCOUNT)) return false;
  return psql(`DELETE FROM admin_users WHERE username = '${IDP_ACCOUNT}' OR username LIKE '${IDP_ACCOUNT}-%';`) !== null;
}

// ---------- the second factor, implemented here on purpose ----------
//
// The point of the check is that the server's algorithm is right, so the code is
// computed from the specification rather than with a library the server also
// uses. RFC 4648 decoding, then RFC 4226 dynamic truncation over HMAC-SHA-1.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret) {
  const cleaned = secret.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

// A code from a step the server will reject, so a "wrong code" test cannot
// accidentally submit the right one when the clock rolls over mid-run.
function wrongCode() {
  return "000000" === totp("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") ? "111111" : "000000";
}

// ---------- driving the identity provider ----------

function absorb(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function jarHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

// Reports whether the test provider is there, so the suite still runs — and
// still passes — against the default stack, where it is not.
async function idpReachable() {
  try {
    const response = await fetch(`${IDP}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return false;
    return (await response.json()).issuer === IDP;
  } catch {
    return false;
  }
}

// Follows the provider's own redirects to its sign-in page, submits the form it
// serves there, and returns where it sends the browser next.
//
// The form is read rather than assumed because the provider keeps its own state
// in the action's query string: posting to a hard-coded path without it is a
// 400, and the state is not something the caller can construct.
async function authorize(startUrl, credentials) {
  const jar = new Map();
  let current = startUrl;
  let response;
  for (let hop = 0; hop < 8; hop++) {
    const headers = jar.size ? { Cookie: jarHeader(jar) } : {};
    response = await fetch(current, { redirect: "manual", headers });
    absorb(jar, response);
    if (response.status < 300 || response.status >= 400) break;
    current = new URL(response.headers.get("location"), current).toString();
  }
  if (!response || response.status >= 400) {
    throw new Error(`the provider refused the authorization request (status ${response?.status ?? "none"})`);
  }
  const html = await response.text();
  const action = html.match(/<form[^>]*\saction="([^"]+)"/)?.[1];
  if (!action) throw new Error("the provider served no sign-in form");
  // The action is HTML-escaped and relative.
  const target = new URL(action.replaceAll("&amp;", "&"), current).toString();
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (jar.size) headers.Cookie = jarHeader(jar);
  const submitted = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams({ login: credentials.email, password: credentials.password }),
  });
  const location = submitted.headers.get("location");
  if (!location) throw new Error(`the provider did not accept the credentials (status ${submitted.status})`);
  return location;
}

// Starts a sign-in and reports what the API handed the browser: where to go, the
// state it parked in a cookie, and that cookie's own attributes.
async function startSignIn(session, slug) {
  const response = await call(session, `/api/v1/auth/oidc/${slug}/start`);
  return {
    response,
    location: response.headers.get("location") || "",
    state: session.jar.get("purels_oidc") || "",
    setCookie: response.headers.getSetCookie().find((line) => line.startsWith("purels_oidc=")) || "",
  };
}

// The error code the API put in a failure redirect, or "" when it was not one.
function redirectError(response) {
  const location = response.headers.get("location") || "";
  return new URL(location, "http://placeholder.invalid").searchParams.get("error") || "";
}

// A sign-in that arrives by redirect has no JSON body to carry the CSRF token,
// so it is taken from the cookie the API set alongside the session — the same
// value the console reads out of the document.
function adoptCsrf(session) {
  session.csrf = session.jar.get("purels_csrf") || "";
}

function createBody(slug, extra = {}) {
  return { slug, display_name: "冒烟登录", issuer: "https://idp.example.com", client_id: "purels", ...extra };
}

async function main() {
  purgeProviders();
  purgeAccounts();

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
    // A trailing slash, to prove the exact issuer is retained rather than
    // stripped: the IdP echoes `iss` back and one missing character is enough
    // to make discovery and every ID token fail its issuer check.
    body: createBody(SLUG, { issuer: "https://idp.example.com/" }),
  });
  const createdBody = await json(created);
  // A placeholder when the create failed, so the checks that follow report an
  // honest 404 against a well-formed UUID instead of a routing edge case. The
  // check above names the real problem.
  const id = createdBody.provider?.id || "00000000-0000-0000-0000-000000000000";
  record("a public client can be created", created.status === 201, `status=${created.status}`);
  record("the trailing slash is preserved in the issuer", createdBody.provider?.issuer === "https://idp.example.com/", `issuer=${createdBody.provider?.issuer}`);
  record("a provider with no secret reports has_secret false", createdBody.provider?.has_secret === false, `has_secret=${createdBody.provider?.has_secret}`);
  record("an omitted auto_provision defaults to on", createdBody.provider?.auto_provision === true, `auto_provision=${createdBody.provider?.auto_provision}`);
  record("the stored slug is the one that was submitted", createdBody.provider?.slug === SLUG, `slug=${createdBody.provider?.slug}`);

  // ---------- validation ----------
  const duplicate = await call(admin, "/api/v1/oidc/providers", { method: "POST", body: createBody(SLUG) });
  record("a duplicate slug is refused", duplicate.status === 409, `status=${duplicate.status}`);

  const plainHTTP = await call(admin, "/api/v1/oidc/providers", { method: "POST", body: createBody(`${SLUG}h`, { issuer: "http://idp.example.com" }) });
  // Whether an http issuer is allowed is a deployment setting, so the suite
  // reads the answer rather than assuming it — the same way it reads whether a
  // secret can be stored. A self-hosted IdP on a private network is the case
  // that needs the relaxation; every other deployment has to refuse.
  const insecureAllowed = plainHTTP.status === 201;
  record(
    insecureAllowed ? "an http issuer is accepted while OIDC_ALLOW_INSECURE_ISSUERS is on" : "an http issuer is refused unless explicitly allowed",
    insecureAllowed ? (await json(plainHTTP)).provider?.issuer === "http://idp.example.com" : plainHTTP.status === 400,
    `status=${plainHTTP.status}`,
  );

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

  // ---------- 6b: a real sign-in against a real identity provider ----------
  //
  // Skipped as a block when the test provider is not up, so the default stack
  // still runs everything above. A sign-in also needs a key — the PKCE verifier
  // is sealed with it — so a deployment without one is told why rather than
  // reported as failing.
  const flowNames = [
    "a provider pointing at a real IdP can be created",
    "start redirects the browser to the provider",
    "the authorization request uses PKCE with S256",
    "the authorization request carries a nonce",
    "the redirect URI comes from the configured base, not the request",
    "the state is mirrored into an HttpOnly cookie",
    "the provider accepts the credentials and returns to the callback",
    "a callback without the state cookie is refused",
    "the callback signs the browser in",
    "the spent state cookie is cleared",
    "the external sign-in produced a working session",
    "an auto-provisioned account is a regular user",
    "a replayed callback is refused",
    "a second sign-in binds to the same account",
    "auto_provision can be switched off",
    "an unknown identity is refused while auto_provision is off",
    "the external account can bind a second factor",
    "a sign-in on an account with a second factor lands on the code form",
    "a challenge is not a session",
    "the challenge is kept in a cookie rather than the redirect",
    "the code completes the sign-in with no challenge in the body",
    "the spent challenge cookie is cleared",
    "the cookie path cannot bypass the attempt counter",
  ];
  const idpUp = await idpReachable();
  // Three settings have to line up before a sign-in can be driven end to end,
  // and each one is reported as the reason rather than as a failure: the
  // provider has to be there, the deployment has to be able to seal a PKCE
  // verifier, and an http issuer has to be permitted.
  const unavailable = !idpUp
    ? `no identity provider at ${IDP}`
    : !secretsAvailable
      ? "SECRET_ENCRYPTION_KEY is empty"
      : IDP.startsWith("http://") && !insecureAllowed
        ? "OIDC_ALLOW_INSECURE_ISSUERS is off"
        : "";
  if (unavailable) {
    for (const name of flowNames) skip(name, unavailable);
  } else {
    // The slug is fixed rather than stamped: it is part of the callback URL
    // registered at the provider, and a redirect URI is compared exactly.
    const provider = await call(admin, "/api/v1/oidc/providers", {
      method: "POST",
      body: {
        slug: IDP_SLUG,
        display_name: "Dex",
        issuer: IDP,
        client_id: IDP_CLIENT_ID,
        client_secret: IDP_SECRET,
        scopes: ["openid", "profile", "email"],
        auto_provision: true,
        enabled: true,
      },
    });
    const providerBody = await json(provider);
    const providerId = providerBody.provider?.id || "00000000-0000-0000-0000-000000000000";
    record("a provider pointing at a real IdP can be created", provider.status === 201, `status=${provider.status}`);

    // The base the callback URL is built from, as the console shows it to the
    // operator who has to register it.
    const consoleList = await json(await call(admin, "/api/v1/oidc/providers"));
    const redirectBase = consoleList.redirect_base || "";
    const expectedCallback = `${redirectBase}/api/v1/auth/oidc/${IDP_SLUG}/callback`;

    // ---------- the start leg ----------
    const visitor = newSession();
    const start = await startSignIn(visitor, IDP_SLUG);
    const authURL = new URL(start.location, BASE);
    record(
      "start redirects the browser to the provider",
      start.response.status === 302 && start.location.startsWith(`${IDP}/auth`),
      `status=${start.response.status} location=${start.location.slice(0, 56)}`,
    );
    const challenge = authURL.searchParams.get("code_challenge") || "";
    record(
      "the authorization request uses PKCE with S256",
      authURL.searchParams.get("code_challenge_method") === "S256" && challenge.length >= 43,
      `method=${authURL.searchParams.get("code_challenge_method")} length=${challenge.length}`,
    );
    record(
      "the authorization request carries a nonce",
      (authURL.searchParams.get("nonce") || "").length >= 32,
      `nonce=${(authURL.searchParams.get("nonce") || "").length} chars`,
    );
    // Built from the configured base and never from the request's Host header:
    // a redirect URI the caller could choose is a redirect URI the caller could
    // point at themselves.
    record(
      "the redirect URI comes from the configured base, not the request",
      authURL.searchParams.get("redirect_uri") === expectedCallback,
      `redirect_uri=${authURL.searchParams.get("redirect_uri")}`,
    );
    record(
      "the state is mirrored into an HttpOnly cookie",
      Boolean(start.state) && authURL.searchParams.get("state") === start.state && /HttpOnly/i.test(start.setCookie),
      `state=${start.state.length} chars httpOnly=${/HttpOnly/i.test(start.setCookie)}`,
    );

    // ---------- the callback leg ----------
    // The provider's own page is driven for real: its form carries its own
    // state in the action, and a hand-made POST without it is a 400.
    const callback = await authorize(start.location, { email: IDP_USER, password: IDP_PASS });
    record(
      "the provider accepts the credentials and returns to the callback",
      callback.startsWith(expectedCallback),
      callback.slice(0, 80),
    );

    // Without the cookie this is not the browser that started the sign-in.
    const stranger = newSession();
    const refused = await call(stranger, callback);
    record(
      "a callback without the state cookie is refused",
      refused.status === 302 && redirectError(refused) === "oidc_state" && !stranger.jar.has("purels_session"),
      `status=${refused.status} error=${redirectError(refused)}`,
    );

    const landed = await call(visitor, callback);
    record(
      "the callback signs the browser in",
      landed.status === 302 && (landed.headers.get("location") || "") === "/admin" && visitor.jar.has("purels_session"),
      `status=${landed.status} location=${landed.headers.get("location")}`,
    );
    record("the spent state cookie is cleared", !visitor.jar.has("purels_oidc"), [...visitor.jar.keys()].join(",") || "no cookies");

    adoptCsrf(visitor);
    const me = await json(await call(visitor, "/api/v1/auth/me"));
    record("the external sign-in produced a working session", me.user?.username === IDP_ACCOUNT, `username=${me.user?.username}`);
    // The role is not the provider's to choose: an external identity always
    // lands as a regular account, whatever it claims about itself.
    record(
      "an auto-provisioned account is a regular user",
      me.user?.role === "user" && me.user?.unrestricted === false,
      `role=${me.user?.role} unrestricted=${me.user?.unrestricted}`,
    );
    const listedUsers = await json(await call(admin, "/api/v1/users"));
    const listedOIDCAccount = (listedUsers.users || []).find((user) => user.id === me.user?.id);
    record(
      "the user list identifies the OIDC account and provider",
      listedOIDCAccount?.auth_source === "oidc" && listedOIDCAccount.auth_provider === "Dex",
      `source=${listedOIDCAccount?.auth_source} provider=${listedOIDCAccount?.auth_provider}`,
    );

    // The request was claimed before the code was exchanged, so the same
    // callback cannot be presented twice.
    const replay = newSession();
    replay.jar.set("purels_oidc", start.state);
    const replayed = await call(replay, callback);
    record(
      "a replayed callback is refused",
      replayed.status === 302 && redirectError(replayed) === "oidc_state" && !replay.jar.has("purels_session"),
      `status=${replayed.status} error=${redirectError(replayed)}`,
    );

    // ---------- a second sign-in is the same account ----------
    const second = newSession();
    const secondStart = await startSignIn(second, IDP_SLUG);
    const secondCallback = await authorize(secondStart.location, { email: IDP_USER, password: IDP_PASS });
    await call(second, secondCallback);
    const secondMe = await json(await call(second, "/api/v1/auth/me"));
    const accounts = /^[a-z0-9_-]+$/.test(IDP_ACCOUNT)
      ? psql(`SELECT count(*) FROM admin_users WHERE username = '${IDP_ACCOUNT}' OR username LIKE '${IDP_ACCOUNT}-%';`)
      : "";
    record(
      "a second sign-in binds to the same account",
      Boolean(me.user?.id) && secondMe.user?.id === me.user?.id && accounts === "1",
      `same=${secondMe.user?.id === me.user?.id} accounts=${accounts}`,
    );

    // ---------- auto_provision off ----------
    // dexother has never signed in, so with provisioning off the provider has to
    // refuse rather than quietly create a second account.
    const provisionOff = await call(admin, `/api/v1/oidc/providers/${providerId}`, { method: "PATCH", body: { auto_provision: false } });
    record("auto_provision can be switched off", provisionOff.status === 200, `status=${provisionOff.status}`);

    const other = newSession();
    const otherStart = await startSignIn(other, IDP_SLUG);
    const otherCallback = await authorize(otherStart.location, { email: IDP_OTHER, password: IDP_PASS });
    const otherLanded = await call(other, otherCallback);
    record(
      "an unknown identity is refused while auto_provision is off",
      otherLanded.status === 302 && redirectError(otherLanded) === "oidc_not_provisioned" && !other.jar.has("purels_session"),
      `status=${otherLanded.status} error=${redirectError(otherLanded)}`,
    );

    await call(admin, `/api/v1/oidc/providers/${providerId}`, { method: "PATCH", body: { auto_provision: true } });

    // ---------- the second factor across an external sign-in ----------
    const mfaNames = flowNames.slice(flowNames.indexOf("the external account can bind a second factor"));
    const mfaStatus = await json(await call(visitor, "/api/v1/auth/2fa"));
    if (!mfaStatus.available) {
      for (const name of mfaNames) skip(name, "the second factor is off for this deployment");
    } else {
      const enrolled = await json(await call(visitor, "/api/v1/auth/2fa/enroll", { method: "POST" }));
      const secret = enrolled.secret || "";
      const confirmed = await json(await call(visitor, "/api/v1/auth/2fa/confirm", { method: "POST", body: { code: totp(secret) } }));
      record(
        "the external account can bind a second factor",
        Boolean(secret) && (confirmed.recovery_codes || []).length === 10,
        `secret=${secret.length} chars codes=${(confirmed.recovery_codes || []).length}`,
      );

      // A browser navigation cannot return a challenge in a body, so it goes
      // into a cookie and the page is told only that a code is due.
      const pending = newSession();
      const pendingStart = await startSignIn(pending, IDP_SLUG);
      const pendingCallback = await authorize(pendingStart.location, { email: IDP_USER, password: IDP_PASS });
      const challenged = await call(pending, pendingCallback);
      const pendingLocation = challenged.headers.get("location") || "";
      const mfaChallenge = pending.jar.get("purels_mfa") || "";
      record(
        "a sign-in on an account with a second factor lands on the code form",
        challenged.status === 302 && pendingLocation === "/login?mfa=1",
        `status=${challenged.status} location=${pendingLocation}`,
      );
      record("a challenge is not a session", !pending.jar.has("purels_session"), [...pending.jar.keys()].join(",") || "no cookies");
      record(
        "the challenge is kept in a cookie rather than the redirect",
        Boolean(mfaChallenge) && !pendingLocation.includes(mfaChallenge),
        `challenge=${mfaChallenge.length} chars`,
      );

      // The body carries no challenge: the cookie is HttpOnly, so the page
      // cannot read it, and the server fills it in. Everything downstream is the
      // same claim and the same attempt counter as the password path.
      const verified = await call(pending, "/api/v1/auth/2fa/verify", { method: "POST", body: { code: totp(secret) } });
      record(
        "the code completes the sign-in with no challenge in the body",
        verified.status === 200 && pending.jar.has("purels_session"),
        `status=${verified.status} session=${pending.jar.has("purels_session")}`,
      );
      record("the spent challenge cookie is cleared", !pending.jar.has("purels_mfa"), [...pending.jar.keys()].join(",") || "no cookies");

      // The proof that the cookie is not a way around the counter: spend the
      // five attempts, then present a correct code.
      const limited = newSession();
      const limitedStart = await startSignIn(limited, IDP_SLUG);
      const limitedCallback = await authorize(limitedStart.location, { email: IDP_USER, password: IDP_PASS });
      await call(limited, limitedCallback);
      for (let i = 0; i < 5; i++) {
        await call(limited, "/api/v1/auth/2fa/verify", { method: "POST", body: { code: wrongCode() } });
      }
      const blocked = await call(limited, "/api/v1/auth/2fa/verify", { method: "POST", body: { code: totp(secret) } });
      record(
        "the cookie path cannot bypass the attempt counter",
        blocked.status === 401 && !limited.jar.has("purels_session"),
        `status=${blocked.status} session=${limited.jar.has("purels_session")}`,
      );
    }
  }

  // ---------- report ----------
  const purged = purgeProviders();
  record("the suite's providers are removed", purged, purged ? "purged" : "psql failed");
  const swept = purgeAccounts();
  record("the accounts the flow created are removed", swept, swept ? IDP_ACCOUNT : "psql failed");

  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.skipped) skipped++;
    if (!r.ok) failed++;
    console.log(`[${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const ran = results.length - skipped;
  console.log(`\n${ran - failed}/${ran} checks passed${skipped ? `, ${skipped} skipped` : ""}`);
  console.log(`secrets available: ${secretsAvailable ? "yes" : "no (SECRET_ENCRYPTION_KEY is empty)"}`);
  console.log(`insecure issuers allowed: ${insecureAllowed ? "yes" : "no"}`);
  if (skipped) {
    console.log("Start the test provider to run the sign-in checks:");
    console.log("  docker compose -f deploy/compose.yaml -f deploy/.oidc-check.yaml up -d --force-recreate");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
