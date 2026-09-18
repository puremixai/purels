// Proves that STATS_TZ actually drives day bucketing end to end.
//
// A click is planted at 2026-09-17T23:30:00Z — an instant that is the 17th in
// UTC but the 18th in Asia/Shanghai. The worker buckets it via `occurred_at::date`
// in its session TimeZone, so the day the stats endpoint reports tells you which
// zone the whole chain is running in.
//
//   node scripts/check-stats-tz.mjs          # after a UTC stack
//   node scripts/check-stats-tz.mjs          # after an Asia/Shanghai stack
//
// Prints the observed day; the caller asserts it matches the configured zone.

import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const USER = process.env.ADMIN_USER || "admin";
const PASS = process.env.ADMIN_PASS || "change-me-now";
const COMPOSE = ["-f", "deploy/compose.yaml"];

// 23:30Z on the 17th: the 17th in UTC, already the 18th in Asia/Shanghai.
const OCCURRED_AT = "2026-09-17 23:30:00+00";
const RANGE = { from: "2026-09-17", to: "2026-09-18" };

const cookies = new Map();

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "") cookies.delete(name);
    else cookies.set(name, value);
  }
}

async function call(path, { method = "GET", body, csrf } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookieHeader()) headers.set("Cookie", cookieHeader());
  if (csrf) headers.set("X-CSRF-Token", csrf);
  headers.set("X-Forwarded-For", "203.0.113.77");
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  captureCookies(response);
  return response;
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["compose", ...COMPOSE, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}

async function main() {
  const login = await call("/api/v1/auth/login", { method: "POST", body: { username: USER, password: PASS } });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const csrf = (await login.json()).csrf_token;

  const destination = `https://example.org/tz-${Date.now().toString(36)}`;
  const created = await call("/api/v1/links", { method: "POST", csrf, body: { destination_url: destination } });
  if (!created.ok) throw new Error(`create failed: ${created.status} ${await created.text()}`);
  const link = (await created.json()).link;

  psql(
    `INSERT INTO click_events (link_id, occurred_at, referrer, user_agent) VALUES ('${link.id}', '${OCCURRED_AT}', '', 'tz-probe')`,
  );

  // The worker ticks every 5s; poll so a slow batch cannot produce a false miss.
  let daily = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(5000);
    const stats = await call(`/api/v1/links/${link.id}/stats?from=${RANGE.from}&to=${RANGE.to}`);
    if (!stats.ok) throw new Error(`stats failed: ${stats.status}`);
    daily = (await stats.json()).stats.daily ?? [];
    if (daily.length > 0) break;
  }

  if (daily.length === 0) {
    console.log("RESULT day=none clicks=0 (click never rolled up)");
    process.exitCode = 1;
    return;
  }
  const day = daily[0].day.slice(0, 10);
  console.log(`RESULT day=${day} clicks=${daily[0].clicks} alias=${link.alias}`);

  psql(`DELETE FROM link_click_daily WHERE link_id='${link.id}'; DELETE FROM click_events WHERE link_id='${link.id}'; DELETE FROM links WHERE id='${link.id}';`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
});
