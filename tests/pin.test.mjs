import assert from "node:assert/strict";
import { derivePassword, MIN_PIN_LENGTH, normalizeEmail } from "../js/pin.js";

assert.equal(MIN_PIN_LENGTH, 4);
assert.equal(normalizeEmail("  Owner@Example.COM "), "owner@example.com");

const first = await derivePassword("owner@example.com", "0123");
const second = await derivePassword("OWNER@example.com", "0123");
const different = await derivePassword("owner@example.com", "0124");

assert.match(first, /^mm1\.[A-Za-z0-9_-]{43}$/);
assert.equal(first, second, "email normalization must not change the derived password");
assert.notEqual(first, different, "different PINs must derive different account passwords");

await assert.rejects(() => derivePassword("owner@example.com", "123"), /at least 4 digits/i);
await assert.rejects(() => derivePassword("owner@example.com", "12a4"), /digits only/i);
await assert.rejects(() => derivePassword("", "1234"), /email is required/i);

console.log("PIN derivation tests passed");
