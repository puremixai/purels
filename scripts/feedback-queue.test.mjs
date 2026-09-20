import test from "node:test";
import assert from "node:assert/strict";
import { addToast, removeToast } from "../web/src/lib/feedback-queue.ts";

const toast = (id) => ({
  id,
  kind: "success",
  title: `Toast ${id}`,
});

test("addToast keeps the newest three notifications first", () => {
  const state = addToast([toast("one"), toast("two"), toast("three")], toast("four"));

  assert.deepEqual(state.map((item) => item.id), ["four", "one", "two"]);
});

test("removeToast dismisses only the requested notification", () => {
  const state = [toast("one"), toast("two")];

  assert.deepEqual(removeToast(state, "one").map((item) => item.id), ["two"]);
  assert.deepEqual(removeToast(state, "missing"), state);
});
