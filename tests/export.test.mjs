/**
 * Generates real CSV / JSON / XLSX artefacts through the site's own export code,
 * so the files can be opened and inspected outside the browser.
 *
 * Run:  node tests/export.test.mjs [outputDir]
 *
 * Browser-only globals used by the export path (Blob, URL.createObjectURL, a DOM
 * anchor for the download click) are stubbed here so `downloadBlob` writes to
 * disk instead of triggering a download.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = process.argv[2] || path.join(root, "tests", "output");
await fs.mkdir(outputDir, { recursive: true });

// --- Stub the browser surface `downloadBlob` touches -------------------------
const written = [];
globalThis.URL.createObjectURL = (blob) => {
  const handle = `blob:${written.length}`;
  written.push({ handle, blob });
  return handle;
};
globalThis.URL.revokeObjectURL = () => {};
globalThis.window = { setTimeout: () => {}, location: { search: "" } };
globalThis.document = {
  createElement: () => ({
    set href(value) { this._handle = value; },
    get href() { return this._handle; },
    download: "",
    click() { this._clicked = true; captured.push({ handle: this._handle, filename: this.download }); },
    remove() {},
  }),
  body: { append: () => {} },
};
const captured = [];

// ExcelJS ships as a UMD bundle. Load it through require so it takes the
// CommonJS branch rather than binding itself to the `window` stub above.
globalThis.ExcelJS = createRequire(import.meta.url)(path.join(root, "vendor", "exceljs.min.js"));
if (!globalThis.ExcelJS?.Workbook) throw new Error("Vendored ExcelJS did not expose a Workbook.");

const { exportJSON, exportMistakeCSV, exportWorkbook } = await import(path.join(root, "js", "export.js"));
const { normalizeState } = await import(path.join(root, "js", "storage.js"));

const data = JSON.parse(await fs.readFile(path.join(root, "data", "site-data.json"), "utf8"));
data.index = {
  scheduleByDate: new Map(data.schedule.map((row) => [row.date, row])),
  chapterById: new Map(data.chapters.map((chapter) => [chapter.id, chapter])),
  modeByName: new Map(data.studyModes.map((mode) => [mode.name.toLowerCase(), mode])),
  guideById: new Map(data.guide.sections.map((section) => [section.id, section])),
  examById: new Map(data.exams.map((exam) => [exam.id, exam])),
};

// --- Deliberately awkward content: quotes, commas, newlines, unicode, length --
const nasty = 'Comma, "double quote", \nnewline, unicode é ™ ≥ ∆, and <b>markup</b>';
const long = `${"Extremely long repair note. ".repeat(40)}end`;
const now = new Date().toISOString();

const state = normalizeState({
  daily: {
    "2026-10-12": { status: "complete", actualQuestions: 40, actualCars: 3, notes: nasty, updatedAt: now },
    "2026-10-13": { status: "in-progress", actualQuestions: 12, actualCars: 1, notes: "", updatedAt: now },
  },
  exams: {
    "exam-03": { cp: 128, cars: 126, bb: 130, ps: 128, total: 512, timingStatus: "Mixed", reviewStatus: "Complete", reviewDate: "2026-11-23", completed: true, unfinishedSection: false, repairThemes: nasty, notes: "", updatedAt: now },
    "exam-04": { cp: 130, cars: 129, bb: 131, ps: 130, total: 520, timingStatus: "Stable", reviewStatus: "In progress", reviewDate: "", completed: true, unfinishedSection: false, repairThemes: "Electrochem", notes: long, updatedAt: now },
  },
  mistakes: Array.from({ length: 60 }, (_, index) => ({
    id: `mistake-${index}`,
    date: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`,
    source: ["Kaplan Chapter Questions", "UWorld", "AAMC Section Bank Vol. 1"][index % 3],
    section: ["CP", "BB", "PS", "CARS"][index % 4],
    chapterId: index % 5 === 0 ? "PHY04" : "",
    topic: ["Fluids", "Enzyme kinetics", "Amino acids", "Doppler effect"][index % 4],
    questionRef: `Q${index}`,
    description: "",
    result: ["Incorrect", "Flagged", "Guessed-correct"][index % 3],
    errorType: ["Content gap", "Misread question", "Timing pressure"][index % 3],
    whyMissed: index === 0 ? nasty : `Cause ${index}`,
    takeaway: index === 1 ? long : `Reasoning ${index}`,
    fix: `Fix ${index}`,
    retestDate: index % 7 === 0 ? "2026-10-20" : "",
    retestStatus: index % 7 === 0 ? "Scheduled" : "Not scheduled",
    retestResult: "",
    confidence: index % 4,
    tags: ["seed", `t${index % 3}`],
    notes: "",
    assignmentId: "",
    createdAt: now,
    updatedAt: now,
  })),
  mastery: { "hy-1": { confidence: 2, lastReviewed: "2026-10-01", nextReview: "2026-10-20", notes: nasty, updatedAt: now } },
  settings: { registeredExamDate: "2027-01-23", updatedAt: now },
});

const snapshot = JSON.stringify(state);

exportJSON(state);
exportMistakeCSV(data, state);
await exportWorkbook(data, state);

if (JSON.stringify(state) !== snapshot) throw new Error("Exporting mutated the tracker state.");

for (const { handle, filename } of captured) {
  const entry = written.find((item) => item.handle === handle);
  if (!entry) throw new Error(`No blob captured for ${filename}`);
  const buffer = Buffer.from(await entry.blob.arrayBuffer());
  await fs.writeFile(path.join(outputDir, filename), buffer);
}

console.log(JSON.stringify({
  outputDir,
  files: captured.map((item) => item.filename),
  mistakes: state.mistakes.length,
  stateUnchangedByExport: true,
}, null, 2));
