import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../internal/http/handler/gallery/redirect.js", import.meta.url), "utf8");

function fixture({ seconds = "2", interstitial = "true", missing, copy = {}, query = "" } = {}) {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  const navigations = [];

  function eventTarget(initial = {}) {
    const listeners = new Map();
    return Object.assign(initial, {
      addEventListener(type, listener) {
        const list = listeners.get(type) || [];
        list.push(listener);
        listeners.set(type, list);
      },
      dispatch(type, event = {}) {
        for (const listener of listeners.get(type) || []) listener(event);
      },
    });
  }

  const bodyClasses = new Set();
  const body = {
    dataset: { seconds, interstitial },
    classList: { toggle(name, enabled) { enabled ? bodyClasses.add(name) : bodyClasses.delete(name); } },
  };
  const ids = ["pause-button", "pause-symbol", "pause-label", "timer-number", "timer-label", "ring-progress", "progress-fill", "continue-link", "status-message"];
  const elements = Object.fromEntries(ids.map((id) => [id, eventTarget({
    hidden: id === "pause-button", textContent: "", style: {}, dataset: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  })]));
  elements["pause-button"].dataset = {
    pause: "Stay a while", resume: "Resume", paused: "Take your time", secondsLabel: "seconds to go",
    pausedStatus: "Countdown paused.", resumedStatus: "Countdown resumed.", ...copy,
  };
  const realHref = "https://destination.example/real?utm_source=purels#section";
  elements["continue-link"].href = realHref;
  const countdown = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const details = [{ open: true }, { open: true }];
  const document = eventTarget({
    body,
    getElementById(id) { return id === missing ? null : elements[id]; },
    querySelector(selector) {
      assert.equal(selector, ".countdown-state");
      return countdown;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".destination-details[open]");
      return details.filter((item) => item.open);
    },
  });
  const window = eventTarget({
    location: { search: query, replace(url) { navigations.push({ url, at: now }); } },
    setTimeout(callback, milliseconds) {
      const id = nextTimer++;
      timers.set(id, { callback, at: now + milliseconds });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });

  vm.runInNewContext(source, { document, window, performance: { now: () => now } });

  function advance(milliseconds) {
    const target = now + milliseconds;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
    }
    now = target;
  }

  return { advance, bodyClasses, countdown, details, document, elements, navigations, realHref, timers, window };
}

test("counts the configured duration and replaces with the server's destination once", () => {
  const f = fixture({ seconds: "7" });
  assert.equal(f.elements["pause-button"].hidden, false);
  assert.equal(f.elements["timer-number"].textContent, "7");
  assert.equal(f.countdown.attributes["aria-label"], "7 seconds to go");
  f.advance(6999);
  assert.equal(f.navigations.length, 0);
  f.advance(1);
  assert.deepEqual(f.navigations, [{ url: f.realHref, at: 7000 }]);
  assert.equal(f.elements["progress-fill"].style.transform, "scaleX(0)");
  assert.equal(f.timers.size, 0);
  f.advance(10000);
  assert.equal(f.navigations.length, 1);
});

test("pause stops navigation, freezes progress, and resume uses exact remaining time", () => {
  const f = fixture();
  f.advance(725);
  f.elements["pause-button"].dispatch("click");
  const progress = f.elements["progress-fill"].style.transform;
  assert.equal(progress, "scaleX(0.6375)");
  assert.equal(f.elements["pause-button"].attributes["aria-pressed"], "true");
  assert.equal(f.elements["pause-label"].textContent, "Resume");
  assert.equal(f.elements["status-message"].textContent, "Countdown paused.");
  assert.equal(f.countdown.attributes["aria-label"], "Countdown paused.");
  f.advance(5000);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.elements["progress-fill"].style.transform, progress);
  f.elements["pause-button"].dispatch("click");
  assert.equal(f.elements["pause-button"].attributes["aria-pressed"], "false");
  assert.equal(f.elements["status-message"].textContent, "Countdown resumed.");
  assert.equal(f.countdown.attributes["aria-label"], "2 seconds to go");
  f.advance(1274);
  assert.equal(f.navigations.length, 0);
  f.advance(1);
  assert.deepEqual(f.navigations, [{ url: f.realHref, at: 7000 }]);
});

