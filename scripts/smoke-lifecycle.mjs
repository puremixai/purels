// Lifecycle checks: bulk edits, destination checks and the per-account cap.
//
//   node scripts/smoke-lifecycle.mjs
//
// Talks straight to the Go API (default :8080). Every account it creates is
// named with a per-run stamp and removed again through psql at the end, because
// the API deliberately offers no way to delete an account.
//
// The cap check needs to know the value the API is running with; it defaults to
// the shipped 1000 and can be overridden with MAX_LINKS_PER_USER.
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS, MAX_LINKS_PER_USER

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me-now";
const MAX_LINKS = Number(process.env.MAX_LINKS_PER_USER || 1000);
const STAMP = Date.now().toString(36);

const TEST_IP = "203.0.113.30";
// Sign-up allows five attempts per minute per address.
const REG_IP = `198.18.${(Date.now() % 250) + 1}.31`;

const CAROL = `carol${STAMP}`;
const DAVE = `dave${STAMP}`;
const CAROL_PASS = "smoke-password-carol";
const DAVE_PASS = "smoke-password-dave";
const BULK_TAG = `bulktag${STAMP}`;
// .invalid is reserved and never resolves, so a check against it always ends in
// "could not connect" — the one outcome that does not depend on the network.
const UNREACHABLE = `https://unreachable-${STAMP}.invalid/`;

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
  return response;
}

async function register(session, username, password) {
  const response = await call(session, "/api/v1/auth/register", { method: "POST", ip: REG_IP, body: { username, password } });
  const payload = await json(response);
  if (response.status === 201) {
    session.csrf = payload.csrf_token || "";
    session.userId = payload.user?.id || "";
    session.role = payload.user?.role || "";
  }
  return response;
}

async function createLink(session, alias, destination) {
  const response = await call(session, "/api/v1/links", { method: "POST", body: { destination_url: destination, alias } });
  const payload = await json(response);
  return { status: response.status, link: payload.link };
}

async function getLink(session, id) {
  const response = await call(session, `/api/v1/links/${id}`);
  return { status: response.status, link: (await json(response)).link };
}

