import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadSiteData, getTodayContext, scheduledWeekForDate } from "../js/data.js";
import { normalizeState } from "../js/storage.js";
import { renderPlan } from "../js/views/plan.js";
import { renderToday } from "../js/views/today.js";
import { renderGuide } from "../js/views/guide.js";

const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-01" } };
const data = await loadSiteData();
const state = normalizeState({});
const context = { data, state };
assert.equal(data.plan.plan_start, "2026-09-01");
assert.equal(data.schedule.length, 145);
assert.equal(data.plan.prep_weeks, 20);
assert.equal(data.plan.week_boundary, "Tuesday-Monday");
assert.equal(getTodayContext(data, "2026-08-31").state, "before-plan");
assert.equal(getTodayContext(data, "2026-09-01").row.week, 1);
assert.equal(scheduledWeekForDate(data, "2026-09-07"), 1);
assert.equal(scheduledWeekForDate(data, "2026-09-08"), 2);
assert.equal(scheduledWeekForDate(data, "2027-01-23"), 20);
assert.equal(scheduledWeekForDate(data, "2027-01-24"), 20);
assert.equal(getTodayContext(data, "2027-01-24").state, "after-plan");
assert.deepEqual(data.exams.map(e => e.plannedDate), ["2026-09-19", "2026-11-21", "2026-12-05", "2026-12-12", "2026-12-19", "2027-01-02", "2027-01-09"]);
assert.deepEqual(data.exams[0].reviewAssignmentIds, ["2026-09-20", "2026-09-21"]);
for (const exam of data.exams) {
  const row = data.index.scheduleByDate.get(exam.plannedDate);
  assert.equal(row.day, "Sat");
  assert.equal(row.chapterIds.length, 0);
  assert.equal(row.carsPassages, 9);
  assert.doesNotMatch(row.practiceTarget, /\d+ UWorld/);
  assert.equal(exam.reviewAssignmentIds.length, 2);
  for (const id of exam.reviewAssignmentIds) assert.equal(data.index.scheduleByDate.get(id).chapterIds.length, 0);
}
for (const d of ["2026-11-26", "2026-12-25"]) {
  const row = data.index.scheduleByDate.get(d);
  assert.equal(row.isRest, true);
  assert.equal(row.carsPassages, 0);
  assert.equal(row.practiceTarget, "");
}
for (const row of data.schedule.filter(r => r.isRest)) {
  assert.equal(row.practiceTarget, "", `Rest day ${row.date} must not carry a practice quota`);
  assert.equal(row.carsPassages, 0);
}
const chapterRows = data.schedule.filter(r => r.chapterIds.length);
const ids = chapterRows.flatMap(r => r.chapterIds);
assert.equal(ids.length, 83);
assert.equal(new Set(ids).size, 83);
assert.equal(chapterRows.at(-1).date, "2026-11-30");
assert.deepEqual(data.sectionBanks.map(s => s.totalQuestions), [120, 120, 120]);
assert.equal(data.plan.question_targets.section_bank_reserve, 240);
assert.equal(data.plan.question_targets.uworld_baseline, data.plan.weeks.reduce((n, w) => n + w.uworld_questions, 0));
assert.match(data.plan.study_modes.override_rule, /September 19 diagnostic/);
assert.match(data.plan.retention_protocol.daily_retrieval, /first 10 minutes.*closed-book recall/i);
assert.match(data.plan.retention_protocol.question_mix, /70% current-topic and 30% earlier-topic/);
assert.match(data.plan.retention_protocol.cards, /retrieval failures, repeated misses, or high-yield facts/);
assert.match(data.plan.retention_protocol.minimum_viable_day, /Do not mark the full day complete/);
assert.match(data.index.scheduleByDate.get("2026-09-11").sourceNotes, /first passage untimed.*main point.*author stance.*evidence map/i);
assert.match(data.index.scheduleByDate.get("2026-09-22").sourceNotes, /six current-topic and two earlier-topic/);
assert.match(data.index.scheduleByDate.get("2026-09-22").sourceNotes, /CARS: work toward about 10 minutes/);
assert.match(data.index.scheduleByDate.get("2026-09-10").sourceNotes, /10-minute spaced-retrieval loop/);
assert.match(renderPlan(context, {}), /145 dated rows · 20 Tuesday-Monday weeks/);
assert.match(renderToday(context), /Sep 1-2 reading preserved/);
assert.match(renderToday(context), /PHY10/);
assert.doesNotMatch(renderToday(context), /class="catchup-card"/);
window.location.search = "?today=2026-09-19";
assert.match(renderToday(context), /AAMC Unscored Sample/);
window.location.search = "?today=2026-09-20";
assert.match(renderToday(context), /Full-length review/);
assert.match(renderGuide(context, {}), /September 10 adjustment/);
assert.match(renderGuide(context, {}), /Retention loop/);
assert.doesNotMatch(JSON.stringify(data.guide), /August 19|August 22|22-week|158 daily|880 baseline|AAMC Unscored Sample Sat Sep 5|third-party full-length moves/);

// Date-keyed cloud progress remains truthful after the restructure: the two
// completed reading days stay complete and superseded Sep 3-9 rows do not
// create a new past-due queue on Sep 10.
window.location.search = "?today=2026-09-10";
const preserved = normalizeState({ daily: {
  "2026-09-01": { status: "complete", updatedAt: "2026-09-10T12:00:00.000Z" },
  "2026-09-02": { status: "complete", updatedAt: "2026-09-10T12:00:00.000Z" },
} });
const preservedHTML = renderToday({ data, state: preserved });
assert.match(preservedHTML, /Completed <span>2<\/span>/);
assert.doesNotMatch(preservedHTML, /Past due/);

// Regeneration must not reset existing logs, historic records, settings or scores.
const saved = normalizeState({ daily: { "2026-08-19": { status: "complete" } }, settings: { registeredExamDate: "2027-01-23", displayName: "Student" }, exams: { "exam-03": { total: 520 } } });
const before = JSON.stringify(saved);
renderPlan({ data, state: saved }, {});
renderToday({ data, state: saved });
assert.equal(JSON.stringify(saved), before);
console.log("September 10 restructure, workload placement, guide, UI and preserved-state checks passed");
