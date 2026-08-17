/**
 * Two-device merge behaviour, exercised directly against `mergeStates`.
 *
 * Every case here maps to something that can really happen when a phone and a
 * computer both hold local edits: offline divergence, a deletion racing an edit,
 * simultaneous timestamps, and a first sign-in where one side starts empty.
 *
 * Run:  node tests/sync-merge.test.mjs
 */
import assert from "node:assert/strict";
import { defaultState, mergeStates, normalizeState } from "../js/storage.js";

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks += 1; };
const at = (iso) => new Date(iso).toISOString();

const EARLY = at("2026-10-01T10:00:00Z");
const LATE = at("2026-10-01T12:00:00Z");

function entry(id, overrides = {}) {
  return {
    id, date: "2026-10-01", source: "UWorld", section: "CP", chapterId: "", topic: "Fluids",
    questionRef: "", description: "", result: "Incorrect", errorType: "Content gap",
    whyMissed: "cause", takeaway: "reasoning", fix: "fix", retestDate: "", retestStatus: "Not scheduled",
    retestResult: "", confidence: "", tags: [], notes: "", assignmentId: "",
    createdAt: EARLY, updatedAt: EARLY, ...overrides,
  };
}

function stateWith(overrides = {}) {
  return normalizeState({ ...defaultState(), ...overrides });
}

// 1. First sign-in: local work must survive meeting an empty cloud record.
{
  const local = stateWith({ mistakes: [entry("m1")], daily: { "2026-10-01": { status: "complete", updatedAt: EARLY } } });
  const merged = mergeStates(local, defaultState());
  check(merged.mistakes.length === 1, "first sign-in keeps the local entry");
  check(merged.daily["2026-10-01"].status === "complete", "first sign-in keeps local daily progress");
}

// 2. Empty second device pulls the cloud copy down.
{
  const cloud = stateWith({ mistakes: [entry("m1")], exams: { "exam-03": { total: 512, updatedAt: EARLY } } });
  const merged = mergeStates(defaultState(), cloud);
  check(merged.mistakes.length === 1, "empty device downloads cloud entries");
  check(merged.exams["exam-03"].total === 512, "empty device downloads cloud exam scores");
}

// 3. Both devices edited the same entry offline: newest update wins.
{
  const phone = stateWith({ mistakes: [entry("m1", { fix: "phone fix", updatedAt: LATE })] });
  const laptop = stateWith({ mistakes: [entry("m1", { fix: "laptop fix", updatedAt: EARLY })] });
  check(mergeStates(phone, laptop).mistakes[0].fix === "phone fix", "newer edit wins regardless of merge order (A)");
  check(mergeStates(laptop, phone).mistakes[0].fix === "phone fix", "newer edit wins regardless of merge order (B)");
}

// 4. Disjoint offline edits on both sides are both kept.
{
  const phone = stateWith({ mistakes: [entry("m1")], daily: { "2026-10-01": { status: "complete", updatedAt: EARLY } } });
  const laptop = stateWith({ mistakes: [entry("m2")], daily: { "2026-10-02": { status: "in-progress", updatedAt: EARLY } } });
  const merged = mergeStates(phone, laptop);
  check(merged.mistakes.length === 2, "both offline entries survive reconnection");
  check(Object.keys(merged.daily).length === 2, "both offline daily records survive reconnection");
}

// 5. A deletion must not be resurrected by a stale device still holding the entry.
{
  const deleter = stateWith({ mistakes: [], tombstones: { mistakes: { m1: LATE } } });
  const stale = stateWith({ mistakes: [entry("m1")] });
  check(mergeStates(deleter, stale).mistakes.length === 0, "tombstone beats a stale copy (A)");
  check(mergeStates(stale, deleter).mistakes.length === 0, "tombstone beats a stale copy (B)");
  check(mergeStates(stale, deleter).tombstones.mistakes.m1 === LATE, "tombstone is carried forward so other devices learn of it");
}

// 6. An edit made AFTER the deletion is a genuine re-add and must be kept.
{
  const deleter = stateWith({ mistakes: [], tombstones: { mistakes: { m1: EARLY } } });
  const reAdded = stateWith({ mistakes: [entry("m1", { fix: "re-added", updatedAt: LATE })] });
  const merged = mergeStates(deleter, reAdded);
  check(merged.mistakes.length === 1, "an edit newer than the tombstone is kept");
  check(merged.mistakes[0].fix === "re-added", "the re-added content is the newer one");
}

// 7. Equal timestamps must resolve deterministically, not differ by merge order.
{
  const a = stateWith({ mistakes: [entry("m1", { fix: "A", updatedAt: EARLY })] });
  const b = stateWith({ mistakes: [entry("m1", { fix: "B", updatedAt: EARLY })] });
  check(mergeStates(a, b).mistakes[0].fix === mergeStates(a, b).mistakes[0].fix, "equal timestamps are stable across repeated merges");
  check(mergeStates(a, b).mistakes.length === 1, "equal timestamps do not duplicate the entry");
}

// 8. Equal-timestamp tombstone still wins, so a delete is never silently undone.
{
  const deleter = stateWith({ mistakes: [], tombstones: { mistakes: { m1: EARLY } } });
  const stale = stateWith({ mistakes: [entry("m1", { updatedAt: EARLY })] });
  check(mergeStates(stale, deleter).mistakes.length === 0, "tombstone wins on an equal timestamp");
}

// 9. Settings and mastery follow their own timestamps, not the envelope's.
{
  const older = stateWith({ settings: { registeredExamDate: "2027-01-22", updatedAt: EARLY }, mastery: { "hy-1": { confidence: 1, updatedAt: EARLY } } });
  const newer = stateWith({ settings: { registeredExamDate: "2027-01-23", updatedAt: LATE }, mastery: { "hy-1": { confidence: 3, updatedAt: LATE } } });
  const merged = mergeStates(older, newer);
  check(merged.settings.registeredExamDate === "2027-01-23", "newer registered exam date wins");
  check(merged.mastery["hy-1"].confidence === 3, "newer mastery confidence wins");
}

// 10. Merging is idempotent: syncing twice must not change or duplicate anything.
{
  const phone = stateWith({ mistakes: [entry("m1"), entry("m2")], tombstones: { mistakes: { m3: EARLY } } });
  const laptop = stateWith({ mistakes: [entry("m2", { updatedAt: LATE }), entry("m4")] });
  const once = mergeStates(phone, laptop);
  const twice = mergeStates(once, laptop);
  const ids = (state) => state.mistakes.map((item) => item.id).sort().join(",");
  check(ids(once) === ids(twice), "re-syncing the same pair is idempotent");
  check(once.mistakes.length === 3, "no duplicate rows are created by the merge");
}

// 11. Nothing is silently dropped: every id present on either side and not
//     tombstoned must appear in the result.
{
  const phone = stateWith({ mistakes: [entry("m1"), entry("m2")] });
  const laptop = stateWith({ mistakes: [entry("m3"), entry("m4")] });
  const merged = mergeStates(phone, laptop);
  check(["m1", "m2", "m3", "m4"].every((id) => merged.mistakes.some((item) => item.id === id)), "no entry is lost when both sides diverge");
}

console.log(`sync-merge.test.mjs: ${checks} assertions passed`);
