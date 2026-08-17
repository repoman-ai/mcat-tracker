import { normalizeEmail } from "./pin.js";

// Shared by the normal sign-in client and the recovery-page client. Using the
// same key lets a recovery session replace any stale signed-out session cleanly.
export const AUTH_STORAGE_KEY = "mcatMomentum.cloudAuth.v1";
export const OWNER_EMAIL_KEY = "mcatMomentum.ownerEmail.v1";
export const OWNER_IDENTIFIER_KEY = "mcatMomentum.ownerIdentifier.v1";

export function rememberedEmail() {
  try { return localStorage.getItem(OWNER_EMAIL_KEY) || ""; } catch { return ""; }
}

export function rememberEmail(email) {
  const account = normalizeEmail(email);
  if (!account) return;
  try { localStorage.setItem(OWNER_EMAIL_KEY, account); } catch { /* Private-mode storage is not fatal. */ }
}

/** Remembers exactly the kind of identifier used, never resolving a username to email. */
export function rememberedIdentifier() {
  try { return localStorage.getItem(OWNER_IDENTIFIER_KEY) || rememberedEmail(); } catch { return ""; }
}

export function rememberIdentifier(identifier) {
  const normalized = String(identifier ?? "").trim().toLowerCase();
  if (!normalized) return;
  try { localStorage.setItem(OWNER_IDENTIFIER_KEY, normalized); } catch { /* Private-mode storage is not fatal. */ }
  if (normalized.includes("@")) rememberEmail(normalized);
}
