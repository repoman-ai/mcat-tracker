import { GENERIC_AUTH_ERROR, migrateLoginCredential, unlockWithIdentifier } from "./account-auth.js";
import { AUTH_STORAGE_KEY, rememberIdentifier } from "./auth-storage.js";
import { mergeStates, normalizeState, SCHEMA_VERSION } from "./storage.js";
import { SYNC_CONFIG } from "./sync-config.js";
import { validateLoginUsername } from "./username.js";

const SYNC_DELAY = 900;
const POLL_INTERVAL = 60_000;

/** The identifier used on this device is cached here. A username is never resolved to email in storage. */
export { rememberedIdentifier } from "./auth-storage.js";

/**
 * True when this browser holds Supabase auth material. Used so a device that
 * signed in previously stays unlocked while offline, when the token endpoint
 * cannot be reached to refresh.
 */
export function hasStoredSession() {
  try { return Boolean(localStorage.getItem(AUTH_STORAGE_KEY)); } catch { return false; }
}

let client = null;
let session = null;
let callbacks = null;
let pendingTimer = null;
let syncPromise = null;
let pollTimer = null;

let status = {
  configured: false,
  signedIn: false,
  unlocked: true,
  email: "",
  mode: "setup-required",
  message: "Cloud sync needs one-time setup.",
  lastSyncedAt: "",
};

/**
 * Whether the tracker should show its contents.
 *
 * Before cloud sync is configured there is nothing to unlock, so the site stays
 * usable as a local-only tracker. Once configured, a signed-in session unlocks
 * it — and a device that has signed in before stays unlocked while offline, so
 * losing signal never locks you out of your own study plan.
 */
function computeUnlocked(signedIn) {
  if (!status.configured) return true;
  if (signedIn) return true;
  return hasStoredSession() && !navigator.onLine;
}

function isConfigured() {
  try {
    const url = new URL(SYNC_CONFIG.supabaseUrl);
    const secureTransport = url.protocol === "https:" || (["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:");
    return secureTransport && Boolean(SYNC_CONFIG.supabasePublishableKey?.trim());
  } catch {
    return false;
  }
}

function emit(patch = {}) {
  status = { ...status, ...patch };
  callbacks?.onStatus?.({ ...status });
}

function setSession(nextSession) {
  session = nextSession || null;
  const signedIn = Boolean(session?.user);
  emit({
    signedIn,
    unlocked: computeUnlocked(signedIn),
    email: session?.user?.email || "",
    mode: signedIn ? status.mode : "locked",
    message: signedIn ? status.message : "Enter your PIN to unlock this device.",
  });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (session?.user && document.visibilityState === "visible") syncNow({ reason: "poll", quiet: true });
  }, POLL_INTERVAL);
}

export function getSyncStatus() {
  return { ...status };
}

export async function initializeSync(options) {
  callbacks = options;
  status.configured = isConfigured();
  if (!status.configured) {
    emit({ mode: "setup-required", unlocked: true, message: "Cloud sync needs one-time setup." });
    return getSyncStatus();
  }
  if (!window.supabase?.createClient) {
    // Fail open rather than trapping the owner behind a lock screen that cannot
    // possibly accept a PIN. Local progress stays reachable.
    emit({ mode: "error", unlocked: true, message: "The cloud-sync library could not load, so this device is working locally." });
    return getSyncStatus();
  }

  client = window.supabase.createClient(SYNC_CONFIG.supabaseUrl, SYNC_CONFIG.supabasePublishableKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  client.auth.onAuthStateChange((event, nextSession) => {
    setSession(nextSession);
    if (["SIGNED_IN", "TOKEN_REFRESHED"].includes(event) && nextSession?.user) {
      setTimeout(() => syncNow({ reason: event.toLowerCase(), quiet: event === "TOKEN_REFRESHED" }), 0);
    }
  });

  const { data, error } = await client.auth.getSession();
  if (error) {
    emit({ mode: "error", unlocked: computeUnlocked(false), message: `Could not restore your unlocked session: ${error.message}` });
    return getSyncStatus();
  }
  setSession(data.session);
  startPolling();
  window.addEventListener("online", () => {
    if (session?.user) syncNow({ reason: "online" });
    else emit({ unlocked: computeUnlocked(false) });
  });
  window.addEventListener("offline", () => emit({
    unlocked: computeUnlocked(Boolean(session?.user)),
    mode: session?.user ? "offline" : status.mode,
    message: session?.user ? "Offline — changes are safe here and will sync later." : status.message,
  }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session?.user) syncNow({ reason: "visible", quiet: true });
  });
  if (session?.user) await syncNow({ reason: "startup" });
  return getSyncStatus();
}

