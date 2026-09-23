import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { parseISODate, daysBetween, todayISO, toISODate } from "../js/utils.js";
import { parseRoute } from "../js/router.js";
import { loadSiteData, weekRows } from "../js/data.js";
import { assignmentTasks, taskProgress, withDailyTask, withDailyCompletion } from "../js/daily.js";
import { normalizeState } from "../js/storage.js";
import { renderToday } from "../js/views/today.js";
import { renderExams } from "../js/views/exams.js";
import { bindPlan } from "../js/views/plan.js";

const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-22", hash: "#today" } };
const data = await loadSiteData();

test("calendar dates reject rollover and invalid previews fall back to the real date", () => {
  for (const date of ["2027-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-09-00", "bad"]) {
    assert.equal(parseISODate(date), null, date);
  }
  assert.equal(toISODate(parseISODate("2028-02-29")), "2028-02-29");
  assert.equal(daysBetween("2027-03-13", "2027-03-15"), 2);
  assert.equal(daysBetween("2027-02-29", "2027-03-01"), null);
  window.location.search = "?today=2027-02-29";
  assert.equal(todayISO(), toISODate(new Date()));
});

test("malformed encoded deep links cannot crash routing or Plan binding", () => {
  assert.deepEqual(parseRoute("#plan/%E0%A4%A"), { view: "plan", detail: "" });
  assert.deepEqual(parseRoute("#guide/100%"), { view: "guide", detail: "" });
  assert.deepEqual(parseRoute("#plan/2026-09-22"), { view: "plan", detail: "2026-09-22" });
  window.location.hash = "#plan/%E0%A4%A";
  globalThis.CSS = { escape: (value) => value };
  assert.doesNotThrow(() => bindPlan({ querySelectorAll: () => [], querySelector: () => null }, { data, state: normalizeState({}) }));
});

test("weekly motivation credits partial steps without recording questions or completing the day", () => {
  window.location.search = "?today=2026-09-22";
  const row = data.schedule[0];
  const initial = normalizeState({ daily: { [row.id]: { notes: "Keep me", actualQuestions: 2 } } });
  const state = withDailyTask(initial, row, assignmentTasks(row)[0].id, true);
  const before = JSON.stringify(state);
  const html = renderToday({ data, state });
  const total = weekRows(data, 1).reduce((sum, day) => sum + taskProgress(day, state).total, 0);
  assert.match(html, /1 step banked/);
  assert.match(html, new RegExp(`Weekly steps complete<\/span><strong>1/${total}`));
  assert.equal((html.match(/class="week-day /g) || []).length, 7);
  assert.match(html, /aria-current="date"/);
  assert.equal(state.daily[row.id].status, "in-progress");
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.daily[row.id].actualQuestions, 2);
  assert.equal(state.daily[row.id].notes, "Keep me");
  const reopened = withDailyTask(state, row, assignmentTasks(row)[0].id, false);
  assert.match(renderToday({ data, state: reopened }), /Start with one step/);
});

test("weekly completion celebrates actual tasks and rest never becomes study debt", () => {
  window.location.search = "?today=2026-09-27";
  let state = normalizeState({});
  for (const row of weekRows(data, 1).filter((row) => assignmentTasks(row).length)) state = withDailyCompletion(state, row, true);
  const html = renderToday({ data, state });
  assert.match(html, /This week’s steps are complete/);
  assert.match(html, /do not need to clear past-due work/);
  assert.equal(state.daily["2026-09-27"], undefined);
});

test("Today exposes heavy exam-week budgets without adding quotas or moving assignments", () => {
  window.location.search = "?today=2026-10-10";
  const before = JSON.stringify(data.schedule);
  const riskData = structuredClone(data);
  // The revised calendar fits; a synthetic overrun still exercises risk UI.
  const check = riskData.validation.weeklyChecks.find(w => w.week === 3);
  check.estimatedLowMinutes = 1180; check.estimatedHighMinutes = 1300;
  check.capacityRisk = "midpoint-over-budget";
  const html = renderToday({ data: riskData, state: normalizeState({}) });
  assert.match(html, /20-hour weekly ceiling/);
  assert.match(html, /Even the midpoint exceeds/);
  assert.match(html, /Protect exam review and rest/);
  assert.equal(JSON.stringify(data.schedule), before);
});

test("a different registered date explicitly warns that the schedule has not moved", () => {
  window.location.search = "?today=2026-09-22";
  const state = normalizeState({ settings: { registeredExamDate: "2027-04-09" } });
  assert.match(renderExams({ data, state }), /saving a date changes the countdown only/);
  assert.match(renderToday({ data, state }), /booked date differs from this plan/);
  const aligned = normalizeState({ settings: { registeredExamDate: "2027-03-19" } });
  assert.doesNotMatch(renderExams({ data, state: aligned }), /saving a date changes the countdown only/);
});
