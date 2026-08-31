import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSiteData, getModeDetails, modeLabel } from "../js/data.js";
import { normalizeState, validateBackup, createBackup } from "../js/storage.js";
import { renderPlan } from "../js/views/plan.js";
import { renderToday } from "../js/views/today.js";

execFileSync("python3", ["-S", fileURLToPath(new URL("test_workload.py", import.meta.url))], { stdio: "inherit" });
const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-02" } };
const data = await loadSiteData();
assert.equal("generatedAt" in raw, false);
assert.equal("displayNormalizations" in raw.validation, false);
assert.equal(getModeDetails(data, "Rapid review; rapid review; Rapid review").length, 1);
assert.equal(modeLabel("Full read; Questions first; Full read"), "Full read; Questions first");
assert.equal(data.index.scheduleByDate.get("2026-09-02").mode.split(";").length, 3);
assert.doesNotMatch(renderToday({data, state: normalizeState({})}), /Rapid review; Rapid review/);
const html = renderPlan({data, state: normalizeState({})}, {});
assert.match(html, /Advisory estimate:/);
assert.match(html, /Capacity risk:/);
assert.equal(data.plan.question_targets.uworld_baseline, 484);
assert.equal(data.plan.weeks.reduce((s, w) => s + w.planned_hours, 0), 426);
for (const week of data.validation.weeklyChecks) {
  const rows = data.schedule.filter(row => row.week === week.week);
  assert.equal(week.estimatedLowMinutes, rows.reduce((s, row) => s + row.estimatedWorkload.lowMinutes, 0));
  assert.equal(week.estimatedHighMinutes, rows.reduce((s, row) => s + row.estimatedWorkload.highMinutes, 0));
  assert.ok(week.estimatedLowMinutes <= week.budgetMinutes);
}
for (const w of [8, 9, 10, 11]) {
  const rows = data.schedule.filter(row => row.week === w);
  assert.equal(rows.reduce((s,r) => s + Number(r.practiceTarget.match(/(\d+) [BC]\/[^ ] Section Bank/)?.[1] || 0), 0), 50);
  assert.equal(rows.filter(r=>r.isSectionBank).length, 2);
  assert.ok(rows.every(r=>r.estimatedWorkload.highMinutes < 400));
  assert.ok(rows.filter(r=>r.day==="Sat").every(r=>/Timed science checkpoint/.test(r.sourceNotes)));
}
for (const bank of data.sectionBanks) for (const block of bank.assignments) {
  assert.ok(block.questions >= 20 && block.questions <= 30);
  const row = data.index.scheduleByDate.get(block.date);
  assert.ok(!row.isExam && !row.isFullLengthReview && !row.isRest);
}
assert.equal(data.sectionBanks.flatMap(b=>b.assignments).map(a=>a.date).sort().at(-1), "2027-01-06");
for (const row of data.schedule.filter(r=>r.isRest || r.isFullLengthReview)) {
  assert.equal(row.carsPassages, 0);
  assert.equal(row.practiceTarget, "");
}
for (const date of ["2027-01-15", "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21"]) {
  const row = data.index.scheduleByDate.get(date);
  assert.equal(row.isRest, false);
  assert.deepEqual([row.estimatedWorkload.lowMinutes, row.estimatedWorkload.highMinutes], [20,45]);
}
const saved = normalizeState({daily:{"2026-08-19":{status:"complete"},"2026-09-02":{status:"in-progress"}}});
const backup = validateBackup(createBackup(saved), data.schedule);
assert.equal(backup.summary.dailyRecords, 2);
assert.equal(backup.summary.activeDailyRecords, 1);
assert.equal(backup.summary.historicalDailyRecords, 1);
assert.equal(backup.state.daily["2026-08-19"].status, "complete");
console.log("Workload policy, redistribution, display-only modes and preserved history passed");
