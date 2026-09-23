import assert from "node:assert/strict";
import test from "node:test";
import { runtimeChanges, runtimeDraft, runtimeGroups } from "./runtime-settings-form.ts";

function fixture() {
  return {
    alias_mode: "random",
    unique_urls: true,
    registration_enabled: true,
    totp_enabled: true,
    count_bots: true,
    forward_query: true,
    fallback_url: "https://example.com/not-found",
    auto_prune_expired: true,
    prune_grace_seconds: 2592000,
    max_links_per_user: 1000,
    destination_denylist: ["blocked.example.com", "private.example.com"],
    short_domains: ["go.example.com", "short.example.com"],
    health_check_enabled: true,
    health_check_interval_seconds: 86400,
    rate_limit_enabled: true,
    rate_limit_login: 10,
    rate_limit_api: 120,
    rate_limit_redirect: 600,
    rate_limit_register: 5,
    rate_limit_2fa: 10,
    rate_limit_oidc: 30,
  };
}

test("every runtime policy field belongs to exactly one settings group", () => {
  const fields = Object.values(runtimeGroups).flat();
  assert.equal(fields.length, 21);
  assert.equal(new Set(fields).size, 21, "a field cannot be saved from multiple groups");
  assert.deepEqual([...fields].sort(), Object.keys(fixture()).sort());
});

test("drafts round-trip each group's values without producing a patch", () => {
  const saved = fixture();
  for (const group of Object.keys(runtimeGroups)) {
    const draft = runtimeDraft(saved, group);
    assert.deepEqual(Object.keys(draft), [...runtimeGroups[group]]);
    assert.deepEqual(runtimeChanges(saved, draft, group), {});
  }
  assert.deepEqual(runtimeDraft(saved, "creation"), {
    alias_mode: "random", unique_urls: true, max_links_per_user: "1000",
    short_domains: "go.example.com\nshort.example.com",
  });
});

test("saving a group ignores fields belonging to all other groups", () => {
  const saved = fixture();
  const edits = {
    creation: { max_links_per_user: "2000" },
    redirects: { fallback_url: "https://example.com/new" },
    maintenance: { health_check_interval_seconds: "60" },
    registration: { registration_enabled: false, totp_enabled: false },
    traffic: { rate_limit_login: "42" },
    statistics: { count_bots: false },
  };
  const expected = {
    creation: { max_links_per_user: 2000 },
    redirects: { fallback_url: "https://example.com/new" },
    maintenance: { health_check_interval_seconds: 60 },
    registration: { registration_enabled: false, totp_enabled: false },
    traffic: { rate_limit_login: 42 },
    statistics: { count_bots: false },
  };
  for (const group of Object.keys(runtimeGroups)) {
    const draft = { ...runtimeDraft(saved, group), ...Object.assign({}, ...Object.values(edits)) };
    assert.deepEqual(runtimeChanges(saved, draft, group), expected[group]);
  }
});

test("false, zero, empty URLs and empty lists remain explicit changes", () => {
  const saved = fixture();
  assert.deepEqual(runtimeChanges(saved, {
    ...runtimeDraft(saved, "creation"), unique_urls: false, max_links_per_user: "0", short_domains: "",
  }, "creation"), { unique_urls: false, max_links_per_user: 0, short_domains: [] });
  assert.deepEqual(runtimeChanges(saved, {
    ...runtimeDraft(saved, "redirects"), forward_query: false, fallback_url: "", destination_denylist: "\n , \n",
  }, "redirects"), { forward_query: false, fallback_url: "", destination_denylist: [] });
  assert.deepEqual(runtimeChanges(saved, {
    ...runtimeDraft(saved, "traffic"), rate_limit_api: "0",
  }, "traffic"), { rate_limit_api: 0 });
});

test("host textareas accept newlines, commas and whitespace without mutating saved lists", () => {
  const saved = fixture();
  const before = structuredClone(saved);
  const changes = runtimeChanges(saved, {
    ...runtimeDraft(saved, "creation"),
    short_domains: "  one.example.com\r\n\n two.example.com, three.example.com ,\n",
  }, "creation");
  assert.deepEqual(changes, { short_domains: ["one.example.com", "two.example.com", "three.example.com"] });
  assert.deepEqual(saved, before);
});

test("disabling health checks and cleanup preserves their saved durations despite empty drafts", () => {
  const saved = fixture();
  const changes = runtimeChanges(saved, {
    ...runtimeDraft(saved, "maintenance"),
    health_check_enabled: false, health_check_interval_seconds: "",
    auto_prune_expired: false, prune_grace_seconds: "",
  }, "maintenance");
  assert.deepEqual(changes, { health_check_enabled: false, auto_prune_expired: false });
  const merged = { ...saved, ...changes };
  assert.equal(merged.health_check_interval_seconds, saved.health_check_interval_seconds);
  assert.equal(merged.prune_grace_seconds, saved.prune_grace_seconds);
});

test("disabling the rate limiter preserves every saved request limit despite empty drafts", () => {
  const saved = fixture();
  const draft = { ...runtimeDraft(saved, "traffic"), rate_limit_enabled: false };
  for (const key of ["rate_limit_login", "rate_limit_register", "rate_limit_2fa", "rate_limit_oidc", "rate_limit_api", "rate_limit_redirect"]) {
    draft[key] = "";
  }
  const changes = runtimeChanges(saved, draft, "traffic");
  assert.deepEqual(changes, { rate_limit_enabled: false });
  assert.deepEqual({ ...saved, ...changes }, { ...saved, rate_limit_enabled: false });
});

test("enabled numeric controls reject empty, nonnumeric, fractional and unsafe values", () => {
  const saved = fixture();
  for (const raw of ["", "not a number", "NaN", "Infinity", "-Infinity", "1.5", "9007199254740992"]) {
    assert.throws(() => runtimeChanges(saved, {
      ...runtimeDraft(saved, "creation"), max_links_per_user: raw,
    }, "creation"), /max_links_per_user/, `must reject ${JSON.stringify(raw)}`);
  }
  for (const [group, key] of [
    ["maintenance", "health_check_interval_seconds"],
    ["maintenance", "prune_grace_seconds"],
    ["traffic", "rate_limit_api"],
  ]) {
    assert.throws(() => runtimeChanges(saved, {
      ...runtimeDraft(saved, group), [key]: "",
    }, group), new RegExp(key));
  }
});

test("omitted draft fields are not treated as resets", () => {
  assert.deepEqual(runtimeChanges(fixture(), { max_links_per_user: "0" }, "creation"), { max_links_per_user: 0 });
});
