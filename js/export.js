import { createBackup } from "./storage.js";
import { assignmentTasks, taskProgress, recordedCounts } from "./daily.js";
import {
  countPracticeQuestions,
  csvCell,
  downloadBlob,
  makeDateFromISO,
  percent,
  todayISO,
  topCounts,
} from "./utils.js";

function exportFields(data) { return [...data.workbook.mistakeLog.fieldDefinitions, { key: "captureStatus", label: "Capture Status", type: "text" }, { key: "masteryTopicId", label: "Mastery Topic ID", type: "text" }]; }

const NAVY = "0E2A47";
const BLUE = "2B6F8A";
const PALE_BLUE = "E9F4F7";
const PALE_GREEN = "E8F5EE";
const PALE_GOLD = "FFF4D6";
const BORDER = "D7E2E8";
const WHITE = "FFFFFF";
const TEXT = "183042";

function weekDateRange(data, weekNumber) {
  const rows = data.schedule.filter((row) => row.week === weekNumber);
  return rows.length ? `${rows[0].date} to ${rows.at(-1).date}` : "";
}

function styleWorksheet(worksheet, widths, dateColumns = []) {
  worksheet.views = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
  worksheet.properties.defaultRowHeight = 20;
  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    row.font = { name: "Aptos", size: rowNumber === 1 ? 11 : 10, color: { argb: rowNumber === 1 ? WHITE : TEXT } };
    if (rowNumber === 1) {
      row.height = 30;
      row.font = { name: "Aptos Display", size: 11, bold: true, color: { argb: WHITE } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      row.alignment = { vertical: "middle", wrapText: true };
    } else {
      const fill = rowNumber % 2 === 0 ? "FFFFFF" : "F7FAFB";
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      const longest = Math.max(...row.values.slice(1).map((value) => String(value ?? "").length), 0);
      row.height = Math.min(72, longest > 100 ? 54 : longest > 55 ? 40 : 22);
    }
    row.eachCell((cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: BORDER } } };
    });
  });
  widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  dateColumns.forEach((columnNumber) => { worksheet.getColumn(columnNumber).numFmt = "yyyy-mm-dd"; });
  worksheet.pageSetup = { orientation: widths.length > 10 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
  worksheet.headerFooter.oddFooter = "&LMCAT Momentum export&CPage &P of &N&RGenerated locally";
}

function addSheet(workbook, name, headers, rows, widths, options = {}) {
  const worksheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: options.tabColor || BLUE } } });
  worksheet.addRow(headers);
  rows.forEach((values) => worksheet.addRow(values));
  styleWorksheet(worksheet, widths, options.dateColumns || []);
  if (options.highlightStatusColumn) {
    const column = worksheet.getColumn(options.highlightStatusColumn);
    column.eachCell((cell, rowNumber) => {
      if (rowNumber === 1) return;
      const value = String(cell.value || "").toLowerCase();
      const fill = value.includes("complete") || value.includes("resolved")
        ? PALE_GREEN
        : value.includes("progress") || value.includes("due")
          ? PALE_GOLD
          : PALE_BLUE;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    });
  }
  return worksheet;
}

function dailyRows(data, state) {
  return data.schedule.map((row) => {
    const user = state.daily[row.id] || {};
    const progress = taskProgress(row, state);
    const finished = assignmentTasks(row).filter((task) => user.status === "complete" || user.completedTasks?.[task.id]).map((task) => task.label);
    return [
      makeDateFromISO(row.date), row.day, row.week, row.phase, row.weeklyFocus,
      row.resource, row.chapterIds.join("; "), row.assignment, row.mode,
      row.practiceTargetDisplay, row.carsPassages, row.weeklyMilestone,
      progress.total ? `${progress.completed}/${progress.total}${finished.length ? ` · ${finished.join("; ")}` : ""}` : "",
      user.status || "not-started", user.actualQuestions ?? "", user.actualCars ?? "",
      user.notes || "", user.updatedAt || "",
    ];
  });
}

function progressRows(data, state) {
  return data.plan.weeks.map((week) => {
    const rows = data.schedule.filter((row) => row.week === week.week);
    const studyRows = rows.filter((row) => !row.isRest);
    const completed = studyRows.filter((row) => state.daily[row.id]?.status === "complete").length;
    const questions = recordedCounts(rows, state, "actualQuestions");
    const cars = recordedCounts(rows, state, "actualCars");
    return [
      week.week, weekDateRange(data, week.week), week.phase, week.focus, week.planned_hours,
      studyRows.length, completed, percent(completed, studyRows.length) / 100,
      rows.reduce((sum, row) => sum + countPracticeQuestions(row.practiceTarget), 0), questions.total, week.cars_passages, cars.total,
      week.milestone, week.exam_or_section_bank || "", questions.days, cars.days,
    ];
  });
}

