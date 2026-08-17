import { AUTH_STORAGE_KEY, rememberEmail, rememberedEmail } from "./auth-storage.js";
import { deriveRecoveryPassword } from "./account-auth.js";
import { normalizeEmail } from "./pin.js";
import { SYNC_CONFIG } from "./sync-config.js";

const loadingView = document.querySelector("[data-reset-loading]");
const resetView = document.querySelector("[data-reset-form]");
const expiredView = document.querySelector("[data-reset-expired]");
const successView = document.querySelector("[data-reset-success]");
const resetForm = document.querySelector("[data-new-pin-form]");
const resendForm = document.querySelector("[data-resend-form]");
const resetError = document.querySelector("[data-reset-error]");
const resendError = document.querySelector("[data-resend-error]");
const resendMessage = document.querySelector("[data-resend-message]");

const hashParameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const queryParameters = new URLSearchParams(window.location.search);
const arrivedFromRecovery = hashParameters.get("type") === "recovery"
  || hashParameters.has("access_token")
  || queryParameters.has("code");
const linkError = hashParameters.get("error_description") || queryParameters.get("error_description");

function configured() {
  try {
    const url = new URL(SYNC_CONFIG.supabaseUrl);
    const secureTransport = url.protocol === "https:" || (["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:");
    return secureTransport && Boolean(SYNC_CONFIG.supabasePublishableKey?.trim());
  } catch {
    return false;
  }
}

function show(view) {
  [loadingView, resetView, expiredView, successView].forEach((candidate) => {
    candidate.hidden = candidate !== view;
  });
}

function recoveryErrorMessage(raw = "") {
  const message = String(raw).replaceAll("+", " ");
  if (/expired|otp_expired|invalid|already/i.test(message)) {
    return "This reset link expired or was already used. Request a fresh email below.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "The reset service could not be reached. Check your connection and try again.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "A reset email was requested too recently. Wait about a minute, then try again.";
  }
  return message || "This reset link is missing, expired, or already used. Request a fresh email below.";
}

function showExpired(message) {
  document.querySelector("[data-link-error]").textContent = recoveryErrorMessage(message);
  resendForm.elements.email.value = rememberedEmail();
  show(expiredView);
  (resendForm.elements.email.value ? resendForm.querySelector("button") : resendForm.elements.email).focus();
}

async function accountCredential(client, action, fields = {}) {
  const { data, error } = await client.functions.invoke("account-credentials", { body: { action, ...fields } });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error || message; } catch { /* Preserve transport message. */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

if (!configured() || !window.supabase?.createClient) {
  showExpired("PIN recovery is not configured yet. Finish the Supabase setup, then request another reset email.");
} else {
  const client = window.supabase.createClient(SYNC_CONFIG.supabaseUrl, SYNC_CONFIG.supabasePublishableKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit",
    },
  });

  let recoverySession = null;
  client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session?.user) {
      recoverySession = session;
      show(resetView);
      resetForm.elements.pin.focus();
    }
  });

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = resetForm.querySelector("button[type='submit']");
    const pin = resetForm.elements.pin.value;
    const confirmation = resetForm.elements.confirmation.value;
    resetError.textContent = "";
    if (pin !== confirmation) {
      resetError.textContent = "The two PINs do not match. Type the same PIN in both boxes.";
      resetForm.elements.confirmation.select();
      return;
    }

    button.disabled = true;
    button.textContent = "Saving new PIN…";
    try {
      const session = recoverySession || (await client.auth.getSession()).data.session;
      const email = normalizeEmail(session?.user?.email);
      if (!email || !arrivedFromRecovery) throw new Error("The secure reset session is missing or expired.");
      const credential = await accountCredential(client, "status");
      const migrated = ["pending", "active"].includes(credential.migrationState) && credential.credentialSalt;
      const password = await deriveRecoveryPassword(credential, email, pin);
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      if (migrated && credential.migrationState === "pending") await accountCredential(client, "activate", { password });
      rememberEmail(email);
      await client.auth.signOut({ scope: "global" });
      show(successView);
      window.setTimeout(() => window.location.replace("./index.html"), 1800);
    } catch (problem) {
      resetError.textContent = recoveryErrorMessage(problem.message);
      button.disabled = false;
      button.textContent = "Save new PIN";
    }
  });

  resendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = resendForm.querySelector("button[type='submit']");
    const email = normalizeEmail(resendForm.elements.email.value);
    resendError.textContent = "";
    resendMessage.textContent = "";
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      const redirectTo = new URL("reset.html", window.location.href).href;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      rememberEmail(email);
      resendMessage.textContent = "If that address matches the owner account, a fresh reset link is on its way.";
    } catch (problem) {
      resendError.textContent = recoveryErrorMessage(problem.message);
    } finally {
      button.disabled = false;
      button.textContent = "Send a new reset email";
    }
  });

  (async () => {
    if (linkError) {
      showExpired(linkError);
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error) {
      showExpired(error.message);
      return;
    }
    if (arrivedFromRecovery && data.session?.user) {
      recoverySession = data.session;
      show(resetView);
      resetForm.elements.pin.focus();
      return;
    }
    showExpired("");
  })();
}
