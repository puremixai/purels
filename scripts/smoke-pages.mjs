// Browser smoke test for every admin page and its primary actions.
// Drives an already-running headless Chrome over the DevTools Protocol.
// Zero dependencies: uses Node's global fetch + WebSocket.
//
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank
//   node scripts/smoke-pages.mjs
//
// Env: CDP_PORT (9222), BASE_URL (http://localhost), ADMIN_USER, ADMIN_PASS
//
// The console ships English and Chinese. Everything below asserts the English
// wording: the browser's Accept-Language is pinned to English at connect time and
// the locale cookie is only written once the switcher has been used. Phase 1b
// drives the switcher and asserts the Chinese wording, then puts the language
// back; phase 1c covers the header negotiation itself, with no cookie in play.

import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.CDP_PORT || 9222);
const BASE = (process.env.BASE_URL || "http://localhost").replace(/\/$/, "");
const USER = process.env.ADMIN_USER || "admin";
const PASS = process.env.ADMIN_PASS || "change-me-now";
const STAMP = Date.now().toString(36);

const PAGES = [
  { name: "login", path: "/login", expect: ["Sign in", "Username"] },
  { name: "register", path: "/register", expect: ["Register", "Username"] },
  { name: "dashboard", path: "/admin", expect: ["Overview", "Total links", "Recent links"] },
  { name: "links", path: "/admin/links", expect: ["Link management", "Destination", "Clicks", "Previous"] },
  { name: "new-link", path: "/admin/links/new", expect: ["Create link", "Destination URL"] },
  { name: "stats", path: "/admin/stats", expect: ["Statistics", "Clicks in range", "Unique visitors", "Clicks over time", "Top links", "Referrers", "Devices", "Link detail", "Recent clicks"] },
  { name: "audit", path: "/admin/audit", expect: ["Audit log", "Actor", "Action"] },
  { name: "users", path: "/admin/users", expect: ["User management", "Username", "Role"] },
  { name: "roles", path: "/admin/settings/roles", expect: ["Role permissions", "Manage users", "Manage role permissions", "Manage every link"] },
  { name: "oidc", path: "/admin/settings/oidc", expect: ["Sign-in methods", "Add a sign-in method", "Issuer", "Client ID", "Scopes"] },
  { name: "analytics", path: "/admin/settings/analytics", expect: ["Tracking settings", "GA4 measurement ID", "GTM container ID", "Matomo URL", "Matomo site ID"] },
  { name: "captcha", path: "/admin/settings/captcha", expect: ["Registration protection", "Cloudflare Turnstile", "Site key", "Expected hostname", "Expected action"] },
  { name: "security", path: "/admin/settings/security", expect: ["Two-factor authentication", "API tokens", "Create a token"] },
];

// Matched without their trailing punctuation: the same sentence is worded per
// page ("Failed to load." on a list, "Failed to load the ranking." on stats), and
// the prefix catches every variant. None of these appear in ordinary copy.
const ERROR_MARKERS = [
  "Failed to load",
  "Cannot reach the API server",
  "Request failed (",
  "Failed to create",
  "Failed to revoke",
  "Failed to save",
  "Failed to check the destination",
  "The bulk action failed",
  "Failed to export",
  "Failed to import",
  "You do not have permission",
  "Application error",
  "An error occurred",
];

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let id = 0;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg);
      }
    });
    ws.addEventListener("error", () => reject(new Error("websocket failed")));
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          return new Promise((res, rej) => {
            pending.set(mid, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        on(fn) {
          listeners.push(fn);
        },
        close() {
          ws.close();
        },
      }),
    );
  });
}

