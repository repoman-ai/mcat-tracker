import { loadSiteData } from "./data.js";
import { exportCorruptRecovery } from "./export.js";
import { navigate, startRouter } from "./router.js";
import { lastLoadIssue, loadState, MAX_DISPLAY_NAME_LENGTH, sanitizeDisplayName, saveState } from "./storage.js";
import { configureLoginUsername, getLoginUsernameStatus, getSyncStatus, initializeSync, rememberedIdentifier, removeLoginUsername, renameLoginUsername, requestPinReset, scheduleCloudSync, signOutOfSync, syncNow, unlockWithPin } from "./sync.js";
import { MAX_LOGIN_USERNAME_LENGTH, validateLoginUsername } from "./username.js";
import { escapeAttr, escapeHTML, formatDateLong, setDocumentTitle, todayISO } from "./utils.js";
import { renderToday, bindToday, leaveToday } from "./views/today.js";
import { renderPlan, bindPlan } from "./views/plan.js";
import { renderExams, bindExams } from "./views/exams.js";
import { renderLog, bindLog } from "./views/log.js";
import { renderGuide, bindGuide } from "./views/guide.js";
import { createStateUpdater } from "./state-actions.js";
import { createToastController } from "./toast.js";
import { captureViewState } from "./view-state.js";

const root = document.querySelector("#view-root");
const dialog = document.querySelector("#app-dialog");
const dialogTitle = dialog.querySelector("#dialog-title");
const dialogBody = dialog.querySelector("[data-dialog-body]");
const toast = document.querySelector("[data-toast]");
const banner = document.querySelector("[data-app-banner]");
const topbarDate = document.querySelector("[data-topbar-date]");

let data;
let state;
let currentRoute = { view: "today", detail: "" };
let previousFocus = null;
let quickLogPrefill = null;
let syncStatus = getSyncStatus();
let lockEmailOverride = false;
let renderedRoute = "";

const lockScreen = document.querySelector("[data-lock-screen]");
const lockForm = lockScreen.querySelector("[data-lock-form]");
const lockError = lockScreen.querySelector("[data-lock-error]");
const lockMessage = lockScreen.querySelector("[data-lock-message]");
const lockAccount = lockScreen.querySelector("[data-lock-account]");
const lockEmailField = lockScreen.querySelector("[data-lock-email-field]");

const showToast = createToastController(toast, document);

function openDialog({ title, body, onMount }) {
  if (dialog.open) dialog.close();
  previousFocus = document.activeElement;
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialog.showModal();
  onMount?.(dialog);
  dialog.querySelector("button, a, input, select, textarea")?.focus();
}

const updateState = createStateUpdater({
  save: saveState,
  apply: (saved) => { state = saved; context.state = saved; },
  render: () => renderCurrent(),
  sync: scheduleCloudSync,
  showToast,
});

function applySyncedState(nextState) {
  state = saveState(nextState, { notify: false });
  context.state = state;
  renderCurrent();
  return state;
}

function syncLabel(snapshot) {
  if (!snapshot.configured) return "Local only";
  if (!snapshot.signedIn) return "Locked";
  if (snapshot.mode === "syncing" || snapshot.mode === "connecting") return "Syncing";
  if (snapshot.mode === "pending") return "Pending";
  if (snapshot.mode === "offline") return "Offline";
  if (snapshot.mode === "error") return "Sync paused";
  return "Synced";
}

function renderSyncChrome() {
  document.querySelectorAll("[data-sync-open]").forEach((button) => {
    button.dataset.syncMode = syncStatus.mode;
    button.setAttribute("aria-label", `Cross-device sync: ${syncLabel(syncStatus)}`);
    const label = button.querySelector("[data-sync-label]");
    if (label) label.textContent = syncLabel(syncStatus);
  });
}

/** Cosmetic tracker state; deliberately separate from the private account alias. */
function displayNameFieldHTML() {
  const name = state?.settings.displayName || "";
  return `<form class="sync-name-form" data-display-name-form>
    <h4>Display name</h4>
    <label>Cosmetic greeting
      <input name="displayName" type="text" value="${escapeAttr(name)}" maxlength="${MAX_DISPLAY_NAME_LENGTH}" autocomplete="nickname" placeholder="What should this tracker call you?">
    </label>
    <div class="button-row"><button class="button button--primary button--small" type="submit">Save display name</button>${name ? `<button class="button button--quiet button--small" type="button" data-display-name-clear>Remove</button>` : ""}</div>
    <p class="form-hint">This only changes the Today greeting and synced tracker state. It is not a sign-in username.</p>
  </form>`;
}

