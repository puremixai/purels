// API-level checks for pagination, token scopes, rate limiting, statistics and QR codes.
// Talks straight to the Go API (default :8080) so the X-Forwarded-For header can be
// controlled to isolate rate-limit buckets.
//
//   node scripts/smoke-api.mjs
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS

import { setTimeout as sleep } from "node:timers/promises";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const USER = process.env.ADMIN_USER || "admin";
const PASS = process.env.ADMIN_PASS || "change-me-now";
const TEST_IP = "203.0.113.10";
// Fresh bucket per run so a previous run's window cannot mask the result.
const RATE_IP = `198.51.100.${(Date.now() % 200) + 1}`;
const STAMP = Date.now().toString(36);
// A marker no real browser sends, so a divert rule keyed on it cannot be
// tripped by the client's own user agent.
const RULE_UA = `smoke-ua-${STAMP}`;

const cookies = new Map();
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

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

async function call(path, { ip = TEST_IP, ...options } = {}) {
  const headers = new Headers(options.headers);
  // A string body is already serialised (CSV uploads); everything else is JSON.
  const raw = typeof options.body === "string";
  if (options.body !== undefined && !raw) headers.set("Content-Type", "application/json");
  if (cookieHeader()) headers.set("Cookie", cookieHeader());
  headers.set("X-Forwarded-For", ip);
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : raw ? options.body : JSON.stringify(options.body),
    redirect: "manual",
  });
  captureCookies(response);
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

