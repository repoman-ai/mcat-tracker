import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { completedRows, dueEntries, isStudyRow, loadSiteData, pendingRows } from "../js/data.js";
import { withDailyStatus } from "../js/daily.js";
import { createBackup, mergeStates, normalizeState, SCHEMA_VERSION, validateBackup } from "../js/storage.js";
import { bindToday, leaveToday, renderToday } from "../js/views/today.js";
import { bindCompletionButtons } from "../js/views/shared.js";
import { bindPlan, renderPlan } from "../js/views/plan.js";

const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-10", hash: "#today" } };
const data = await loadSiteData();
const empty = () => normalizeState({});
const preview = (date) => { window.location.search = `?today=${date}`; };

test("before/first plan day has no pending work, including superseded August history", () => {
  const state = normalizeState({ daily: { "2026-08-19": { status: "in-progress" } } });
  for (const date of ["2026-08-31", "2026-09-01"]) {
    preview(date);
    assert.deepEqual(pendingRows(data, state), []);
    assert.doesNotMatch(renderToday({ data, state }), /class="catchup-card"/);
  }
});

test("backlog is oldest first without displacing today’s primary action", () => {
  preview("2026-09-10");
  const state = empty();
  const rows = pendingRows({ ...data, schedule: [...data.schedule].reverse() }, state);
  assert.deepEqual(rows.map((row) => row.date), data.schedule.filter((row) => isStudyRow(row) && row.date < "2026-09-10").map((row) => row.date));
  const html = renderToday({ data, state });
  assert.ok(html.indexOf('data-start-day=') < html.indexOf('class="catchup-card"'));
  assert.ok(html.indexOf('class="today-backlog-link"') < html.indexOf('class="today-action '));
  assert.deepEqual([...html.matchAll(/data-work-row="([^"]+)"/g)].map((m) => m[1]), rows.slice(0, 3).map((row) => row.id));
  assert.match(html, new RegExp(`Showing oldest 3 of ${rows.length}`));
  assert.match(html, new RegExp(`View all ${rows.length} in Plan`));
});

test("rest, test-window, today and future rows are excluded; exam and review days count", () => {
  const rows = pendingRows(data, empty(), "2027-01-24");
  assert.ok(rows.some((row) => row.isExam));
  assert.ok(rows.some((row) => row.isFullLengthReview));
  assert.ok(rows.every((row) => !row.isRest && !row.isTestWindow));
  assert.ok(pendingRows(data, empty(), "2026-09-10").every((row) => row.date < "2026-09-10"));
});

test("only complete clears a day; deferred and unknown legacy states remain visible", () => {
  for (const status of [undefined, "not-started", "in-progress", "deferred", "custom"]) {
    const state = normalizeState({ daily: { "2026-09-01": { status } } });
    assert.equal(pendingRows(data, state, "2026-09-02").length, 1);
  }
  assert.equal(pendingRows(data, normalizeState({ daily: { "2026-09-01": { status: "complete" } } }), "2026-09-02").length, 0);
});

test("no horizon or item cap silently drops old work", () => {
  preview("2027-01-24");
  const state = empty();
  const rows = pendingRows(data, state);
  assert.equal(rows.length, data.schedule.filter(isStudyRow).length);
  const html = renderToday({ data, state });
  assert.equal((html.match(/data-work-row=/g) || []).length, 3);
  const plan = renderPlan({ data, state }, { detail: "past-due" });
  assert.equal((plan.match(/data-work-row=/g) || []).length, rows.length);
  assert.match(html, /data-work-row="2026-09-01"/);
  assert.match(html, /End of the dated plan/);
  assert.doesNotMatch(html, /<h1>Plan complete/);
});

test("catch-up stays present on rest, exam, placeholder and after-plan days", () => {
  for (const date of ["2026-09-05", "2026-11-26", "2027-01-22", "2027-01-24"]) {
    preview(date);
    assert.match(renderToday({ data, state: empty() }), /class="catchup-card"/);
  }
});

test("today's checklist leads the action and reference material stays disclosed", () => {
  preview("2026-09-10");
  const html = renderToday({ data, state: empty() });
  const checklist = html.indexOf('class="task-checklist"');
  assert.ok(checklist > 0 && checklist < html.indexOf('data-toggle-complete="2026-09-10"'));
  assert.doesNotMatch(html, /data-start-day=|class="today-facts"/);
});

test("Completed includes every saved completion and historical records, newest date first", () => {
  const state = normalizeState({ daily: {
    "2026-09-01": { status: "complete", notes: "keep" },
    "2026-09-09": { status: "complete" },
    "2026-08-19": { status: "complete" },
    "2026-09-02": { status: "in-progress" },
  } });
  const before = JSON.stringify(state);
  assert.deepEqual(completedRows(data, state).map((row) => row.id), ["2026-09-09", "2026-09-01", "2026-08-19"]);
  const html = renderToday({ data, state }, { detail: "completed" });
  assert.match(html, /Saved history · outside the current plan/);
  assert.match(html, /disabled aria-pressed="true" aria-label="Completed — saved history \(read-only\): Wednesday, August 19, 2026/);
  assert.doesNotMatch(html, /data-toggle-complete="2026-08-19"/);
  assert.match(html, /aria-label="Completed — reopen Wednesday, September 9, 2026/);
  assert.doesNotMatch(html, /class="catchup-card"/);
  assert.equal(JSON.stringify(state), before);
});

test("completion preserves all fields and uses real edit time, not the preview date", () => {
  preview("2027-01-24");
  const state = normalizeState({ daily: { "2026-09-01": { status: "deferred", notes: "Review optics", actualQuestions: 12, actualCars: 2, custom: { retained: true }, updatedAt: "2026-01-01T00:00:00.000Z" } } });
  const before = JSON.stringify(state);
  const start = Date.now();
  const next = withDailyStatus(state, "2026-09-01", "complete");
  const record = next.daily["2026-09-01"];
  assert.equal(record.notes, "Review optics");
  assert.equal(record.actualQuestions, 12);
  assert.equal(record.actualCars, 2);
  assert.deepEqual(record.custom, { retained: true });
  assert.ok(Date.parse(record.updatedAt) >= start && Date.parse(record.updatedAt) <= Date.now());
  assert.equal(record.completedLate, undefined);
  assert.equal(record.completedOn, undefined);
  assert.equal(JSON.stringify(state), before);
  assert.equal(SCHEMA_VERSION, 3);
  assert.deepEqual(validateBackup(createBackup(next)).state.daily, next.daily);
  assert.deepEqual(mergeStates(state, next).daily, next.daily);
  assert.deepEqual(mergeStates(next, state).daily, next.daily);
});

function buttonHarness(state, ids, fail = false) {
  const handlers = new Map();
  const messages = [];
  const container = { querySelectorAll: () => ids.map((id) => ({ dataset: { toggleComplete: id }, addEventListener: (_, handler) => handlers.set(id, handler) })) };
  const context = { state, updateState: (next, options = {}) => { if (fail) return false; context.state = next; options.onSaved?.(next); if (options.success) messages.push([options.success]); return true; }, showToast: (...args) => messages.push(args) };
  bindCompletionButtons(container, context);
  return { context, messages, click: (id) => handlers.get(id)({ preventDefault() {} }) };
}

test("every check-off binds, undo restores previous status, and reopening does not erase notes", () => {
  const harness = buttonHarness(normalizeState({ daily: { "2026-09-01": { status: "in-progress", notes: "saved", actualQuestions: 12 } } }), ["2026-09-01", "2026-09-02"]);
  harness.click("2026-09-01");
  assert.equal(harness.context.state.daily["2026-09-01"].status, "complete");
  harness.messages.at(-1)[2].onClick();
  assert.equal(harness.context.state.daily["2026-09-01"].status, "in-progress");
  harness.click("2026-09-02");
  assert.equal(harness.context.state.daily["2026-09-02"].status, "complete");
  harness.click("2026-09-01");
  harness.click("2026-09-01");
  assert.equal(harness.context.state.daily["2026-09-01"].status, "not-started");
  assert.equal(harness.context.state.daily["2026-09-01"].notes, "saved");
  assert.equal(harness.context.state.daily["2026-09-01"].actualQuestions, 12);
});

test("failed saves cannot claim success or supply a destructive undo", () => {
  const state = empty();
  const harness = buttonHarness(state, ["2026-09-01"], true);
  harness.click("2026-09-01");
  assert.equal(harness.context.state, state);
  assert.equal(harness.messages.length, 0);
});

test("undo never overwrites a newer synced edit", () => {
  const harness = buttonHarness(empty(), ["2026-09-01"]);
  harness.click("2026-09-01");
  const undo = harness.messages.at(-1)[2].onClick;
  harness.context.state.daily["2026-09-01"] = { status: "complete", notes: "Another device", updatedAt: "2099-01-01T00:00:00.000Z" };
  undo();
  assert.equal(harness.context.state.daily["2026-09-01"].notes, "Another device");
  assert.equal(harness.context.state.daily["2026-09-01"].status, "complete");
  assert.match(harness.messages.at(-1)[0], /has changed/);
});

test("retest summary shares the Log derivation and remains visible without overdue study days", () => {
  preview("2026-09-01");
  const state = normalizeState({ mistakes: [
    { id: "past", retestDate: "2026-08-30", retestStatus: "Scheduled" },
    { id: "today", retestDate: "2026-09-01", retestStatus: "Scheduled" },
    { id: "future", retestDate: "2026-09-02", retestStatus: "Scheduled" },
    { id: "done", retestDate: "2026-08-29", retestStatus: "Retested" },
    { id: "resolved", retestDate: "2026-08-29", retestStatus: "Resolved" },
  ] });
  assert.deepEqual(dueEntries(state).map((entry) => entry.dueState), ["overdue", "today", "upcoming"]);
  assert.match(renderToday({ data, state }), /2 retests due/);
  assert.doesNotMatch(renderToday({ data, state }), /class="catchup-card"/);
});

test("Plan's past-due filter uses the same queue and keeps check-off in collapsed summaries", () => {
  preview("2026-09-10");
  const context = { data, state: empty(), rerender() {} };
  let change;
  const container = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-plan-filter]" ? [{ dataset: { planFilter: "status" }, value: "past-due", addEventListener: (_, handler) => { change = handler; } }] : [],
  };
  bindPlan(container, context);
  change();
  const html = renderPlan(context, {}, { isRouteChange: false });
  const ids = [...html.matchAll(/data-assignment-details="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...ids].sort(), pendingRows(data, context.state).map((row) => row.id));
  assert.match(html, /class="past-due-label">Past due/);
  const firstDay = html.slice(html.indexOf(`data-assignment-details="${ids[0]}"`));
  assert.ok(firstDay.indexOf(`data-toggle-complete="${ids[0]}"`) < firstDay.indexOf('class="plan-day__detail"'));
});

test("View all keeps the entire schedule, resolves today once, and opens the backlog", () => {
  preview("2026-10-26");
  const state = empty();
  let reads = 0;
  const search = window.location.search;
  Object.defineProperty(window.location, "search", { configurable: true, get() { reads += 1; return search; } });
  try {
    const html = renderPlan({ data, state }, { detail: "past-due" });
    assert.equal(reads, 1);
    assert.equal((html.match(/class="week-card"/g) || []).length, 20);
    assert.equal((html.match(/data-assignment-details=/g) || []).length, 145);
    assert.match(html, /id="backlog-list" open/);
    assert.match(html, /class="today-label">Today/);
    assert.equal((html.match(/data-work-row=/g) || []).length, pendingRows(data, state, "2026-10-26").length);
  } finally { Object.defineProperty(window.location, "search", { configurable: true, writable: true, value: search }); }
});

test("every Plan navigation resets manual filters; same-view saves keep them", () => {
  preview("2026-09-20");
  const context = { data, state: normalizeState({ daily: { "2026-09-01": { status: "deferred" } } }), rerender() {} };
  const ids = (html) => [...html.matchAll(/data-assignment-details="([^"]+)"/g)].map((m) => m[1]);
  for (const detail of ["", "past-due", "2026-09-20"]) {
    let change;
    bindPlan({ querySelector: () => null, querySelectorAll: (selector) => selector === "[data-plan-filter]" ? [{ dataset: { planFilter: "status" }, value: "deferred", addEventListener: (_, handler) => { change = handler; } }] : [] }, context, { isRouteChange: false });
    change();
    const filtered = renderPlan(context, {}, { isRouteChange: false });
    assert.deepEqual(ids(filtered), ["2026-09-01"]);
    assert.match(filtered, /Showing 1 of 145 scheduled days/);
    const full = renderPlan(context, { detail });
    assert.equal(ids(full).length, 145);
    assert.match(full, /data-assignment-details="2026-09-20"/);
    assert.match(full, /class="deferred-label">Deferred/);
  }
});

test("zero past-due days never hides the schedule", () => {
  preview("2026-08-25");
  const html = renderPlan({ data, state: empty() }, { detail: "past-due" });
  assert.match(html, /No past-due days/);
  assert.equal((html.match(/data-assignment-details=/g) || []).length, 145);
  assert.doesNotMatch(html, /No days match/);
});


test("checking off work and rerendering keeps one focus timer and its original assignment", () => {
  preview("2026-09-10");
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let ticks;
  let intervalCount = 0;
  let cleared = 0;
  globalThis.setInterval = (callback) => { ticks = callback; intervalCount += 1; return 123; };
  globalThis.clearInterval = () => { cleared += 1; };
  const mount = (context) => {
    const elements = Object.fromEntries(["clock", "toggle", "finish"].map((name) => [name, { addEventListener(_, callback) { this.click = callback; } }]));
    const selectors = { "[data-focus-clock]": elements.clock, "[data-focus-toggle]": elements.toggle, "[data-focus-finish]": elements.finish };
    bindToday({ querySelector: (selector) => selectors[selector] || null, querySelectorAll: () => [] }, context);
    return elements;
  };
  const context = { data, state: empty(), updateState(next, options = {}) { this.state = next; options.onSaved?.(next); return true; }, showToast() {} };
  try {
    const first = mount(context);
    first.toggle.click();
    first.finish.click(); // An accidental sub-second Finish must not pause.
    assert.equal(cleared, 0);
    assert.equal(first.toggle.textContent, "Pause");
    now += 1000; ticks();
    assert.equal(first.clock.textContent, "24:59");
    context.state = withDailyStatus(context.state, "2026-09-01", "complete");
    const second = mount(context);
    assert.equal(second.clock.textContent, "24:59");
    assert.equal(second.toggle.textContent, "Pause");
    assert.equal(second.finish.disabled, false);
    assert.equal(intervalCount, 1);
    leaveToday();
    assert.equal(cleared, 1);
    const third = mount(context);
    assert.equal(third.toggle.textContent, "Resume");
    assert.equal(third.clock.textContent, "24:59");
    third.toggle.click();
    assert.equal(intervalCount, 2);
    now += 1499 * 1000; ticks();
    assert.equal(third.clock.textContent, "00:00");
    assert.equal(third.toggle.textContent, "Save block");
    assert.equal(third.toggle.disabled, false);
    preview("2026-09-11");
    third.toggle.click();
    assert.equal(cleared, 3);
    assert.equal(context.state.focusSessions.length, 1);
    assert.equal(context.state.focusSessions[0].assignmentId, "2026-09-10");
    assert.equal(third.clock.textContent, "25:00");
    assert.equal(third.finish.disabled, true);
  } finally {
    Date.now = originalNow;
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
  }
});

test("Complete filter does not expand the entire completed plan", () => {
  preview("2026-09-20");
  const state = empty();
  for (const row of data.schedule) state.daily[row.id] = { status: "complete" };
  const context = { data, state, rerender() {} };
  renderPlan(context, {});
  let change;
  bindPlan({ querySelector: () => null, querySelectorAll: (selector) => selector === "[data-plan-filter]" ? [{ dataset: { planFilter: "status" }, value: "complete", addEventListener: (_, handler) => { change = handler; } }] : [] }, context, { isRouteChange: false });
  change();
  const html = renderPlan(context, {}, { isRouteChange: false });
  assert.equal((html.match(/class="week-card"/g) || []).length, 20);
  assert.deepEqual([...html.matchAll(/class="week-card" open id="week-(\d+)"/g)].map((m) => m[1]), ["3"]);
});
