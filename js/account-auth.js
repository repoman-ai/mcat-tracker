import { deriveCredentialPassword, derivePassword, normalizeEmail } from "./pin.js";
import { isEmailIdentifier, normalizeLoginIdentifier, validateLoginUsername } from "./username.js";

export const GENERIC_AUTH_ERROR = "That email or username and PIN combination did not match. Check both and try again.";

export async function deriveRecoveryPassword(credential, email, pin) {
  if (["pending", "active"].includes(credential?.migrationState) && credential.credentialSalt) {
    return deriveCredentialPassword(credential.credentialSalt, pin, credential.credentialVersion);
  }
  return derivePassword(normalizeEmail(email), pin);
}

function authSucceeded(result) {
  return Boolean(result && !result.error && result.data?.session);
}

/**
 * Tries the private immutable-salt credential first, then the legacy
 * email-salted credential for email identifiers only. Both public outcomes are
 * deliberately generic. Dependencies are injected to keep request-boundary
 * behavior directly testable without a live project.
 */
export async function unlockWithIdentifier({ identifier, pin, auth, getCredentialInfo, loginWithAlias }) {
  const normalized = normalizeLoginIdentifier(identifier);
  if (!normalized) throw new Error("Enter your account email or sign-in username.");

  let aliasFailure = null;
  try {
    const credential = await getCredentialInfo(normalized);
    const password = await deriveCredentialPassword(credential.credentialSalt, pin, credential.credentialVersion);
    const tokens = await loginWithAlias(normalized, password);
    const installed = await auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
    if (installed.error || !installed.data?.session) throw installed.error || new Error(GENERIC_AUTH_ERROR);
    return installed.data.session;
  } catch (error) {
    aliasFailure = error;
  }

  if (isEmailIdentifier(normalized)) {
    const password = await derivePassword(normalizeEmail(normalized), pin);
    const legacy = await auth.signInWithPassword({ email: normalizeEmail(normalized), password });
    if (authSucceeded(legacy)) return legacy.data.session;
  }

  if (/fetch|network|connection|unavailable/i.test(String(aliasFailure?.message || ""))) throw aliasFailure;
  throw new Error(GENERIC_AUTH_ERROR);
}

async function signInDerived(auth, email, password) {
  const result = await auth.signInWithPassword({ email, password });
  return authSucceeded(result);
}

/**
 * Performs or resumes first-time credential migration. A pending database row
 * is created only after the legacy PIN is verified. If password rotation wins
 * the race but activation fails, a retry verifies the v2 credential and merely
 * completes activation; the immutable salt is reused throughout.
 */
export async function migrateLoginCredential({ email, pin, requestedUsername, auth, accountApi }) {
  const validation = validateLoginUsername(requestedUsername);
  if (!validation.valid) throw new Error(validation.message);
  const accountEmail = normalizeEmail(email);
  if (!accountEmail) throw new Error("The signed-in account email is unavailable.");

  let status = await accountApi.status();
  if (status.migrationState === "active") {
    return accountApi.setUsername(validation.username);
  }

  const legacyPassword = await derivePassword(accountEmail, pin);
  let v2Password = null;

  if (status.migrationState === "pending") {
    v2Password = await deriveCredentialPassword(status.credentialSalt, pin, status.credentialVersion);
    if (await signInDerived(auth, accountEmail, v2Password)) {
      await accountApi.setUsername(validation.username);
      await accountApi.activate(v2Password);
      return accountApi.status();
    }
  }

  if (!await signInDerived(auth, accountEmail, legacyPassword)) throw new Error(GENERIC_AUTH_ERROR);
  status = await accountApi.begin(validation.username);
  v2Password = await deriveCredentialPassword(status.credentialSalt, pin, status.credentialVersion);
  const rotated = await auth.updateUser({ password: v2Password, current_password: legacyPassword });
  if (rotated.error) throw new Error("The credential migration could not finish. Retry setup with the same PIN; no new salt will be created.");
  await accountApi.activate(v2Password);
  return accountApi.status();
}
