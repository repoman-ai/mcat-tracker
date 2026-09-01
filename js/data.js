import { todayISO } from "./utils.js";

let cachedData;

export async function loadSiteData() {
  if (cachedData) return cachedData;
  const response = await fetch("./data/site-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load study data (${response.status})`);
  const data = await response.json();
  if (data?.validation?.status !== "passed" || !data.schedule?.length || data.validation.dailyRows !== data.schedule.length || data.validation.numericWeeks !== data.plan?.prep_weeks) {
    throw new Error("Generated study data did not pass validation.");
  }
  data.index = {
    scheduleByDate: new Map(data.schedule.map((row) => [row.date, row])),
    chapterById: new Map(data.chapters.map((chapter) => [chapter.id, chapter])),
    modeByName: new Map(data.studyModes.map((mode) => [mode.name.toLowerCase(), mode])),
    guideById: new Map(data.guide.sections.map((section) => [section.id, section])),
    examById: new Map(data.exams.map((exam) => [exam.id, exam])),
  };
  cachedData = data;
  return data;
}

export function getTodayContext(data, iso = todayISO()) {
  const exact = data.index.scheduleByDate.get(iso) || null;
  const first = data.schedule[0];
  const last = data.schedule.at(-1);
  if (exact) return { today: iso, row: exact, state: "scheduled" };
  if (iso < first.date) return { today: iso, row: first, state: "before-plan" };
  if (iso > last.date) return { today: iso, row: null, state: "after-plan" };
  const next = data.schedule.find((row) => row.date > iso) || null;
  return { today: iso, row: next, state: "gap" };
}

export function getModeDetails(data, modeString = "") {
  return uniqueModeNames(modeString)
    .map((name) => data.index.modeByName.get(name.toLowerCase()) || {
      id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
      name,
      summary: "Follow the named block and use the operating rules for review depth.",
      completeInstructions: "Follow the named block and use the operating rules for review depth.",
    });
}

export function uniqueModeNames(modeString = "") {
  const seen = new Set();
  return modeString.split(";").map((name) => name.trim()).filter((name) => {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function modeLabel(modeString) {
  return uniqueModeNames(modeString).join("; ");
}

export function weekRows(data, weekNumber) {
  return data.schedule.filter((row) => row.week === weekNumber);
}

export function isStudyRow(row) {
  return !row.isRest && !row.isTestWindow;
}

export function isPastDue(row, state, today = todayISO()) {
  // Deferred means later, not done. Only an explicit completion clears work.
  return isStudyRow(row) && row.date < today && state.daily[row.id]?.status !== "complete";
}

export function pendingRows(data, state, today = todayISO()) {
  // Derive from the active schedule: superseded dates never become catch-up debt.
  return data.schedule.filter((row) => isPastDue(row, state, today))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function completedRows(data, state) {
  const byId = new Map(data.schedule.map((row) => [row.id, row]));
  return Object.entries(state.daily).filter(([, record]) => record?.status === "complete")
    .map(([id]) => byId.get(id) || { id, date: id, assignment: "Earlier plan record", historical: true })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function dueEntries(state, today = todayISO()) {
  return state.mistakes.filter((entry) => entry.retestDate && !["Retested", "Resolved"].includes(entry.retestStatus))
    .sort((a, b) => a.retestDate.localeCompare(b.retestDate))
    .map((entry) => ({ ...entry, dueState: entry.retestDate < today ? "overdue" : entry.retestDate === today ? "today" : "upcoming" }));
}

export function scheduledWeekForDate(data, iso = todayISO()) {
  const row = data.index.scheduleByDate.get(iso);
  if (row && typeof row.week === "number") return row.week;
  if (iso < data.plan.plan_start) return 1;
  const lastNumeric = [...data.schedule].reverse().find((item) => typeof item.week === "number");
  if (lastNumeric && iso > lastNumeric.date) return lastNumeric.week;
  return null;
}
