// Analytics settings: the tracking ids every page injects.
//
//   node scripts/smoke-analytics.mjs
//
// Talks straight to the Go API (default :8080) and signs in as the bootstrap
// administrator. Most of what it checks is validation, because these values are
// interpolated into an inline <script> that runs on every page the deployment
// serves: a value that got through would be stored XSS against visitors and the
// highest-privilege accounts alike, so the refusal cases matter more than the
// happy path.
//
// What is injected, and where, is smoke-pages.mjs's business — it is the suite
// with a browser. This one only proves what the API accepts and stores, and
// that the anonymous read the console's server render depends on works.
//
// The settings are a single row, so the run restores it to empty rather than
// deleting it, and removes the audit entries it wrote.
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me-now";

const EMPTY = {
  ga4_measurement_id: "",
  gtm_container_id: "",
  google_tag_id: "",
  matomo_url: "",
  matomo_site_id: "",
  clarity_project_id: "",
};

// The fields a save replaces, which is also what "nothing is configured" and
// "everything was cleared" have to cover.
const FIELDS = Object.keys(EMPTY);

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

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

async function call(session, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const cookie = cookieHeader(session);
  if (cookie) headers.set("Cookie", cookie);
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

// The API offers no endpoint that would clear a tracking id without also
// setting one, so the row goes back to empty through psql and the audit entries
// this run wrote go with it.
function psql(sql) {
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  try {
    return execFileSync(
      "docker",
      ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-t", "-A", "-c", sql],
      { stdio: "pipe" },
    )
      .toString()
      .trim();
  } catch {
    return null;
  }
}

async function save(session, body) {
  const response = await call(session, "/api/v1/analytics", { method: "PUT", body });
  return { response, payload: await json(response) };
}

async function main() {
  const admin = newSession();
  const login = await call(admin, "/api/v1/auth/login", { method: "POST", body: { username: ADMIN_USER, password: ADMIN_PASS } });
  const loginPayload = await json(login);
  if (loginPayload.csrf_token) admin.csrf = loginPayload.csrf_token;
  record("the administrator signs in", login.status === 200, `status=${login.status}`);

  // Start from a known state regardless of what an earlier run left behind.
  await save(admin, EMPTY);

  // ---------- the empty state ----------
  const initial = await json(await call(admin, "/api/v1/analytics"));
  const settings = initial.analytics || {};
  record(
    "an unconfigured deployment reads back as empty",
    FIELDS.every((key) => settings[key] === ""),
    JSON.stringify(settings),
  );

  // ---------- the happy path ----------
  const ga4 = await save(admin, { ...EMPTY, ga4_measurement_id: "g-abcde12345" });
  record(
    "a GA4 measurement id is stored, upper-cased",
    ga4.response.status === 200 && ga4.payload.analytics?.ga4_measurement_id === "G-ABCDE12345",
    `status=${ga4.response.status} value=${ga4.payload.analytics?.ga4_measurement_id}`,
  );

  const gtm = await save(admin, { ...EMPTY, gtm_container_id: "gtm-abc1234" });
  record(
    "a GTM container id is stored, upper-cased",
    gtm.response.status === 200 && gtm.payload.analytics?.gtm_container_id === "GTM-ABC1234",
    `status=${gtm.response.status} value=${gtm.payload.analytics?.gtm_container_id}`,
  );

  // The id this field exists for. It is a Google tag, not a container: the two
  // load through different scripts, which is why they are separate columns.
  const googleTag = await save(admin, { ...EMPTY, google_tag_id: "gt-mk52gbmx" });
  record(
    "a Google tag id is stored, upper-cased",
    googleTag.response.status === 200 && googleTag.payload.analytics?.google_tag_id === "GT-MK52GBMX",
    `status=${googleTag.response.status} value=${googleTag.payload.analytics?.google_tag_id}`,
  );

  // A container id in the Google tag column would inject a gtag.js load for
  // something that does not exist, so it is refused rather than folded.
  const containerInGoogleTag = await save(admin, { ...EMPTY, google_tag_id: "GTM-ABC1234" });
  record(
    "a GTM container id is refused by the Google tag field",
    containerInGoogleTag.response.status === 400,
    `status=${containerInGoogleTag.response.status}`,
  );

  const matomo = await save(admin, { ...EMPTY, matomo_url: "https://matomo.example.com///", matomo_site_id: "7" });
  record(
    "a Matomo base URL is stored without its trailing slashes",
    matomo.response.status === 200 && matomo.payload.analytics?.matomo_url === "https://matomo.example.com" && matomo.payload.analytics?.matomo_site_id === "7",
    `status=${matomo.response.status} url=${matomo.payload.analytics?.matomo_url}`,
  );

  const clarity = await save(admin, { ...EMPTY, clarity_project_id: "YMUTUPW1DP" });
  record(
    "a Clarity project id is stored, lower-cased",
    clarity.response.status === 200 && clarity.payload.analytics?.clarity_project_id === "ymutupw1dp",
    `status=${clarity.response.status} value=${clarity.payload.analytics?.clarity_project_id}`,
  );

  // ---------- what must never be stored ----------
  //
  // Each payload is a way to escape the JavaScript string literal the value is
  // embedded in, or the <script> element that literal sits inside.
  //
  // The row is emptied first so that the check below it can tell "nothing was
  // stored" from "the happy path above stored something".
  await save(admin, EMPTY);

  const injections = [
    { field: "ga4_measurement_id", value: `G-1"><script>alert(1)</script>` },
    { field: "ga4_measurement_id", value: `G-1</script><img src=x>` },
    { field: "ga4_measurement_id", value: `G-1'</script>` },
    { field: "gtm_container_id", value: `GTM-1</script>` },
    { field: "gtm_container_id", value: `GTM-1\n<script>alert(1)</script>` },
    { field: "google_tag_id", value: `GT-1</script><img src=x>` },
    { field: "google_tag_id", value: `GT-1";alert(1);//` },
    { field: "clarity_project_id", value: `ymutup</script>` },
    { field: "clarity_project_id", value: `ymutup'+(alert(1))+&apos;` },
    { field: "clarity_project_id", value: `ymutup/w1dp` },
    { field: "matomo_site_id", value: `1"><script>alert(1)</script>` },
    { field: "matomo_url", value: `javascript:alert(1)` },
    { field: "matomo_url", value: `http://matomo.example/"><script>alert(1)</script>` },
    { field: "matomo_url", value: `http://matomo.example/?a=<script>` },
    { field: "matomo_url", value: `http://user:pass@matomo.example/` },
    { field: "matomo_url", value: `data:text/html,<script>alert(1)</script>` },
  ];
  for (const { field, value } of injections) {
    const body = { ...EMPTY, [field]: value };
    // A Matomo site id is only reachable when there is a URL: with none, the
    // field is dropped rather than validated, because clearing the URL is how
    // Matomo is turned off. So the payload needs a URL to be exercised at all.
    if (field === "matomo_url") body.matomo_site_id = "1";
    if (field === "matomo_site_id") body.matomo_url = "https://matomo.example.com";
    const attempt = await save(admin, body);
    record(`the API refuses ${field}=${JSON.stringify(value).slice(0, 44)}`, attempt.response.status === 400, `status=${attempt.response.status}`);
  }

  // The refused writes must not have stored anything along the way.
  const afterInjections = await json(await call(admin, "/api/v1/analytics"));
  const survivors = FIELDS.filter((key) => (afterInjections.analytics || {})[key] !== "");
  record("no refused value reached the database", survivors.length === 0, survivors.join(",") || "all empty");

  // A payload parked in the site id while there is no URL is dropped rather than
  // refused, so this proves the drop is not a way to store one.
  const droppedPayload = await save(admin, { ...EMPTY, matomo_site_id: `1"><script>alert(1)</script>` });
  const afterDrop = await json(await call(admin, "/api/v1/analytics"));
  record(
    "a payload in an unreachable site id is dropped, not stored",
    droppedPayload.response.status === 200 && afterDrop.analytics?.matomo_site_id === "",
    `status=${droppedPayload.response.status} site=${JSON.stringify(afterDrop.analytics?.matomo_site_id)}`,
  );

  // ---------- the two-field rule ----------
  const urlWithoutSite = await save(admin, { ...EMPTY, matomo_url: "https://matomo.example.com" });
  record("a Matomo URL without a site id is refused", urlWithoutSite.response.status === 400, `status=${urlWithoutSite.response.status}`);

  const siteWithoutURL = await save(admin, { ...EMPTY, matomo_site_id: "7" });
  record(
    "a site id without a URL is dropped rather than refused",
    siteWithoutURL.response.status === 200 && siteWithoutURL.payload.analytics?.matomo_site_id === "",
    `status=${siteWithoutURL.response.status} site=${siteWithoutURL.payload.analytics?.matomo_site_id}`,
  );

  // ---------- all five at once, then back to empty ----------
  const everything = await save(admin, {
    ga4_measurement_id: "G-ABCDE12345",
    gtm_container_id: "GTM-ABC1234",
    google_tag_id: "GT-MK52GBMX",
    matomo_url: "https://matomo.example.com",
    matomo_site_id: "7",
    clarity_project_id: "ymutupw1dp",
  });
  const reread = await json(await call(admin, "/api/v1/analytics"));
  record(
    "all five providers can be configured together",
    everything.response.status === 200 &&
      reread.analytics?.ga4_measurement_id === "G-ABCDE12345" &&
      reread.analytics?.gtm_container_id === "GTM-ABC1234" &&
      reread.analytics?.google_tag_id === "GT-MK52GBMX" &&
      reread.analytics?.matomo_url === "https://matomo.example.com" &&
      reread.analytics?.matomo_site_id === "7" &&
      reread.analytics?.clarity_project_id === "ymutupw1dp",
    JSON.stringify(reread.analytics || {}),
  );

  // The console's own server render reads the ids before anybody has signed in
  // — that is what makes the landing page, sign-in and registration carry the
  // trackers — so this has to answer without a session, and without a wrapper
  // the parser would read past.
  const anonymous = newSession();
  const publicRead = await call(anonymous, "/api/v1/analytics/public");
  const publicPayload = await json(publicRead);
  record(
    "the tracking ids are readable without a session",
    publicRead.status === 200 &&
      publicPayload.google_tag_id === "GT-MK52GBMX" &&
      publicPayload.clarity_project_id === "ymutupw1dp" &&
      publicPayload.analytics === undefined,
    `status=${publicRead.status} ${JSON.stringify(publicPayload)}`,
  );

  // A save is a change worth attributing: the values run as script in every
  // visitor's browser.
  const trail = await json(await call(admin, "/api/v1/audit?action=analytics.update&limit=5"));
  record(
    "the change is recorded in the audit trail",
    (trail.entries || []).length > 0,
    `${(trail.entries || []).length} entries`,
  );

  const cleared = await save(admin, EMPTY);
  const afterClear = await json(await call(admin, "/api/v1/analytics"));
  record(
    "clearing every field turns all five off",
    cleared.response.status === 200 && FIELDS.every((key) => afterClear.analytics?.[key] === ""),
    JSON.stringify(afterClear.analytics || {}),
  );
}

main()
  .catch((err) => {
    record("the suite ran to completion", false, err.message);
  })
  .then(() => {
    // Restore the baseline: the row stays, empty, and this run's audit entries
    // go. The row must not be deleted — the console's first read assumes it is
    // there.
    const restored = psql(
      `UPDATE analytics_settings SET ga4_measurement_id=NULL, gtm_container_id=NULL, google_tag_id=NULL, matomo_url=NULL, matomo_site_id=NULL, clarity_project_id=NULL WHERE id=1;
       DELETE FROM audit_logs WHERE action = 'analytics.update';`,
    );
    record("the settings row is restored to empty", restored !== null, restored === null ? "psql unavailable — clear it by hand" : "restored");

    let failed = 0;
    for (const r of results) {
      if (!r.ok) failed++;
      console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });
