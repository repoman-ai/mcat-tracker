import { APP_VERSION, uniqueId } from "./utils.js";

export const STORAGE_KEY = "mcatMomentum.state.v2";
export const SCHEMA_VERSION = 3;
export let lastLoadIssue = null;
const UNEDITED_SETTINGS_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    updatedAt: new Date().toISOString(),
    daily: {},
    exams: {},
    mistakes: [],
    mastery: {},
    settings: {
      displayName: "",
      registeredExamDate: "",
      storageNoticeDismissed: false,
      reducedMotionOverride: "system",
      // A fresh device has not edited settings. Keeping this at the epoch lets
      // an existing cloud name or exam date win during its first merge.
      updatedAt: UNEDITED_SETTINGS_TIMESTAMP,
    },
    drafts: { mistake: {} },
    focusSessions: [],
    tombstones: { mistakes: {} },
  };
}

export const MAX_DISPLAY_NAME_LENGTH = 32;

/**
 * The display name is cosmetic. It is not an identity: sign-in still uses the
 * owner email and PIN. Control characters become ordinary spacing so pasted
 * lines cannot disturb the layout, and the length is capped to keep the
 * greeting compact.
 */
export function sanitizeDisplayName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
}

function objectOr(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function sanitizeMistakes(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      let id = String(item.id || uniqueId("mistake"));
      while (seen.has(id)) id = `${id}-copy-${seen.size + 1}`;
      seen.add(id);
      return {
        id,
        date: String(item.date || ""),
        source: String(item.source || ""),
        section: String(item.section || ""),
        chapterId: String(item.chapterId || ""),
        topic: String(item.topic || ""),
        questionRef: String(item.questionRef || ""),
        description: String(item.description || ""),
        result: String(item.result || "Incorrect"),
        errorType: String(item.errorType || ""),
        whyMissed: String(item.whyMissed || ""),
        takeaway: String(item.takeaway || ""),
        fix: String(item.fix || ""),
        retestDate: String(item.retestDate || ""),
        retestStatus: String(item.retestStatus || (item.retestDate ? "Scheduled" : "Not scheduled")),
        retestResult: String(item.retestResult || ""),
        confidence: item.confidence === "" || item.confidence === null || item.confidence === undefined ? "" : Number(item.confidence),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : String(item.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        notes: String(item.notes || ""),
        assignmentId: String(item.assignmentId || ""),
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
      };
    });
}

export function normalizeState(input) {
  const base = defaultState();
  const source = objectOr(input);
  const settings = objectOr(source.settings);
  return {
    ...base,
    ...source,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    daily: objectOr(source.daily),
    exams: objectOr(source.exams),
    mistakes: sanitizeMistakes(source.mistakes),
    mastery: objectOr(source.mastery),
    settings: {
      ...base.settings,
      ...settings,
      displayName: sanitizeDisplayName(settings.displayName),
      updatedAt: String(settings.updatedAt || source.updatedAt || base.settings.updatedAt),
    },
    drafts: { ...base.drafts, ...objectOr(source.drafts), mistake: objectOr(objectOr(source.drafts).mistake) },
    focusSessions: Array.isArray(source.focusSessions) ? source.focusSessions.filter((item) => item && typeof item === "object") : [],
    tombstones: {
      ...base.tombstones,
      ...objectOr(source.tombstones),
      mistakes: Object.fromEntries(Object.entries(objectOr(objectOr(source.tombstones).mistakes)).map(([id, timestamp]) => [String(id), String(timestamp)])),
    },
    updatedAt: String(source.updatedAt || base.updatedAt),
  };
}

function migrateState(input) {
  if (!input || typeof input !== "object") return defaultState();
  if (input.schemaVersion === SCHEMA_VERSION) return normalizeState(input);
  if ([1, 2].includes(input.schemaVersion) || input.version === 1) {
    return normalizeState({
      ...input,
      daily: input.daily || input.completion || {},
      mistakes: input.mistakes || input.mistakeLog || [],
      settings: { ...(input.settings || {}), registeredExamDate: input.registeredExamDate || input.settings?.registeredExamDate || "" },
    });
  }
  return normalizeState(input);
}

export function loadState() {
  lastLoadIssue = null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    return migrateState(JSON.parse(raw));
  } catch (error) {
    const recoveryKey = `${STORAGE_KEY}.corrupt.${Date.now()}`;
    try { localStorage.setItem(recoveryKey, raw); } catch { /* Preserve the original key if quota is full. */ }
    lastLoadIssue = { type: "corrupt", recoveryKey, raw, message: error.message };
    return defaultState();
  }
}

