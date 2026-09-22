import assert from "node:assert/strict";
import test from "node:test";
import { adminNavSections, getVisibleNavigation, isNavItemActive } from "./admin-navigation.ts";

test("settings navigation is one section whose heading is the overview page", () => {
  const settings = adminNavSections.find((section) => section.id === "settings");

  assert.ok(settings);
  assert.deepEqual(settings.groups.map((group) => group.id), ["access", "security", "links", "analytics"]);
  assert.equal(settings.href, "/home/settings");
  assert.equal(settings.groups.find((group) => group.id === "links")?.items[0].href, "/home/settings/runtime");
});

test("settings navigation keeps only items allowed by the current scopes", () => {
  const visible = getVisibleNavigation(["roles:manage", "settings:manage"]);
  const settings = visible.find((section) => section.id === "settings");

  assert.ok(settings);
  assert.deepEqual(settings.groups.map((group) => group.id), ["access", "security", "links"]);
  assert.deepEqual(settings.groups.flatMap((group) => group.items).map((item) => item.href), [
    "/home/settings/roles",
    "/home/settings/security",
    "/home/settings/runtime",
  ]);
});

test("nested settings routes keep their parent menu item active", () => {
  assert.equal(isNavItemActive("/home/settings/oidc", "/home/settings/oidc"), true);
  assert.equal(isNavItemActive("/home/settings/oidc/edit", "/home/settings/oidc"), true);
  assert.equal(isNavItemActive("/home/settings/runtime", "/home/settings/oidc"), false);
});
