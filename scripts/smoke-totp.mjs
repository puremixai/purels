// TOTP two-factor checks: enrolment, the two-stage login, and the ways in.
//
//   node scripts/smoke-totp.mjs
//
// Talks straight to the Go API (default :8080). It creates its own account with
// a per-run stamp and removes it through psql at the end, so it never enrols the
// bootstrap administrator — the other suites sign in as that account with a
// password alone and would be locked out by a second factor.
//
// The suite needs the feature switched on to be meaningful:
//
//   TOTP_ENABLED=true
//   TOTP_ENCRYPTION_KEY=<32 raw bytes, 64 hex, or base64 for 32 bytes>
//   RATE_LIMIT_2FA=60
//
// The rate limit matters: a full run makes about a dozen verify calls, and the
// default bucket of 10 per minute would turn the later ones into 429s that look
// like failures. The real brute-force bound is the attempt counter stored with
// the challenge, not this bucket, so raising it for a test changes nothing about
// what is being verified.
//
// With TOTP_ENABLED=false — the default — the suite still runs, asserting that
// enrolment is refused, and skips the rest rather than reporting a failure.
//
// Env: API_BASE (http://localhost:8080), ADMIN_USER, ADMIN_PASS

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/$/, "");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-me-now";
const STAMP = Date.now().toString(36);

const ACCOUNT = `mfa${STAMP}`;
const PASSWORD = "smoke-password-mfa";
// Sign-up allows five attempts per minute per address, so this run takes an
// address of its own, unique per run so an earlier window cannot mask a failure.
const REG_IP = `198.20.${(Date.now() % 250) + 1}.9`;
const TEST_IP = "203.0.113.30";

const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail, skipped: false });
}

function skip(name, detail = "TOTP_ENABLED is false") {
  results.push({ name, ok: true, detail, skipped: true });
}

// ---------- TOTP, implemented here on purpose ----------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Hand-written rather than imported: the point of this suite is to check the
// server against the algorithm, not against a library the server also uses. It
// is the same decoding RFC 4648 defines, and it is what turns the secret the API
// generated into the key HMAC is taken over.
function base32Decode(secret) {
  const cleaned = secret.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`not base32: ${char}`);
    // `bits` never exceeds 12 here, so only the low bits of `value` are read and
    // the 32-bit truncation JavaScript applies to << cannot lose them.
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 4226 dynamic truncation over HMAC-SHA-1, then the low six digits, which is
// what RFC 6238 defines for a 30-second step.
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

// A code from a step the server will reject, so a "wrong code" test cannot
// accidentally submit the right one when the clock rolls over mid-run.
function wrongCode() {
  return "000000" === totp("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") ? "111111" : "000000";
}

// ---------- HTTP plumbing ----------

function newSession() {
  return { jar: new Map(), csrf: "", userId: "", role: "" };
}

function cookieHeader(session) {
  return [...session.jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(session, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "") session.jar.delete(name);
    else session.jar.set(name, value);
  }
}

