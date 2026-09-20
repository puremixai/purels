import test from "node:test";
import assert from "node:assert/strict";
import { buildOIDCCallbackURL } from "../web/src/lib/oidc-callback.ts";

test("buildOIDCCallbackURL returns no preview until both parts exist", () => {
  assert.equal(buildOIDCCallbackURL("https://links.example.com", ""), "");
  assert.equal(buildOIDCCallbackURL("", "dex"), "");
});

test("buildOIDCCallbackURL matches the callback registered at the identity provider", () => {
  assert.equal(
    buildOIDCCallbackURL("https://links.example.com/", "LinuxDO"),
    "https://links.example.com/api/v1/auth/oidc/linuxdo/callback",
  );
});