/**
 * Turns a Supabase auth failure into something a tired student can act on,
 * without revealing which half of the credentials was wrong and without
 * surfacing raw transport errors.
 */
function unlockErrorMessage(error) {
  const raw = String(error?.message || "");
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return navigator.onLine
      ? "Could not reach the sync service. Check the connection and try again — your local progress is untouched."
      : "You’re offline, so the PIN cannot be checked right now. Reconnect and try again.";
  }
  // Supabase answers a wrong email and a wrong PIN identically, so neither can
  // be enumerated. Say so plainly instead of leaking which half was wrong.
  if (/invalid login credentials|email or username and PIN combination/i.test(raw)) return GENERIC_AUTH_ERROR;
  if (/email not confirmed/i.test(raw)) return "This account still needs email confirmation turned off in Supabase. See the README setup steps.";
  if (/rate limit|too many/i.test(raw)) return "Too many attempts just now. Wait a minute and try again.";
  return raw || "The PIN could not be checked.";
}

/**
 * Calls a pre-auth Edge Function without installing a browser session or
 * attaching an Authorization bearer. Only the publishable key is sent.
 */
async function publicFunction(name, body) {
  const response = await fetch(`${SYNC_CONFIG.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SYNC_CONFIG.supabasePublishableKey },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || (response.status === 429 ? "Too many attempts just now. Wait a minute and try again." : "The sign-in service is temporarily unavailable."));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function accountFunction(action, fields = {}) {
  if (!client) throw new Error("Cloud sync is not configured yet.");
  const { data, error } = await client.functions.invoke("account-credentials", { body: { action, ...fields } });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* Preserve transport message. */ }
    throw new Error(message || "The account service is temporarily unavailable.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const accountApi = {
  status: () => accountFunction("status"),
  begin: (loginUsername) => accountFunction("begin", { loginUsername }),
  setUsername: (loginUsername) => accountFunction("set_username", { loginUsername }),
  activate: (password) => accountFunction("activate", { password }),
};

/**
 * Unlocks this device with an email or sign-in username and PIN. The PIN is stretched locally
 * into the account password; the raw PIN never leaves the browser and is never
 * stored. There is no sign-up path here — only an account that already exists in
 * Supabase can be unlocked.
 */
export async function unlockWithPin(identifier, pin) {
  if (!client) throw new Error("Cloud sync is not configured yet.");
  emit({ mode: "connecting", message: "Checking your PIN…" });

  try {
    const nextSession = await unlockWithIdentifier({
      identifier,
      pin,
      auth: client.auth,
      getCredentialInfo: (normalized) => publicFunction("credential-info", { identifier: normalized }),
      loginWithAlias: (normalized, password) => publicFunction("identifier-login", { identifier: normalized, password }),
    });
    rememberIdentifier(identifier);
    setSession(nextSession);
  } catch (error) {
    emit({ mode: "locked", message: unlockErrorMessage(error) });
    throw new Error(unlockErrorMessage(error));
  }

  await syncNow({ reason: "unlock" });
  return getSyncStatus();
}

/**
 * Sends a PIN-reset email to the owner address.
 *
 * The link lands on reset.html, which asks for a NEW PIN and re-derives the
 * account key from it. Supabase never learns the PIN itself, and forgetting the
 * PIN no longer means losing the account.
 */
export async function requestPinReset(identifier) {
  if (!client) throw new Error("Cloud sync is not configured yet.");
  const normalized = String(identifier ?? "").trim().toLowerCase();
  if (!normalized) throw new Error("Enter the account email or sign-in username so a reset link can be requested.");

  // Same-origin so this works on localhost and on the deployed subpath alike.
  const redirectTo = new URL("reset.html", window.location.href).href;
  await publicFunction("request-pin-reset", { identifier: normalized, redirectTo });
  rememberIdentifier(normalized);
  return true;
}

export async function getLoginUsernameStatus() {
  if (!session?.user) throw new Error("Unlock this device to manage its sign-in username.");
  return accountApi.status();
}

export async function configureLoginUsername(loginUsername, pin) {
  if (!session?.user?.email) throw new Error("Unlock this device to manage its sign-in username.");
  const result = await migrateLoginCredential({
    email: session.user.email,
    pin,
    requestedUsername: loginUsername,
    auth: client.auth,
    accountApi,
  });
  return result;
}

export async function renameLoginUsername(loginUsername) {
  if (!session?.user) throw new Error("Unlock this device to manage its sign-in username.");
  const checked = validateLoginUsername(loginUsername);
  if (!checked.valid) throw new Error(checked.message);
  return accountApi.setUsername(checked.username);
}

export async function removeLoginUsername() {
  if (!session?.user) throw new Error("Unlock this device to manage its sign-in username.");
  return accountApi.setUsername(null);
}

/**
 * Locks this device: cloud access ends here and the PIN is required again.
 * Local progress is deliberately left intact so nothing is lost.
 */
export async function signOutOfSync() {
  if (!client) return;
  clearTimeout(pendingTimer);
  if (session?.user && navigator.onLine) await syncNow({ reason: "lock", quiet: true });
  const { error } = await client.auth.signOut();
  if (error) throw error;
  setSession(null);
}

export function scheduleCloudSync() {
  if (!client || !session?.user) return;
  clearTimeout(pendingTimer);
  emit({ mode: navigator.onLine ? "pending" : "offline", message: navigator.onLine ? "Changes waiting to sync…" : "Offline — changes are safe here and will sync later." });
  pendingTimer = setTimeout(() => syncNow({ reason: "local-change" }), SYNC_DELAY);
}

export async function syncNow({ reason = "manual", quiet = false } = {}) {
  if (!client || !session?.user) return getSyncStatus();
  if (!navigator.onLine) {
    emit({ mode: "offline", message: "Offline — changes are safe here and will sync later." });
    return getSyncStatus();
  }
  if (syncPromise) return syncPromise;
  clearTimeout(pendingTimer);
  if (!quiet) emit({ mode: "syncing", message: reason === "manual" ? "Syncing now…" : "Syncing changes…" });

  syncPromise = (async () => {
    try {
      const userId = session.user.id;
      const { data: remote, error: readError } = await client
        .from("tracker_state")
        .select("payload, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (readError) throw readError;

      const localState = callbacks.getState();
      const combined = remote?.payload ? mergeStates(localState, remote.payload) : normalizeState(localState);
      const prepared = normalizeState({ ...combined, updatedAt: new Date().toISOString() });
      const applied = callbacks.applyState?.(prepared) || prepared;

      const { error: writeError } = await client.from("tracker_state").upsert({
        user_id: userId,
        schema_version: SCHEMA_VERSION,
        payload: applied,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (writeError) throw writeError;

      emit({ mode: "synced", message: "All changes synced.", lastSyncedAt: new Date().toISOString() });
      return getSyncStatus();
    } catch (error) {
      emit({ mode: navigator.onLine ? "error" : "offline", message: navigator.onLine ? `Sync paused: ${error.message}` : "Offline — changes are safe here and will sync later." });
      return getSyncStatus();
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}
