import assert from "node:assert/strict";
import test from "node:test";

import {
  adminNavSections,
  getVisibleNavigation,
  isNavItemActive,
} from "../src/components/admin-navigation.ts";

const settingsHrefs = [
  "/home/users",
  "/home/settings/roles",
  "/home/settings/oidc",
  "/home/settings/analytics",
  "/home/settings/security",
  "/home/settings/captcha",
  "/home/settings/runtime",
];

test("keeps management routes together in the settings section", () => {
  const settings = adminNavSections.find((section) => section.id === "settings");

  assert.ok(settings);
  assert.deepEqual(settings.groups.map((group) => ({
    id: group.id,
    items: group.items.map((item) => item.href),
  })), [
    { id: "access", items: settingsHrefs.slice(0, 3) },
    { id: "security", items: ["/home/settings/security", "/home/settings/captcha"] },
    { id: "system", items: ["/home/settings/analytics", "/home/settings/runtime"] },
  ]);
  assert.deepEqual(
    adminNavSections.find((section) => section.id === "primary")?.groups[0].items.map((item) => item.href),
    ["/home", "/home/links", "/home/stats", "/home/audit"],
  );
});

test("filters settings children by scope without hiding public settings", () => {
  const visibleSettings = getVisibleNavigation(["users:manage", "roles:manage"])
    .find((section) => section.id === "settings");

  assert.deepEqual(visibleSettings?.groups.map((group) => ({
    id: group.id,
    items: group.items.map((item) => item.href),
  })), [
    { id: "access", items: ["/home/users", "/home/settings/roles"] },
    { id: "security", items: ["/home/settings/security"] },
  ]);
});

test("marks nested settings routes active", () => {
  assert.equal(isNavItemActive("/home/settings/runtime/advanced", "/home/settings/runtime"), true);
  assert.equal(isNavItemActive("/home/users", "/home/users"), true);
  assert.equal(isNavItemActive("/home/users-other", "/home/users"), false);
});
