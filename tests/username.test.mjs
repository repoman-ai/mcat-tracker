import assert from "node:assert/strict";
import { MAX_LOGIN_USERNAME_LENGTH, MIN_LOGIN_USERNAME_LENGTH, normalizeLoginIdentifier, normalizeLoginUsername, validateLoginUsername } from "../js/username.js";
import { fakeCredentialSaltForSecret } from "../supabase/functions/_shared/security.js";
import { validateUsername as validateServerUsername } from "../supabase/functions/_shared/username.js";

assert.equal(MIN_LOGIN_USERNAME_LENGTH, 3);
assert.equal(MAX_LOGIN_USERNAME_LENGTH, 32);
assert.equal(normalizeLoginUsername("  Study.Runner  "), "study.runner");
assert.equal(normalizeLoginIdentifier(" Owner@Example.COM "), "owner@example.com");

for (const valid of ["abc", "a.b", "study_runner", "mcat-520", "a1b", "x".repeat(32)]) {
  assert.deepEqual(validateLoginUsername(valid).valid, true, valid);
  assert.deepEqual(validateServerUsername(valid).valid, true, `server: ${valid}`);
}
for (const invalid of ["ab", "x".repeat(33), ".abc", "abc-", "a@b", "a b", "a..b", "admin", "SUPPORT", "sign-in", "éclair"]) {
  assert.deepEqual(validateLoginUsername(invalid).valid, false, invalid);
  assert.deepEqual(validateServerUsername(invalid).valid, false, `server: ${invalid}`);
}

// A normalized unique index treats every case variant as the same alias.
const aliases = new Set();
const reserve = (candidate) => {
  const checked = validateLoginUsername(candidate);
  if (!checked.valid || aliases.has(checked.username)) return false;
  aliases.add(checked.username);
  return true;
};
assert.equal(reserve("Study.Runner"), true);
assert.equal(reserve("study.runner"), false);
assert.equal(reserve(" STUDY.RUNNER "), false);

const secret = "x".repeat(32);
const firstFake = await fakeCredentialSaltForSecret(secret, "Missing.User");
const secondFake = await fakeCredentialSaltForSecret(secret, " missing.user ");
const otherFake = await fakeCredentialSaltForSecret(secret, "other.user");
assert.match(firstFake, /^[A-Za-z0-9_-]{43}$/);
assert.equal(firstFake, secondFake, "unknown identifiers receive deterministic normalized fake salts");
assert.notEqual(firstFake, otherFake);

console.log("username and fake-credential tests passed");