function mistakeRows(data, state) {
  const fields = exportFields(data);
  return state.mistakes.map((entry) => fields.map((field) => {
    const value = entry[field.key];
    if (field.type === "date") return value ? makeDateFromISO(value) : "";
    return Array.isArray(value) ? value.join("; ") : value ?? "";
  }));
}

function weeklyPatternRows(data, state) {
  return data.plan.weeks.map((week) => {
    const scheduleRows = data.schedule.filter((row) => row.week === week.week);
    const dates = new Set(scheduleRows.map((row) => row.date));
    const entries = state.mistakes.filter((entry) => entry.captureStatus !== "needs-review" && dates.has(entry.date));
    const top = (key) => topCounts(entries.map((entry) => entry[key]), 1)[0]?.[0] || "";
    const repeated = topCounts(entries.map((entry) => entry.topic), 10).filter(([, count]) => count > 1).map(([value, count]) => `${value} (${count})`).join("; ");
    const nextAction = entries.filter((entry) => entry.retestStatus !== "Resolved").sort((a, b) => String(a.retestDate || "9999").localeCompare(String(b.retestDate || "9999")))[0]?.fix || "";
    return [
      week.week, weekDateRange(data, week.week), entries.length,
      entries.filter((entry) => entry.result === "Incorrect").length,
      entries.filter((entry) => entry.result === "Flagged").length,
      entries.filter((entry) => entry.result === "Guessed-correct").length,
      top("errorType"), top("topic"), top("section"), top("source"), repeated,
      entries.filter((entry) => entry.retestDate && !["Retested", "Resolved"].includes(entry.retestStatus)).length,
      entries.filter((entry) => entry.retestStatus === "Retested").length,
      entries.filter((entry) => entry.retestStatus === "Resolved").length,
      nextAction,
    ];
  });
}

function masteryRows(data, state) {
  return data.workbook.mastery.topics.map((topic) => {
    const user = state.mastery[topic.id] || {};
    const related = state.mistakes.filter((entry) => (entry.masteryTopicId ? entry.masteryTopicId === topic.id : (entry.topic === topic.topic || entry.tags?.includes(topic.topic)))).length;
    return [topic.section, topic.category, topic.topic, user.confidence ?? "", user.lastReviewed ? makeDateFromISO(user.lastReviewed) : "", user.nextReview ? makeDateFromISO(user.nextReview) : "", user.notes || "", related];
  });
}

function examRows(data, state) {
  return data.exams.map((exam) => {
    const user = state.exams[exam.id] || {};
    return [
      exam.name, exam.source, makeDateFromISO(exam.plannedDate), user.completed ? "Complete" : "Not complete",
      ...(["cp", "cars", "bb", "ps", "total"].map((key) => exam.diagnostic ? "" : user[key] ?? "")),
      user.timingStatus || "", user.unfinishedSection ? "Yes" : "No", user.reviewStatus || "Not started",
      user.reviewDate ? makeDateFromISO(user.reviewDate) : "", user.notes || "", user.repairThemes || "",
      ...["cp", "cars", "bb", "ps"].map((key) => exam.diagnostic ? user.diagnosticPercent?.[key] ?? "" : ""),
    ];
  });
}

function listsRows(data) {
  const source = { ...data.workbook.allowedValues, "Retest Status": ["Not scheduled", "Scheduled", "Due", "Retested", "Resolved"], "Results": ["Incorrect", "Flagged", "Guessed-correct"] };
  const headers = Object.keys(source);
  const count = Math.max(...Object.values(source).map((values) => values.length));
  const rows = Array.from({ length: count }, (_, rowIndex) => headers.map((header) => source[header][rowIndex] ?? ""));
  return { headers, rows };
}