function bindDisplayNameField(scope) {
  const form = scope.querySelector("[data-display-name-form]");
  if (!form) return;
  const save = (value) => {
    const displayName = sanitizeDisplayName(value);
    updateState({ ...state, settings: { ...state.settings, displayName, updatedAt: new Date().toISOString() } }, {
      success: displayName ? `Display name saved as ${displayName}` : "Display name removed",
      onSaved: () => { if (dialog.open) dialog.close(); },
    });
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); save(form.elements.displayName.value); });
  form.querySelector("[data-display-name-clear]")?.addEventListener("click", () => save(""));
}

function loginUsernameEditorHTML(account) {
  const active = account.migrationState === "active";
  const pending = account.migrationState === "pending";
  const username = account.loginUsername || "";
  return `<form class="sync-name-form" data-login-username-form>
    <h4>Sign-in username</h4>
    <label>Private account alias
      <input name="loginUsername" type="text" value="${escapeAttr(username)}" maxlength="${MAX_LOGIN_USERNAME_LENGTH}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. study.runner">
    </label>
    ${active ? "" : `<label>Current PIN
      <input name="pin" type="password" autocomplete="current-password" inputmode="numeric" pattern="[0-9]*" minlength="4" required placeholder="Required for first setup">
    </label>`}
    <p class="form-error" data-login-username-error role="alert"></p>
    <div class="button-row"><button class="button button--primary button--small" type="submit">${active ? (username ? "Rename username" : "Add username") : (pending ? "Retry setup" : "Set up username")}</button>${active && username ? `<button class="button button--quiet button--small" type="button" data-login-username-remove>Remove username</button>` : ""}</div>
    <p class="form-hint">Use 3–32 lowercase letters, digits, dots, underscores, or hyphens. This alias unlocks new devices; changing or removing it never changes your PIN. Your account email continues to work.</p>
    ${pending ? `<p class="form-hint"><strong>Setup is incomplete but recoverable.</strong> Re-enter the same PIN to finish; the credential salt will not change.</p>` : ""}
  </form>`;
}

async function loadLoginUsernameEditor(scope) {
  const mount = scope.querySelector("[data-login-username-editor]");
  if (!mount || !syncStatus.signedIn) return;
  try {
    const account = await getLoginUsernameStatus();
    if (!mount.isConnected) return;
    mount.innerHTML = loginUsernameEditorHTML(account);
    const form = mount.querySelector("[data-login-username-form]");
    const error = form.querySelector("[data-login-username-error]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      const checked = validateLoginUsername(form.elements.loginUsername.value);
      if (!checked.valid) { error.textContent = checked.message; return; }
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        if (account.migrationState === "active") await renameLoginUsername(checked.username);
        else await configureLoginUsername(checked.username, form.elements.pin.value);
        showToast(account.migrationState === "active" ? "Sign-in username updated" : "Sign-in username ready on new devices");
        await loadLoginUsernameEditor(scope);
      } catch (problem) {
        error.textContent = problem.message;
        button.disabled = false;
        button.textContent = account.migrationState === "active" ? "Save username" : "Retry setup";
      } finally {
        if (form.elements.pin) form.elements.pin.value = "";
      }
    });
    form.querySelector("[data-login-username-remove]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      error.textContent = "";
      try {
        await removeLoginUsername();
        showToast("Sign-in username removed; email + PIN still works");
        await loadLoginUsernameEditor(scope);
      } catch (problem) { error.textContent = problem.message; button.disabled = false; }
    });
  } catch (problem) {
    mount.innerHTML = `<p class="form-error" role="alert">${escapeHTML(problem.message)}</p>`;
  }
}