export function saveState(state, { notify = true } = {}) {
  const normalized = normalizeState({ ...state, updatedAt: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  if (notify) window.dispatchEvent(new CustomEvent("tracker:statechange", { detail: normalized }));
  return normalized;
}

export function createBackup(state) {
  return {
    format: "mcat-tracker-backup",
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state: normalizeState(state),
  };
}

export function validateBackup(payload, schedule = null) {
  if (!payload || typeof payload !== "object") throw new Error("The selected file does not contain a JSON object.");
  if (payload.format !== "mcat-tracker-backup") throw new Error("This is not an MCAT tracker backup file.");
  if (!payload.state || typeof payload.state !== "object") throw new Error("The backup is missing its state payload.");
  if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion < 1 || payload.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${payload.schemaVersion ?? "missing"}.`);
  }
  const rawMistakes = payload.state.mistakes;
  if (rawMistakes !== undefined && !Array.isArray(rawMistakes)) throw new Error("The mistake log must be an array.");
  const ids = (rawMistakes || []).map((entry) => entry?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error("The backup contains duplicate mistake entry IDs. No data was changed.");
  const state = normalizeState(payload.state);
  const activeIds = schedule ? new Set(schedule.map((row) => row.id)) : null;
  const activeDailyRecords = activeIds ? Object.keys(state.daily).filter((id) => activeIds.has(id)).length : null;
  return {
    state,
    summary: {
      dailyRecords: Object.keys(state.daily).length,
      activeDailyRecords,
      historicalDailyRecords: activeIds ? Object.keys(state.daily).length - activeDailyRecords : null,
      mistakeEntries: state.mistakes.length,
      examRecords: Object.keys(state.exams).length,
      masteryRecords: Object.keys(state.mastery).length,
      focusSessions: state.focusSessions.length,
      registeredExamDate: state.settings.registeredExamDate || "Not set",
      displayName: state.settings.displayName || "Not set",
    },
  };
}

function newest(first, second) {
  const a = Date.parse(first?.updatedAt || first?.createdAt || 0) || 0;
  const b = Date.parse(second?.updatedAt || second?.createdAt || 0) || 0;
  return b >= a ? second : first;
}

function mergeRecordMaps(current, incoming) {
  const result = { ...current };
  Object.entries(incoming).forEach(([id, record]) => { result[id] = newest(result[id], record); });
  return result;
}

function mergeTimestampMaps(current, incoming) {
  const result = { ...current };
  Object.entries(incoming).forEach(([id, timestamp]) => {
    if ((Date.parse(timestamp) || 0) >= (Date.parse(result[id]) || 0)) result[id] = timestamp;
  });
  return result;
}

export function mergeStates(existing, imported) {
  const current = normalizeState(existing);
  const incoming = normalizeState(imported);
  const deletedMistakes = mergeTimestampMaps(current.tombstones.mistakes, incoming.tombstones.mistakes);
  const mistakeMap = new Map(current.mistakes.map((entry) => [entry.id, entry]));
  incoming.mistakes.forEach((entry) => mistakeMap.set(entry.id, newest(mistakeMap.get(entry.id), entry)));
  [...mistakeMap.entries()].forEach(([id, entry]) => {
    if ((Date.parse(deletedMistakes[id]) || 0) >= (Date.parse(entry.updatedAt || entry.createdAt) || 0)) mistakeMap.delete(id);
  });
  const sessionMap = new Map(current.focusSessions.map((entry) => [entry.id || `${entry.startedAt}-${entry.assignmentId}`, entry]));
  incoming.focusSessions.forEach((entry) => {
    const id = entry.id || `${entry.startedAt}-${entry.assignmentId}`;
    sessionMap.set(id, newest(sessionMap.get(id), entry));
  });
  const incomingStateIsNewer = (Date.parse(incoming.updatedAt) || 0) >= (Date.parse(current.updatedAt) || 0);
  return normalizeState({
    ...(incomingStateIsNewer ? current : incoming),
    ...(incomingStateIsNewer ? incoming : current),
    daily: mergeRecordMaps(current.daily, incoming.daily),
    exams: mergeRecordMaps(current.exams, incoming.exams),
    mastery: mergeRecordMaps(current.mastery, incoming.mastery),
    settings: newest(current.settings, incoming.settings),
    drafts: incomingStateIsNewer ? { ...current.drafts, ...incoming.drafts } : { ...incoming.drafts, ...current.drafts },
    mistakes: [...mistakeMap.values()],
    focusSessions: [...sessionMap.values()],
    tombstones: { mistakes: deletedMistakes },
  });
}

export function clearDraft(state) {
  return normalizeState({ ...state, drafts: { ...state.drafts, mistake: {} } });
}
