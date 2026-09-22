import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadSiteData, getTodayContext, scheduledWeekForDate } from "../js/data.js";
import { normalizeState } from "../js/storage.js";
import { renderPlan } from "../js/views/plan.js";
import { renderToday } from "../js/views/today.js";
import { renderGuide } from "../js/views/guide.js";
import { renderExams } from "../js/views/exams.js";

const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-22" } };
const data = await loadSiteData();
const state = normalizeState({});
const context = { data, state };

assert.equal(data.plan.plan_start, "2026-09-22");
assert.equal(data.plan.plan_end, "2027-03-22");
assert.equal(data.plan.prep_weeks, 26);
assert.equal(data.schedule.length, 182);
assert.equal(data.plan.week_boundary, "Tuesday-Monday");
assert.equal(getTodayContext(data, "2026-09-21").state, "before-plan");
assert.equal(getTodayContext(data, "2026-09-22").row.week, 1);
assert.equal(scheduledWeekForDate(data, "2026-09-28"), 1);
assert.equal(scheduledWeekForDate(data, "2026-09-29"), 2);
assert.equal(scheduledWeekForDate(data, "2027-03-19"), 26);
assert.equal(getTodayContext(data, "2027-03-23").state, "after-plan");

assert.deepEqual(data.exams.map((exam) => exam.plannedDate), ["2026-10-10", "2026-12-12", "2027-01-02", "2027-01-23", "2027-02-06", "2027-02-20", "2027-03-06"]);
assert.deepEqual(data.exams[0].reviewAssignmentIds, ["2026-10-11", "2026-10-12"]);
for (const exam of data.exams) {
  const row = data.index.scheduleByDate.get(exam.plannedDate);
  assert.equal(row.day, "Sat");
  assert.equal(row.chapterIds.length, 0);
  assert.equal(row.carsPassages, 9);
  assert.equal(exam.reviewAssignmentIds.length, 2);
  assert.ok(exam.reviewAssignmentIds.every((id) => data.index.scheduleByDate.get(id).isFullLengthReview));
}
for (const day of ["2026-11-26", "2026-12-25", "2027-01-01"]) {
  const row = data.index.scheduleByDate.get(day);
  assert.equal(row.isRest, true);
  assert.equal(row.practiceTarget, "");
}

const assigned = data.schedule.flatMap((row) => row.chapterIds);
assert.equal(assigned.length, 78);
assert.equal(new Set(assigned).size, 78);
assert.deepEqual(new Set([...assigned, ...data.plan.prior_chapter_ids]), new Set(data.chapters.map((chapter) => chapter.id)));
assert.equal(data.schedule.filter((row) => row.chapterIds.length).at(-1).date, "2027-01-20");
assert.deepEqual(data.sectionBanks.map((bank) => bank.totalQuestions), [120, 120, 120]);
assert.equal(data.plan.question_targets.uworld_baseline, data.plan.weeks.reduce((sum, week) => sum + week.uworld_questions, 0));
assert.match(renderPlan(context, {}), /182 dated rows · 26 Tuesday-Monday weeks/);
assert.match(renderToday(context), /GC04/);
assert.doesNotMatch(renderToday({ data, state: normalizeState({ settings: { displayName: "W".repeat(100) } }) }), /W{8}/);
assert.match(renderGuide(context, {}), /Plan at a Glance/);
assert.match(renderExams(context), /March 19 is the planning date/);
assert.doesNotMatch(renderExams(context), /January 22 is the planning date|January 23 is the planning date/);

window.location.search = "?today=2026-10-10";
assert.match(renderToday(context), /AAMC Unscored Sample/);
window.location.search = "?today=2026-10-11";
assert.match(renderToday(context), /Full-length review/);

const saved = normalizeState({ daily: { "2026-09-01": { status: "complete", notes: "Prior reading" } }, settings: { registeredExamDate: "2027-03-19" }, exams: { "exam-03": { total: 520 } } });
const before = JSON.stringify(saved);
renderPlan({ data, state: saved }, {});
renderToday({ data, state: saved });
assert.equal(JSON.stringify(saved), before);
console.log("March calendar, official exams, section banks, guide and saved-state checks passed");
