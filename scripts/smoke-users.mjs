// Multi-user checks: registration, role boundaries and link ownership.
//
//   node scripts/smoke-users.mjs
//
// Talks straight to the Go API (default :8080). Every account it creates is
// named with a per-run stamp and removed again through psql at the end, because
// the API deliberately offers no way to delete an account.
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me-now";
const STAMP = Date.now().toString(36);

const TEST_IP = "203.0.113.20";
// Sign-up allows five attempts per minute per address, and the negative cases
// alone spend most of that, so the format checks get an address of their own.
// Both are unique per run so an earlier run's window cannot mask a failure.
const REG_IP = `198.18.${(Date.now() % 250) + 1}.7`;
const REG_IP_2 = `198.19.${(Date.now() % 250) + 1}.7`;

const ALICE = `alice${STAMP}`;
const BOB = `bob${STAMP}`;
const ALICE_PASS = "smoke-password-alice";
const BOB_PASS = "smoke-password-bob";
const ALICE_ALIAS = `own${STAMP}`;
const BOB_ALIAS = `bob${STAMP}`;
const OWNER_TAG = `ownercheck${STAMP}`;

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

function newSession() {
  return { jar: new Map(), csrf: "", userId: "", role: "" };
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
  if (response.status === 200) {
    session.csrf = payload.csrf_token || "";
    session.userId = payload.user?.id || "";
    session.role = payload.user?.role || "";
  }
  return { response, payload };
}

async function register(session, username, password, ip = REG_IP) {
  const response = await call(session, "/api/v1/auth/register", { method: "POST", ip, body: { username, password } });
  const payload = await json(response);
  if (response.status === 201) {
    session.csrf = payload.csrf_token || "";
    session.userId = payload.user?.id || "";
    session.role = payload.user?.role || "";
  }
  return { response, payload };
}

