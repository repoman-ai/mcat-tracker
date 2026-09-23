import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSiteData, getModeDetails, modeLabel } from "../js/data.js";
import { normalizeState, validateBackup, createBackup } from "../js/storage.js";
import { renderPlan } from "../js/views/plan.js";

execFileSync("python3", ["-S", fileURLToPath(new URL("test_workload.py", import.meta.url))], { stdio: "inherit" });
const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-22" } };
const data = await loadSiteData();

assert.equal("generatedAt" in raw, false);
assert.equal(getModeDetails(data, "Rapid review; rapid review; Rapid review").length, 1);
assert.equal(modeLabel("Full read; Questions first; Full read"), "Full read; Questions first");
assert.match(renderPlan({ data, state: normalizeState({}) }, {}), /Advisory estimate:/);
assert.equal(data.plan.question_targets.uworld_baseline, 222);
assert.equal(data.plan.question_targets.section_bank, 360);
for (const week of data.validation.weeklyChecks) {
  const rows = data.schedule.filter((row) => row.week === week.week);
  assert.equal(week.estimatedLowMinutes, rows.reduce((sum, row) => sum + (row.estimatedWorkload.conditional ? 0 : row.estimatedWorkload.lowMinutes), 0));
  assert.equal(week.estimatedHighMinutes, rows.reduce((sum, row) => sum + (row.estimatedWorkload.conditional ? 0 : row.estimatedWorkload.highMinutes), 0));
  assert.ok(week.estimatedLowMinutes <= week.budgetMinutes, `Week ${week.week} exceeds its budget`);
}
for (const week of data.validation.weeklyChecks) {
  assert.ok(week.estimatedHighMinutes <= week.budgetMinutes, `Week ${week.week} high estimate exceeds budget`);
}
assert.deepEqual(data.sectionBanks.map(bank => bank.totalQuestions), [120, 120, 120]);
for (const bank of data.sectionBanks) for (const block of bank.assignments) {
  assert.ok([8, 10, 20].includes(block.questions));
  const row = data.index.scheduleByDate.get(block.date);
  assert.ok(!row.isExam && !row.isFullLengthReview && !row.isRest);
}
assert.equal(data.sectionBanks.flatMap(bank => bank.assignments).map(item => item.date).sort().at(-1), "2027-03-02");
for (const row of data.schedule.filter((item) => item.isRest || item.isFullLengthReview)) {
  assert.equal(row.carsPassages, 0);
  assert.equal(row.practiceTarget, "");
}
const testDay = data.index.scheduleByDate.get("2027-03-19");
assert.equal(testDay.isTestWindow, true);
assert.equal(testDay.estimatedWorkload.conditional, true);
const saved = normalizeState({ daily: { "2026-09-01": { status: "complete" }, "2026-09-22": { status: "in-progress" } } });
const backup = validateBackup(createBackup(saved), data.schedule);
assert.equal(backup.summary.dailyRecords, 2);
assert.equal(backup.summary.activeDailyRecords, 1);
assert.equal(backup.summary.historicalDailyRecords, 1);
console.log("March workload and saved-history checks passed");