export function exportJSON(state, filename = `MCAT_Tracker_Backup_${todayISO()}.json`) {
  const blob = new Blob([JSON.stringify(createBackup(state), null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, filename);
}

export function exportCorruptRecovery(raw, filename = `MCAT_Tracker_Corrupt_Recovery_${todayISO()}.txt`) {
  downloadBlob(new Blob([raw], { type: "text/plain;charset=utf-8" }), filename);
}

export function exportMistakeCSV(data, state) {
  const fields = exportFields(data);
  const lines = [fields.map((field) => csvCell(field.label)).join(",")];
  state.mistakes.forEach((entry) => {
    lines.push(fields.map((field) => csvCell(entry[field.key])).join(","));
  });
  const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `MCAT_Mistake_Log_${todayISO()}.csv`);
}

let excelLibrary;
export function loadExcelLibrary() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!excelLibrary) excelLibrary = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("../vendor/exceljs.min.js", import.meta.url).href;
    script.onload = () => { if (globalThis.ExcelJS) resolve(globalThis.ExcelJS); else { script.remove(); reject(new Error("Excel export could not load. Try again.")); } };
    script.onerror = () => { script.remove(); reject(new Error("Excel export could not load. Check your connection and try again.")); };
    document.head.append(script);
  }).catch((error) => { excelLibrary = null; throw error; });
  return excelLibrary;
}
export async function exportWorkbook(data, state) {
  await loadExcelLibrary();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MCAT Momentum";
  workbook.lastModifiedBy = "MCAT Momentum";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Current local MCAT tracker state";
  workbook.title = "MCAT 520 Plus Mistake Log";
  workbook.description = "Generated locally in the browser. XLSX is a portable report, not automatic synchronization.";

  addSheet(workbook, "Daily Schedule",
    ["Date", "Day", "Week", "Phase", "Weekly Focus", "Resource", "Chapter ID", "Assignment", "Mode", "Practice Target", "CARS Passages", "Weekly Milestone", "Checklist Progress", "Completion Status", "Actual Questions", "Actual CARS", "User Notes", "Updated"],
    dailyRows(data, state), [13, 8, 8, 18, 28, 24, 18, 52, 25, 42, 13, 46, 42, 18, 15, 12, 38, 22],
    { dateColumns: [1], highlightStatusColumn: 14, tabColor: "2B6F8A" });

  const progress = addSheet(workbook, `${data.plan.prep_weeks}-Week Progress`,
    ["Week", "Dates", "Phase", "Focus", "Planned Hours", "Study Days", "Completed Days", "Completion %", "Planned Questions", "Recorded QBank Questions", "CARS Target", "Recorded CARS Passages", "Milestone", "FL / Section Bank", "Days with QBank Counts", "Days with CARS Counts"],
    progressRows(data, state), [8, 24, 19, 32, 14, 12, 15, 14, 17, 20, 13, 20, 48, 22, 20, 20],
    { tabColor: "5C8D79" });
  progress.getColumn(8).numFmt = "0%";

  const mistakeFields = exportFields(data);
  addSheet(workbook, "Mistake Log", mistakeFields.map((field) => field.label), mistakeRows(data, state),
    mistakeFields.map((field) => ["whyMissed", "takeaway", "fix", "notes", "description"].includes(field.key) ? 38 : ["createdAt", "updatedAt"].includes(field.key) ? 22 : 18),
    { dateColumns: mistakeFields.map((field, index) => field.type === "date" ? index + 1 : 0).filter(Boolean), highlightStatusColumn: mistakeFields.findIndex((field) => field.key === "retestStatus") + 1, tabColor: "D79A47" });

  addSheet(workbook, "Weekly Pattern Review",
    ["Week", "Dates", "Entries", "Incorrect", "Flagged", "Guessed-correct", "Top Error Type", "Top Topic", "Top Section", "Top Source", "Repeated Issues", "Retests Open", "Retested", "Resolved", "Next Repair Action"],
    weeklyPatternRows(data, state), [8, 24, 10, 11, 10, 16, 24, 30, 14, 26, 36, 14, 12, 12, 42],
    { tabColor: "C88444" });

  addSheet(workbook, "High-Yield Mastery",
    ["Section", "Category", "Topic", "Confidence", "Last Reviewed", "Next Review", "Notes", "Related Mistake Count"],
    masteryRows(data, state), [12, 26, 42, 14, 16, 16, 42, 22],
    { dateColumns: [5, 6], tabColor: "5C8D79" });

  addSheet(workbook, "Full-Length Scores",
    ["Exam", "Source", "Planned Date", "Status", "C/P", "CARS", "B/B", "P/S", "Total", "Timing Status", "Any Section Unfinished?", "Review Status", "Review Date", "Notes", "Key Repair Themes", "Diagnostic C/P %", "Diagnostic CARS %", "Diagnostic B/B %", "Diagnostic P/S %"],
    examRows(data, state), [30, 22, 16, 16, 10, 10, 10, 10, 10, 18, 22, 18, 16, 38, 38, 18, 18, 18, 18],
    { dateColumns: [3, 13], highlightStatusColumn: 4, tabColor: "8A5E95" });

  const lists = listsRows(data);
  addSheet(workbook, "Lists", lists.headers, lists.rows, lists.headers.map(() => 28), { tabColor: "73808A" });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `MCAT_520_Plus_Mistake_Log_${todayISO()}.xlsx`,
  );
}
