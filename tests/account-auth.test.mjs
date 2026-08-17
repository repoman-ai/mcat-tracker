import assert from "node:assert/strict";
import { deriveRecoveryPassword, GENERIC_AUTH_ERROR, migrateLoginCredential, unlockWithIdentifier } from "../js/account-auth.js";
import { AUTH_STORAGE_KEY } from "../js/auth-storage.js";
import { deriveCredentialPassword, derivePassword } from "../js/pin.js";

const EMAIL = "owner@example.com";
const USERNAME = "study.runner";
const PIN = "0123";
const WRONG_PIN = "9999";
const SALT = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const TOKENS = { accessToken: crypto.randomUUID(), refreshToken: crypto.randomUUID() };
const legacyPassword = await derivePassword(EMAIL, PIN);
const v2Password = await deriveCredentialPassword(SALT, PIN, 2);

function authForPassword(expectedPassword) {
  return {
    async setSession(tokens) { return { data: { session: { user: { id: "user-1", email: EMAIL }, ...tokens } }, error: null }; },
    async signInWithPassword({ email, password }) {
      return email === EMAIL && password === expectedPassword
        ? { data: { session: { user: { id: "user-1", email: EMAIL } } }, error: null }
        : { data: { session: null }, error: new Error("Invalid login credentials") };
    },
  };
}

// Email and case-insensitive username resolve to the same private credential.
for (const identifier of [EMAIL, USERNAME, "STUDY.RUNNER"]) {
  const requested = [];
  const session = await unlockWithIdentifier({
    identifier,
    pin: PIN,
    auth: authForPassword("never-used"),
    getCredentialInfo: async (value) => { requested.push({ identifier: value }); return { credentialSalt: SALT, credentialVersion: 2 }; },
    loginWithAlias: async (value, password) => {
      requested.push({ identifier: value, password });
      if (password !== v2Password) throw new Error("Invalid login credentials");
      return TOKENS;
    },
  });
  assert.equal(session.user.id, "user-1");
  assert.equal(requested.at(-1).identifier, identifier.toLowerCase());
  assert.equal(requested.at(-1).password, v2Password);
  assert.ok(!JSON.stringify(requested).includes(PIN), "raw PIN must not cross either request boundary");
}

// Existing accounts still fall back to the legacy email-salted credential.
const legacySession = await unlockWithIdentifier({
  identifier: EMAIL,
  pin: PIN,
  auth: authForPassword(legacyPassword),
  getCredentialInfo: async () => ({ credentialSalt: "Z".repeat(43), credentialVersion: 2 }),
  loginWithAlias: async () => { throw new Error("Invalid login credentials"); },
});
assert.equal(legacySession.user.email, EMAIL);

// Unknown email, unknown username, and a wrong PIN expose the same message.
for (const scenario of [
  { identifier: "missing@example.com", pin: PIN },
  { identifier: "missing.user", pin: PIN },
  { identifier: USERNAME, pin: WRONG_PIN },
]) {
  await assert.rejects(() => unlockWithIdentifier({
    ...scenario,
    auth: authForPassword("no-match"),
    getCredentialInfo: async () => ({ credentialSalt: "Q".repeat(43), credentialVersion: 2 }),
    loginWithAlias: async () => { throw new Error("Invalid login credentials"); },
  }), (error) => error.message === GENERIC_AUTH_ERROR);
}

function migrationHarness(failure = "") {
  const durable = { row: null, authPassword: legacyPassword, fail: failure, calls: [] };
  const maybeFail = (point) => {
    if (durable.fail === point) { durable.fail = ""; throw new Error(`injected ${point}`); }
  };
  const auth = {
    async signInWithPassword({ email, password }) {
      durable.calls.push({ operation: "signIn", email, password });
      const ok = email === EMAIL && password === durable.authPassword;
      return ok ? { data: { session: { user: { email } } }, error: null } : { data: { session: null }, error: new Error("Invalid login credentials") };
    },
    async updateUser({ password, current_password }) {
      durable.calls.push({ operation: "updateUser", password, current_password });
      maybeFail("update-before");
      if (current_password !== durable.authPassword) return { error: new Error("Invalid login credentials") };
      durable.authPassword = password;
      if (durable.fail === "update-after") { durable.fail = ""; return { error: new Error("response lost") }; }
      return { error: null };
    },
  };
  const snapshot = () => durable.row ? {
    loginUsername: durable.row.username,
    credentialSalt: SALT,
    credentialVersion: 2,
    migrationState: durable.row.state,
  } : { loginUsername: null, credentialSalt: null, credentialVersion: null, migrationState: "none" };
  const accountApi = {
    async status() { durable.calls.push({ operation: "status" }); maybeFail("status"); return snapshot(); },
    async begin(username) {
      durable.calls.push({ operation: "begin", username });
      maybeFail("begin-before");
      durable.row ||= { username, state: "pending" };
      durable.row.username = username;
      maybeFail("begin-after");
      return snapshot();
    },
    async setUsername(username) { durable.calls.push({ operation: "setUsername", username }); durable.row.username = username; return snapshot(); },
    async activate(password) {
      durable.calls.push({ operation: "activate", password });
      maybeFail("activate-before");
      if (password !== durable.authPassword) throw new Error("activation rejected");
      durable.row.state = "active";
      maybeFail("activate-after");
      return snapshot();
    },
  };
  return { durable, auth, accountApi };
}