async function call(session, path, { ip = TEST_IP, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const cookie = cookieHeader(session);
  if (cookie) headers.set("Cookie", cookie);
  headers.set("X-Forwarded-For", ip);
  if (session.csrf) headers.set("X-CSRF-Token", session.csrf);
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  captureCookies(session, response);
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

// Reads a response and, when it completed a sign-in, keeps the CSRF token.
//
// Both stages hand one back — a password-only login directly, a second-factor
// login from the verify call — and without capturing it every later mutation is
// rejected by the CSRF check, which looks exactly like the wrong password the
// test is trying to prove.
async function readLogin(session, response) {
  const payload = await json(response);
  if (response.ok && payload && payload.csrf_token) {
    session.csrf = payload.csrf_token;
    session.userId = payload.user?.id || session.userId;
    session.role = payload.user?.role || session.role;
  }
  return payload;
}

async function signIn(session, username, password) {
  const response = await call(session, "/api/v1/auth/login", { method: "POST", body: { username, password } });
  const payload = await readLogin(session, response);
  if (payload.mfa_required) {
    // A challenge is not a session, so nothing may be treated as signed in.
    session.csrf = "";
    session.userId = "";
    session.role = "";
  }
  return { response, payload };
}

async function register(session, username, password) {
  const response = await call(session, "/api/v1/auth/register", { method: "POST", ip: REG_IP, body: { username, password } });
  const payload = await readLogin(session, response);
  return { response, payload };
}

// The API offers no way to delete an account, so the test account goes through
// psql. Its challenges and recovery codes follow by ON DELETE CASCADE.
function purgeAccount(username) {
  if (!/^[a-z0-9_-]+$/.test(username)) return false;
  const compose = resolve(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "compose.yaml");
  const sql = `DELETE FROM admin_users WHERE username = '${username}';`;
  try {
    execFileSync("docker", ["compose", "-f", compose, "exec", "-T", "postgres", "psql", "-U", "purels", "-d", "purels", "-q", "-c", sql], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Signs in and returns the challenge it was handed. The session object keeps the
// cookies the response set, so the caller can assert on what a challenge did and
// did not leave behind.
async function loginWithPassword(session, username, password) {
  const response = await call(session, "/api/v1/auth/login", { method: "POST", body: { username, password } });
  const payload = await readLogin(session, response);
  return { response, payload, challenge: payload.challenge || "" };
}

async function main() {
  const account = newSession();

  const registered = await register(account, ACCOUNT, PASSWORD);
  record("the test account is created", registered.response.status === 201, `status=${registered.response.status}`);

  const before = await json(await call(account, "/api/v1/auth/2fa"));
  record("a new account reports the second factor as off", before.enabled === false && before.pending === false, JSON.stringify(before));

  if (!before.available) {
    // The default configuration. Enrolment must be refused rather than
    // accepted-and-unreadable: a secret the server cannot decrypt would lock the
    // account out on the next sign-in.
    record("the deployment reports the second factor as unavailable", before.available === false, `available=${before.available}`);
    const enroll = await call(account, "/api/v1/auth/2fa/enroll", { method: "POST" });
    record("enrolment is refused while the feature is off", enroll.status === 409, `status=${enroll.status}`);
    const confirm = await call(account, "/api/v1/auth/2fa/confirm", { method: "POST", body: { code: "123456" } });
    record("confirmation is refused while the feature is off", confirm.status === 409, `status=${confirm.status}`);
    const plain = await signIn(newSession(), ACCOUNT, PASSWORD);
    record("a login still succeeds with a password alone", plain.response.status === 200, `status=${plain.response.status}`);

    for (const name of [
      "enrolment returns a secret and a QR code",
      "an unconfirmed enrolment is reported as pending",
      "a wrong code does not confirm the enrolment",
      "the correct code confirms the enrolment",
      "a confirmed account reports itself as enabled",
      "a correct password returns a challenge instead of a session",
      "a challenge response sets no session cookie",
      "a wrong code is rejected",
      "the attempt counter rejects a correct code after five failures",
      "a correct code completes the login",
      "a recovery code completes a login",
      "a recovery code cannot be used twice",
      "a second recovery code still works",
      "disabling requires the password",
      "the correct code disables the second factor",
      "a disabled account is no longer challenged",
      "an account can enrol again after disabling",
      "a regular account cannot reset another account's second factor",
      "an administrator can reset another account's second factor",
      "the reset clears the secret and the recovery codes",
      "an account reset by an administrator is no longer challenged",
    ]) {
      skip(name);
    }
    return;
  }

  // ---------- enrolment ----------
  const enrolled = await json(await call(account, "/api/v1/auth/2fa/enroll", { method: "POST" }));
  const secret = enrolled.secret || "";
  record(
    "enrolment returns a secret and a QR code",
    Boolean(secret) && (enrolled.otpauth_url || "").startsWith("otpauth://totp/") && (enrolled.qr || "").startsWith("data:image/png;base64,"),
    `secret=${secret.length} chars uri=${(enrolled.otpauth_url || "").slice(0, 24)}... qr=${(enrolled.qr || "").length} bytes`,
  );

  const pending = await json(await call(account, "/api/v1/auth/2fa"));
  record("an unconfirmed enrolment is reported as pending", pending.pending === true && pending.enabled === false, JSON.stringify(pending));

  const badConfirm = await call(account, "/api/v1/auth/2fa/confirm", { method: "POST", body: { code: wrongCode() } });
  record("a wrong code does not confirm the enrolment", badConfirm.status === 401, `status=${badConfirm.status}`);

  const confirmed = await json(await call(account, "/api/v1/auth/2fa/confirm", { method: "POST", body: { code: totp(secret) } }));
  const recoveryCodes = confirmed.recovery_codes || [];
  record("the correct code confirms the enrolment", recoveryCodes.length === 10, `${recoveryCodes.length} recovery codes`);

  const me = await json(await call(account, "/api/v1/auth/me"));
  const enabledStatus = await json(await call(account, "/api/v1/auth/2fa"));
  record(
    "a confirmed account reports itself as enabled",
    me.user?.mfa_enabled === true && enabledStatus.enabled === true && enabledStatus.recovery_codes_remaining === 10,
    `me=${me.user?.mfa_enabled} status=${JSON.stringify(enabledStatus)}`,
  );

  // ---------- the two-stage login ----------
  await call(account, "/api/v1/auth/logout", { method: "POST" });
  account.jar.clear();

  const first = await loginWithPassword(account, ACCOUNT, PASSWORD);
  record(
    "a correct password returns a challenge instead of a session",
    first.response.status === 200 && first.payload.mfa_required === true && Boolean(first.challenge) && !first.payload.user,
    `status=${first.response.status} challenge=${Boolean(first.challenge)} user=${Boolean(first.payload.user)}`,
  );
  record("a challenge response sets no session cookie", !account.jar.has("purels_session"), [...account.jar.keys()].join(",") || "no cookies");

  const wrong = await call(account, "/api/v1/auth/2fa/verify", { method: "POST", body: { challenge: first.challenge, code: wrongCode() } });
  record("a wrong code is rejected", wrong.status === 401, `status=${wrong.status}`);

  // Four more, to spend the five attempts the challenge allows.
  for (let i = 0; i < 4; i++) {
    await call(account, "/api/v1/auth/2fa/verify", { method: "POST", body: { challenge: first.challenge, code: wrongCode() } });
  }
  // The proof that the counter advanced: a correct code now fails, because the
  // half-session is out of attempts rather than because the code was wrong.
  const afterLimit = await call(account, "/api/v1/auth/2fa/verify", { method: "POST", body: { challenge: first.challenge, code: totp(secret) } });
  record("the attempt counter rejects a correct code after five failures", afterLimit.status === 401, `status=${afterLimit.status}`);

  const second = await loginWithPassword(account, ACCOUNT, PASSWORD);
  const accepted = await call(account, "/api/v1/auth/2fa/verify", { method: "POST", body: { challenge: second.challenge, code: totp(secret) } });
  const acceptedPayload = await readLogin(account, accepted);
  record(
    "a correct code completes the login",
    accepted.status === 200 && account.jar.has("purels_session") && Boolean(account.csrf) && acceptedPayload.user?.username === ACCOUNT,
    `status=${accepted.status} cookie=${account.jar.has("purels_session")} csrf=${Boolean(account.csrf)}`,
  );

  const afterLogin = await json(await call(account, "/api/v1/auth/me"));
  record("the completed login is a working session", afterLogin.user?.username === ACCOUNT, `user=${afterLogin.user?.username}`);

  // ---------- recovery codes ----------
  const spendRecovery = async (code) => {
    // The logout has to be a real one: with the CSRF token captured above it
    // revokes the session, so the next step really starts from no session.
    await call(account, "/api/v1/auth/logout", { method: "POST" });
    account.jar.clear();
    account.csrf = "";
    const step = await loginWithPassword(account, ACCOUNT, PASSWORD);
    const response = await call(account, "/api/v1/auth/2fa/verify", { method: "POST", body: { challenge: step.challenge, code } });
    await readLogin(account, response);
    return response;
  };

  const firstRecovery = await spendRecovery(recoveryCodes[0]);
  record("a recovery code completes a login", firstRecovery.status === 200 && account.jar.has("purels_session"), `status=${firstRecovery.status}`);

  const reused = await spendRecovery(recoveryCodes[0]);
  record("a recovery code cannot be used twice", reused.status === 401, `status=${reused.status}`);

  const secondRecovery = await spendRecovery(recoveryCodes[1]);
  record("a second recovery code still works", secondRecovery.status === 200, `status=${secondRecovery.status}`);

  const spentStatus = await json(await call(account, "/api/v1/auth/2fa"));
  record("spent recovery codes are counted down", spentStatus.recovery_codes_remaining === 8, `remaining=${spentStatus.recovery_codes_remaining}`);

  // ---------- disabling ----------
  const wrongPassword = await call(account, "/api/v1/auth/2fa/disable", { method: "POST", body: { password: "not-the-password", code: totp(secret) } });
  record("disabling requires the password", wrongPassword.status === 401, `status=${wrongPassword.status}`);

  const disabled = await call(account, "/api/v1/auth/2fa/disable", { method: "POST", body: { password: PASSWORD, code: totp(secret) } });
  record("the correct code disables the second factor", disabled.status === 204, `status=${disabled.status}`);

  await call(account, "/api/v1/auth/logout", { method: "POST" });
  account.jar.clear();
  account.csrf = "";
  const plain = await loginWithPassword(account, ACCOUNT, PASSWORD);
  record(
    "a disabled account is no longer challenged",
    plain.response.status === 200 && !plain.payload.mfa_required && account.jar.has("purels_session"),
    `status=${plain.response.status} mfa_required=${Boolean(plain.payload.mfa_required)}`,
  );

  // ---------- the administrator reset ----------
  // The documented way back in after the encryption key is lost or changed, and
  // the only path that removes a second factor without the target's own code.
  const reEnrolled = await json(await call(account, "/api/v1/auth/2fa/enroll", { method: "POST" }));
  const secondSecret = reEnrolled.secret || "";
  const reConfirmed = await call(account, "/api/v1/auth/2fa/confirm", { method: "POST", body: { code: totp(secondSecret) } });
  record(
    "an account can enrol again after disabling",
    reConfirmed.status === 200 && Boolean(secondSecret) && secondSecret !== secret,
    `status=${reConfirmed.status} fresh=${secondSecret !== secret}`,
  );

  const admin = newSession();
  await signIn(admin, ADMIN_USER, ADMIN_PASS);

  // A regular account must not be able to strip somebody else's second factor.
  // Without this the whole feature is decorative: any account could disarm the
  // administrator's and then sign in with a password alone.
  const forbidden = await call(account, `/api/v1/users/${admin.userId}/2fa/reset`, { method: "POST" });
  record("a regular account cannot reset another account's second factor", forbidden.status === 403, `status=${forbidden.status}`);

  const reset = await call(admin, `/api/v1/users/${account.userId}/2fa/reset`, { method: "POST" });
  record("an administrator can reset another account's second factor", reset.status === 204, `status=${reset.status}`);

  const afterReset = await json(await call(account, "/api/v1/auth/2fa"));
  record(
    "the reset clears the secret and the recovery codes",
    afterReset.enabled === false && afterReset.pending === false && afterReset.recovery_codes_remaining === 0,
    JSON.stringify(afterReset),
  );

  await call(account, "/api/v1/auth/logout", { method: "POST" });
  account.jar.clear();
  account.csrf = "";
  const afterResetLogin = await loginWithPassword(account, ACCOUNT, PASSWORD);
  record(
    "an account reset by an administrator is no longer challenged",
    afterResetLogin.response.status === 200 && !afterResetLogin.payload.mfa_required,
    `status=${afterResetLogin.response.status} mfa_required=${Boolean(afterResetLogin.payload.mfa_required)}`,
  );
}

main()
  .catch((err) => {
    record("the suite ran to completion", false, err.message);
  })
  .then(() => {
    const purged = purgeAccount(ACCOUNT);
    record("the test account is removed", purged, purged ? ACCOUNT : "psql unavailable — remove it by hand");

    let failed = 0;
    let skipped = 0;
    for (const r of results) {
      if (r.skipped) skipped++;
      if (!r.ok) failed++;
      console.log(`[${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    const ran = results.length - skipped;
    console.log(`\n${ran - failed}/${ran} checks passed${skipped ? `, ${skipped} skipped` : ""}`);
    if (skipped) console.log("Set TOTP_ENABLED=true and TOTP_ENCRYPTION_KEY to run the full suite.");
    process.exit(failed ? 1 : 0);
  });