function syncDialogBody() {
  if (!syncStatus.configured) {
    return `<div class="sync-panel"><span class="sync-hero sync-hero--setup" aria-hidden="true">↔</span><h3>Working locally on this device</h3><p>Every change is already saved in this browser, and JSON backups work normally. To see the same progress on your phone and computer, finish the one-time Supabase setup in the README and add the project URL and publishable key to <code>js/sync-config.js</code>.</p><div class="notice-card"><strong>Security boundary</strong><p>Only a publishable key belongs in browser code. A secret or service-role key must never appear in this project.</p></div>${displayNameFieldHTML()}<a class="button" href="./setup.html">Open the account key calculator</a></div>`;
  }
  if (!syncStatus.signedIn) {
    return `<div class="sync-panel"><span class="sync-hero sync-hero--setup" aria-hidden="true">⌘</span><h3>This device is locked</h3><p>${escapeHTML(syncStatus.message)} Local progress on this device is untouched and will merge with your cloud copy once you unlock.</p><div class="button-row"><button class="button button--primary" type="button" data-sync-unlock>Enter PIN</button></div></div>`;
  }
  const lastSync = syncStatus.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Waiting for first sync";
  return `<div class="sync-panel"><span class="sync-hero sync-hero--ready" aria-hidden="true">✓</span><h3>${escapeHTML(syncStatus.message)}</h3><dl class="sync-facts"><div><dt>Account email</dt><dd>${escapeHTML(syncStatus.email)}</dd></div><div><dt>Last sync</dt><dd>${escapeHTML(lastSync)}</dd></div></dl>${displayNameFieldHTML()}<div data-login-username-editor><p class="form-hint">Loading private sign-in username…</p></div><p>Changes save locally first, then sync automatically. If you study offline, they stay safe here and upload when this device reconnects.</p><p class="form-error" data-sync-error role="alert"></p><div class="button-row"><button class="button button--primary" type="button" data-sync-now>Sync now</button><button class="button" type="button" data-sync-lock>Lock this device</button></div><p class="form-hint">Locking asks for your PIN again next time. It never deletes local progress.</p></div>`;
}

function openSyncDialog() {
  openDialog({ title: "Your account and sync", body: syncDialogBody(), onMount: (scope) => {
    bindDisplayNameField(scope);
    loadLoginUsernameEditor(scope);
    scope.querySelector("[data-sync-unlock]")?.addEventListener("click", () => { dialog.close(); renderLockScreen({ focus: true }); });
    scope.querySelector("[data-sync-now]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget; button.disabled = true; button.textContent = "Syncing…";
      await syncNow(); dialog.close(); showToast(getSyncStatus().message, getSyncStatus().mode === "error" ? "error" : "success");
    });
    scope.querySelector("[data-sync-lock]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { await signOutOfSync(); dialog.close(); showToast("This device is locked"); }
      catch (problem) { scope.querySelector("[data-sync-error]").textContent = problem.message; button.disabled = false; }
    });
  } });
}

/* ---- PIN unlock gate ---- */

function renderLockScreen({ focus = false } = {}) {
  const locked = syncStatus.configured && !syncStatus.unlocked;
  lockScreen.hidden = !locked;
  document.body.classList.toggle("is-locked", locked);
  if (!locked) return;

  lockError.textContent = "";

  const known = rememberedIdentifier();
  const useKnown = Boolean(known) && !lockEmailOverride;
  lockAccount.hidden = !useKnown;
  lockEmailField.hidden = useKnown;
  lockForm.elements.identifier.required = !useKnown;
  if (useKnown) {
    lockAccount.querySelector("[data-lock-identifier]").textContent = known;
    lockForm.elements.identifier.value = known;
  }
  lockScreen.querySelector("[data-lock-lead]").textContent = known && !lockEmailOverride
    ? "Welcome back. Enter your PIN to unlock this device."
    : "Enter the account email or sign-in username and PIN for this tracker.";
  if (focus) (useKnown ? lockForm.elements.pin : lockForm.elements.identifier).focus();
}

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = lockForm.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Unlocking…";
  lockError.textContent = "";
  lockMessage.textContent = "";
  try {
    await unlockWithPin(lockForm.elements.identifier.value, lockForm.elements.pin.value);
    lockForm.elements.pin.value = "";
    lockEmailOverride = false;
    showToast("Unlocked — your tracker is syncing");
  } catch (problem) {
    lockError.textContent = problem.message;
    lockForm.elements.pin.select?.();
  } finally {
    button.disabled = false;
    button.textContent = "Unlock";
  }
});

