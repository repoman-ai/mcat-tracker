import assert from "node:assert/strict";
import * as storage from "../js/storage.js";
import { csvCell } from "../js/utils.js";

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.has(key) ? this.#items.get(key) : null; }
  setItem(key, value) { this.#items.set(String(key), String(value)); }
  removeItem(key) { this.#items.delete(String(key)); }
  clear() { this.#items.clear(); }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  get length() { return this.#items.size; }
  keys() { return [...this.#items.keys()]; }
}

globalThis.localStorage = new MemoryStorage();

const empty = storage.loadState();
assert.equal(empty.schemaVersion, 3);
assert.deepEqual(empty.mistakes, []);

localStorage.setItem(storage.STORAGE_KEY, JSON.stringify({
  schemaVersion: 1,
  completion: { "2026-08-19": { status: "complete" } },
  mistakeLog: [{ id: "old-1", topic: "Units" }],
  registeredExamDate: "2027-01-22",
}));
const migrated = storage.loadState();
assert.equal(migrated.daily["2026-08-19"].status, "complete");
assert.equal(migrated.mistakes[0].id, "old-1");
assert.equal(migrated.settings.registeredExamDate, "2027-01-22");

localStorage.setItem(storage.STORAGE_KEY, JSON.stringify({
  schemaVersion: 2,
  daily: { "2026-08-20": { status: "in-progress", updatedAt: "2026-08-20T12:00:00.000Z" } },
  mistakes: [{ id: "v2-1", topic: "Vectors", updatedAt: "2026-08-20T12:00:00.000Z" }],
}));
const migratedV2 = storage.loadState();
assert.equal(migratedV2.schemaVersion, 3);
assert.equal(migratedV2.daily["2026-08-20"].status, "in-progress");
assert.equal(migratedV2.mistakes[0].id, "v2-1");

localStorage.setItem(storage.STORAGE_KEY, "{definitely not JSON");
const recovered = storage.loadState();
assert.equal(recovered.schemaVersion, 3);
assert.equal(storage.lastLoadIssue?.type, "corrupt");
assert.ok(localStorage.keys().some((key) => key.startsWith(`${storage.STORAGE_KEY}.corrupt.`)));

const saved = storage.saveState({ ...storage.defaultState(), daily: { day: { status: "in-progress" } } }, { notify: false });
assert.equal(saved.daily.day.status, "in-progress");
assert.equal(JSON.parse(localStorage.getItem(storage.STORAGE_KEY)).schemaVersion, 3);

const duplicateBackup = storage.createBackup(storage.defaultState());
duplicateBackup.state.mistakes = [{ id: "same" }, { id: "same" }];
assert.throws(() => storage.validateBackup(duplicateBackup), /duplicate mistake entry IDs/i);

const validBackup = storage.createBackup({
  ...storage.defaultState(),
  daily: { "2026-08-19": { status: "complete" } },
  mistakes: [{ id: "m-1", topic: "Circuits", updatedAt: "2026-08-21T00:00:00.000Z" }],
});
const checked = storage.validateBackup(validBackup);
assert.equal(checked.summary.dailyRecords, 1);
assert.equal(checked.summary.mistakeEntries, 1);

const merged = storage.mergeStates(
  { ...storage.defaultState(), mistakes: [{ id: "m-1", topic: "Old", updatedAt: "2026-08-20T00:00:00.000Z" }] },
  validBackup.state,
);
assert.equal(merged.mistakes.length, 1);
assert.equal(merged.mistakes[0].topic, "Circuits");

const mergedByRecordTime = storage.mergeStates(
  { ...storage.defaultState(), daily: { day: { status: "complete", updatedAt: "2026-08-22T00:00:00.000Z" } } },
  { ...storage.defaultState(), daily: { day: { status: "in-progress", updatedAt: "2026-08-21T00:00:00.000Z" } } },
);
assert.equal(mergedByRecordTime.daily.day.status, "complete");

const mergedDeletion = storage.mergeStates(
  { ...storage.defaultState(), mistakes: [{ id: "gone", topic: "Old", updatedAt: "2026-08-20T00:00:00.000Z" }] },
  { ...storage.defaultState(), tombstones: { mistakes: { gone: "2026-08-21T00:00:00.000Z" } } },
);
assert.equal(mergedDeletion.mistakes.length, 0);
assert.equal(mergedDeletion.tombstones.mistakes.gone, "2026-08-21T00:00:00.000Z");

assert.equal(storage.defaultState().settings.displayName, "");
assert.equal(storage.sanitizeDisplayName("  Alec  E  "), "Alec E");
assert.equal(storage.sanitizeDisplayName("Alec\0\nE\t"), "Alec E");
assert.equal(storage.sanitizeDisplayName("x".repeat(80)).length, storage.MAX_DISPLAY_NAME_LENGTH);
assert.equal(storage.sanitizeDisplayName(undefined), "");
assert.equal(storage.normalizeState({ settings: { displayName: "  Alec " } }).settings.displayName, "Alec");
const displayBackup = storage.createBackup(storage.normalizeState({ settings: { displayName: "  Alec  E  ", updatedAt: "2026-08-21T00:00:00.000Z" } }));
assert.equal(displayBackup.state.settings.displayName, "Alec E", "display name is normalized in JSON export");
const validatedDisplayBackup = storage.validateBackup(displayBackup);
assert.equal(validatedDisplayBackup.state.settings.displayName, "Alec E", "display name survives JSON import");
assert.equal(validatedDisplayBackup.summary.displayName, "Alec E");

// Opening a fresh device is not a settings edit; its blank defaults must not
// overwrite a real cloud display name just because the device was opened later.
const cloudNameOnFreshDevice = {
  ...storage.defaultState(),
  settings: { ...storage.defaultState().settings, displayName: "Cloud name", updatedAt: "2025-01-01T00:00:00.000Z" },
};
assert.equal(storage.mergeStates(storage.defaultState(), cloudNameOnFreshDevice).settings.displayName, "Cloud name");
assert.equal(storage.mergeStates(cloudNameOnFreshDevice, storage.defaultState()).settings.displayName, "Cloud name");

// A display name set on one device must win over an older one from another device.
const mergedName = storage.mergeStates(
  { ...storage.defaultState(), settings: { displayName: "Old", updatedAt: "2026-08-20T00:00:00.000Z" } },
  { ...storage.defaultState(), settings: { displayName: "New", updatedAt: "2026-08-21T00:00:00.000Z" } },
);
assert.equal(mergedName.settings.displayName, "New");
assert.equal(storage.mergeStates(
  { ...storage.defaultState(), settings: { displayName: "New", updatedAt: "2026-08-21T00:00:00.000Z" } },
  { ...storage.defaultState(), settings: { displayName: "Old", updatedAt: "2026-08-20T00:00:00.000Z" } },
).settings.displayName, "New");

// Removing a display name is also a settings edit, so a newer empty value wins.
const mergedNameRemoval = storage.mergeStates(
  { ...storage.defaultState(), settings: { displayName: "Alec", updatedAt: "2026-08-20T00:00:00.000Z" } },
  { ...storage.defaultState(), settings: { displayName: "", updatedAt: "2026-08-21T00:00:00.000Z" } },
);
assert.equal(mergedNameRemoval.settings.displayName, "");

assert.equal(csvCell("plain"), "plain");
assert.equal(csvCell("comma, quote \" and\nUnicode β"), '"comma, quote "" and\nUnicode β"');

console.log("storage.test.mjs: all assertions passed");
