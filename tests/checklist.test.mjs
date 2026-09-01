import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { assignmentTasks, taskProgress, withDailyCompletion, withDailyTask } from "../js/daily.js";
import { loadSiteData } from "../js/data.js";
import { normalizeState } from "../js/storage.js";
import { bindTaskChecklist, taskChecklist } from "../js/views/shared.js";
import { renderPlan } from "../js/views/plan.js";
import { renderToday } from "../js/views/today.js";

const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-09-01", hash: "#today" } };
const data = await loadSiteData();
const row = data.index.scheduleByDate.get("2026-09-01");
const empty = () => normalizeState({});

test("chapter and practice work become stable, understandable checklist steps", () => {
  assert.deepEqual(assignmentTasks(row).map(({ id, label }) => ({ id, label })), [
    { id: "chapter:PHY10", label: "Review PHY10 · Mathematics" },
    { id: "chapter:PHY11", label: "Review PHY11 · Reasoning About the Design and Execution of Research" },
    { id: "practice:0", label: "Complete 8 UWorld topic questions" },
    { id: "practice:1", label: "Complete 1 CARS passage" },
  ]);
  assert.deepEqual(assignmentTasks(data.index.scheduleByDate.get("2026-09-05")).map((task) => task.id), ["assignment:0"]);
  assert.deepEqual(assignmentTasks(data.index.scheduleByDate.get("2026-09-13")), []);
  assert.deepEqual(assignmentTasks(data.index.scheduleByDate.get("2026-09-06")).map((task) => task.id), ["review:incorrect", "review:flagged", "review:guessed-correct"]);
  assert.deepEqual(assignmentTasks(data.index.scheduleByDate.get("2026-09-07")).map((task) => task.label), ["Finish full-length review", "Confidence map", "Weekly pattern review"]);
  assert.deepEqual(assignmentTasks(data.index.scheduleByDate.get("2026-10-24")).map((task) => task.label), ["Answer review", "Brief maintenance", "Complete 2 CARS passages", "Complete 30 B/B Section Bank questions"]);
  for (const scheduleRow of data.schedule.filter((item) => !item.isRest && !item.isTestWindow)) {
    const ids = assignmentTasks(scheduleRow).map((task) => task.id);
    assert.ok(ids.length, `${scheduleRow.id} has no actionable checklist step`);
    assert.equal(new Set(ids).size, ids.length, `${scheduleRow.id} has duplicate checklist step IDs`);
  }
});

test("partial steps persist, start the day, and the final step completes it", () => {
  let state = empty();
  const tasks = assignmentTasks(row);
  state = withDailyTask(state, row, tasks[0].id, true);
  assert.equal(state.daily[row.id].status, "in-progress");
  assert.deepEqual(taskProgress(row, state), { tasks, completed: 1, total: 4 });
  for (const task of tasks.slice(1)) state = withDailyTask(state, row, task.id, true);
  assert.equal(state.daily[row.id].status, "complete");
  assert.equal(taskProgress(row, state).completed, 4);
  state = withDailyTask(state, row, tasks[1].id, false);
  assert.equal(state.daily[row.id].status, "in-progress");
  assert.equal(taskProgress(row, state).completed, 3);
});

test("whole-day completion and reopening update every step without erasing notes", () => {
  const state = normalizeState({ daily: { [row.id]: { status: "in-progress", notes: "keep this", completedTasks: { "chapter:PHY10": true } } } });
  const completed = withDailyCompletion(state, row, true);
  assert.equal(taskProgress(row, completed).completed, 4);
  assert.equal(completed.daily[row.id].notes, "keep this");
  const reopened = withDailyCompletion(completed, row, false);
  assert.equal(taskProgress(row, reopened).completed, 0);
  assert.equal(reopened.daily[row.id].notes, "keep this");
});

test("Today, assignment details, and Plan all expose the same progress", () => {
  const state = withDailyTask(empty(), row, "chapter:PHY10", true);
  const checklist = taskChecklist(row, state);
  assert.match(checklist, /1\/4 done/);
  assert.match(checklist, /aria-pressed="true"[^>]*aria-label="Reopen: Review PHY10/);
  assert.match(renderToday({ data, state }), /Block checklist/);
  assert.match(renderToday({ data, state }), /Guardrails for today/);
  assert.match(renderPlan({ data, state }, {}), /class="plan-day__progress">1\/4 steps/);
  assert.match(renderPlan({ data, state }, {}), /Guardrails for this block/);
});

test("checklist controls save safely and Undo restores the complete prior record", () => {
  const buttons = assignmentTasks(row).slice(0, 1).map((task) => ({
    dataset: { taskAssignment: row.id, toggleTask: task.id },
    addEventListener(_, callback) { this.click = callback; },
  }));
  const messages = [];
  const context = {
    data,
    state: normalizeState({ daily: { [row.id]: { status: "in-progress", notes: "preserve" } } }),
    updateState(next, options = {}) { this.state = next; options.onSaved?.(next); return true; },
    showToast(...args) { messages.push(args); },
  };
  bindTaskChecklist({ querySelectorAll: () => buttons }, context);
  buttons[0].click({ preventDefault() {} });
  assert.equal(context.state.daily[row.id].completedTasks["chapter:PHY10"], true);
  messages.at(-1)[2].onClick();
  assert.deepEqual(context.state.daily[row.id], { status: "in-progress", notes: "preserve" });
});