lockScreen.querySelector("[data-lock-reset]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const identifier = lockForm.elements.identifier.value || rememberedIdentifier();
  lockError.textContent = "";
  lockMessage.textContent = "";
  if (!identifier) {
    lockEmailOverride = true;
    renderLockScreen({ focus: true });
    lockError.textContent = "Enter your account email or sign-in username first, then tap “Forgot your PIN?” again.";
    return;
  }

  button.disabled = true;
  button.textContent = "Sending reset email…";
  try {
    await requestPinReset(identifier);
    lockMessage.textContent = "If that identifier matches the owner account, a PIN reset link is on its way.";
  } catch (problem) {
    lockError.textContent = problem.message;
  } finally {
    button.disabled = false;
    button.textContent = "Forgot your PIN?";
  }
});

lockScreen.querySelector("[data-lock-change-email]").addEventListener("click", () => {
  lockEmailOverride = true;
  renderLockScreen({ focus: true });
});

function sourceFromRow(row) {
  if (!row) return "";
  if (row.resource.includes("Kaplan")) return "Kaplan Chapter Questions";
  if (row.resource.includes("AAMC PE")) return row.resource.replace("PE", "Practice Exam ");
  if (row.resource.includes("Diagnostic")) return "AAMC Unscored Sample";
  if (row.resource.includes("Third-party")) return "Third-Party FL";
  if (row.isSectionBank) return row.practiceTarget.includes("B/B") || row.practiceTarget.includes("C/P") || row.practiceTarget.includes("P/S") ? "AAMC Section Bank Vol. 1" : "Other";
  return row.resource.split(";")[0] || "Other";
}

function sectionFromChapter(chapterId = "") {
  if (/^(GC|PHY|OC)/.test(chapterId)) return "CP";
  if (/^(BIO|BCH)/.test(chapterId)) return "BB";
  if (/^PS/.test(chapterId)) return "PS";
  if (/^CARS/.test(chapterId)) return "CARS";
  return "";
}

function openQuickLog(row = null) {
  const chapter = row?.chapters?.[0];
  quickLogPrefill = row ? {
    date: todayISO(),
    source: sourceFromRow(row),
    chapterId: chapter?.id || "",
    topic: chapter?.title || row.weeklyFocus || "",
    section: sectionFromChapter(chapter?.id),
    assignmentId: row.id,
  } : { date: todayISO() };
  context.quickLogPrefill = quickLogPrefill;
  navigate("log", "new");
}

function clearQuickLogPrefill() {
  quickLogPrefill = null;
  context.quickLogPrefill = null;
}

const context = {
  data: null,
  state: null,
  quickLogPrefill: null,
  updateState,
  navigate,
  openDialog,
  showToast,
  openQuickLog,
  clearQuickLogPrefill,
  rerender: (options) => renderCurrent(options),
};

function renderBanner() {
  if (lastLoadIssue?.type === "corrupt") {
    banner.hidden = false;
    banner.innerHTML = `<div><strong>Stored tracker data could not be read.</strong><span>A recovery copy was preserved. The tracker opened with empty state instead of silently deleting anything.</span></div><button class="button button--small" type="button" data-download-recovery>Download recovery copy</button>`;
    banner.querySelector("[data-download-recovery]").addEventListener("click", () => exportCorruptRecovery(lastLoadIssue.raw));
    return;
  }
  if (!syncStatus.configured) {
    banner.hidden = false;
    banner.innerHTML = `<div><strong>Saving on this device only.</strong><span>Cross-device sync is not set up yet.</span></div><button class="button button--small" type="button" data-banner-sync>Details</button>`;
    banner.querySelector("[data-banner-sync]").addEventListener("click", openSyncDialog);
    return;
  }
  if (!syncStatus.signedIn) {
    // Reachable only through offline grace: this device unlocked previously and
    // has since lost its connection, so it keeps working without a PIN prompt.
    banner.hidden = false;
    banner.innerHTML = `<div><strong>Offline.</strong><span>Changes are safe here and sync when you reconnect.</span></div>`;
    return;
  }
  if (["offline", "error"].includes(syncStatus.mode)) {
    banner.hidden = false;
    banner.innerHTML = `<div><strong>${syncStatus.mode === "offline" ? "You’re offline." : "Sync is paused."}</strong><span>${escapeHTML(syncStatus.message)}</span></div><button class="button button--small" type="button" data-banner-sync>Details</button>`;
    banner.querySelector("[data-banner-sync]").addEventListener("click", openSyncDialog);
    return;
  }
  banner.hidden = true;
  banner.innerHTML = "";
}