async function login() {
  const response = await call("/api/v1/auth/login", { method: "POST", body: { username: USER, password: PASS } });
  const payload = await json(response);
  if (response.status !== 200) throw new Error(`login failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload.csrf_token;
}

async function main() {
  const csrf = await login();

  // ---------- pagination, sorting, filtering ----------
  const seeded = [];
  for (let i = 0; i < 3; i++) {
    const response = await call("/api/v1/links", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: { destination_url: `https://example.org/page-${i}`, alias: `api${STAMP}${i}` },
    });
    if (response.status === 201) seeded.push(`api${STAMP}${i}`);
  }
  record("seed links", seeded.length === 3, `${seeded.length}/3 created`);

  const page1 = await json(await call("/api/v1/links?limit=2&offset=0&sort=created_at_desc"));
  record("pagination limit", Array.isArray(page1.links) && page1.links.length <= 2, `returned ${page1.links?.length}`);
  record("pagination total", typeof page1.total === "number" && page1.total >= 3, `total=${page1.total}`);
  record("pagination offset", page1.offset === 0 && page1.limit === 2, `limit=${page1.limit} offset=${page1.offset}`);

  const page2 = await json(await call("/api/v1/links?limit=2&offset=2&sort=created_at_desc"));
  const firstIds = new Set((page1.links || []).map((l) => l.id));
  const overlap = (page2.links || []).filter((l) => firstIds.has(l.id));
  record("pagination offset excludes page 1", overlap.length === 0, `overlap=${overlap.length}`);

  const byAlias = await json(await call(`/api/v1/links?sort=alias_asc&search=api${STAMP}`));
  const aliases = (byAlias.links || []).map((l) => l.alias);
  const sorted = [...aliases].sort();
  record("sort alias_asc", JSON.stringify(aliases) === JSON.stringify(sorted), aliases.join(","));

  const byClicks = await json(await call("/api/v1/links?sort=clicks_desc&limit=5"));
  const counts = (byClicks.links || []).map((l) => l.clicks ?? 0);
  record("sort clicks_desc", counts.every((value, i) => i === 0 || counts[i - 1] >= value), counts.join(","));
  record("list exposes clicks", (byClicks.links || []).every((l) => typeof l.clicks === "number"), "clicks present on every row");

  const active = await json(await call("/api/v1/links?status=active"));
  record("status filter active", (active.links || []).every((l) => l.status === "active"), `${active.links?.length} rows`);

  const badSort = await call("/api/v1/links?sort=id;DROP%20TABLE%20links--");
  record("unknown sort is rejected safely", badSort.status === 200, `status=${badSort.status}`);

  // ---------- titles and tags ----------
  // The alias carries the run stamp so the cleanup sweep at the end finds it.
  const taggedAlias = `api${STAMP}tag`;
  const taggedCreated = await json(
    await call("/api/v1/links", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: {
        destination_url: "https://example.org/tagged",
        alias: taggedAlias,
        title: "Release notes",
        // Mixed case, padding and a duplicate must all collapse to ["docs","news"].
        tags: ["News", " news ", "docs"],
      },
    }),
  );
  const taggedLink = taggedCreated.link;
  record("title is stored", taggedLink?.title === "Release notes", `title=${JSON.stringify(taggedLink?.title)}`);
  record(
    "tags are trimmed, lowercased and de-duped",
    JSON.stringify([...(taggedLink?.tags || [])].sort()) === JSON.stringify(["docs", "news"]),
    JSON.stringify(taggedLink?.tags),
  );

  if (taggedLink?.id) {
    const reread = await json(await call(`/api/v1/links/${taggedLink.id}`));
    record(
      "tags survive a re-read in stable order",
      JSON.stringify(reread.link?.tags) === JSON.stringify(["docs", "news"]),
      JSON.stringify(reread.link?.tags),
    );
  }

  const byTag = await json(await call(`/api/v1/links?tag=news&search=${STAMP}`));
  record("tag filter matches", (byTag.links || []).some((l) => l.alias === taggedAlias), `${byTag.links?.length} rows`);
  record(
    "tag filter excludes untagged links",
    (byTag.links || []).length > 0 && (byTag.links || []).every((l) => (l.tags || []).includes("news")),
    `${byTag.links?.length} rows`,
  );

  const byTitle = await json(await call("/api/v1/links?search=Release%20notes"));
  record("search matches the title", (byTitle.links || []).some((l) => l.alias === taggedAlias), `${byTitle.links?.length} rows`);

  const vocabulary = await json(await call("/api/v1/tags"));
  const newsTag = (vocabulary.tags || []).find((t) => t.name === "news");
  record("tag vocabulary lists the tag", Boolean(newsTag) && newsTag.links >= 1, JSON.stringify(newsTag));

  if (taggedLink?.id) {
    const retagged = await json(
      await call(`/api/v1/links/${taggedLink.id}`, {
        method: "PATCH",
        headers: { "X-CSRF-Token": csrf },
        body: { title: "Updated title", tags: ["docs"] },
      }),
    );
    record("update replaces the tag set", JSON.stringify(retagged.link?.tags) === JSON.stringify(["docs"]), JSON.stringify(retagged.link?.tags));
    record("update replaces the title", retagged.link?.title === "Updated title", JSON.stringify(retagged.link?.title));

    const cleared = await json(
      await call(`/api/v1/links/${taggedLink.id}`, {
        method: "PATCH",
        headers: { "X-CSRF-Token": csrf },
        body: { tags: [] },
      }),
    );
    record("an empty tag list clears the tags", Array.isArray(cleared.link?.tags) && cleared.link.tags.length === 0, JSON.stringify(cleared.link?.tags));
  }

  const badTag = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: "https://example.org/bad-tag", alias: `api${STAMP}bad`, tags: ["has spaces"] },
  });
  record("a tag with spaces is rejected", badTag.status === 400, `status=${badTag.status}`);

  const longTitle = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: "https://example.org/long-title", alias: `api${STAMP}long`, title: "x".repeat(256) },
  });
  record("an over-long title is rejected", longTitle.status === 400, `status=${longTitle.status}`);

  // ---------- CSV import and export ----------
  // Lines 2-4 are valid; lines 5-7 each fail for a different reason.
  const csvBody = [
    "alias,destination_url,title,tags,redirect_code",
    `api${STAMP}csv1,https://example.org/csv-1,CSV 一,news|docs,301`,
    `api${STAMP}csv2,https://example.org/csv-2,CSV 二,,302`,
    // Blank alias, so this is the one row that goes through the UNIQUE_URLS
    // lookup. Keep its destination run-unique, otherwise a leftover link to the
    // same URL is reused and no fresh alias is generated to assert on.
    `,https://example.org/auto-${STAMP},api${STAMP}auto,,302`,
    `api${STAMP}csv3,not-a-url,CSV 三,,302`,
    `api${STAMP}csv4,https://example.org/csv-4,CSV 四,,abc`,
    `api${STAMP}csv5,https://example.org/csv-5,CSV 五,,999`,
  ].join("\r\n");

  const imported = await json(
    await call("/api/v1/links/import", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
      body: csvBody,
    }),
  );
  record("import creates the valid rows", imported.created === 3, `created=${imported.created} failed=${imported.failed}`);
  record("import rejects the invalid rows", imported.failed === 3, JSON.stringify(imported.errors));
  record(
    "import errors carry the source line",
    (imported.errors || []).map((e) => e.line).join(",") === "5,6,7",
    (imported.errors || []).map((e) => `${e.line}:${e.reason}`).join(" | "),
  );

  const csvList = await json(await call(`/api/v1/links?search=${STAMP}&limit=100`));
  const csvOne = (csvList.links || []).find((l) => l.alias === `api${STAMP}csv1`);
  record(
    "imported link keeps its title and tags",
    csvOne?.title === "CSV 一" && JSON.stringify(csvOne?.tags) === JSON.stringify(["docs", "news"]),
    JSON.stringify({ title: csvOne?.title, tags: csvOne?.tags }),
  );
  const csvTwo = (csvList.links || []).find((l) => l.alias === `api${STAMP}csv2`);
  record("import defaults the redirect code", csvTwo?.redirect_code === 302, `code=${csvTwo?.redirect_code}`);
  const csvAuto = (csvList.links || []).find((l) => l.title === `api${STAMP}auto`);
  record("import generates an alias when the column is blank", Boolean(csvAuto?.alias) && csvAuto.alias.length === 8, `alias=${csvAuto?.alias}`);

  const exported = await call(`/api/v1/links/export?search=${STAMP}`);
  const csvText = (await exported.text()).replace(/^\uFEFF/, "");
  const csvLines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
  record(
    "export returns a csv download",
    exported.status === 200 &&
      (exported.headers.get("content-type") || "").includes("text/csv") &&
      (exported.headers.get("content-disposition") || "").includes("attachment"),
    `status=${exported.status} type=${exported.headers.get("content-type")}`,
  );
  record("export writes the header row", csvLines[0] === "alias,destination_url,title,tags,redirect_code", csvLines[0]);
  const exportedOne = csvLines.find((line) => line.startsWith(`api${STAMP}csv1,`));
  record(
    "export round-trips title, tags and code",
    Boolean(exportedOne) && exportedOne.includes("CSV 一") && exportedOne.includes("docs|news") && exportedOne.endsWith(",301"),
    exportedOne || "row missing",
  );

  const tagExport = await call("/api/v1/links/export?tag=docs");
  const tagLines = (await tagExport.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  record(
    "export honours the tag filter",
    tagLines.slice(1).length > 0 && tagLines.slice(1).every((line) => line.includes("docs")),
    `${tagLines.length - 1} data rows`,
  );

  const noUrlColumn = await call("/api/v1/links/import", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf, "Content-Type": "text/csv" },
    body: "alias,title\nfoo,bar",
  });
  record("import rejects a file without a destination column", noUrlColumn.status === 400, `status=${noUrlColumn.status}`);

  // ---------- expand ----------
  const expanded = await json(await call(`/api/v1/links/expand?url=${taggedAlias}`));
  record("expand resolves a bare code", expanded.link?.alias === taggedAlias, `alias=${expanded.link?.alias}`);

  const asUrl = await json(await call(`/api/v1/links/expand?url=${encodeURIComponent(`http://localhost:8080/${taggedAlias}`)}`));
  record("expand resolves a full short URL", asUrl.link?.alias === taggedAlias, `alias=${asUrl.link?.alias}`);

  const foreign = await call(`/api/v1/links/expand?url=${encodeURIComponent(`https://evil.example/${taggedAlias}`)}`);
  record("expand refuses a foreign host", foreign.status === 400, `status=${foreign.status}`);

  const unknownCode = await call(`/api/v1/links/expand?url=${STAMP}nosuch`);
  record("expand 404s for an unknown code", unknownCode.status === 404, `status=${unknownCode.status}`);

  // Regression: GetLinkByAlias used to ignore deleted_at, so a retired code
  // still resolved even though the redirect refused it.
  const doomed = await json(
    await call("/api/v1/links", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: { destination_url: `https://example.org/api${STAMP}doomed`, alias: `api${STAMP}doomed` },
    }),
  );
  await call(`/api/v1/links/${doomed.link?.id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
  const expandDeleted = await call(`/api/v1/links/expand?url=api${STAMP}doomed`);
  record("expand does not resolve a deleted link", expandDeleted.status === 404, `status=${expandDeleted.status}`);
  const redirectDeleted = await call(`/api${STAMP}doomed`);
  record("redirect does not resolve a deleted link", redirectDeleted.status === 404, `status=${redirectDeleted.status}`);

  // ---------- case-insensitive aliases ----------
  const mixedAlias = `Api${STAMP}Case`;
  const mixedCreate = await json(
    await call("/api/v1/links", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: { destination_url: `https://example.org/case-${STAMP}`, alias: mixedAlias },
    }),
  );
  record("an alias is stored lower-cased", mixedCreate.link?.alias === mixedAlias.toLowerCase(), `alias=${mixedCreate.link?.alias}`);

  const upperLookup = await call(`/${mixedAlias.toUpperCase()}`);
  record("a short code resolves in any casing", upperLookup.status === 302, `status=${upperLookup.status}`);

  const upperDupe = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: `https://example.org/case-${STAMP}-2`, alias: mixedAlias.toUpperCase() },
  });
  record("a differing case is the same alias", upperDupe.status === 409, `status=${upperDupe.status}`);

  // ---------- query string forwarding ----------
  const forwarded = await call(`/${taggedAlias}?utm_source=news&x=1`);
  const location = forwarded.headers.get("location") || "";
  record("the visitor query string is forwarded", forwarded.status === 302 && location.includes("?utm_source=news&x=1"), location || "no location");

  // ---------- divert rules ----------
  // A rule sends a matching visitor elsewhere. Its destination goes through the
  // same validation as the link's own, denylist included.
  const ruleAlias = `api${STAMP}rules`;
  const ruleCreate = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: {
      destination_url: "https://example.org/rule-default",
      alias: ruleAlias,
      rules: [
        { match_type: "ua_contains", match_value: RULE_UA, destination_url: "https://example.org/rule-ua" },
        { match_type: "device", match_value: "tablet", destination_url: "https://example.org/rule-tablet", redirect_code: 301 },
      ],
    },
  });
  const ruleBody = await json(ruleCreate);
  const ruleID = ruleBody.link?.id;
  record(
    "a link is created with divert rules",
    ruleCreate.status === 201 && ruleBody.link?.rules?.length === 2,
    `status=${ruleCreate.status} rules=${ruleBody.link?.rules?.length}`,
  );
  // Position comes from the list order, and a rule with no code of its own reads
  // back as 0, which means "inherit the link's".
  const ruleShape = (ruleBody.link?.rules || []).map((rule) => `${rule.position}:${rule.redirect_code}`);
  record(
    "rules keep their order and inherit the link's code",
    ruleShape.join(",") === "0:0,1:301",
    ruleShape.join(",") || "no rules",
  );

  const rulesSingle = await json(await call(`/api/v1/links/${ruleID}`));
  record("a single-link read carries the rules", rulesSingle.link?.rules?.length === 2, `${rulesSingle.link?.rules?.length} rules`);
  const rulesList = await json(await call(`/api/v1/links?search=${ruleAlias}`));
  record("the list does not carry rules", rulesList.links?.[0]?.rules === undefined, `rules=${JSON.stringify(rulesList.links?.[0]?.rules)}`);

  const ruleHit = await call(`/${ruleAlias}`, { headers: { "User-Agent": RULE_UA } });
  record(
    "a matching user agent is diverted",
    ruleHit.status === 302 && ruleHit.headers.get("location") === "https://example.org/rule-ua",
    `${ruleHit.status} -> ${ruleHit.headers.get("location")}`,
  );
  const deviceHit = await call(`/${ruleAlias}`, { headers: { "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari" } });
  record(
    "a device rule fires and uses its own code",
    deviceHit.status === 301 && deviceHit.headers.get("location") === "https://example.org/rule-tablet",
    `${deviceHit.status} -> ${deviceHit.headers.get("location")}`,
  );
  const ruleMiss = await call(`/${ruleAlias}`, { headers: { "User-Agent": "smoke-plain-agent" } });
  record(
    "an unmatched visitor keeps the link's destination",
    ruleMiss.status === 302 && ruleMiss.headers.get("location") === "https://example.org/rule-default",
    `${ruleMiss.status} -> ${ruleMiss.headers.get("location")}`,
  );

  // The preview page is what a trailing "+" asks for. Opening one is not a
  // visit, so the click log must not move.
  const clicksBefore = (await json(await call(`/api/v1/links/${ruleID}/clicks?from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`))).total;
  const preview = await call(`/${ruleAlias}+`, { headers: { "User-Agent": "smoke-plain-agent" } });
  const previewHTML = await preview.text();
  record(
    "the preview page is html",
    (preview.headers.get("content-type") || "").includes("text/html") && previewHTML.includes("<!doctype html>"),
    preview.headers.get("content-type") || "no content-type",
  );
  record("the preview page shows the destination", previewHTML.includes("https://example.org/rule-default"), `${previewHTML.length} bytes`);
  record(
    "the preview page stays out of search results",
    preview.headers.get("x-robots-tag") === "noindex, nofollow" && preview.headers.get("cache-control") === "no-store",
    `${preview.headers.get("x-robots-tag")} / ${preview.headers.get("cache-control")}`,
  );
  await call(`/${ruleAlias}+`);
  await call(`/${ruleAlias}+`);
  const clicksAfter = (await json(await call(`/api/v1/links/${ruleID}/clicks?from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`))).total;
  record("the preview page is not counted", clicksAfter === clicksBefore, `${clicksBefore} -> ${clicksAfter}`);

  // An update that says nothing about rules must leave them alone; an empty list
  // is the instruction to remove them all.
  const titleOnly = await json(
    await call(`/api/v1/links/${ruleID}`, { method: "PATCH", headers: { "X-CSRF-Token": csrf }, body: { title: "rule smoke" } }),
  );
  record("an update without rules leaves them alone", titleOnly.link?.rules?.length === 2, `${titleOnly.link?.rules?.length} rules`);
  const cleared = await json(
    await call(`/api/v1/links/${ruleID}`, { method: "PATCH", headers: { "X-CSRF-Token": csrf }, body: { rules: [] } }),
  );
  record("an empty rule list removes every rule", cleared.link?.rules === undefined || cleared.link?.rules.length === 0, JSON.stringify(cleared.link?.rules));
  // The redirect has to follow too, which is what proves the cache was dropped.
  const afterClearing = await call(`/${ruleAlias}`, { headers: { "User-Agent": RULE_UA } });
  record(
    "clearing the rules restores the default destination",
    afterClearing.headers.get("location") === "https://example.org/rule-default",
    `${afterClearing.status} -> ${afterClearing.headers.get("location")}`,
  );

  // ---------- rule validation ----------
  // Each case gets its own alias so a wrongly accepted rule cannot make the next
  // one fail with a conflict instead of the status being checked.
  let rejected = 0;
  const rejectRule = async (name, rules) => {
    const index = rejected++;
    const response = await call("/api/v1/links", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: { destination_url: "https://example.org/rule-reject", alias: `api${STAMP}rej${index}`, rules },
    });
    record(name, response.status === 400, `status=${response.status}`);
  };
  await rejectRule("an unknown match type is rejected", [{ match_type: "ua_regex", match_value: ".*", destination_url: "https://example.org/x" }]);
  await rejectRule("a blank match value is rejected", [{ match_type: "ua_contains", match_value: "   ", destination_url: "https://example.org/x" }]);
  await rejectRule("an unknown device is rejected", [{ match_type: "device", match_value: "phone", destination_url: "https://example.org/x" }]);
  await rejectRule("a rule destination that is not a URL is rejected", [{ match_type: "ua_contains", match_value: "x", destination_url: "javascript:alert(1)" }]);
  await rejectRule("a rule with a bad redirect code is rejected", [
    { match_type: "ua_contains", match_value: "x", destination_url: "https://example.org/x", redirect_code: 307 },
  ]);
  await rejectRule(
    "more than ten rules are rejected",
    Array.from({ length: 11 }, (_, i) => ({ match_type: "ua_contains", match_value: "x", destination_url: `https://example.org/${i}` })),
  );

  // A disabled link has no preview page, exactly as it has no redirect.
  await call(`/api/v1/links/${ruleID}`, { method: "PATCH", headers: { "X-CSRF-Token": csrf }, body: { status: "disabled" } });
  const disabledPreview = await call(`/${ruleAlias}+`);
  record("a disabled link has no preview page", disabledPreview.status === 404, `status=${disabledPreview.status}`);
  const disabledRedirect = await call(`/${ruleAlias}`);
  record("a disabled link stops redirecting", disabledRedirect.status === 404, `status=${disabledRedirect.status}`);

  // ---------- UNIQUE_URLS ----------
  const destination = `https://example.org/api${STAMP}unique`;
  const firstCreate = await call("/api/v1/links", { method: "POST", headers: { "X-CSRF-Token": csrf }, body: { destination_url: destination } });
  const firstBody = await json(firstCreate);
  record("a new destination mints a link", firstCreate.status === 201 && Boolean(firstBody.link?.id), `status=${firstCreate.status}`);

  const secondCreate = await call("/api/v1/links", { method: "POST", headers: { "X-CSRF-Token": csrf }, body: { destination_url: destination } });
  const secondBody = await json(secondCreate);
  record(
    "re-shortening the same destination reuses the code",
    secondCreate.status === 200 && secondBody.link?.id === firstBody.link?.id,
    `status=${secondCreate.status} same=${secondBody.link?.id === firstBody.link?.id}`,
  );

  const thirdCreate = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: destination, alias: `api${STAMP}uniq` },
  });
  const thirdBody = await json(thirdCreate);
  record(
    "an explicit alias still creates a second link",
    thirdCreate.status === 201 && thirdBody.link?.id !== firstBody.link?.id,
    `status=${thirdCreate.status} distinct=${thirdBody.link?.id !== firstBody.link?.id}`,
  );

  // A link that can no longer be resolved must not be handed back as a reusable
  // code, or re-shortening the destination would return a dead short URL.
  await call(`/api/v1/links/${firstBody.link?.id}`, { method: "PATCH", headers: { "X-CSRF-Token": csrf }, body: { status: "disabled" } });
  const afterDisable = await call("/api/v1/links", { method: "POST", headers: { "X-CSRF-Token": csrf }, body: { destination_url: destination } });
  const afterDisableBody = await json(afterDisable);
  record(
    "a disabled link is not reused as a code",
    afterDisableBody.link?.id !== firstBody.link?.id,
    `status=${afterDisable.status} reused=${afterDisableBody.link?.id === firstBody.link?.id}`,
  );

  // ---------- audit trail ----------
  // Drive one full create/update/delete cycle so the assertions do not depend on
  // entries left behind by an earlier run.
  const audited = await json(
    await call("/api/v1/links", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: { destination_url: "https://example.org/audited", alias: `api${STAMP}audit`, title: "audited" },
    }),
  );
  const auditedId = audited.link?.id;
  await call(`/api/v1/links/${auditedId}`, { method: "PATCH", headers: { "X-CSRF-Token": csrf }, body: { title: "audited v2" } });
  await call(`/api/v1/links/${auditedId}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });

  const audit = await json(await call("/api/v1/audit?limit=50"));
  record("audit trail is readable", Array.isArray(audit.entries) && audit.total > 0, `${audit.entries?.length} of ${audit.total}`);

  const forResource = (audit.entries || []).filter((e) => e.resource_id === auditedId);
  record(
    "audit records create, update and delete for one resource",
    ["link.create", "link.update", "link.delete"].every((name) => forResource.some((e) => e.action === name)),
    forResource.map((e) => e.action).join(",") || "no entries for the resource",
  );
  record(
    "audit attributes the actor and resource type",
    forResource.length > 0 && forResource.every((e) => e.username === "admin" && e.resource_type === "link"),
    JSON.stringify(forResource.map((e) => [e.username, e.resource_type])),
  );

  const actions = new Set((audit.entries || []).map((e) => e.action));
  record("audit records the login", actions.has("session.login"), [...actions].sort().join(","));

  const importAudit = await json(await call("/api/v1/audit?action=link.import&limit=5"));
  record(
    "audit can be filtered by action",
    (importAudit.entries || []).length > 0 && (importAudit.entries || []).every((e) => e.action === "link.import"),
    `${importAudit.entries?.length} entries of ${importAudit.total}`,
  );
  record(
    "audit captures the import outcome",
    importAudit.entries?.[0]?.metadata?.created === 3 && importAudit.entries?.[0]?.metadata?.failed === 3,
    JSON.stringify(importAudit.entries?.[0]?.metadata),
  );

  // ---------- statistics ----------
  const target = (page1.links || [])[0];
  const summary = await json(await call("/api/v1/stats/summary"));
  record("stats summary", typeof summary.total_links === "number" && typeof summary.total_clicks === "number", JSON.stringify(summary));

  const top = await call("/api/v1/stats/top?order=top&limit=5");
  record("stats top", top.status === 200, `status=${top.status}`);

  const bottom = await call("/api/v1/stats/top?order=bottom&limit=5");
  record("stats bottom", bottom.status === 200, `status=${bottom.status}`);

  if (target) {
    const stats = await json(await call(`/api/v1/links/${target.id}/stats`));
    const ok = typeof stats.stats?.total_clicks === "number" && Array.isArray(stats.stats?.daily) && Array.isArray(stats.stats?.referrers);
    record("per-link stats shape", ok, JSON.stringify({ total: stats.stats?.total_clicks, daily: stats.stats?.daily?.length, referrers: stats.stats?.referrers?.length }));
  }

  // ---------- QR code ----------
  if (target) {
    const response = await call(`/api/v1/links/${target.id}/qr`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    record("qr returns PNG", response.status === 200 && isPng, `status=${response.status} bytes=${buffer.length}`);
    record("qr content type", (response.headers.get("content-type") || "").includes("image/png"), response.headers.get("content-type") || "");

    const large = await call(`/api/v1/links/${target.id}/qr?size=512`);
    record("qr honours size", large.status === 200, `status=${large.status}`);

    const clamped = await call(`/api/v1/links/${target.id}/qr?size=99999`);
    record("qr clamps bad size", clamped.status === 200, `status=${clamped.status}`);
  }

  // ---------- analytics: generate real traffic, then read it back ----------
  const trafficAlias = `api${STAMP}hit`;
  const traffic = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: "https://example.org/traffic", alias: trafficAlias },
  });
  const trafficId = (await json(traffic)).link?.id;
  if (traffic.status === 201) {
    const visitors = [
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile Safari", "https://news.ycombinator.com/"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari", "https://www.google.com/"],
      ["Googlebot/2.1 (+http://www.google.com/bot.html)", ""],
    ];
    for (const [ua, referer] of visitors) {
      await fetch(`${BASE}/${trafficAlias}`, {
        headers: { "User-Agent": ua, Referer: referer, "X-Forwarded-For": TEST_IP },
        redirect: "manual",
      });
    }
    await sleep(7000); // the worker rolls raw events into the daily table every 5s
  } else {
    record("seed traffic", false, `status=${traffic.status}`);
  }

  const today = await json(await call(`/api/v1/stats/overview?from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`));
  record("overview trend is one point for today", today.trend?.length === 1, `${today.trend?.length} points`);
  record("overview counts human traffic", (today.total_clicks ?? 0) >= 2, `clicks=${today.total_clicks}`);
  record("overview unique visitors", (today.unique_visitors ?? 0) >= 1, `visitors=${today.unique_visitors}`);
  record(
    "device breakdown classifies UA",
    ["mobile", "desktop"].every((kind) => (today.devices ?? []).some((d) => d.device === kind)),
    JSON.stringify(today.devices),
  );
  // The crawler click is recorded but not reported, so the breakdown has no bot
  // bucket at all while COUNT_BOTS is off.
  record(
    "bot traffic is excluded from the breakdown",
    !(today.devices ?? []).some((d) => d.device === "bot"),
    JSON.stringify(today.devices),
  );
  record("referrers captured", (today.referrers ?? []).length >= 1, JSON.stringify(today.referrers));

  // ---------- per-link click log ----------
  if (trafficId) {
    const range = `from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`;
    const clicks = await json(await call(`/api/v1/links/${trafficId}/clicks?${range}`));
    // Three requests were made against this link: two human, one crawler. The
    // crawler is stored but not reported while COUNT_BOTS is off.
    record("click log returns the human events", clicks.total === 2, `${clicks.clicks?.length} of ${clicks.total}`);
    record(
      "click log excludes the crawler",
      (clicks.clicks ?? []).length > 0 && (clicks.clicks ?? []).every((c) => !c.user_agent.includes("Googlebot")),
      JSON.stringify((clicks.clicks ?? []).map((c) => c.user_agent.slice(0, 24))),
    );
    record(
      "click log carries the referrer and user agent",
      (clicks.clicks ?? []).some((c) => c.referrer === "https://news.ycombinator.com/" && c.user_agent.includes("iPhone")),
      JSON.stringify(clicks.clicks?.[0]),
    );
    record("click log is scoped to the link", (clicks.clicks ?? []).every((c) => c.link_id === trafficId), "all rows belong to the link");
    record("click log echoes the range", clicks.from === isoDaysAgo(0) && clicks.to === isoDaysAgo(0), `${clicks.from}~${clicks.to}`);

    const key = (c) => `${c.occurred_at}|${c.user_agent}`;
    const firstPage = await json(await call(`/api/v1/links/${trafficId}/clicks?limit=1&offset=0&${range}`));
    const secondPage = await json(await call(`/api/v1/links/${trafficId}/clicks?limit=1&offset=1&${range}`));
    const seen = new Set((firstPage.clicks ?? []).map(key));
    const overlap = (secondPage.clicks ?? []).filter((c) => seen.has(key(c)));
    record(
      "click log paginates without overlap",
      (firstPage.clicks ?? []).length === 1 && (secondPage.clicks ?? []).length === 1 && overlap.length === 0,
      `${firstPage.clicks?.length} then ${secondPage.clicks?.length}, overlap=${overlap.length}`,
    );
  } else {
    record("click log returns the human events", false, "no traffic link to inspect");
  }
  record(
    "recent clicks feed",
    (today.recent_clicks ?? []).length >= 2 && today.recent_clicks.every((c) => "alias" in c && "occurred_at" in c && "user_agent" in c),
    `${today.recent_clicks?.length} rows`,
  );

  const week = await json(await call(`/api/v1/stats/overview?from=${isoDaysAgo(6)}&to=${isoDaysAgo(0)}`));
  record("overview trend spans the range", week.trend?.length === 7, `${week.trend?.length} points`);
  const weekDays = (week.trend ?? []).map((p) => String(p.day).slice(0, 10));
  const consecutive = weekDays.every((day, i) => i === 0 || new Date(day) - new Date(weekDays[i - 1]) === 86400000);
  record("overview trend has no gaps", consecutive, weekDays.join(","));
  record("overview range is echoed", week.from === isoDaysAgo(6) && week.to === isoDaysAgo(0), `${week.from}~${week.to}`);

  const year = await json(await call(`/api/v1/stats/overview?from=${isoDaysAgo(364)}&to=${isoDaysAgo(0)}`));
  record("overview supports 365 days", year.trend?.length === 365, `${year.trend?.length} points`);

  const capped = await json(await call(`/api/v1/stats/overview?from=1970-01-01&to=${isoDaysAgo(0)}`));
  record("overview caps an unbounded range", (capped.trend?.length ?? 0) <= 366, `${capped.trend?.length} points`);

  const rankedToday = await json(await call(`/api/v1/stats/top?order=top&limit=5&from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`));
  record("ranking accepts a range", rankedToday.from === isoDaysAgo(0) && rankedToday.to === isoDaysAgo(0), `${rankedToday.from}~${rankedToday.to}`);
  record("ranking is range scoped", (rankedToday.links ?? []).some((l) => l.alias === trafficAlias), `${rankedToday.links?.length} rows`);

  // ---------- token scope enforcement ----------
  const created = await json(await call("/api/v1/auth/tokens", { method: "POST", headers: { "X-CSRF-Token": csrf }, body: { name: `scope-${STAMP}` } }));
  const secret = created.secret;
  const tokenId = created.token?.id;
  record("create token", Boolean(secret) && Boolean(tokenId), tokenId ? `id=${tokenId}` : "no token id");

  if (secret) {
    const bearer = { Authorization: `Bearer ${secret}` };
    const read = await call("/api/v1/links", { headers: bearer });
    record("token can read links", read.status === 200, `status=${read.status}`);

    const write = await call("/api/v1/links", { method: "POST", headers: bearer, body: { destination_url: "https://example.net/token", alias: `api${STAMP}tok` } });
    record("token can write links", write.status === 201, `status=${write.status}`);

    const tokens = await call("/api/v1/auth/tokens", { headers: bearer });
    record("token cannot manage tokens", tokens.status === 403, `status=${tokens.status}`);

    const audit = await call("/api/v1/audit", { headers: bearer });
    record("token cannot read the audit log", audit.status === 403, `status=${audit.status}`);

    const scopes = created.token?.scopes || [];
    record("token reports scopes", scopes.length === 3, scopes.join(","));
  }

  // Revoke via the session so the token cannot be reused.
  if (tokenId) {
    const revoked = await call(`/api/v1/auth/tokens/${tokenId}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
    record("revoke token", revoked.status === 204, `status=${revoked.status}`);
  }

  // ---------- rate limiting ----------
  let sawLimit = false;
  let retryAfter = "";
  for (let i = 0; i < 14; i++) {
    const response = await call("/api/v1/auth/login", { ip: RATE_IP, method: "POST", body: { username: USER, password: "wrong-password" } });
    if (response.status === 429) {
      sawLimit = true;
      retryAfter = response.headers.get("retry-after") || "";
      break;
    }
  }
  record("login rate limit returns 429", sawLimit, sawLimit ? `retry-after=${retryAfter}` : "never throttled after 14 attempts");

  const limited = await call("/api/v1/links", { ip: RATE_IP });
  record("rate limit is per-IP", limited.status !== 429, `other IP status=${limited.status}`);

  // ---------- deleted links must not inflate aggregates ----------
  // Soft-deleted links keep their rows in link_click_daily/click_events, so every
  // aggregate has to JOIN links and filter deleted_at. Otherwise the headline totals
  // and the rankings disagree with the link list.
  const trafficRow = (await json(await call(`/api/v1/links?search=${trafficAlias}`))).links?.[0];
  if (trafficRow && (trafficRow.clicks ?? 0) > 0) {
    const before = await json(await call("/api/v1/stats/summary"));
    await call(`/api/v1/links/${trafficRow.id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
    const after = await json(await call("/api/v1/stats/summary"));
    record(
      "deleting a link drops its clicks from the summary",
      after.total_clicks === before.total_clicks - trafficRow.clicks,
      `${before.total_clicks} -> ${after.total_clicks} (removed ${trafficRow.clicks})`,
    );
    record(
      "deleting a link drops it from the link count",
      after.total_links === before.total_links - 1,
      `${before.total_links} -> ${after.total_links}`,
    );

    const ranking = await json(await call(`/api/v1/stats/top?order=top&limit=50&from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`));
    record(
      "deleted link is absent from rankings",
      !(ranking.links || []).some((row) => row.alias === trafficAlias),
      `${(ranking.links || []).length} ranked`,
    );

    const overview = await json(await call(`/api/v1/stats/overview?from=${isoDaysAgo(0)}&to=${isoDaysAgo(0)}`));
    record(
      "deleted link is absent from recent clicks",
      !(overview.recent_clicks || []).some((row) => row.alias === trafficAlias),
      `${(overview.recent_clicks || []).length} recent`,
    );
  } else {
    record("deleting a link drops its clicks from the summary", false, "no aggregated traffic to test with");
  }

  // ---------- short domains + IP mode ----------
  const config = await json(await call("/api/v1/config"));
  record("config lists the short domains", Array.isArray(config.short_domains), JSON.stringify(config));
  record("config reports the default domain", Boolean(config.default_domain), config.default_domain);

  // This stack configures no extra short domain, so all that can be proven here
  // is that the whitelist is closed. The configured case needs a restart with
  // SHORT_DOMAINS set, which the batch verification covers by hand.
  const offDomain = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: "https://example.com/off-domain", alias: `api${STAMP}off`, domain: "evil.example" },
  });
  record("an unconfigured short domain is refused", offDomain.status === 400, `status=${offDomain.status}`);

  const plainAlias = `api${STAMP}dom`;
  const plain = await call("/api/v1/links", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
    body: { destination_url: "https://example.com/plain-domain", alias: plainAlias },
  });
  const plainPayload = await json(plain);
  record("a link with no domain is created", plain.status === 201, `status=${plain.status}`);
  record(
    "an unset domain is left out of the record",
    plainPayload.link?.domain === undefined,
    JSON.stringify(plainPayload.link?.domain),
  );
  const plainShortUrl = plainPayload.short_url || "";
  record(
    "short_url is on the default domain",
    plainShortUrl.includes(config.default_domain) && plainShortUrl.endsWith(`/${plainAlias}`),
    plainShortUrl,
  );
  // The code is global and the domain is display only, so naming one must not
  // change whether the short link resolves.
  const plainRedirect = await call(`/${plainAlias}`);
  record("the short link still resolves", plainRedirect.status === 302, `status=${plainRedirect.status}`);

  record("the overview reports the IP mode", (today.ip_mode ?? "") !== "", today.ip_mode);

  // ---------- cleanup ----------
  const stale = await json(await call(`/api/v1/links?search=api${STAMP}&limit=100`));
  for (const link of stale.links || []) {
    await call(`/api/v1/links/${link.id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
  }
  const remaining = await json(await call(`/api/v1/links?search=api${STAMP}`));
  record("cleanup seeded links", (remaining.links || []).length === 0, `${remaining.links?.length} left`);

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
  console.error("api smoke test crashed:", err.message);
  process.exit(2);
});