// Runs SQL against the compose database. Used for the two things the API has no
// endpoint for: removing a test account, and filling one to its link cap.
function psql(sql) {
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  try {
    execFileSync("docker", ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-q", "-c", sql], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const admin = newSession();
  const carol = newSession();
  const dave = newSession();

  const adminLogin = await signIn(admin, ADMIN_USER, ADMIN_PASS);
  record("the bootstrap account signs in as an administrator", adminLogin.status === 200 && admin.role === "admin", `status=${adminLogin.status} role=${admin.role}`);

  const carolReg = await register(carol, CAROL, CAROL_PASS);
  record("a regular account registers", carolReg.status === 201 && carol.role === "user", `status=${carolReg.status} role=${carol.role}`);

  const daveReg = await register(dave, DAVE, DAVE_PASS);
  record("a second account registers", daveReg.status === 201 && dave.role === "user", `status=${daveReg.status}`);

  // ---------- setup ----------
  const aliases = [`b1${STAMP}`, `b2${STAMP}`, `b3${STAMP}`];
  const links = [];
  for (const alias of aliases) {
    links.push((await createLink(carol, alias, `https://example.org/${alias}`)).link);
  }
  record("the owner creates three links", links.length === 3 && links.every((link) => Boolean(link?.id)), links.map((link) => link?.alias).join(","));

  const ids = links.map((link) => link.id);
  const bulk = (session, body) => call(session, "/api/v1/links/bulk", { method: "POST", body });

  // ---------- bulk status ----------
  const disabled = await bulk(carol, { action: "disable", ids });
  const disabledPayload = await json(disabled);
  const afterDisable = await Promise.all(ids.map((id) => getLink(carol, id)));
  record("bulk disable reports every link it changed", disabled.status === 200 && disabledPayload.affected === 3, `status=${disabled.status} affected=${disabledPayload.affected}`);
  record("bulk disable stops every selected link", afterDisable.every((item) => item.link?.status === "disabled"), afterDisable.map((item) => item.link?.status).join(","));

  const enabled = await bulk(carol, { action: "enable", ids });
  const enabledPayload = await json(enabled);
  const afterEnable = await Promise.all(ids.map((id) => getLink(carol, id)));
  record("bulk enable reports every link it changed", enabled.status === 200 && enabledPayload.affected === 3, `status=${enabled.status} affected=${enabledPayload.affected}`);
  record("bulk enable restarts every selected link", afterEnable.every((item) => item.link?.status === "active"), afterEnable.map((item) => item.link?.status).join(","));

  // ---------- bulk tags ----------
  const tagged = await bulk(carol, { action: "tag", ids, tags: [BULK_TAG] });
  const taggedPayload = await json(tagged);
  const afterTag = await Promise.all(ids.map((id) => getLink(carol, id)));
  const carolTags = await json(await call(carol, "/api/v1/tags"));
  record("bulk tag reports every link it changed", tagged.status === 200 && taggedPayload.affected === 3, `status=${tagged.status} affected=${taggedPayload.affected}`);
  record("bulk tag reaches every selected link", afterTag.every((item) => (item.link?.tags || []).includes(BULK_TAG)), afterTag.map((item) => (item.link?.tags || []).join("|")).join(" / "));
  record("the new tag shows up in the tag list", (carolTags.tags || []).some((tag) => tag.name === BULK_TAG), JSON.stringify(carolTags.tags));

  const untagged = await bulk(carol, { action: "untag", ids, tags: [BULK_TAG] });
  const untaggedPayload = await json(untagged);
  const afterUntag = await Promise.all(ids.map((id) => getLink(carol, id)));
  record("bulk untag reports every link it changed", untagged.status === 200 && untaggedPayload.affected === 3, `status=${untagged.status} affected=${untaggedPayload.affected}`);
  record("bulk untag reaches every selected link", afterUntag.every((item) => !(item.link?.tags || []).includes(BULK_TAG)), afterUntag.map((item) => (item.link?.tags || []).join("|")).join(" / "));

  // ---------- bulk expiry ----------
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const expiring = await bulk(carol, { action: "set_expiry", ids, expires_at: future });
  const expiringPayload = await json(expiring);
  const afterExpiry = await Promise.all(ids.map((id) => getLink(carol, id)));
  record("bulk set_expiry reports every link it changed", expiring.status === 200 && expiringPayload.affected === 3, `status=${expiring.status} affected=${expiringPayload.affected}`);
  record("bulk set_expiry dates every selected link", afterExpiry.every((item) => Boolean(item.link?.expires_at)), afterExpiry.map((item) => item.link?.expires_at || "none").join(","));

  const cleared = await bulk(carol, { action: "set_expiry", ids, expires_at: "" });
  const afterClear = await Promise.all(ids.map((id) => getLink(carol, id)));
  record("an empty expiry clears the date again", cleared.status === 200 && afterClear.every((item) => !item.link?.expires_at), afterClear.map((item) => item.link?.expires_at || "none").join(","));

  // ---------- ownership scoping ----------
  const foreignDelete = await json(await bulk(dave, { action: "delete", ids }));
  const foreignDisable = await json(await bulk(dave, { action: "disable", ids }));
  const survived = await Promise.all(ids.map((id) => getLink(carol, id)));
  record(
    "a batch of another account's ids changes nothing",
    foreignDelete.affected === 0 && foreignDisable.affected === 0,
    `delete=${foreignDelete.affected} disable=${foreignDisable.affected}`,
  );
  record("the other account's links are untouched", survived.every((item) => item.link?.status === "active"), survived.map((item) => item.link?.status).join(","));

  // ---------- rejected batches ----------
  const rejected = [
    ["an unknown action", { action: "explode", ids }],
    ["no ids", { action: "disable", ids: [] }],
    ["ids that are not uuids", { action: "disable", ids: ["not-a-uuid"] }],
    ["a tag batch with no tags", { action: "tag", ids, tags: [] }],
    ["a set_expiry batch with no date", { action: "set_expiry", ids }],
  ];
  for (const [label, body] of rejected) {
    const response = await bulk(carol, body);
    record(`a batch with ${label} is rejected`, response.status === 400, `status=${response.status}`);
  }

  // ---------- destination checks ----------
  const probeLink = (await createLink(carol, `probe${STAMP}`, UNREACHABLE)).link;
  const probe = await call(carol, `/api/v1/links/${probeLink.id}/check`, { method: "POST" });
  const probePayload = await json(probe);
  record("a destination check answers with a result", probe.status === 200 && Boolean(probePayload.checked_at), `status=${probe.status}`);

  const checked = await getLink(carol, probeLink.id);
  record(
    "an unreachable destination is recorded as status code 0",
    checked.link?.last_status_code === 0 && Boolean(checked.link?.last_checked_at),
    `status_code=${checked.link?.last_status_code} checked_at=${checked.link?.last_checked_at}`,
  );
  record("a failed check reports why", probePayload.status_code === 0 && Boolean(probePayload.error), `error=${probePayload.error || "none"}`);

  const foreignProbe = await call(dave, `/api/v1/links/${probeLink.id}/check`, { method: "POST" });
  record("another account cannot check a link it does not own", foreignProbe.status === 404, `status=${foreignProbe.status}`);

  const missingProbe = await call(carol, "/api/v1/links/3f2504e0-4f89-11d3-9a0c-0305e82c3301/check", { method: "POST" });
  record("checking a link that does not exist is a 404", missingProbe.status === 404, `status=${missingProbe.status}`);

  // ---------- bulk delete ----------
  const removed = await bulk(carol, { action: "delete", ids });
  const removedPayload = await json(removed);
  const listed = await json(await call(carol, `/api/v1/links?search=${STAMP}&limit=100`));
  const listedAliases = (listed.links || []).map((link) => link.alias);
  record("bulk delete reports every link it removed", removed.status === 200 && removedPayload.affected === 3, `status=${removed.status} affected=${removedPayload.affected}`);
  record("bulk delete removes every selected link from the list", !aliases.some((alias) => listedAliases.includes(alias)), listedAliases.join(","));
  const expandDeleted = await call(carol, `/api/v1/links/expand?url=${aliases[0]}`);
  record("a bulk-deleted code no longer resolves", expandDeleted.status === 404, `status=${expandDeleted.status}`);

  // ---------- per-account cap ----------
  // The cap counts live links, so it is checked last: filling the account would
  // otherwise disturb every count above.
  const filled = psql(
    `INSERT INTO links (alias, destination_url, user_id) SELECT 'q' || g::text || '${STAMP}', 'https://example.org/q' || g::text, '${carol.userId}' FROM generate_series(1, ${MAX_LINKS}) g;`,
  );
  record("the account can be filled to its cap", filled, filled ? `${MAX_LINKS} rows` : "psql unavailable");

  if (filled) {
    const overCap = await createLink(carol, `over${STAMP}`, `https://example.org/over-${STAMP}`);
    record("an account at its cap cannot create another link", overCap.status === 429, `status=${overCap.status}`);

    const generatedOverCap = await createLink(carol, "", `https://example.org/over2-${STAMP}`);
    record("the cap also applies to generated codes", generatedOverCap.status === 429, `status=${generatedOverCap.status}`);

    const adminCreate = await createLink(admin, `adminover${STAMP}`, `https://example.org/admin-over-${STAMP}`);
    record("an administrator is exempt from the cap", adminCreate.status === 201, `status=${adminCreate.status}`);

    const readBack = await getLink(carol, probeLink.id);
    record("an account over its cap can still read its own links", readBack.status === 200, `status=${readBack.status}`);
  }

  // ---------- cleanup ----------
  // The administrator's own link goes first: its alias contains the stamp, so it
  // would otherwise show up in the search below.
  psql(`DELETE FROM links WHERE alias = 'adminover${STAMP}';`);
  const purged = psql(`DELETE FROM admin_users WHERE username IN ('${CAROL}','${DAVE}');`);
  record("test accounts are removed", purged, purged ? `${CAROL}, ${DAVE}` : "psql unavailable — remove them by hand");

  if (purged) {
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
  console.error("lifecycle smoke test crashed:", err.message);
  process.exit(2);
});