test("preview and disabled, malformed, or out-of-range delays never start", () => {
  for (const options of [
    { interstitial: "false" }, { interstitial: undefined, seconds: "0" },
    { seconds: "0" }, { seconds: "-1" }, { seconds: "61" },
    { seconds: "1.5" }, { seconds: "oops" }, { seconds: "Infinity" },
  ]) {
    const f = fixture(options);
    f.advance(100000);
    assert.equal(f.navigations.length, 0, JSON.stringify(options));
    assert.equal(f.elements["pause-button"].hidden, true);
    assert.equal(f.timers.size, 0);
  }
});

test("the maximum supported delay is sixty seconds", () => {
  const f = fixture({ seconds: "60" });
  f.advance(59999);
  assert.equal(f.navigations.length, 0);
  f.advance(1);
  assert.equal(f.navigations[0].at, 60000);
});

test("prototype query parameters cannot affect navigation, art, or timing", () => {
  const f = fixture({ query: "?review=1&mode=preview&seconds=60&destination=https://attacker.example&art=other" });
  f.advance(2000);
  assert.deepEqual(f.navigations, [{ url: f.realHref, at: 2000 }]);
});

test("an unavailable required element leaves the manual link and hidden pause control untouched", () => {
  const f = fixture({ missing: "ring-progress" });
  f.advance(10000);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.elements["pause-button"].hidden, true);
  assert.equal(f.elements["continue-link"].href, f.realHref);
});

test("manual navigation remains an ordinary anchor and pagehide cancels the timer", () => {
  const f = fixture();
  let prevented = false;
  f.elements["continue-link"].dispatch("click", { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(f.elements["continue-link"].href, f.realHref);
  f.advance(650);
  f.window.dispatch("pagehide");
  assert.equal(f.timers.size, 0);
  f.advance(10000);
  assert.equal(f.navigations.length, 0);
});

test("bfcache restoration remains paused until explicitly resumed", () => {
  const f = fixture();
  f.advance(675);
  f.window.dispatch("pagehide", { persisted: true });
  f.advance(5000);
  f.window.dispatch("pageshow", { persisted: true });
  assert.equal(f.elements["pause-button"].attributes["aria-pressed"], "true");
  assert.equal(f.elements["progress-fill"].style.transform, "scaleX(0.6625)");
  f.advance(5000);
  assert.equal(f.navigations.length, 0);
  f.elements["pause-button"].dispatch("click");
  f.advance(1324);
  assert.equal(f.navigations.length, 0);
  f.advance(1);
  assert.equal(f.navigations[0].at, 12000);
});

test("initial pageshow does not pause the countdown", () => {
  const f = fixture();
  f.window.dispatch("pageshow", { persisted: false });
  f.advance(2000);
  assert.equal(f.navigations.length, 1);
});

test("status announcements describe state changes, not every timer tick", () => {
  const f = fixture();
  f.advance(500);
  assert.equal(f.elements["status-message"].textContent, "");
  f.elements["pause-button"].dispatch("click");
  f.elements["pause-button"].dispatch("click");
  f.advance(500);
  assert.equal(f.elements["status-message"].textContent, "Countdown resumed.");
  assert.equal(f.countdown.attributes["aria-label"], "1 seconds to go");
});

test("button labels and announcements come from the server-provided locale", () => {
  const f = fixture({ copy: { pause: "停留欣赏", resume: "继续倒计时", paused: "已暂停", secondsLabel: "秒后自动跳转", pausedStatus: "倒计时已暂停", resumedStatus: "倒计时已继续" } });
  assert.equal(f.elements["pause-label"].textContent, "停留欣赏");
  assert.equal(f.elements["timer-label"].textContent, "秒后自动跳转");
  f.elements["pause-button"].dispatch("click");
  assert.equal(f.elements["pause-label"].textContent, "继续倒计时");
  assert.equal(f.elements["timer-label"].textContent, "已暂停");
  assert.equal(f.elements["status-message"].textContent, "倒计时已暂停");
});

test("Escape closes destination details even on a preview page", () => {
  const f = fixture({ interstitial: "false" });
  f.document.dispatch("keydown", { key: "Enter" });
  assert.ok(f.details.every((details) => details.open));
  f.document.dispatch("keydown", { key: "Escape" });
  assert.ok(f.details.every((details) => !details.open));
});
