import assert from "node:assert/strict";
import test from "node:test";
import { adminNavSections, getVisibleNavigation, getVisibleSettingsSearchEntries, isNavItemActive } from "./admin-navigation.ts";

const settingsItems = (scopes) => getVisibleNavigation(scopes).find((section) => section.id === "settings").groups.flatMap((group) => group.items);

test("site settings have five flat categories and no personal security entry", () => {
  const settings = adminNavSections.find((section) => section.id === "settings");
  assert.equal(settings.href, "/home/settings");
  assert.ok(settings.groups.every((group) => !group.labelKey));
  assert.deepEqual(settings.groups.flatMap((group) => group.items).map((item) => item.href), [
    "/home/settings/links", "/home/settings/registration", "/home/users", "/home/settings/traffic", "/home/settings/analytics",
  ]);
});

test("mixed categories remain accessible with any one of their permissions", () => {
  assert.deepEqual(settingsItems(["oidc:manage"]).map((item) => item.href), ["/home/settings/registration"]);
  assert.deepEqual(settingsItems(["captcha:manage"]).map((item) => item.href), ["/home/settings/registration"]);
  assert.deepEqual(settingsItems(["analytics:manage"]).map((item) => item.href), ["/home/settings/analytics"]);
  assert.deepEqual(settingsItems([]), []);
  assert.deepEqual(settingsItems(["settings:manage"]).map((item) => item.href), [
    "/home/settings/links", "/home/settings/registration", "/home/settings/traffic", "/home/settings/analytics",
  ]);
});

test("a role manager enters the role editor instead of an unauthorized user page", () => {
  assert.deepEqual(settingsItems(["roles:manage"]).map((item) => item.href), ["/home/settings/roles"]);
  assert.deepEqual(settingsItems(["users:manage", "roles:manage"]).map((item) => item.href), ["/home/users"]);
});

test("nested and legacy editors activate the corresponding parent category", () => {
  assert.equal(isNavItemActive("/home/settings/oidc/edit", "/home/settings/registration"), true);
  assert.equal(isNavItemActive("/home/settings/captcha", "/home/settings/registration"), true);
  assert.equal(isNavItemActive("/home/settings/runtime", "/home/settings/links"), true);
  assert.equal(isNavItemActive("/home/settings/links/maintenance", "/home/settings/links"), true);
  assert.equal(isNavItemActive("/home/settings/roles", "/home/users"), true);
  assert.equal(isNavItemActive("/home/users", "/home/settings/roles"), true);
  assert.equal(isNavItemActive("/home/settings/traffic", "/home/settings/links"), false);
  assert.equal(isNavItemActive("/home/settings/security", "/home/users"), false);
  assert.equal(isNavItemActive("/home/links", "/home"), false);
});

test("field search does not expose other permissions within shared categories", () => {
  const captcha = getVisibleSettingsSearchEntries(["captcha:manage"]);
  assert.ok(captcha.length > 0);
  assert.ok(captcha.every((entry) => entry.href === "/home/settings/registration#captcha"));
  const runtime = getVisibleSettingsSearchEntries(["settings:manage"]);
  assert.ok(runtime.some((entry) => entry.href.endsWith("/analytics#count_bots")));
  assert.ok(runtime.every((entry) => !entry.href.includes("#integrations") && !entry.href.includes("#captcha") && !entry.href.includes("/oidc")));
  assert.deepEqual(getVisibleSettingsSearchEntries([]), []);
});

test("field search opens lifecycle fields on their new pages", () => {
  const entries = getVisibleSettingsSearchEntries(["settings:manage"]);
  assert.equal(entries.find((entry) => entry.labelKey === "settings.runtime.pruneGrace").href, "/home/settings/links/maintenance#prune_grace_seconds");
  assert.equal(entries.find((entry) => entry.labelKey === "settings.runtime.denylist").href, "/home/settings/links/redirects#destination_denylist");
  assert.equal(entries.find((entry) => entry.labelKey === "settings.runtime.rateLogin").href, "/home/settings/traffic#rate_limit_login");
});