// Clean first-time migration verifies v1, reuses one salt, rotates, and activates.
{
  const harness = migrationHarness();
  const result = await migrateLoginCredential({ email: EMAIL, pin: PIN, requestedUsername: USERNAME, auth: harness.auth, accountApi: harness.accountApi });
  assert.equal(result.migrationState, "active");
  assert.equal(harness.durable.authPassword, v2Password);
  assert.equal(harness.durable.row.username, USERNAME);
  const update = harness.durable.calls.find((call) => call.operation === "updateUser");
  assert.equal(update.current_password, legacyPassword, "rotation reauthenticates the current derived credential");
  assert.ok(!JSON.stringify(harness.durable.calls).includes(PIN), "migration requests and logs never contain the raw PIN");
}

// Every operation boundary can be retried, including response loss after a write.
for (const failure of ["status", "begin-before", "begin-after", "update-before", "update-after", "activate-before", "activate-after"]) {
  const harness = migrationHarness(failure);
  await assert.rejects(() => migrateLoginCredential({ email: EMAIL, pin: PIN, requestedUsername: USERNAME, auth: harness.auth, accountApi: harness.accountApi }));
  const saltBeforeRetry = harness.durable.row ? SALT : null;
  const result = await migrateLoginCredential({ email: EMAIL, pin: PIN, requestedUsername: USERNAME, auth: harness.auth, accountApi: harness.accountApi });
  assert.equal(result.migrationState, "active", failure);
  if (saltBeforeRetry) assert.equal(result.credentialSalt, saltBeforeRetry, `${failure} must not rotate the salt`);
  assert.equal(harness.durable.authPassword, v2Password, failure);
}

// Rename is metadata-only once active; the PIN-derived Auth password is unchanged.
{
  const harness = migrationHarness();
  harness.durable.row = { username: USERNAME, state: "active" };
  harness.durable.authPassword = v2Password;
  const result = await migrateLoginCredential({ email: EMAIL, pin: WRONG_PIN, requestedUsername: "new.runner", auth: harness.auth, accountApi: harness.accountApi });
  assert.equal(result.loginUsername, "new.runner");
  assert.equal(harness.durable.authPassword, v2Password);
  assert.equal(harness.durable.calls.some((call) => call.operation === "updateUser"), false);
}

// Recovery retains the legacy behavior before migration and uses v2 afterward.
assert.equal(await deriveRecoveryPassword({ migrationState: "none" }, EMAIL, PIN), legacyPassword);
assert.equal(await deriveRecoveryPassword({ migrationState: "active", credentialSalt: SALT, credentialVersion: 2 }, EMAIL, PIN), v2Password);
assert.equal(await deriveRecoveryPassword({ migrationState: "pending", credentialSalt: SALT, credentialVersion: 2 }, EMAIL, PIN), v2Password);

// setSession receives only tokens and a persistent client can store them for offline grace.
const local = new Map();
const persistentAuth = {
  async setSession(tokens) { local.set(AUTH_STORAGE_KEY, JSON.stringify(tokens)); return { data: { session: { user: { id: "user-1" }, ...tokens } }, error: null }; },
  async signInWithPassword() { return { data: { session: null }, error: new Error("unused") }; },
};
await unlockWithIdentifier({
  identifier: USERNAME,
  pin: PIN,
  auth: persistentAuth,
  getCredentialInfo: async () => ({ credentialSalt: SALT, credentialVersion: 2 }),
  loginWithAlias: async () => TOKENS,
});
assert.ok(local.has(AUTH_STORAGE_KEY));
assert.ok(!local.get(AUTH_STORAGE_KEY).includes(PIN));
globalThis.localStorage = { getItem: (key) => local.get(key) || null };
const { hasStoredSession } = await import("../js/sync.js");
assert.equal(hasStoredSession(), true, "setSession persistence continues to enable existing offline grace");

console.log("account auth, migration, recovery, and session tests passed");