// Accounts cannot be deleted through the API, so the test accounts are removed
// with psql. Their links, sessions and tokens follow through ON DELETE CASCADE.
function purgeAccounts(usernames) {
  if (!usernames.every((name) => /^[a-z0-9_-]+$/.test(name))) return false;
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  const sql = `DELETE FROM admin_users WHERE username IN (${usernames.map((name) => `'${name}'`).join(",")});`;
  try {
    execFileSync("docker", ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-q", "-c", sql], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const admin = newSession();
  const alice = newSession();
  const bob = newSession();

  const adminLogin = await signIn(admin, ADMIN_USER, ADMIN_PASS);
  record("the bootstrap account signs in as an administrator", adminLogin.response.status === 200 && admin.role === "admin", `status=${adminLogin.response.status} role=${admin.role}`);

  // ---------- registration ----------
  const aliceReg = await register(alice, ALICE, ALICE_PASS);
  record("registration creates a regular account", aliceReg.response.status === 201 && alice.role === "user", `status=${aliceReg.response.status} role=${alice.role}`);

  const bobReg = await register(bob, BOB, BOB_PASS);
  record("registration creates a second account", bobReg.response.status === 201 && Boolean(bob.userId), `status=${bobReg.response.status}`);

  const aliceMe = await json(await call(alice, "/api/v1/auth/me"));
  record("registration signs the new account in", aliceMe.user?.username === ALICE, `user=${aliceMe.user?.username}`);

  const dupe = await register(newSession(), ALICE, ALICE_PASS);
  record("a duplicate username is rejected", dupe.response.status === 409, `status=${dupe.response.status}`);

  const caseDupe = await register(newSession(), ADMIN_USER.toUpperCase(), ALICE_PASS);
  record("usernames are case-insensitive", caseDupe.response.status === 409, `status=${caseDupe.response.status}`);

  const weak = await register(newSession(), `weak${STAMP}`, "short");
  record("a short password is rejected", weak.response.status === 400, `status=${weak.response.status}`);

  for (const [label, username] of [["too short", "a"], ["a space", "bad name"], ["a leading separator", "_lead"]]) {
    const bad = await register(newSession(), username, ALICE_PASS, REG_IP_2);
    record(`a username with ${label} is rejected`, bad.response.status === 400, `status=${bad.response.status}`);
  }

  // ---------- ownership ----------
  const aliceCreate = await call(alice, "/api/v1/links", {
    method: "POST",
    body: { destination_url: `https://example.org/owned-${STAMP}`, alias: ALICE_ALIAS, title: "alice", tags: [OWNER_TAG] },
  });
  const aliceLink = (await json(aliceCreate)).link;
  record("a regular user can create a link", aliceCreate.status === 201 && Boolean(aliceLink?.id), `status=${aliceCreate.status}`);

  const bobCreate = await call(bob, "/api/v1/links", {
    method: "POST",
    body: { destination_url: `https://example.org/bob-${STAMP}`, alias: BOB_ALIAS, title: "bob" },
  });
  const bobLink = (await json(bobCreate)).link;
  record("a second regular user can create a link", bobCreate.status === 201 && Boolean(bobLink?.id), `status=${bobCreate.status}`);

  const aliceList = await json(await call(alice, `/api/v1/links?search=${STAMP}&limit=100`));
  const aliceAliases = (aliceList.links || []).map((l) => l.alias);
  record("the owner sees their own link", aliceAliases.includes(ALICE_ALIAS), aliceAliases.join(","));
  record("a user does not see another account's link in the list", !aliceAliases.includes(BOB_ALIAS), aliceAliases.join(","));

  const bobList = await json(await call(bob, `/api/v1/links?search=${STAMP}&limit=100`));
  const bobAliases = (bobList.links || []).map((l) => l.alias);
  record("the other owner sees their own link", bobAliases.includes(BOB_ALIAS), bobAliases.join(","));
  record("the list does not leak the first account's link", !bobAliases.includes(ALICE_ALIAS), bobAliases.join(","));

  const denied = [
    ["read it by id", await call(bob, `/api/v1/links/${aliceLink?.id}`)],
    ["edit it", await call(bob, `/api/v1/links/${aliceLink?.id}`, { method: "PATCH", body: { title: "hijacked" } })],
    ["delete it", await call(bob, `/api/v1/links/${aliceLink?.id}`, { method: "DELETE" })],
    ["read its statistics", await call(bob, `/api/v1/links/${aliceLink?.id}/stats`)],
    ["read its click log", await call(bob, `/api/v1/links/${aliceLink?.id}/clicks`)],
    ["fetch its qr code", await call(bob, `/api/v1/links/${aliceLink?.id}/qr`)],
  ];
  for (const [label, response] of denied) {
    record(`another user cannot ${label}`, response.status === 404, `status=${response.status}`);
  }

  const bobExport = await call(bob, `/api/v1/links/export?search=${STAMP}`);
  const bobCsv = (await bobExport.text()).replace(/^\uFEFF/, "");
  record("an export cannot leak another account's links", !bobCsv.includes(ALICE_ALIAS), `${bobCsv.split(/\r?\n/).filter((line) => line.trim()).length - 1} data rows`);

  const bobSummary = await json(await call(bob, "/api/v1/stats/summary"));
  record("the summary counts only the caller's links", bobSummary.total_links === 1 && bobSummary.total_clicks === 0, JSON.stringify(bobSummary));

  const bobRanking = await json(await call(bob, "/api/v1/stats/top?limit=50"));
  record("rankings are scoped to the caller", !(bobRanking.links || []).some((l) => l.alias === ALICE_ALIAS), `${bobRanking.links?.length} rows`);

  const bobTags = await json(await call(bob, "/api/v1/tags"));
  const aliceTags = await json(await call(alice, "/api/v1/tags"));
  record("the tag list is scoped to the caller", !(bobTags.tags || []).some((t) => t.name === OWNER_TAG) && (aliceTags.tags || []).some((t) => t.name === OWNER_TAG), JSON.stringify(bobTags.tags));

  // ---------- administrator visibility ----------
  const adminList = await json(await call(admin, `/api/v1/links?search=${STAMP}&limit=100`));
  const adminAliases = (adminList.links || []).map((l) => l.alias);
  record("an administrator sees every account's links", adminAliases.includes(ALICE_ALIAS) && adminAliases.includes(BOB_ALIAS), adminAliases.join(","));

  const adminRead = await call(admin, `/api/v1/links/${aliceLink?.id}`);
  record("an administrator can read any link", adminRead.status === 200, `status=${adminRead.status}`);

  const adminPatch = await call(admin, `/api/v1/links/${aliceLink?.id}`, { method: "PATCH", body: { title: "edited by the administrator" } });
  record("an administrator can edit any link", adminPatch.status === 200, `status=${adminPatch.status}`);

  // ---------- role boundaries ----------
  const bobAudit = await call(bob, "/api/v1/audit");
  record("a regular user cannot read the audit log", bobAudit.status === 403, `status=${bobAudit.status}`);

  const bobUsers = await call(bob, "/api/v1/users");
  record("a regular user cannot list accounts", bobUsers.status === 403, `status=${bobUsers.status}`);

  const bobPromote = await call(bob, `/api/v1/users/${alice.userId}`, { method: "PATCH", body: { role: "admin" } });
  record("a regular user cannot change a role", bobPromote.status === 403, `status=${bobPromote.status}`);

  const bobSelfDisable = await call(bob, `/api/v1/users/${bob.userId}`, { method: "PATCH", body: { disabled: true } });
  record("a regular user cannot disable an account", bobSelfDisable.status === 403, `status=${bobSelfDisable.status}`);

  // ---------- a regular user's own API token ----------
  const tokenCreate = await call(bob, "/api/v1/auth/tokens", { method: "POST", body: { name: `smoke-${STAMP}` } });
  const tokenPayload = await json(tokenCreate);
  record("a regular user can mint their own token", tokenCreate.status === 201 && Boolean(tokenPayload.secret), `status=${tokenCreate.status}`);

  if (tokenPayload.secret) {
    const bearer = { Authorization: `Bearer ${tokenPayload.secret}` };
    const tokenRead = await call(newSession(), "/api/v1/links", { headers: bearer });
    record("a regular user's token can read links", tokenRead.status === 200, `status=${tokenRead.status}`);

    const tokenScoped = await json(await call(newSession(), `/api/v1/links?search=${STAMP}&limit=100`, { headers: bearer }));
    record("a regular user's token sees only their own links", !(tokenScoped.links || []).some((l) => l.alias === ALICE_ALIAS), `${tokenScoped.links?.length} rows`);

    const tokenAudit = await call(newSession(), "/api/v1/audit", { headers: bearer });
    record("a regular user's token cannot read the audit log", tokenAudit.status === 403, `status=${tokenAudit.status}`);

    const tokenUsers = await call(newSession(), "/api/v1/users", { headers: bearer });
    record("a regular user's token cannot list accounts", tokenUsers.status === 403, `status=${tokenUsers.status}`);
  }

  // ---------- account administration ----------
  const users = await json(await call(admin, "/api/v1/users"));
  const accounts = users.users || [];
  const usernames = accounts.map((u) => u.username);
  record("the administrator lists every account", [ADMIN_USER, ALICE, BOB].every((name) => usernames.includes(name)), usernames.join(","));
  record(
    "the bootstrap account is an administrator and registered accounts are not",
    accounts.find((u) => u.username === ADMIN_USER)?.role === "admin" &&
      accounts.filter((u) => u.username === ALICE || u.username === BOB).every((u) => u.role === "user"),
    accounts.map((u) => `${u.username}:${u.role}`).join(","),
  );

  const selfChange = await call(admin, `/api/v1/users/${admin.userId}`, { method: "PATCH", body: { role: "user" } });
  record("an administrator cannot change their own account", selfChange.status === 400, `status=${selfChange.status}`);

  const disabled = await call(admin, `/api/v1/users/${bob.userId}`, { method: "PATCH", body: { disabled: true } });
  record("an administrator can disable an account", disabled.status === 204, `status=${disabled.status}`);

  const bobAfterDisable = await call(bob, "/api/v1/links");
  record("a disabled account loses its session", bobAfterDisable.status === 401, `status=${bobAfterDisable.status}`);

  const bobRelogin = await signIn(newSession(), BOB, BOB_PASS);
  record("a disabled account cannot sign in", bobRelogin.response.status === 401, `status=${bobRelogin.response.status}`);

  const enabled = await call(admin, `/api/v1/users/${bob.userId}`, { method: "PATCH", body: { disabled: false } });
  record("an administrator can re-enable an account", enabled.status === 204, `status=${enabled.status}`);

  const bobBack = await signIn(bob, BOB, BOB_PASS);
  record("a re-enabled account can sign in again", bobBack.response.status === 200 && bob.role === "user", `status=${bobBack.response.status} role=${bob.role}`);

  // The role is re-read on every request, so a promotion takes effect on the
  // next call rather than at the next sign-in.
  const promoted = await call(admin, `/api/v1/users/${alice.userId}`, { method: "PATCH", body: { role: "admin" } });
  record("an administrator can promote an account", promoted.status === 204, `status=${promoted.status}`);

  const aliceUsers = await call(alice, "/api/v1/users");
  record("a promoted account gains administrator access", aliceUsers.status === 200, `status=${aliceUsers.status}`);

  const aliceWidened = await json(await call(alice, `/api/v1/links?search=${STAMP}&limit=100`));
  record("a promoted account now sees every link", (aliceWidened.links || []).some((l) => l.alias === BOB_ALIAS), `${aliceWidened.links?.length} rows`);

  const demoted = await call(admin, `/api/v1/users/${alice.userId}`, { method: "PATCH", body: { role: "user" } });
  record("an administrator can demote an account", demoted.status === 204, `status=${demoted.status}`);

  const aliceAfterDemote = await call(alice, "/api/v1/users");
  record("a demoted account loses administrator access", aliceAfterDemote.status === 403, `status=${aliceAfterDemote.status}`);

  const aliceNarrowed = await json(await call(alice, `/api/v1/links?search=${STAMP}&limit=100`));
  record("a demoted account sees only its own links again", !(aliceNarrowed.links || []).some((l) => l.alias === BOB_ALIAS), `${aliceNarrowed.links?.length} rows`);

  // ---------- capability-driven access ----------
  const aliceMeScopes = await json(await call(alice, "/api/v1/auth/me"));
  record(
    "a session reports the scopes its role grants",
    Array.isArray(aliceMeScopes.user?.scopes) && aliceMeScopes.user.scopes.includes("links:read") && !aliceMeScopes.user.scopes.includes("audit:read"),
    (aliceMeScopes.user?.scopes || []).join(","),
  );
  record("a session reports whether the account is unrestricted", aliceMeScopes.user?.unrestricted === false, `unrestricted=${aliceMeScopes.user?.unrestricted}`);

  const rolesDenied = await call(alice, "/api/v1/roles");
  record("a regular user cannot read the role list", rolesDenied.status === 403, `status=${rolesDenied.status}`);

  // Configuring a sign-in method is its own capability, so it does not ride on
  // roles:manage. A regular account must not reach the list either.
  const oidcDenied = await call(alice, "/api/v1/oidc/providers");
  record("a regular user cannot read the sign-in methods", oidcDenied.status === 403, `status=${oidcDenied.status}`);

  const roles = await json(await call(admin, "/api/v1/roles"));
  const roleList = roles.roles || [];
  const roleNames = roleList.map((r) => r.name);
  record("the administrator lists the roles", ["admin", "operator", "readonly", "user"].every((n) => roleNames.includes(n)), roleNames.join(","));

  const unknownRole = await call(admin, `/api/v1/users/${bob.userId}`, { method: "PATCH", body: { role: "superuser" } });
  record("an unknown role is rejected", unknownRole.status === 400, `status=${unknownRole.status}`);

  // Stripping the capability that guards an endpoint would lock everybody out
  // of it, so the edit is refused rather than applied.
  const adminRole = roleList.find((r) => r.name === "admin");
  const stripUsers = await call(admin, "/api/v1/roles/admin", {
    method: "PATCH",
    body: { scopes: (adminRole?.scopes || []).filter((scope) => scope !== "users:manage"), unrestricted: true },
  });
  record("an edit that would remove the last users:manage holder is refused", stripUsers.status === 409, `status=${stripUsers.status}`);

  const stripAll = await call(admin, "/api/v1/roles/admin", { method: "PATCH", body: { scopes: [], unrestricted: true } });
  record("an edit that would strip every permission is refused", stripAll.status === 409, `status=${stripAll.status}`);

  const adminRoleAfter = (await json(await call(admin, "/api/v1/roles"))).roles || [];
  record(
    "a refused edit leaves the role untouched",
    adminRoleAfter.find((r) => r.name === "admin")?.scopes?.includes("users:manage") === true,
    (adminRoleAfter.find((r) => r.name === "admin")?.scopes || []).join(","),
  );

  const unknownScope = await call(admin, "/api/v1/roles/readonly", { method: "PATCH", body: { scopes: ["links:read", "links:delete"], unrestricted: true } });
  record("an unknown scope is rejected", unknownScope.status === 400, `status=${unknownScope.status}`);

  // readonly is the scratch role: no account holds it, so editing it cannot
  // lock anybody out, and it is restored before the suite ends.
  const readonlyBefore = roleList.find((r) => r.name === "readonly") || { scopes: [], unrestricted: true };
  const readonlyEdited = await call(admin, "/api/v1/roles/readonly", {
    method: "PATCH",
    body: { scopes: [...readonlyBefore.scopes, "tokens:manage"], unrestricted: readonlyBefore.unrestricted },
  });
  record("an administrator can edit a role", readonlyEdited.status === 204, `status=${readonlyEdited.status}`);

  const readonlyAfter = ((await json(await call(admin, "/api/v1/roles"))).roles || []).find((r) => r.name === "readonly");
  record("the edited role is stored and read back", readonlyAfter?.scopes?.includes("tokens:manage") === true, (readonlyAfter?.scopes || []).join(","));

  const readonlyRestored = await call(admin, "/api/v1/roles/readonly", {
    method: "PATCH",
    body: { scopes: readonlyBefore.scopes, unrestricted: readonlyBefore.unrestricted },
  });
  record("the scratch role is restored", readonlyRestored.status === 204, `status=${readonlyRestored.status}`);

  // operator holds audit:read and is unrestricted, a different combination
  // from the regular-user role.
  const toOperator = await call(admin, `/api/v1/users/${alice.userId}`, { method: "PATCH", body: { role: "operator" } });
  record("an administrator can assign a non-admin role", toOperator.status === 204, `status=${toOperator.status}`);

  const aliceAudit = await call(alice, "/api/v1/audit");
  record("the operator role grants the audit scope", aliceAudit.status === 200, `status=${aliceAudit.status}`);

  const aliceUsersDenied = await call(alice, "/api/v1/users");
  record("the operator role does not grant user administration", aliceUsersDenied.status === 403, `status=${aliceUsersDenied.status}`);

  const aliceOperatorList = await json(await call(alice, `/api/v1/links?search=${STAMP}&limit=100`));
  record("an unrestricted role sees every account's links", (aliceOperatorList.links || []).some((l) => l.alias === BOB_ALIAS), `${aliceOperatorList.links?.length} rows`);

  const backToUser = await call(admin, `/api/v1/users/${alice.userId}`, { method: "PATCH", body: { role: "user" } });
  record("the account is returned to the regular-user role", backToUser.status === 204, `status=${backToUser.status}`);

  // readonly reads the audit trail and every account's links but cannot write
  // at all — a combination no role could express before.
  const toReadonly = await call(admin, `/api/v1/users/${bob.userId}`, { method: "PATCH", body: { role: "readonly" } });
  record("an administrator can assign the readonly role", toReadonly.status === 204, `status=${toReadonly.status}`);

  const readonlyCreate = await call(bob, "/api/v1/links", {
    method: "POST",
    body: { destination_url: `https://example.org/readonly-${STAMP}`, alias: `ro${STAMP}` },
  });
  record("the readonly role cannot create links", readonlyCreate.status === 403, `status=${readonlyCreate.status}`);

  const readonlyUsers = await call(bob, "/api/v1/users");
  record("the readonly role cannot list accounts", readonlyUsers.status === 403, `status=${readonlyUsers.status}`);

  const readonlyAudit = await call(bob, "/api/v1/audit");
  record("the readonly role can read the audit log", readonlyAudit.status === 200, `status=${readonlyAudit.status}`);

  const readonlyList = await json(await call(bob, `/api/v1/links?search=${STAMP}&limit=100`));
  record("the readonly role sees every account's links", (readonlyList.links || []).some((l) => l.alias === ALICE_ALIAS), `${readonlyList.links?.length} rows`);

  const bobBackToUser = await call(admin, `/api/v1/users/${bob.userId}`, { method: "PATCH", body: { role: "user" } });
  record("the second account is returned to the regular-user role", bobBackToUser.status === 204, `status=${bobBackToUser.status}`);

  // The tracking ids are fetched by every console page for every signed-in
  // account, because the script they decide on is injected for all of them. So
  // the read deliberately carries no scope while the write carries one — gating
  // the read would silently switch tracking off for everyone without the
  // capability.
  const userAnalyticsRead = await call(bob, "/api/v1/analytics");
  record("a regular account can read the tracking ids", userAnalyticsRead.status === 200, `status=${userAnalyticsRead.status}`);

  const userAnalyticsWrite = await call(bob, "/api/v1/analytics", {
    method: "PUT",
    body: { ga4_measurement_id: "", gtm_container_id: "", matomo_url: "", matomo_site_id: "" },
  });
  record("a regular account cannot change the tracking ids", userAnalyticsWrite.status === 403, `status=${userAnalyticsWrite.status}`);

  // A token carries the scopes it was minted with, which never include the
  // administration scopes, so account management is session-only by design.
  const adminToken = await json(await call(admin, "/api/v1/auth/tokens", { method: "POST", body: { name: `roles-${STAMP}` } }));
  if (adminToken.secret) {
    const bearer = { Authorization: `Bearer ${adminToken.secret}` };
    const tokenRoles = await call(newSession(), "/api/v1/roles", { headers: bearer });
    record("an administrator's token does not carry roles:manage", tokenRoles.status === 403, `status=${tokenRoles.status}`);

    const tokenUsers = await call(newSession(), "/api/v1/users", { headers: bearer });
    record("an administrator's token does not carry users:manage", tokenUsers.status === 403, `status=${tokenUsers.status}`);

    const tokenOidc = await call(newSession(), "/api/v1/oidc/providers", { headers: bearer });
    record("an administrator's token does not carry oidc:manage", tokenOidc.status === 403, `status=${tokenOidc.status}`);

    const tokenAnalytics = await call(newSession(), "/api/v1/analytics", {
      method: "PUT",
      headers: bearer,
      body: { ga4_measurement_id: "", gtm_container_id: "", matomo_url: "", matomo_site_id: "" },
    });
    record("an administrator's token does not carry analytics:manage", tokenAnalytics.status === 403, `status=${tokenAnalytics.status}`);

    const revoked = await call(admin, `/api/v1/auth/tokens/${adminToken.token?.id}`, { method: "DELETE" });
    record("the administrator's test token is revoked", revoked.status === 204, `status=${revoked.status}`);
  }

  // ---------- cleanup ----------
  const purged = purgeAccounts([ALICE, BOB]);
  record("test accounts are removed", purged, purged ? `${ALICE}, ${BOB}` : "psql unavailable — remove them by hand");

  if (purged) {
    const remaining = await json(await call(admin, "/api/v1/users"));
    const left = (remaining.users || []).map((u) => u.username);
    record("no test accounts remain", !left.includes(ALICE) && !left.includes(BOB), left.join(","));

    const linksLeft = await json(await call(admin, `/api/v1/links?search=${STAMP}&limit=100`));
    record("their links went with them", (linksLeft.links || []).length === 0, `${linksLeft.links?.length} left`);
  }

  // ---------- report ----------
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("multi-user smoke test crashed:", err.message);
  process.exit(2);
});