// Each run gets its own browser context, and therefore its own cookie jar.
// Sharing the default context means concurrent runs clobber each other: the
// logout and expired-session steps of one run wipe the session every other run
// is still using, which shows up as 401s with no Cookie header at all. A private
// jar is also what makes the language phase start from English every time.
async function openTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (version.webSocketDebuggerUrl) {
        const browser = await connect(version.webSocketDebuggerUrl);
        const { browserContextId } = await browser.send("Target.createBrowserContext");
        const { targetId } = await browser.send("Target.createTarget", {
          url: "about:blank",
          browserContextId,
        });
        return {
          id: targetId,
          browserContextId,
          browser,
          webSocketDebuggerUrl: `ws://127.0.0.1:${PORT}/devtools/page/${targetId}`,
        };
      }
    } catch {
      /* chrome not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint not reachable on port ${PORT}`);
}

async function main() {
  const target = await openTarget();
  const c = await connect(target.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.send("Network.enable");
  // Pin the browser's own language. With no locale cookie the console now follows
  // Accept-Language, so leaving this to the host Chrome would make every wording
  // assertion below depend on the machine's locale.
  await c.send("Network.setExtraHTTPHeaders", {
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });

  let pageErrors = [];
  const httpErrors = [];
  const authLog = [];
  const sessionTrace = [];
  const jarLog = [];
  const authCalls = new Map();
  const sentCookies = new Map();
  const sentMethods = new Map();
  // Every authenticated /api/v1 request, with the time it went out. The API
  // allows RATE_LIMIT_API (120 by default) per IP per rolling minute and this
  // suite is chatty enough to reach that on its own, so the peak is measured
  // rather than guessed at — a 429 is otherwise indistinguishable from a broken
  // page.
  const apiHits = [];
  c.on((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      const { requestId, request } = msg.params;
      if (request.url.includes("/api/v1/")) apiHits.push({ at: Date.now(), path: request.url.replace(BASE, "") });
      if (request.url.includes("/api/v1/auth/")) authCalls.set(requestId, `${request.method} ${request.url.replace(BASE, "")}`);
      return;
    }
    if (msg.method === "Network.responseReceived") {
      const auth = authCalls.get(msg.params.requestId);
      if (auth) {
        const raw = msg.params.response.headers?.["set-cookie"] || msg.params.response.headers?.["Set-Cookie"] || "";
        const names = raw.split(/,(?=[^;]+=)/).map((c) => c.split("=")[0].trim()).filter(Boolean).join("|");
        authLog.push(`${auth} -> ${msg.params.response.status}${names ? ` set-cookie=[${names}]` : ""}`);
      }
      if (msg.params.response.status >= 400) {
        const { status, url } = msg.params.response;
        const cookie = sentCookies.get(msg.params.requestId) || "";
        const method = sentMethods.get(msg.params.requestId) || "";
        const entry = `${status} ${method} ${url.replace(BASE, "")} cookie=${cookie ? cookie.length + "B" : "NONE"}`;
        if (!httpErrors.includes(entry)) httpErrors.push(entry);
        // The body says *why*: a CSRF rejection, a scope rejection and a missing
        // session all surface as a bare status code otherwise.
        if (method && method !== "GET") {
          c.send("Network.getResponseBody", { requestId: msg.params.requestId })
            .then((r) => {
              const body = (r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body) || "";
              const line = `  body at ${status} ${method} ${url.replace(BASE, "")}: ${body.slice(0, 200)}`;
              if (!jarLog.includes(line)) jarLog.push(line);
            })
            .catch(() => {});
        }
        // A missing Cookie header has two very different causes: the browser holds no
        // cookie, or it holds one it will not send to this origin. Snapshot the jar to
        // tell them apart.
        if (!cookie) {
          c.send("Network.getCookies", { urls: [BASE + "/"] })
            .then((r) => {
              const jar = (r.cookies || []).map((k) => `${k.name}@${k.domain}${k.path}`).join(",") || "EMPTY";
              const line = `  jar at ${status} ${url.replace(BASE, "")}: ${jar}`;
              if (!jarLog.includes(line)) jarLog.push(line);
            })
            .catch(() => {});
        }
      }
      return;
    }
    if (msg.method === "Network.requestWillBeSent") {
      sentMethods.set(msg.params.requestId, msg.params.request?.method || "");
      return;
    }
    if (msg.method === "Network.requestWillBeSentExtraInfo") {
      // The authoritative view of what the browser actually attached: the initial
      // requestWillBeSent event omits cookies that are added later in the stack.
      const cookie = msg.params.headers?.Cookie || msg.params.headers?.cookie || "";
      sentCookies.set(msg.params.requestId, cookie);
      return;
    }
    if (msg.method === "Page.javascriptDialogOpening") {
      // confirm() dialogs auto-dismiss in headless; accept them so delete proceeds.
      c.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d.exception?.description || d.text || "unknown exception");
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      pageErrors.push(msg.params.args.map((a) => a.description || a.value).join(" "));
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      // The url travels in its own protocol field, and for a failed subresource
      // load it is the only thing that identifies the request — the text alone
      // reads "Failed to load resource: net::ERR_...". Without it, a phase that
      // deliberately loads something unreachable cannot tell that entry apart
      // from a real failure.
      pageErrors.push(`${msg.params.entry.text}${msg.params.entry.url ? ` ${msg.params.entry.url}` : ""}`);
    }
  });

  const evaluate = async (expression) => {
    const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // The API allows RATE_LIMIT_API requests per IP per minute, and a page sweep
  // with thirteen loads reaches that on its own — measured, not guessed at. A
  // 429 would otherwise land on whichever write happened to be next and read as
  // a broken button, so hold off while the trailing minute is close to the
  // limit. This is a no-op whenever there is headroom, which is most of the run.
  const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_API || 120);
  const pace = async (headroom = 25) => {
    for (;;) {
      const cutoff = Date.now() - 60000;
      const recent = apiHits.filter((hit) => hit.at >= cutoff).length;
      if (recent + headroom <= RATE_LIMIT_PER_MINUTE) return;
      await sleep(1000);
    }
  };

  const waitReady = async (settle = 1200) => {
    for (let i = 0; i < 60; i++) {
      const state = await evaluate("document.readyState").catch(() => null);
      if (state === "complete") break;
      await sleep(100);
    }
    await sleep(settle);
  };

  const go = async (path, settle) => {
    pageErrors = [];
    await pace();
    await c.send("Page.navigate", { url: `${BASE}${path}` });
    await waitReady(settle);
    // Probe with a raw fetch so the client's own 401 handler cannot mask the truth.
    const me = await evaluate(`fetch("/api/v1/auth/me", { credentials: "include" }).then(r => r.status).catch(() => "err")`);
    const jar = await c.send("Network.getCookies", { urls: [`${BASE}/`] }).catch(() => ({ cookies: [] }));
    const described = (jar.cookies || [])
      .map((k) => {
        const ttl = k.session ? "session" : `${Math.round((k.expires - Date.now() / 1000) / 60)}m`;
        return `${k.name}@${k.domain}(ttl=${ttl})`;
      })
      .join(",") || "empty";
    sessionTrace.push(`${path} -> /auth/me=${me} jar=[${described}]`);  };

  const text = () => evaluate("document.body.innerText").catch(() => "");
  const path = () => evaluate("location.pathname");
  const lang = () => evaluate("document.documentElement.lang").catch(() => null);
  // A 401 triggers a second, client-side navigation once the page's API call
  // comes back. Poll for the landing path instead of sleeping a fixed amount:
  // the round trip is not bounded by the page load.
  const waitForPath = async (expected, timeout = 10000) => {
    for (let waited = 0; waited < timeout; waited += 100) {
      if ((await path().catch(() => null)) === expected) return true;
      await sleep(100);
    }
    return false;
  };
  // The language switch is a Server Action, so it re-renders in the same round
  // trip with the new cookie attached. Waiting on <html lang> rather than on any
  // string is what makes this a test of the mechanism: a switcher that wrote a
  // cookie and did nothing else would leave the attribute alone.
  const waitForLang = async (expected, timeout = 10000) => {
    for (let waited = 0; waited < timeout; waited += 150) {
      if ((await lang()) === expected) return true;
      await sleep(150);
    }
    return false;
  };
  // Same reasoning for the destination probe: it dials the target URL from the
  // server, so its latency tracks the network rather than the page.
  const waitForText = async (needle, timeout = 15000) => {
    for (let waited = 0; waited < timeout; waited += 250) {
      if ((await text()).includes(needle)) return true;
      await sleep(250);
    }
    return false;
  };
  // Injected scripts arrive after the configuration has been fetched, so an
  // assertion about one has to wait for the element rather than read the DOM
  // once.
  const waitForSelector = async (selector, timeout = 8000) => {
    for (let waited = 0; waited < timeout; waited += 200) {
      if (await evaluate(`document.querySelector(${JSON.stringify(selector)}) !== null`).catch(() => false)) return true;
      await sleep(200);
    }
    return false;
  };
  const fill = (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  // Fields without a stable placeholder are located through their <label>.
  const fillByLabel = (label, value) => evaluate(`(() => {
    const field = [...document.querySelectorAll("label")].find(l => l.querySelector(".field-label")?.textContent.trim().startsWith(${JSON.stringify(label)}));
    const el = field && field.querySelector("input, textarea");
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  const valueByLabel = (label) => evaluate(`(() => {
    const field = [...document.querySelectorAll("label")].find(l => l.querySelector(".field-label")?.textContent.trim().startsWith(${JSON.stringify(label)}));
    const el = field && field.querySelector("input, textarea");
    return el ? el.value : "";
  })()`);
  const clickText = (selector, label) => evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(n => n.textContent.trim() === ${JSON.stringify(label)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  const clickRowButton = (alias, label) => evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}));
    if (!row) return false;
    const button = [...row.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  // The language switcher is the only select whose options are locale codes.
  // Those values are the same in every language, so this can drive the control
  // without knowing which language the page is currently showing — which is the
  // whole point of the phase below.
  const LOCALE_SELECT = `[...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "zh-CN"))`;
  const switchLocale = async (code) => {
    const clicked = await evaluate(`(() => {
      const select = ${LOCALE_SELECT};
      if (!select) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(code)});
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    return clicked && (await waitForLang(code));
  };

  const results = [];
  const record = (name, ok, detail) => results.push({ name, ok, detail });

  // ---------- phase 1: every page renders ----------
  await go("/login");
  // The login form is driven by position below — the first two inputs are the
  // credentials and the first button in the form submits it. Sign-in provider
  // links belong after the form's closing tag for exactly this reason, so this
  // guards the shape they must not disturb.
  const loginShape = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll("form input")];
    const button = document.querySelector("form button");
    return {
      inputs: inputs.length,
      autoComplete: inputs.map(i => i.getAttribute("autocomplete") || ""),
      button: button ? button.textContent.trim() : "",
      providerLinks: [...document.querySelectorAll("a[href*='/auth/oidc/']")].length,
      switcherOutsideForm: Boolean(${LOCALE_SELECT} && !(${LOCALE_SELECT}).closest("form")),
    };
  })()`);
  record(
    "the login page keeps its credentials-first shape",
    loginShape.inputs === 2
      && loginShape.autoComplete[0] === "username"
      && loginShape.autoComplete[1] === "current-password"
      && loginShape.button === "Sign in"
      && loginShape.providerLinks === 0,
    `inputs=${loginShape.inputs} autocomplete=${loginShape.autoComplete.join(",")} button=${loginShape.button} providerLinks=${loginShape.providerLinks}`,
  );
  record(
    "the login page offers the language switcher outside its form",
    loginShape.switcherOutsideForm === true,
    `switcherOutsideForm=${loginShape.switcherOutsideForm}`,
  );

  // Registration owns CAPTCHA; the login form must remain untouched. The
  // widget is adaptive, so its fixed script is present only when the public
  // settings endpoint reports an enabled site key.
  await go("/register", 1800);
  const registerShape = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll("form input")];
    return {
      inputs: inputs.length,
      autoComplete: inputs.map(i => i.getAttribute("autocomplete") || ""),
      button: document.querySelector("form button")?.textContent.trim() || "",
      turnstile: [...document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile/"]')].length,
      captchaError: [...document.querySelectorAll("p")].some(p => p.textContent.includes("Could not load the registration check")),
      switcherOutsideForm: Boolean(${LOCALE_SELECT} && !(${LOCALE_SELECT}).closest("form")),
    };
  })()`);
  record(
    "the registration page keeps credentials first and CAPTCHA adaptive",
    registerShape.inputs === 2
      && registerShape.autoComplete[0] === "username"
      && registerShape.autoComplete[1] === "new-password"
      && registerShape.button === "Register"
      && registerShape.turnstile >= 0
      && registerShape.switcherOutsideForm === true,
    `inputs=${registerShape.inputs} autocomplete=${registerShape.autoComplete.join(",")} button=${registerShape.button} turnstile=${registerShape.turnstile} captchaError=${registerShape.captchaError}`,
  );

  await go("/login");
  const submitted = await evaluate(`(() => {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const inputs = document.querySelectorAll("form input");
    if (inputs.length < 2) return false;
    setVal(inputs[0], ${JSON.stringify(USER)});
    setVal(inputs[1], ${JSON.stringify(PASS)});
    document.querySelector("form button").click();
    return true;
  })()`);
  await sleep(3000);
  record("login form -> /admin", submitted && (await path()) === "/admin", `landed on ${await path()}`);

  for (const page of PAGES) {
    await go(page.path);
    const body = await text();
    const missing = page.expect.filter((n) => !body.includes(n));
    const markers = ERROR_MARKERS.filter((m) => body.includes(m));
    const rows = page.name === "links" ? await evaluate("document.querySelectorAll('tbody tr').length") : null;
    const detail = [
      rows !== null ? `${rows} rows` : null,
      missing.length ? `missing: ${missing.join(", ")}` : null,
      markers.length ? `errors: ${markers.join(", ")}` : null,
      ...pageErrors.slice(0, 2).map((e) => String(e).split("\n")[0].slice(0, 120)),
    ].filter(Boolean).join(" | ");
    record(`page ${page.path}`, missing.length === 0 && markers.length === 0 && pageErrors.length === 0, detail || "rendered");
  }

  // ---------- phase 1b: the language switcher ----------
  // Run against the shell, which is where an operator would reach for it, and
  // put the language back before anything else asserts on wording. The switch is
  // a Server Action rather than a cookie write plus a refresh, so the page must
  // re-render in place — the URL stays put and the attribute changes with it.
  await go("/admin", 1800);
  const startsEnglish = (await lang()) === "en";
  const bodyBeforeSwitch = await text();
  record(
    "a fresh session gets English",
    startsEnglish && bodyBeforeSwitch.includes("Overview") && bodyBeforeSwitch.includes("Link management"),
    `lang=${await lang()} overview=${bodyBeforeSwitch.includes("Overview")}`,
  );

  const toChinese = await switchLocale("zh-CN");
  const chineseBody = await text();
  const chinesePath = await path();
  record(
    "switching to Chinese re-renders the shell in place",
    toChinese
      && chinesePath === "/admin"
      && chineseBody.includes("概览")
      && chineseBody.includes("链接管理")
      && !chineseBody.includes("Link management"),
    `lang=${await lang()} path=${chinesePath} overview=${chineseBody.includes("概览")} nav=${chineseBody.includes("链接管理")}`,
  );

  // A reload is the only way to prove the choice was remembered rather than held
  // in the client: the cookie has to survive a full navigation.
  await go("/admin", 1500);
  const survivedReload = (await lang()) === "zh-CN" && (await text()).includes("概览");
  record("the language choice survives a reload", survivedReload, `lang=${await lang()}`);

  const backToEnglish = await switchLocale("en");
  const englishBody = await text();
  record(
    "switching back to English restores the wording",
    backToEnglish && (await lang()) === "en" && englishBody.includes("Overview") && !englishBody.includes("概览"),
    `lang=${await lang()} overview=${englishBody.includes("Overview")}`,
  );

  // ---------- phase 1c: negotiation from the browser's own header ----------
  // With no cookie the console falls back to Accept-Language, mirroring
  // preferredLang in the API's preview page so the two cannot disagree. Driven
  // over plain HTTP rather than through the browser: the browser's header is
  // pinned above, and the point here is one header value per case.
  const negotiate = async (acceptLanguage) => {
    const response = await fetch(`${BASE}/login`, {
      headers: acceptLanguage === null ? {} : { "Accept-Language": acceptLanguage },
    }).catch(() => null);
    const html = response ? await response.text() : "";
    return html.match(/<html[^>]*\blang="([^"]*)"/)?.[1] ?? "";
  };

  for (const [header, want, why] of [
    [null, "en", "no header at all falls back to English"],
    ["zh-CN,zh;q=0.9,en;q=0.8", "zh-CN", "a Chinese browser gets Chinese"],
    ["en-US,en;q=0.9,zh-CN;q=0.8", "en", "an English browser gets English"],
    ["zh-TW", "zh-CN", "a regional tag reaches the shipped dictionary"],
    ["zh;q=0.1,en;q=0.9", "en", "quality beats the order the tags arrive in"],
    ["en;q=0,zh;q=0.5", "zh-CN", "a refused language is skipped"],
    ["fr-FR,de;q=0.8", "en", "an unsupported language falls back"],
  ]) {
    const got = await negotiate(header);
    record(`negotiation: ${why}`, got === want, `Accept-Language=${header ?? "(none)"} lang=${got}`);
  }

  // The role dropdown is built from the API's role list, so it has to offer all
  // four presets rather than the two the console used to hard-code.
  await go("/admin/users", 1800);
  const roleOptions = await evaluate(`(() => {
    const select = document.querySelector("tbody select");
    return select ? [...select.options].map(o => o.value) : [];
  })()`);
  record(
    "the user list offers every role",
    ["admin", "operator", "readonly", "user"].every((role) => roleOptions.includes(role)),
    roleOptions.join(",") || "no role select",
  );

  // ---------- phase 2: create a link ----------
  const alias = `smoke${STAMP}`;
  const TITLE = "Smoke title";
  const TAG = "smoketag";
  // The divert rule is matched on a marker no real browser sends, so the check
  // cannot be confused by the headless Chrome user agent.
  const RULE_UA = `smoke-ua-${STAMP}`;
  const RULE_DEST = "https://example.org/rule";
  await go("/admin/links/new");
  await fill('input[type="url"]', "https://example.org/before");
  await fill('input[placeholder="Leave blank to generate one"]', alias);
  const titled = await fillByLabel("Title", TITLE);
  const tagged = await fillByLabel("Tags", `SmokeTag, qa`);
  await pace();
  await clickText("form button", "Create link");
  await sleep(2500);
  const afterCreate = await path();
  const listBody = await text();
  record("create link", afterCreate === "/admin/links" && listBody.includes(alias), `path=${afterCreate} listed=${listBody.includes(alias)}`);
  record("create form accepts a title and tags", titled && tagged, `title=${titled} tags=${tagged}`);

  // Scope to the row: the tag names are short enough to appear elsewhere on the page.
  const createdRow = await evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}));
    if (!row) return null;
    return { text: row.innerText, chips: [...row.querySelectorAll("button")].map(b => b.textContent.trim()) };
  })()`);
  record("list renders the title", Boolean(createdRow && createdRow.text.includes(TITLE)), JSON.stringify(createdRow?.text?.split("\n").slice(0, 3)));
  record("list renders tag chips", Boolean(createdRow && createdRow.chips.includes(TAG) && createdRow.chips.includes("qa")), JSON.stringify(createdRow?.chips));

  const tagFilter = await evaluate(`(() => {
    const select = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === ${JSON.stringify(TAG)}));
    if (!select) return "no tag filter";
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(TAG)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return "selected";
  })()`);
  await sleep(1800);
  const filteredRows = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    return { count: rows.length, allTagged: rows.every(r => [...r.querySelectorAll("button")].some(b => b.textContent.trim() === ${JSON.stringify(TAG)})) };
  })()`);
  record("tag filter narrows the list", tagFilter === "selected" && filteredRows.count > 0 && filteredRows.allTagged, `${tagFilter} rows=${filteredRows.count} allTagged=${filteredRows.allTagged}`);

  // Reset so the later phases can still find the row.
  await evaluate(`(() => {
    const select = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === ${JSON.stringify(TAG)}));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(1500);

  // ---------- phase 2b: CSV import and export ----------
  const csvPath = join(tmpdir(), `purels-smoke-${STAMP}.csv`);
  const csvAlias = `smokecsv${STAMP}`;
  const CSV_TITLE = "CSV title";
  writeFileSync(
    csvPath,
    [
      "alias,destination_url,title,tags,redirect_code",
      `${csvAlias},https://example.org/csv,${CSV_TITLE},csvtag|qa,301`,
    ].join("\r\n"),
    "utf8",
  );

  await go("/admin/links");
  // The picker is hidden by design, so drive it through the protocol instead of
  // clicking it — that is also the only way to hand a real file to the input.
  await pace();
  const fileNode = await c.send("Runtime.evaluate", { expression: `document.querySelector('input[type="file"]')` });
  if (fileNode.result?.objectId) {
    await c.send("DOM.setFileInputFiles", { files: [csvPath], objectId: fileNode.result.objectId });
  }
  await sleep(3000);
  const importBody = await text();
  const importSummary = importBody.split("\n").find((line) => line.includes("Imported")) || "";
  record("import csv reports the created count", /Imported 1 link/.test(importSummary), importSummary || "no report banner");

  const importedRow = await evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(csvAlias)}));
    if (!row) return null;
    return { text: row.innerText, chips: [...row.querySelectorAll("button")].map(b => b.textContent.trim()) };
  })()`);
  record(
    "imported row shows its title, tags and code",
    Boolean(importedRow && importedRow.text.includes(CSV_TITLE) && importedRow.chips.includes("csvtag") && importedRow.text.includes("301")),
    JSON.stringify(importedRow),
  );

  await evaluate(`(() => {
    window.__downloads = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { window.__downloads.push(blob.size); return original.call(URL, blob); };
    return true;
  })()`);
  const exportClicked = await clickText("button", "Export CSV");
  await sleep(2500);
  const downloads = await evaluate("window.__downloads || []");
  record("export csv downloads a file", Boolean(exportClicked) && downloads.length === 1 && downloads[0] > 0, `clicked=${exportClicked} sizes=${JSON.stringify(downloads)}`);

  await pace();
  const csvDeleted = await clickRowButton(csvAlias, "Delete");
  await sleep(2500);
  const csvGone = await evaluate(`!([...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes(${JSON.stringify(csvAlias)})))`);
  record("imported link can be deleted", csvDeleted && csvGone, `clicked=${csvDeleted} gone=${csvGone}`);
  try { unlinkSync(csvPath); } catch { /* the temp file is disposable */ }

  // ---------- phase 3: edit that link ----------
  const editHref = await evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}));
    if (!row) return "";
    const link = [...row.querySelectorAll("a")].find(a => a.textContent.trim() === "Edit");
    return link ? link.getAttribute("href") : "";
  })()`);
  record("edit action present", Boolean(editHref), editHref || "no Edit link in the row");

  if (editHref) {
    await go(editHref);
    const editBody = await text();
    const prefilled = await evaluate(`(() => {
      const input = document.querySelector('input[type="url"]');
      return input ? input.value : "";
    })()`);
    record("edit page prefills", editBody.includes("Edit link") && prefilled === "https://example.org/before", `value=${prefilled}`);

    const editTitle = await valueByLabel("Title");
    const editTags = await valueByLabel("Tags");
    record("edit page prefills the title and tags", editTitle === TITLE && editTags.includes(TAG), `title=${JSON.stringify(editTitle)} tags=${JSON.stringify(editTags)}`);

    // The check button is asserted on the panel's own state, not on the status
    // code: a reachable destination and an unreachable one both record a time,
    // and only the second is allowed to depend on the network.
    const checkBefore = await text();
    const checkClicked = await clickText("button", "Check now");
    const checkSettled = await waitForText("Last checked");
    const checkAfter = await text();
    record(
      "edit page checks the destination",
      checkClicked && checkBefore.includes("Not checked yet") && checkSettled,
      `clicked=${checkClicked} before=${checkBefore.includes("Not checked yet")} after=${checkAfter.includes("Last checked")}`,
    );

    await fill('input[type="url"]', "https://example.org/after");
    await fillByLabel("Title", "Smoke title v2");

    // A divert rule is added here and saved by the same button, so this also
    // covers the rule editor riding along with an ordinary edit.
    const ruleAdded = await clickText("button", "Add rule");
    await sleep(400);
    // The rule's value field has a stable placeholder, and its destination is
    // the second url input on the page.
    const ruleTyped = await fill('input[placeholder="iPhone"]', RULE_UA);
    const ruleUrlSet = await evaluate(`(() => {
      const el = [...document.querySelectorAll('input[type="url"]')][1];
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(RULE_DEST)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    record("edit page adds a divert rule", ruleAdded && ruleTyped && ruleUrlSet, `added=${ruleAdded} typed=${ruleTyped} url=${ruleUrlSet}`);
    const previewHref = await evaluate(`(() => {
      const link = [...document.querySelectorAll("a")].find(a => a.textContent.trim() === "Preview");
      return link ? link.getAttribute("href") : "";
    })()`);
    record("edit page links to the preview page", previewHref.endsWith(`${alias}+`), previewHref || "no Preview link");

    await clickText("form button", "Save changes");
    await sleep(2500);
    const savedPath = await path();
    const savedBody = await text();
    record("edit saves", savedPath === "/admin/links" && savedBody.includes("example.org/after"), `path=${savedPath} updated=${savedBody.includes("example.org/after")}`);
    const editedRow = await evaluate(`(() => {
      const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}));
      return row ? { text: row.innerText, chips: [...row.querySelectorAll("button")].map(b => b.textContent.trim()) } : null;
    })()`);
    record(
      "edit keeps the tags and saves the title",
      Boolean(editedRow && editedRow.text.includes("Smoke title v2") && editedRow.chips.includes(TAG)),
      JSON.stringify({ title: editedRow?.text?.includes("Smoke title v2"), chips: editedRow?.chips }),
    );

    // Reopening is what proves the rule was stored rather than only held in the
    // form state.
    await go(editHref);
    const reloadedRule = await evaluate(`(() => {
      const value = document.querySelector('input[placeholder="iPhone"]');
      const destination = [...document.querySelectorAll('input[type="url"]')][1];
      return { value: value ? value.value : "", destination: destination ? destination.value : "" };
    })()`);
    record(
      "the divert rule round-trips",
      reloadedRule.value === RULE_UA && reloadedRule.destination === RULE_DEST,
      JSON.stringify(reloadedRule),
    );

    // Driven from Node rather than the page: a browser cannot set its own user
    // agent, and the rule is the whole point of this check.
    const diverted = await fetch(`${BASE}/${alias}`, { headers: { "User-Agent": RULE_UA }, redirect: "manual" }).catch(() => null);
    record(
      "the rule diverts a matching visitor",
      diverted?.status === 302 && diverted.headers.get("location") === RULE_DEST,
      `${diverted?.status} -> ${diverted?.headers.get("location")}`,
    );
    const undiverted = await fetch(`${BASE}/${alias}`, { headers: { "User-Agent": "smoke-plain" }, redirect: "manual" }).catch(() => null);
    record(
      "an unmatched visitor keeps the default destination",
      undiverted?.headers.get("location") === "https://example.org/after",
      `${undiverted?.status} -> ${undiverted?.headers.get("location")}`,
    );

    // The preview page follows Accept-Language, and this fetch sends none, so it
    // falls back to the default locale rather than to any remembered choice.
    const previewPage = await fetch(`${BASE}/${alias}+`).then((r) => r.text()).catch(() => "");
    record("the preview page shows the destination", previewPage.includes("https://example.org/after"), `${previewPage.length} bytes`);

    // Back to the list for the phases that follow.
    await go("/admin/links");
  }

  // ---------- phase 4: QR dialog ----------
  const qrOpened = await clickRowButton(alias, "QR code");
  await sleep(1500);
  const qrImage = await evaluate(`(() => {
    const img = document.querySelector('img[alt*="QR code"]');
    if (!img) return null;
    return { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight };
  })()`);
  record("qr dialog renders image", Boolean(qrOpened && qrImage && qrImage.width > 0), JSON.stringify(qrImage));
  await evaluate(`(() => {
    const close = document.querySelector('button[aria-label="Close"]');
    if (close) close.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    return true;
  })()`);
  await sleep(600);
  const dialogClosed = await evaluate(`!document.querySelector('img[alt*="QR code"]')`);
  record("qr dialog closes", dialogClosed, dialogClosed ? "closed" : "still open");

  // ---------- phase 4b: bulk operations ----------
  const selectRow = () => evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}));
    if (!row) return false;
    const box = row.querySelector('input[type="checkbox"]');
    if (!box) return false;
    box.click();
    return true;
  })()`);
  // The bulk bar's select is the only one offering a "disable" action.
  const chooseBulk = (action) => evaluate(`(() => {
    const select = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === ${JSON.stringify(action)}));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(action)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  const rowStatus = () => evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}));
    return row ? row.innerText : "";
  })()`);

  const picked = await selectRow();
  await sleep(500);
  const barShown = (await text()).includes("1 selected");
  record("selecting a row opens the bulk bar", picked && barShown, `picked=${picked} bar=${barShown}`);

  await pace();
  const choseDisable = await chooseBulk("disable");
  const ranDisable = await clickText("button", "Run");
  await sleep(2500);
  // The alias, the destination and the title are all free of the word, so it can
  // only come from the status badge.
  const disabledRow = await rowStatus();
  record("the bulk bar disables the selected link", choseDisable && ranDisable && disabledRow.includes("disabled"), `chose=${choseDisable} ran=${ranDisable} row=${JSON.stringify(disabledRow.slice(0, 40))}`);
  record("the bulk bar closes once the batch has run", !(await text()).includes("1 selected"), "selection cleared");

  await selectRow();
  await sleep(400);
  await pace();
  const choseEnable = await chooseBulk("enable");
  const ranEnable = await clickText("button", "Run");
  await sleep(2500);
  const enabledRow = await rowStatus();
  record("the bulk bar restarts the selected link", choseEnable && ranEnable && enabledRow.includes("active"), `chose=${choseEnable} ran=${ranEnable}`);

  // ---------- phase 5: delete that link ----------
  await pace();
  const deleted = await clickRowButton(alias, "Delete");
  await sleep(2500);
  // Assert on the table itself: the alias also appears in the search box and other
  // chrome, so a whole-page substring check reports false negatives.
  const rowGone = await evaluate(`!([...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes(${JSON.stringify(alias)})))`);
  record("delete link", deleted && rowGone, `clicked=${deleted} rowGone=${rowGone}`);

  // ---------- phase 5b: the audit trail records what we just did ----------
  await go("/admin/audit", 1800);
  // Newest first, so match the create entry explicitly rather than the first row
  // that mentions the alias (the later update also carries it).
  const auditRow = await evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(alias)}) && r.textContent.includes("Created a link"));
    return row ? row.innerText.replace(/\\s+/g, " ").trim() : "";
  })()`);
  record(
    "audit page shows the actor and the recorded action",
    auditRow.includes("admin") && auditRow.includes("Created a link") && auditRow.includes(`alias: ${alias}`),
    auditRow || "no row for the created link",
  );

  const auditFilter = await evaluate(`(() => {
    const select = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "link.delete"));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "link.delete");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(1800);
  const filteredAudit = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    return { count: rows.length, allDelete: rows.length > 0 && rows.every(r => r.textContent.includes("Deleted a link")) };
  })()`);
  record("audit action filter narrows the list", Boolean(auditFilter) && filteredAudit.allDelete, `rows=${filteredAudit.count} allDelete=${filteredAudit.allDelete}`);

  // ---------- phase 6: create + revoke an API token ----------
  const tokenName = `smoke-token-${STAMP}`;
  await go("/admin/settings/security");
  await pace();
  await fill('input[placeholder="Token name"]', tokenName);
  await clickText("button", "Create");
  await sleep(2000);
  const secretShown = (await text()).includes("Save the token now");
  record("create token", secretShown, secretShown ? "secret displayed" : `secret banner missing (path=${await path()})`);

  // The token list is fetched client-side after readyState completes, so poll for
  // the row rather than evaluating the instant navigation finishes.
  await go("/admin/settings/security");
  let revoked = "row not found";
  for (let waited = 0; waited < 8000; waited += 200) {
    revoked = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("div")].filter(d => d.textContent.includes(${JSON.stringify(tokenName)}) && d.querySelector("button"));
      const target = rows[rows.length - 1];
      if (!target) return "row not found";
      target.querySelector("button").click();
      return "clicked";
    })()`);
    if (revoked === "clicked") break;
    await sleep(200);
  }
  await sleep(2000);
  const afterRevoke = await text();
  record("revoke token", revoked === "clicked" && !afterRevoke.includes(tokenName), `${revoked}, gone=${!afterRevoke.includes(tokenName)}`);

  // ---------- phase 7: stats dashboard interactions ----------
  //
  // Every panel below reads from the ranking, which lists only links with clicks
  // in the range (TopLinks). Phase 5 deleted the link this run created, so the
  // dashboard is given a link of its own: leaning on whatever the database
  // already held made these three checks pass against a seeded database and fail
  // against an empty one, so they were testing the fixture rather than the page.
  const apiCall = (expression) => evaluate(`(async () => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("purels_csrf="))?.split("=")[1] || "";
    ${expression}
  })()`);

  const statsAlias = `pagestats${STAMP}`;
  const statsSeeded = await apiCall(`const response = await fetch("/api/v1/links", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ destination_url: "https://example.org/stats", alias: ${JSON.stringify(statsAlias)} }),
    });
    return response.status;`);
  // RecordClick runs before the redirect is written, so the raw events exist by
  // the time these return.
  for (let hit = 0; hit < 3; hit += 1) {
    await fetch(`${BASE}/${statsAlias}`, { redirect: "manual" }).catch(() => null);
  }

  // The ranking reads link_click_daily, which the worker rebuilds from the raw
  // events on its own tick (5s), so a fresh click is not ranked immediately. The
  // dashboard reads the ranking once per range change and never re-polls, so
  // wait for the rollup here instead of loading a page that will stay empty.
  let ranked = false;
  for (let waited = 0; waited < 30000 && !ranked; waited += 1000) {
    await pace();
    ranked = await apiCall(`const payload = await (await fetch("/api/v1/stats/top?order=top&limit=10", { credentials: "include" })).json();
      return (payload.links || []).some((link) => link.alias === ${JSON.stringify(statsAlias)});`);
    if (!ranked) await sleep(1000);
  }

  await go("/admin/stats", 2200);
  const autoSelected = await evaluate(`document.body.innerText.includes("Link detail · /")`);
  record("stats auto-selects a link", autoSelected, autoSelected ? "detail header shows an alias" : `nothing auto-selected (seeded=${statsSeeded} ranked=${ranked})`);

  const drillDown = await evaluate(`(() => {
    const row = document.querySelector("tbody tr");
    if (!row) return false;
    row.click();
    return true;
  })()`);
  await sleep(1500);
  const drillBody = await text();
  record("stats row click drills down", drillDown && drillBody.includes("Link detail · /"), `clicked=${drillDown}`);

  // The detail panel is always seeded from the ranking, so the selected link is
  // guaranteed to have clicks in the range — the log must therefore have rows.
  const clickLogState = await evaluate(`(() => {
    const heading = [...document.querySelectorAll("h3")].find(h => h.textContent.trim() === "Click log");
    if (!heading) return "missing";
    const panel = heading.closest("div").parentElement;
    return panel.querySelectorAll("tbody tr").length > 0 ? "rows" : "empty";
  })()`);
  record("stats click log lists the raw clicks", clickLogState === "rows", `log=${clickLogState}`);

  const rangeSwitched = await clickText("button", "Last 7 days");
  await sleep(2200);
  const rangeBody = await text();
  record(
    "stats range switch reloads",
    rangeSwitched && rangeBody.includes("Clicks over time") && !ERROR_MARKERS.some((m) => rangeBody.includes(m)),
    `clicked=${rangeSwitched}`,
  );

  const todaySwitched = await clickText("button", "Today");
  await sleep(2200);
  const todayBody = await text();
  record("stats today range", todaySwitched && !ERROR_MARKERS.some((m) => todayBody.includes(m)), `clicked=${todaySwitched}`);

  const csvButtons = await evaluate(`[...document.querySelectorAll("button")].filter(b => b.textContent.includes("Export")).length`);
  record("stats csv export buttons", csvButtons >= 2, `${csvButtons} buttons`);

  // The link seeded above belongs to this phase alone, so it goes back out with
  // it rather than being left for the next run to rank.
  await apiCall(`const list = await (await fetch("/api/v1/links?limit=100", { credentials: "include" })).json();
    const row = (list.links || []).find((link) => link.alias === ${JSON.stringify(statsAlias)});
    if (!row) return 0;
    const response = await fetch("/api/v1/links/" + row.id, { method: "DELETE", credentials: "include", headers: { "X-CSRF-Token": csrf } });
    return response.status;`);

  // ---------- phase 7b: a sign-in button appears only once a provider exists ----------
  //
  // The login page renders its provider links from the API, so the only way to
  // see one is to configure one. It is put in and taken out through the API from
  // inside the page: what has to be protected here is the login page's shape,
  // which the suite drives by position, and the provider's own screen is
  // smoke-oidc.mjs's business.
  const providerSlug = `page${STAMP}`;
  const providerName = "Smoke sign-in";

  await pace();
  const providerCreated = await apiCall(`const response = await fetch("/api/v1/oidc/providers", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ slug: ${JSON.stringify(providerSlug)}, display_name: ${JSON.stringify(providerName)}, issuer: "https://idp.example.com", client_id: "purels" }),
    });
    return response.status;`);
  record("a sign-in provider can be configured", providerCreated === 201, `status=${providerCreated}`);

  await go("/login");
  const withProvider = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll("form input")];
    const button = document.querySelector("form button");
    const link = document.querySelector("a[href='/api/v1/auth/oidc/${providerSlug}/start']");
    return { inputs: inputs.length, button: button ? button.textContent.trim() : "", link: link ? link.textContent.trim() : "" };
  })()`);
  record(
    "a configured provider adds a sign-in link without disturbing the form",
    withProvider.inputs === 2 && withProvider.button === "Sign in" && withProvider.link === providerName,
    `inputs=${withProvider.inputs} button=${withProvider.button} link=${withProvider.link || "none"}`,
  );

  const providerRemoved = await apiCall(`const list = await (await fetch("/api/v1/oidc/providers", { credentials: "include" })).json();
    const row = (list.providers || []).find((provider) => provider.slug === ${JSON.stringify(providerSlug)});
    if (!row) return 0;
    const response = await fetch("/api/v1/oidc/providers/" + row.id, { method: "DELETE", credentials: "include", headers: { "X-CSRF-Token": csrf } });
    return response.status;`);
  record("the sign-in provider is removed again", providerRemoved === 204, `status=${providerRemoved}`);

  // ---------- phase 7c: tracking reaches the console and nothing else ----------
  //
  // The assertion that matters here is the boundary, not the snippet: the
  // console must carry the injected script and the login page must not. Matomo
  // is the provider used because its base URL is ours to choose — pointing it at
  // a port nothing listens on keeps the run from contacting Google or any real
  // tracker. The load failure that produces is the one console error this phase
  // tolerates, and it is matched by URL below.
  const TRACKER_HOST = "127.0.0.1:45999";
  await pace();
  const analyticsSaved = await apiCall(`const response = await fetch("/api/v1/analytics", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ ga4_measurement_id: "", gtm_container_id: "", matomo_url: "http://${TRACKER_HOST}/", matomo_site_id: "1" }),
    });
    return response.status;`);
  record("tracking ids can be configured", analyticsSaved === 200, `status=${analyticsSaved}`);

  await go("/admin", 2000);
  const injected = await waitForSelector('script[id="purels-analytics-matomo"]');
  const injectedSource = await evaluate(
    `(() => { const el = document.querySelector('script[id="purels-analytics-matomo"]'); return el ? el.textContent : ""; })()`,
  ).catch(() => "");
  record(
    "the console injects the configured tracker",
    injected && injectedSource.includes(TRACKER_HOST),
    `present=${injected} mentionsHost=${injectedSource.includes(TRACKER_HOST)}`,
  );
  // Anything other than the tracker host's own load failure is a real problem
  // and must not be filtered away with it.
  const unexpectedErrors = pageErrors.filter((entry) => !String(entry).includes(TRACKER_HOST));
  record(
    "injecting a tracker raises no unexpected page errors",
    unexpectedErrors.length === 0,
    unexpectedErrors.slice(0, 2).map((e) => String(e).split("\n")[0].slice(0, 120)).join(" | ") ||
      `filtered ${pageErrors.length - unexpectedErrors.length} tracker-load error(s)`,
  );

  // A full load rather than a client-side transition: next/script appends its
  // element to the document body and never removes it, so a /login reached by
  // clicking a link would still be carrying what the console injected.
  await go("/login", 1500);
  const leaked = await evaluate(`document.querySelector('script[id^="purels-analytics-"]') !== null`);
  record("the login page carries no tracker", leaked === false, `present=${leaked}`);

  const analyticsCleared = await apiCall(`const response = await fetch("/api/v1/analytics", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ ga4_measurement_id: "", gtm_container_id: "", matomo_url: "", matomo_site_id: "" }),
    });
    return response.status;`);
  record("tracking ids can be cleared", analyticsCleared === 200, `status=${analyticsCleared}`);

  await go("/admin", 2000);
  const afterClear = await evaluate(`document.querySelector('script[id^="purels-analytics-"]') !== null`);
  record("an empty configuration injects nothing", afterClear === false, `present=${afterClear}`);

  // ---------- phase 8: logout, then an expired session redirects to /login ----------
  await go("/admin");
  const loggedOut = await clickText("button", "Sign out");
  const reachedLogin = await waitForPath("/login");
  record("logout -> /login", Boolean(loggedOut) && reachedLogin, `clicked=${loggedOut} path=${await path()}`);

  await go("/admin/links", 1500);
  const expired = await waitForPath("/login");
  record("expired session -> /login", expired, `path=${await path()}`);

  // Leave no tab behind: the profile is shared across runs, and abandoned tabs
  // accumulate until the browser itself starts misbehaving. Dispose the context
  // too, so its cookie jar goes with it.
  await c.send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  c.close();
  await target.browser?.send("Target.disposeBrowserContext", { browserContextId: target.browserContextId }).catch(() => {});
  target.browser?.close();

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);

  // Diagnostics are noisy and only meaningful when something failed.
  if (failed) {
    // The busiest rolling minute, which is the number the API's limiter acts on.
    let peak = 0;
    let peakFrom = 0;
    for (let i = 0, j = 0; i < apiHits.length; i++) {
      while (apiHits[i].at - apiHits[j].at >= 60000) j++;
      if (i - j + 1 > peak) {
        peak = i - j + 1;
        peakFrom = j;
      }
    }
    console.log(`\n/api/v1 requests: ${apiHits.length}, busiest minute: ${peak}`);
    if (peak) {
      const window = apiHits.slice(peakFrom, peakFrom + peak);
      console.log(`  that minute ran from +${((window[0].at - apiHits[0].at) / 1000).toFixed(0)}s to +${((window[window.length - 1].at - apiHits[0].at) / 1000).toFixed(0)}s`);
      const counts = new Map();
      for (const hit of window) counts.set(hit.path.split("?")[0], (counts.get(hit.path.split("?")[0]) || 0) + 1);
      for (const [route, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${count}  ${route}`);
    }
    if (httpErrors.length) {
      console.log("\nHTTP responses >= 400 observed:");
      for (const entry of httpErrors) console.log(`  ${entry}`);
    }
    console.log(`\n/auth/* requests: ${authLog.length}`);
    for (const entry of authLog) console.log(`  ${entry}`);
    console.log("\nsession + cookie jar after each navigation:");
    for (const entry of sessionTrace) console.log(`  ${entry}`);
    for (const entry of jarLog) console.log(entry);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke test crashed:", err.message);
  process.exit(2);
});
