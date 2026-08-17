// Shared PIN -> Supabase-password derivation.
//
// The tracker never sends your PIN anywhere and never stores the literal PIN.
// It stretches the PIN with PBKDF2-SHA256 into a long, high-entropy string that
// becomes the account password for Supabase's normal email/password sign-in.
//
// Both the app (js/sync.js) and the one-time calculator (setup.html) import this
// file, so the derivation can never drift between them.
//
// This algorithm is intentionally public. Its purpose is not to hide anything
// from someone reading the source; it is to make sure the value stored in
// Supabase's auth table never contains the short PIN itself. PBKDF2 adds work
// to each guess, while Supabase's online rate limits remain an important part
// of the protection against repeated sign-in attempts.

const ITERATIONS = 310_000;
const KEY_BITS = 256;
const SALT_PREFIX = "mcat-momentum-pin-v1|";

export const MIN_PIN_LENGTH = 4;

function base64url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

/** Returns the account password for an owner email and PIN. */
export async function derivePassword(email, pin) {
  const account = normalizeEmail(email);
  const secret = String(pin ?? "").trim();
  if (!account) throw new Error("An account email is required.");
  if (!/^\d+$/.test(secret)) throw new Error("Use digits only for your PIN.");
  if (secret.length < MIN_PIN_LENGTH) throw new Error(`Use at least ${MIN_PIN_LENGTH} digits for your PIN.`);
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot derive the sign-in key. Use a current browser over http://localhost or https://.");

  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(`${SALT_PREFIX}${account}`), iterations: ITERATIONS },
    material,
    KEY_BITS,
  );
  // Prefixed so the stored value is self-describing if you ever look at it.
  return `mm1.${base64url(new Uint8Array(bits))}`;
}