function updateNav(view) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
}

function renderCurrent({ preserveView = true } = {}) {
  if (!data || !state) return;
  const routeKey = `${currentRoute.view}/${currentRoute.detail}`;
  const sameRoute = renderedRoute === routeKey;
  const restoreView = sameRoute && preserveView ? captureViewState(root, window) : null;
  if (renderedRoute === "today/" && routeKey !== "today/") leaveToday();
  context.data = data;
  context.state = state;
  context.quickLogPrefill = quickLogPrefill;
  updateNav(currentRoute.view);
  renderBanner();
  topbarDate.innerHTML = `<span>${escapeHTML(formatDateLong(todayISO()))}</span>${new URLSearchParams(location.search).get("today") ? `<strong>Preview date</strong>` : ""}`;
  try {
    // A bottom-nav change should land at the start of its new screen, not at
    // the pixel offset left behind by a long checklist or form. Detail routes
    // may then deliberately scroll to their own target in the view binder.
    if (!sameRoute) window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    if (currentRoute.view === "today") { setDocumentTitle(currentRoute.detail === "completed" ? "Completed" : "Today"); root.innerHTML = renderToday(context, currentRoute); bindToday(root, context, currentRoute); }
    else if (currentRoute.view === "plan") { setDocumentTitle("Plan"); root.innerHTML = renderPlan(context, currentRoute); bindPlan(root, context, { isRouteChange: !sameRoute }); }
    else if (currentRoute.view === "exams") { setDocumentTitle("Exams"); root.innerHTML = renderExams(context, currentRoute); bindExams(root, context, currentRoute); }
    else if (currentRoute.view === "log") { setDocumentTitle("Log + repair"); root.innerHTML = renderLog(context, currentRoute); bindLog(root, context, currentRoute); }
    else { setDocumentTitle("Guide"); root.innerHTML = renderGuide(context, currentRoute); bindGuide(root, context, currentRoute); }
    if (!sameRoute) root.focus({ preventScroll: true });
    renderedRoute = routeKey;
    restoreView?.();
  } catch (error) {
    console.error(error);
    root.innerHTML = `<section class="fatal-state"><span class="eyebrow">The view could not be rendered</span><h1>Something went wrong</h1><p>${escapeHTML(error.message)}</p><button class="button button--primary" type="button" data-retry-view>Try again</button></section>`;
    root.querySelector("[data-retry-view]")?.addEventListener("click", renderCurrent);
  }
}

dialog.querySelector("[data-dialog-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialog.open) {
    event.preventDefault();
    dialog.close();
  }
});
dialog.addEventListener("close", () => { dialogBody.innerHTML = ""; if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null; });
document.querySelectorAll("[data-global-log]").forEach((button) => button.addEventListener("click", () => openQuickLog()));
document.querySelectorAll("[data-sync-open]").forEach((button) => button.addEventListener("click", openSyncDialog));
window.addEventListener("storage", (event) => { if (event.key?.startsWith("mcatMomentum.state")) { state = loadState(); renderCurrent(); } });

async function initialize() {
  try {
    [data, state] = await Promise.all([loadSiteData(), Promise.resolve(loadState())]);
    context.data = data;
    context.state = state;
    startRouter((route) => { currentRoute = route; renderCurrent(); });
    renderSyncChrome();
    initializeSync({
      getState: () => state,
      applyState: applySyncedState,
      onStatus: (nextStatus) => {
        const wasLocked = syncStatus.configured && !syncStatus.unlocked;
        syncStatus = nextStatus;
        renderSyncChrome();
        renderBanner();
        renderLockScreen({ focus: !wasLocked && syncStatus.configured && !syncStatus.unlocked });
      },
    }).catch((error) => {
      // Never strand the owner behind a lock screen because setup failed.
      syncStatus = { ...getSyncStatus(), mode: "error", unlocked: true, message: error.message };
      renderSyncChrome(); renderBanner(); renderLockScreen();
    });
  } catch (error) {
    console.error(error);
    root.innerHTML = `<section class="fatal-state"><span class="eyebrow">Local data could not load</span><h1>Start a local web server</h1><p>${escapeHTML(error.message)}</p><p>This site uses a generated JSON file, so opening <code>index.html</code> directly may be blocked by browser security. Follow the README preview command.</p></section>`;
  }
}

initialize();
