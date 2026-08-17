import { exportJSON, exportMistakeCSV, exportWorkbook } from "../export.js";
import { mergeStates, validateBackup } from "../storage.js";
import {
  debounce,
  escapeAttr,
  escapeHTML,
  formatDate,
  formatDateLong,
  formToObject,
  parseISODate,
  plural,
  todayISO,
  topCounts,
  uniqueId,
} from "../utils.js";
import { emptyState } from "./shared.js";

const logFilters = { search: "", section: "all", source: "all", result: "all", errorType: "all", retest: "all", dateFrom: "", dateTo: "", sort: "updated-desc" };
const masteryFilters = { section: "all", confidence: "all", review: "all" };
let editingId = "";
let lastSavedId = "";

// Log used to render capture, retests, patterns, the full table, all 40 mastery
// topics, and the export centre as one column — about 12,000px on a phone before
// a single entry existed. Each section is now its own deep-linkable panel.
const LOG_TABS = [
  { id: "capture", label: "Capture", hint: "Log a question" },
  { id: "repair", label: "Repair", hint: "Retests and patterns" },
  { id: "entries", label: "Entries", hint: "Full mistake log" },
  { id: "mastery", label: "Mastery", hint: "40 high-yield topics" },
  { id: "export", label: "Export", hint: "Backups and workbooks" },
];
const TAB_IDS = new Set(LOG_TABS.map((tab) => tab.id));
const PAGE_SIZE = 25;
let activeTab = "capture";
let logPage = 0;

/** Resolves the panel to show. Entry IDs in the route open a dialog instead. */
export function resolveLogTab(detail = "") {
  if (TAB_IDS.has(detail)) activeTab = detail;
  else if (detail === "new" || detail === "") activeTab = "capture";
  else if (editingId) activeTab = "capture";
  return activeTab;
}

function tabStrip(context, overdue) {
  const counts = { entries: context.state.mistakes.length, repair: overdue };
  return `<nav class="log-tabs" aria-label="Log sections">${LOG_TABS.map((tab) => {
    const count = counts[tab.id];
    const current = tab.id === activeTab;
    return `<a href="#log/${tab.id}" data-log-tab="${escapeAttr(tab.id)}" class="${current ? "is-active" : ""}" ${current ? 'aria-current="page"' : ""}><strong>${escapeHTML(tab.label)}</strong>${count ? `<span class="log-tabs__count">${count}</span>` : ""}<small>${escapeHTML(tab.hint)}</small></a>`;
  }).join("")}</nav>`;
}

function inferSection(chapterId = "") {
  if (/^(GC|PHY|OC)/.test(chapterId)) return "CP";
  if (/^(BIO|BCH)/.test(chapterId)) return "BB";
  if (/^PS/.test(chapterId)) return "PS";
  if (/^CARS/.test(chapterId)) return "CARS";
  return "";
}

function addDays(value, days) {
  const date = parseISODate(value || todayISO()) || new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function selectOptions(values, selected, placeholder = "Select") {
  const items = [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
  if (selected && !items.map(String).includes(String(selected))) items.unshift(selected);
  return `<option value="">${escapeHTML(placeholder)}</option>${items.map((value) => `<option value="${escapeAttr(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHTML(value)}</option>`).join("")}`;
}

function quickForm(context) {
  const existing = editingId ? context.state.mistakes.find((entry) => entry.id === editingId) : null;
  const draft = existing || context.state.drafts.mistake || {};
  const prefill = context.quickLogPrefill || {};
  const value = (key, fallback = "") => draft[key] ?? prefill[key] ?? fallback;
  const sources = context.data.workbook.allowedValues.Sources || [];
  const sections = context.data.workbook.allowedValues.Sections || [];
  const errors = context.data.workbook.allowedValues["Error Types"] || [];
  const chapterId = value("chapterId");
  const section = value("section", inferSection(chapterId));
  const topic = value("topic", chapterId ? context.data.index.chapterById.get(chapterId)?.title || "" : "");
  return `<section class="quick-capture" id="quick-capture" aria-labelledby="quick-title">
    <div class="quick-capture__intro"><div><h2 id="quick-title">${existing ? "Edit mistake entry" : "Quick capture"}</h2><p>Cause, correct reasoning, one concrete repair. <a href="#guide/operating-rules">What belongs here</a></p></div>${existing ? `<button class="button button--quiet" type="button" data-cancel-edit>Cancel edit</button>` : `<span class="autosave-state" data-autosave-state>Draft autosaves</span>`}</div>
    ${lastSavedId ? `<div class="save-success" role="status"><div><strong>Entry saved.</strong><span>Repair captured without losing your place.</span></div><div class="button-row"><button class="button button--quiet" type="button" data-log-another>Log another</button><button class="button button--quiet" type="button" data-view-entry="${escapeAttr(lastSavedId)}">View entry</button><button class="button button--quiet" type="button" data-schedule-retest="${escapeAttr(lastSavedId)}">Schedule retest</button><a class="button button--quiet" href="#today">Return to Today</a></div></div>` : ""}
    <form data-mistake-form novalidate>
      <input type="hidden" name="id" value="${escapeAttr(existing?.id || "")}">
      <input type="hidden" name="assignmentId" value="${escapeAttr(value("assignmentId"))}">
      <div class="form-grid form-grid--four">
        <label>Date<input required name="date" type="date" value="${escapeAttr(value("date", todayISO()))}"></label>
        <label>Result<select required name="result">${selectOptions(["Incorrect", "Flagged", "Guessed-correct"], value("result", "Incorrect"))}</select></label>
        <label>Source<select required name="source">${selectOptions(sources, value("source"), "Choose source")}</select></label>
        <label>MCAT section<select required name="section">${selectOptions(sections, section, "Choose section")}</select></label>
      </div>
      <div class="form-grid form-grid--three">
        <label>Chapter<select name="chapterId">${selectOptions(context.data.chapters.map((chapter) => chapter.id), chapterId, "No chapter / choose")}</select></label>
        <label>Topic<input required name="topic" value="${escapeAttr(topic)}" placeholder="e.g. enzyme kinetics"></label>
        <label>Question or passage ref<input name="questionRef" value="${escapeAttr(value("questionRef"))}" placeholder="Q12, Passage 4, etc."></label>
      </div>
      <label>Error type<select required name="errorType">${selectOptions(errors, value("errorType"), "Choose the primary cause")}</select></label>
      <div class="repair-grid">
        <label>Why was it missed?<textarea required name="whyMissed" rows="3" placeholder="Name the actual cause, not just ‘content gap.’">${escapeHTML(value("whyMissed"))}</textarea></label>
        <label>Correct reasoning or takeaway<textarea required name="takeaway" rows="3" placeholder="What should your reasoning have done?">${escapeHTML(value("takeaway"))}</textarea></label>
        <label>Concrete fix<textarea required name="fix" rows="3" placeholder="One action you can retest">${escapeHTML(value("fix"))}</textarea></label>
      </div>
      <div class="form-grid form-grid--two">
        <label>Retest date <span class="optional">optional</span><input name="retestDate" type="date" value="${escapeAttr(value("retestDate"))}"></label>
        <label>Retest status<select name="retestStatus">${selectOptions(["Not scheduled", "Scheduled", "Due", "Retested", "Resolved"], value("retestStatus", value("retestDate") ? "Scheduled" : "Not scheduled"))}</select></label>
      </div>
      <details class="more-details" ${value("description") || value("tags") || value("notes") ? "open" : ""}><summary>More details</summary><div class="more-details__body">
        <label>Short question description<textarea name="description" rows="2" placeholder="Avoid reproducing copyrighted question text; a short reminder is enough.">${escapeHTML(value("description"))}</textarea></label>
        <div class="form-grid form-grid--two"><label>Confidence 0-3<select name="confidence">${selectOptions([0, 1, 2, 3], value("confidence"), "Not rated")}</select></label><label>Tags<input name="tags" value="${escapeAttr(Array.isArray(value("tags")) ? value("tags").join(", ") : value("tags"))}" placeholder="timing, units, passage map"></label></div>
        <label>Additional notes<textarea name="notes" rows="3">${escapeHTML(value("notes"))}</textarea></label>
        ${existing ? `<label>Retest result<textarea name="retestResult" rows="2">${escapeHTML(value("retestResult"))}</textarea></label>` : ""}
      </div></details>
      <div class="form-actions"><button class="button button--primary button--large" type="submit">${existing ? "Save changes" : "Save entry"}</button><span class="form-hint">Required: date, result, source, section, topic, error type, cause, reasoning, and fix.</span></div>
    </form>
  </section>`;
}

function dueEntries(state) {
  const today = todayISO();
  return state.mistakes.filter((entry) => entry.retestDate && !["Retested", "Resolved"].includes(entry.retestStatus)).sort((a, b) => a.retestDate.localeCompare(b.retestDate)).map((entry) => ({ ...entry, dueState: entry.retestDate < today ? "overdue" : entry.retestDate === today ? "today" : "upcoming" }));
}

function retestQueue(context) {
  const due = dueEntries(context.state);
  const priority = due.filter((entry) => entry.dueState !== "upcoming");
  if (!priority.length) return `<section class="queue-card queue-card--clear"><div><span class="eyebrow">Repair queue</span><h2>No retests due today</h2><p>${due.length ? `${plural(due.length, "retest")} scheduled ahead.` : "Schedule a retest when a mistake needs delayed retrieval."}</p></div>${due.length ? `<a href="#log/entries" class="button button--quiet">View upcoming</a>` : ""}</section>`;
  return `<section class="retest-section" aria-labelledby="retest-title"><div class="section-heading"><div><span class="eyebrow">Gentle repair queue</span><h2 id="retest-title">Retests due</h2></div><span>${priority.filter((entry) => entry.dueState === "overdue").length} overdue · ${priority.filter((entry) => entry.dueState === "today").length} today</span></div><div class="retest-grid">${priority.slice(0, 6).map((entry) => `<article class="retest-card retest-card--${entry.dueState}"><div><span class="status-badge">${entry.dueState === "overdue" ? `Due ${formatDate(entry.retestDate)}` : "Due today"}</span><h3>${escapeHTML(entry.topic)}</h3><p>${escapeHTML(entry.fix)}</p></div><div class="retest-card__meta"><span>${escapeHTML(entry.section)}</span><span>${escapeHTML(entry.source)}</span></div><div class="button-row"><button class="button button--primary" type="button" data-retest-entry="${escapeAttr(entry.id)}">Record retest</button><button class="button button--quiet" type="button" data-view-entry="${escapeAttr(entry.id)}">View</button></div></article>`).join("")}</div></section>`;
}

function summaryBars(title, counts) {
  const max = Math.max(...counts.map(([, count]) => count), 1);
  return `<article class="summary-card"><h3>${escapeHTML(title)}</h3>${counts.length ? `<ul class="bar-list">${counts.map(([label, count]) => `<li><div><span>${escapeHTML(label)}</span><strong>${count}</strong></div><span class="mini-bar"><i style="width:${Math.round((count / max) * 100)}%"></i></span></li>`).join("")}</ul>` : `<p class="muted">No entries yet.</p>`}</article>`;
}

function patternSummary(context) {
  const thisWeek = context.data.index.scheduleByDate.get(todayISO())?.week;
  const weekDates = new Set(context.data.schedule.filter((row) => row.week === thisWeek).map((row) => row.date));
  const entries = context.state.mistakes.filter((entry) => weekDates.has(entry.date));
  const repeated = topCounts(entries.map((entry) => entry.topic), 5).filter(([, count]) => count > 1);
  return `<section class="pattern-summary" aria-labelledby="pattern-title"><div class="section-heading"><div><span class="eyebrow">Workbook concept, made live</span><h2 id="pattern-title">Weekly pattern review</h2></div><span>${entries.length} entries this week</span></div><div class="summary-grid">${summaryBars("Error types", topCounts(entries.map((entry) => entry.errorType), 4))}${summaryBars("Topics", topCounts(entries.map((entry) => entry.topic), 4))}${summaryBars("Sections", topCounts(entries.map((entry) => entry.section), 4))}${summaryBars("Sources", topCounts(entries.map((entry) => entry.source), 4))}</div><div class="pattern-action"><strong>${repeated.length ? "Repeated issues worth one repair plan" : "No repeated topic yet this week"}</strong><p>${repeated.length ? repeated.map(([topic, count]) => `${topic} (${count})`).join(" · ") : "Keep logging only meaningful misses, flags, and guessed-correct items."}</p></div></section>`;
}

function filterEntries(entries) {
  const query = logFilters.search.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    const haystack = [entry.topic, entry.source, entry.section, entry.chapterId, entry.errorType, entry.whyMissed, entry.takeaway, entry.fix, ...(entry.tags || [])].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (logFilters.section !== "all" && entry.section !== logFilters.section) return false;
    if (logFilters.source !== "all" && entry.source !== logFilters.source) return false;
    if (logFilters.result !== "all" && entry.result !== logFilters.result) return false;
    if (logFilters.errorType !== "all" && entry.errorType !== logFilters.errorType) return false;
    if (logFilters.retest === "overdue" && !(entry.retestDate && entry.retestDate < todayISO() && !["Retested", "Resolved"].includes(entry.retestStatus))) return false;
    if (logFilters.retest !== "all" && logFilters.retest !== "overdue" && entry.retestStatus !== logFilters.retest) return false;
    if (logFilters.dateFrom && entry.date < logFilters.dateFrom) return false;
    if (logFilters.dateTo && entry.date > logFilters.dateTo) return false;
    return true;
  });
  return filtered.sort((a, b) => {
    if (logFilters.sort === "date-asc") return a.date.localeCompare(b.date);
    if (logFilters.sort === "topic") return a.topic.localeCompare(b.topic);
    if (logFilters.sort === "retest") return String(a.retestDate || "9999").localeCompare(String(b.retestDate || "9999"));
    return String(b.updatedAt || b.date).localeCompare(String(a.updatedAt || a.date));
  });
}

function logTable(context) {
  const all = filterEntries(context.state.mistakes);
  // A full season of logging runs to hundreds of rows. Rendering them all made
  // the panel ~13,000px tall and slowed every keystroke, since each state change
  // re-renders the view.
  const pageCount = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  if (logPage >= pageCount) logPage = pageCount - 1;
  const start = logPage * PAGE_SIZE;
  const entries = all.slice(start, start + PAGE_SIZE);
  const pager = all.length > PAGE_SIZE
    ? `<nav class="log-pager" aria-label="Mistake log pages"><button class="button button--small" type="button" data-log-page="${logPage - 1}" ${logPage === 0 ? "disabled" : ""}>Previous</button><span aria-live="polite">${start + 1}–${start + entries.length} of ${all.length}</span><button class="button button--small" type="button" data-log-page="${logPage + 1}" ${logPage >= pageCount - 1 ? "disabled" : ""}>Next</button></nav>`
    : "";
  const values = context.data.workbook.allowedValues;
  return `<section class="complete-log" aria-labelledby="complete-log-title"><div class="section-heading"><div><span class="eyebrow">Searchable complete record</span><h2 id="complete-log-title">Mistake log</h2></div><span>${all.length} of ${context.state.mistakes.length} entries</span></div>
    <div class="log-filter-grid"><label class="search-control">Search<input type="search" data-log-search value="${escapeAttr(logFilters.search)}" placeholder="Topic, chapter, cause, fix, tag…"></label><label>Section<select data-log-filter="section"><option value="all">All sections</option>${(values.Sections || []).map((value) => `<option ${logFilters.section === value ? "selected" : ""}>${escapeHTML(value)}</option>`).join("")}</select></label><label>Source<select data-log-filter="source"><option value="all">All sources</option>${(values.Sources || []).map((value) => `<option ${logFilters.source === value ? "selected" : ""}>${escapeHTML(value)}</option>`).join("")}</select></label><label>Result<select data-log-filter="result"><option value="all">All results</option>${["Incorrect", "Flagged", "Guessed-correct"].map((value) => `<option ${logFilters.result === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Error type<select data-log-filter="errorType"><option value="all">All error types</option>${(values["Error Types"] || []).map((value) => `<option ${logFilters.errorType === value ? "selected" : ""}>${escapeHTML(value)}</option>`).join("")}</select></label><label>Retest<select data-log-filter="retest"><option value="all">All retest states</option><option value="overdue" ${logFilters.retest === "overdue" ? "selected" : ""}>Overdue</option>${["Not scheduled", "Scheduled", "Due", "Retested", "Resolved"].map((value) => `<option ${logFilters.retest === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>From date<input type="date" data-log-filter="dateFrom" value="${escapeAttr(logFilters.dateFrom)}"></label><label>Through date<input type="date" data-log-filter="dateTo" value="${escapeAttr(logFilters.dateTo)}"></label><label>Sort<select data-log-filter="sort"><option value="updated-desc" ${logFilters.sort === "updated-desc" ? "selected" : ""}>Recently updated</option><option value="date-asc" ${logFilters.sort === "date-asc" ? "selected" : ""}>Oldest date</option><option value="topic" ${logFilters.sort === "topic" ? "selected" : ""}>Topic A-Z</option><option value="retest" ${logFilters.sort === "retest" ? "selected" : ""}>Retest date</option></select></label><button class="button button--quiet" type="button" data-log-reset>Reset</button></div>
    ${entries.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Result</th><th>Section</th><th>Topic / cause</th><th>Source</th><th>Retest</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${entries.map((entry) => `<tr><td data-label="Date">${escapeHTML(formatDate(entry.date))}</td><td data-label="Result"><span class="result-chip result-chip--${escapeAttr(entry.result.toLowerCase().replaceAll(/[^a-z]+/g, "-"))}">${escapeHTML(entry.result)}</span></td><td data-label="Section">${escapeHTML(entry.section)}</td><td data-label="Topic / cause"><strong>${escapeHTML(entry.topic)}</strong><span>${escapeHTML(entry.errorType)} · ${escapeHTML(entry.whyMissed)}</span></td><td data-label="Source">${escapeHTML(entry.source)}</td><td data-label="Retest">${entry.retestDate ? `${escapeHTML(formatDate(entry.retestDate))}<span>${escapeHTML(entry.retestStatus)}</span>` : "Not scheduled"}</td><td class="row-actions"><button class="icon-button" type="button" data-view-entry="${escapeAttr(entry.id)}" aria-label="View ${escapeAttr(entry.topic)}">View</button><button class="icon-button" type="button" data-edit-entry="${escapeAttr(entry.id)}" aria-label="Edit ${escapeAttr(entry.topic)}">Edit</button><button class="icon-button icon-button--danger" type="button" data-delete-entry="${escapeAttr(entry.id)}" aria-label="Delete ${escapeAttr(entry.topic)}">Delete</button></td></tr>`).join("")}</tbody></table></div>${pager}` : emptyState("No entries match", "Try clearing a filter, or capture the next meaningful miss above.")}
  </section>`;
}

function relatedChapters(topic, data) {
  const words = topic.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
  if (!words.length) return [];
  return data.chapters.map((chapter) => ({ chapter, score: words.filter((word) => `${chapter.title} ${chapter.subsections.map((item) => item.title).join(" ")}`.toLowerCase().includes(word)).length })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((item) => item.chapter);
}

function masterySection(context) {
  const today = todayISO();
  const filtered = context.data.workbook.mastery.topics.filter((topic) => {
    const user = context.state.mastery[topic.id] || {};
    const relatedCount = context.state.mistakes.filter((entry) => entry.topic === topic.topic).length;
    if (masteryFilters.section !== "all" && topic.section !== masteryFilters.section) return false;
    if (masteryFilters.confidence !== "all" && String(user.confidence ?? "never") !== masteryFilters.confidence) return false;
    if (masteryFilters.review === "never" && user.lastReviewed) return false;
    if (masteryFilters.review === "due" && !(user.nextReview && user.nextReview <= today)) return false;
    if (masteryFilters.review === "repeated" && relatedCount < 2) return false;
    return true;
  });
  return `<section class="mastery-section" aria-labelledby="mastery-title"><div class="section-heading"><div><span class="eyebrow">Complete workbook checklist · 40 topics</span><h2 id="mastery-title">High-yield mastery</h2></div><span>0 unfamiliar · 1 recognize · 2 explain · 3 apply</span></div>
    <div class="mastery-filters"><label>Section<select data-mastery-filter="section"><option value="all">All sections</option>${["CP", "BB", "PS", "CARS"].map((value) => `<option ${masteryFilters.section === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Confidence<select data-mastery-filter="confidence"><option value="all">All confidence</option><option value="never" ${masteryFilters.confidence === "never" ? "selected" : ""}>Not rated</option>${[0, 1, 2, 3].map((value) => `<option value="${value}" ${masteryFilters.confidence === String(value) ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Review need<select data-mastery-filter="review"><option value="all">All review states</option><option value="never" ${masteryFilters.review === "never" ? "selected" : ""}>Never reviewed</option><option value="due" ${masteryFilters.review === "due" ? "selected" : ""}>Due for review</option><option value="repeated" ${masteryFilters.review === "repeated" ? "selected" : ""}>Repeated mistakes</option></select></label></div>
    <div class="mastery-list">${filtered.map((topic) => {
      const user = context.state.mastery[topic.id] || {};
      const relatedMistakes = context.state.mistakes.filter((entry) => entry.topic === topic.topic);
      const chapters = relatedChapters(topic.topic, context.data);
      const due = user.nextReview && user.nextReview <= today;
      return `<article class="mastery-row ${due ? "is-due" : ""}" data-mastery-row="${escapeAttr(topic.id)}"><div class="mastery-row__lead"><span class="section-token section-token--${topic.section.toLowerCase()}">${escapeHTML(topic.section)}</span><div><h3>${escapeHTML(topic.topic)}</h3><p>${relatedMistakes.length ? `${plural(relatedMistakes.length, "related mistake")}` : "No exact related mistakes"}${user.lastReviewed ? ` · reviewed ${formatDate(user.lastReviewed)}` : " · never reviewed"}</p></div></div><div class="confidence-control" role="group" aria-label="Confidence for ${escapeAttr(topic.topic)}">${[0, 1, 2, 3].map((value) => `<button type="button" data-confidence="${value}" data-topic-id="${escapeAttr(topic.id)}" class="${Number(user.confidence) === value ? "is-selected" : ""}" aria-pressed="${Number(user.confidence) === value}">${value}</button>`).join("")}</div><details><summary>Review details</summary><div class="mastery-detail"><div class="form-grid form-grid--two"><label>Last reviewed<input data-mastery-field="lastReviewed" type="date" value="${escapeAttr(user.lastReviewed || "")}"></label><label>Next review<input data-mastery-field="nextReview" type="date" value="${escapeAttr(user.nextReview || "")}"></label></div><label>Notes<textarea data-mastery-field="notes" rows="2">${escapeHTML(user.notes || "")}</textarea></label>${chapters.length ? `<div class="context-links"><span>Related chapters</span>${chapters.map((chapter) => `<a href="#plan/${escapeAttr(context.data.schedule.find((row) => row.chapterIds.includes(chapter.id))?.date || "")}">${escapeHTML(chapter.id)} ${escapeHTML(chapter.title)}</a>`).join("")}</div>` : ""}</div></details></article>`;
    }).join("") || emptyState("No mastery topics match", "Adjust the confidence or review filters.")}</div>
  </section>`;
}

function exportCenter(context) {
  return `<section class="export-center" aria-labelledby="export-title"><div class="section-heading"><div><span class="eyebrow">Portable reports + full round trip</span><h2 id="export-title">Export center</h2></div><span>Generated from current tracker state</span></div><div class="storage-notice"><strong>Local first, privately synchronized after sign-in</strong><p>Each device saves immediately in its browser, then merges with your authenticated cloud copy. JSON remains an independent full backup; XLSX and CSV are portable reports.</p></div><div class="export-grid"><article><h3>Excel workbook</h3><p>Seven polished sheets with the live schedule, progress, mistakes, patterns, mastery, scores, and lists.</p><button class="button button--primary" type="button" data-export-xlsx>Create XLSX</button></article><article><h3>Mistake log CSV</h3><p>Every log field with stable headers and safe quoting for commas, newlines, and Unicode.</p><button class="button" type="button" data-export-csv>Export CSV</button></article><article><h3>Complete JSON backup</h3><p>The supported full round-trip format for all progress, settings, drafts, and tracking data.</p><button class="button" type="button" data-export-json>Export JSON</button></article><article><h3>Import JSON backup</h3><p>Validated before any change. You choose replace or merge and can download a safety backup first.</p><button class="button" type="button" data-import-json>Choose backup</button><input class="sr-only" type="file" accept="application/json,.json" data-import-file></article></div></section>`;
}

function entryDialog(entry, data) {
  const chapter = data.index.chapterById.get(entry.chapterId);
  return `<article class="entry-detail"><div class="entry-detail__top"><span class="result-chip">${escapeHTML(entry.result)}</span><span>${escapeHTML(formatDateLong(entry.date))}</span></div><h3>${escapeHTML(entry.topic)}</h3><dl class="detail-list detail-list--grid"><div><dt>Source</dt><dd>${escapeHTML(entry.source)}</dd></div><div><dt>Section</dt><dd>${escapeHTML(entry.section)}</dd></div><div><dt>Chapter</dt><dd>${escapeHTML(chapter ? `${chapter.id} · ${chapter.title}` : entry.chapterId || "—")}</dd></div><div><dt>Question ref</dt><dd>${escapeHTML(entry.questionRef || "—")}</dd></div><div><dt>Error type</dt><dd>${escapeHTML(entry.errorType)}</dd></div><div><dt>Confidence</dt><dd>${entry.confidence === "" ? "—" : entry.confidence}</dd></div></dl><section><h4>Why it was missed</h4><p>${escapeHTML(entry.whyMissed)}</p></section><section><h4>Correct reasoning</h4><p>${escapeHTML(entry.takeaway)}</p></section><section><h4>Concrete fix</h4><p>${escapeHTML(entry.fix)}</p></section><section><h4>Retest</h4><p>${entry.retestDate ? `${escapeHTML(formatDateLong(entry.retestDate))} · ${escapeHTML(entry.retestStatus)}` : "Not scheduled"}</p>${entry.retestResult ? `<p>${escapeHTML(entry.retestResult)}</p>` : ""}</section>${entry.notes ? `<section><h4>Notes</h4><p>${escapeHTML(entry.notes)}</p></section>` : ""}<div class="button-row"><button class="button button--primary" type="button" data-dialog-edit="${escapeAttr(entry.id)}">Edit entry</button>${entry.assignmentId ? `<a class="button button--quiet" href="#plan/${escapeAttr(entry.assignmentId)}">Open assignment</a>` : ""}</div></article>`;
}

export function renderLog(context, route = {}) {
  const tab = resolveLogTab(route.detail || "");
  const overdue = dueEntries(context.state).filter((entry) => entry.dueState === "overdue").length;
  const repeated = topCounts(context.state.mistakes.map((entry) => entry.topic), 50).filter(([, count]) => count > 1).length;
  const rated = Object.values(context.state.mastery).filter((item) => item.confidence !== undefined && item.confidence !== "").length;

  const panels = {
    capture: () => quickForm(context),
    repair: () => `${retestQueue(context)}${patternSummary(context)}`,
    entries: () => logTable(context),
    mastery: () => masterySection(context),
    export: () => exportCenter(context),
  };

  // The counters are orienting context for reviewing, but pure noise when the
  // job is "write this down before I forget it", so capture skips them.
  const overview = tab === "capture" ? "" : `<div class="log-overview"><article><span>Entries</span><strong>${context.state.mistakes.length}</strong></article><article><span>Retests overdue</span><strong>${overdue}</strong></article><article><span>Repeated topics</span><strong>${repeated}</strong></article><article><span>Mastery rated</span><strong>${rated}/40</strong></article></div>`;

  return `<header class="view-header"><div><span class="eyebrow">${plural(context.state.mistakes.length, "saved entry", "saved entries")} · ${plural(overdue, "overdue retest")}</span><h1>Log + repair</h1></div></header>
    ${tabStrip(context, overdue)}
    ${overview}
    <div class="log-panel">${(panels[tab] || panels.capture)()}</div>`;
}

function formEntry(form, existing) {
  const values = formToObject(form);
  const now = new Date().toISOString();
  return {
    id: existing?.id || uniqueId("mistake"), date: values.date, source: values.source, section: values.section,
    chapterId: values.chapterId || "", topic: values.topic.trim(), questionRef: values.questionRef?.trim() || "",
    description: values.description?.trim() || "", result: values.result, errorType: values.errorType,
    whyMissed: values.whyMissed.trim(), takeaway: values.takeaway.trim(), fix: values.fix.trim(),
    retestDate: values.retestDate || "", retestStatus: values.retestStatus || (values.retestDate ? "Scheduled" : "Not scheduled"),
    retestResult: values.retestResult?.trim() || existing?.retestResult || "",
    confidence: values.confidence === "" || values.confidence === undefined ? "" : Number(values.confidence),
    tags: String(values.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean), notes: values.notes?.trim() || "",
    assignmentId: values.assignmentId || "", createdAt: existing?.createdAt || now, updatedAt: now,
  };
}

function openEntry(context, id) {
  const entry = context.state.mistakes.find((item) => item.id === id);
  if (!entry) return;
  context.openDialog({ title: "Mistake entry", body: entryDialog(entry, context.data), onMount: (dialog) => {
    dialog.querySelector("[data-dialog-edit]")?.addEventListener("click", () => { editingId = id; lastSavedId = ""; activeTab = "capture"; dialog.close(); context.navigate("log", "capture"); });
  } });
}

function openRetest(context, id) {
  const entry = context.state.mistakes.find((item) => item.id === id);
  if (!entry) return;
  context.openDialog({ title: "Record retest", body: `<form data-retest-form><p class="dialog-lead"><strong>${escapeHTML(entry.topic)}</strong><br>${escapeHTML(entry.fix)}</p><label>Retest result<textarea required name="retestResult" rows="4" placeholder="What happened when you tried it again?">${escapeHTML(entry.retestResult || "")}</textarea></label><label>Status<select name="retestStatus"><option>Retested</option><option>Resolved</option><option>Scheduled</option></select></label><button class="button button--primary" type="submit">Save retest</button></form>`, onMount: (dialog) => {
    dialog.querySelector("[data-retest-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formToObject(event.currentTarget);
      const mistakes = context.state.mistakes.map((item) => item.id === id ? { ...item, retestResult: values.retestResult, retestStatus: values.retestStatus, updatedAt: new Date().toISOString() } : item);
      context.updateState({ ...context.state, mistakes }); dialog.close(); context.showToast("Retest saved");
    });
  } });
}

function importDialog(context, payload) {
  let validated;
  try { validated = validateBackup(payload); }
  catch (error) { context.openDialog({ title: "Backup rejected safely", body: `<div class="import-error"><p>${escapeHTML(error.message)}</p><p>No existing tracker data was changed.</p></div>` }); return; }
  const summary = validated.summary;
  context.openDialog({ title: "Import complete JSON backup", body: `<form data-import-confirm><div class="import-summary"><p>This backup contains:</p><ul><li>${summary.dailyRecords} daily records</li><li>${summary.mistakeEntries} mistake entries</li><li>${summary.examRecords} exam records</li><li>${summary.masteryRecords} mastery records</li><li>${summary.focusSessions} focus sessions</li><li>Registered date: ${escapeHTML(summary.registeredExamDate)}</li></ul></div><fieldset><legend>How should conflicts be handled?</legend><label class="radio-control"><input type="radio" name="strategy" value="replace" checked><span><strong>Replace existing state</strong>Every current tracker record, setting, and draft will be replaced.</span></label><label class="radio-control"><input type="radio" name="strategy" value="merge"><span><strong>Merge, newest entry wins</strong>Imported daily, exam, mastery, and settings values win; duplicate mistake IDs use the newest update.</span></label></fieldset><div class="safety-box"><strong>Safety first</strong><p>Download the current state before importing if you may need to undo this change.</p><button class="button" type="button" data-safety-backup>Download safety backup</button></div><label class="check-control"><input type="checkbox" required data-import-check><span>I understand what will be replaced or merged.</span></label><button class="button button--primary" type="submit" data-apply-import disabled>Apply import</button></form>`, onMount: (dialog) => {
    const form = dialog.querySelector("[data-import-confirm]");
    const check = form.querySelector("[data-import-check]");
    const apply = form.querySelector("[data-apply-import]");
    check.addEventListener("change", () => { apply.disabled = !check.checked; });
    form.querySelector("[data-safety-backup]").addEventListener("click", () => exportJSON(context.state, `MCAT_Tracker_Safety_Backup_${todayISO()}.json`));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!check.checked) return;
      const strategy = new FormData(form).get("strategy");
      const next = strategy === "merge" ? mergeStates(context.state, validated.state) : validated.state;
      context.updateState(next); dialog.close(); context.showToast("Backup imported successfully");
    });
  } });
}

export function bindLog(container, context, route) {
  const form = container.querySelector("[data-mistake-form]");
  const draftSave = debounce(() => {
    if (editingId || !form) return;
    const values = { ...formToObject(form), _updatedAt: new Date().toISOString() };
    context.updateState({ ...context.state, drafts: { ...context.state.drafts, mistake: values } }, { notify: false });
    const indicator = container.querySelector("[data-autosave-state]");
    if (indicator) { indicator.textContent = "Draft saved"; indicator.classList.add("is-saved"); }
  }, 300);
  form?.addEventListener("input", draftSave);
  form?.addEventListener("change", (event) => {
    if (event.target.name === "chapterId") {
      const chapter = context.data.index.chapterById.get(event.target.value);
      if (chapter) { if (!form.elements.topic.value) form.elements.topic.value = chapter.title; if (!form.elements.section.value) form.elements.section.value = inferSection(chapter.id); }
    }
    draftSave();
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const existing = editingId ? context.state.mistakes.find((entry) => entry.id === editingId) : null;
    const entry = formEntry(form, existing);
    const mistakes = existing ? context.state.mistakes.map((item) => item.id === existing.id ? entry : item) : [entry, ...context.state.mistakes];
    editingId = ""; lastSavedId = entry.id; context.clearQuickLogPrefill?.();
    context.updateState({ ...context.state, mistakes, drafts: { ...context.state.drafts, mistake: {} } });
    context.showToast(existing ? "Entry updated" : "Entry saved");
  });
  container.querySelector("[data-cancel-edit]")?.addEventListener("click", () => { editingId = ""; context.rerender(); });
  container.querySelector("[data-log-another]")?.addEventListener("click", () => { lastSavedId = ""; editingId = ""; context.rerender(); });
  container.querySelectorAll("[data-view-entry]").forEach((button) => button.addEventListener("click", () => openEntry(context, button.dataset.viewEntry)));
  container.querySelectorAll("[data-edit-entry]").forEach((button) => button.addEventListener("click", () => {
    // Editing happens in the capture form, so move there rather than leaving the
    // person on a panel that no longer shows what they just clicked.
    editingId = button.dataset.editEntry;
    lastSavedId = "";
    activeTab = "capture";
    context.navigate("log", "capture");
  }));
  container.querySelectorAll("[data-delete-entry]").forEach((button) => button.addEventListener("click", () => {
    const entry = context.state.mistakes.find((item) => item.id === button.dataset.deleteEntry);
    if (!entry || !window.confirm(`Delete the saved entry for “${entry.topic}”? This deletion will sync to your signed-in devices.`)) return;
    const deletedAt = new Date().toISOString();
    context.updateState({
      ...context.state,
      mistakes: context.state.mistakes.filter((item) => item.id !== entry.id),
      tombstones: { ...context.state.tombstones, mistakes: { ...context.state.tombstones.mistakes, [entry.id]: deletedAt } },
    });
    context.showToast("Entry deleted");
  }));
  container.querySelectorAll("[data-retest-entry]").forEach((button) => button.addEventListener("click", () => openRetest(context, button.dataset.retestEntry)));
  container.querySelector("[data-schedule-retest]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.scheduleRetest;
    const mistakes = context.state.mistakes.map((entry) => entry.id === id ? { ...entry, retestDate: entry.retestDate || addDays(todayISO(), 7), retestStatus: "Scheduled", updatedAt: new Date().toISOString() } : entry);
    context.updateState({ ...context.state, mistakes }); context.showToast("Retest scheduled for seven days from today");
  });

  // Any change to what is being filtered puts you back on the first page.
  const search = container.querySelector("[data-log-search]");
  search?.addEventListener("input", debounce(() => { logFilters.search = search.value; logPage = 0; context.rerender(); }, 250));
  container.querySelectorAll("[data-log-filter]").forEach((control) => control.addEventListener("change", () => { logFilters[control.dataset.logFilter] = control.value; logPage = 0; context.rerender(); }));
  container.querySelector("[data-log-reset]")?.addEventListener("click", () => { Object.assign(logFilters, { search: "", section: "all", source: "all", result: "all", errorType: "all", retest: "all", dateFrom: "", dateTo: "", sort: "updated-desc" }); logPage = 0; context.rerender(); });
  container.querySelectorAll("[data-log-page]").forEach((button) => button.addEventListener("click", () => {
    logPage = Math.max(0, Number(button.dataset.logPage));
    context.rerender();
    requestAnimationFrame(() => container.querySelector("#complete-log-title")?.scrollIntoView({ block: "start" }));
  }));

  container.querySelectorAll("[data-mastery-filter]").forEach((select) => select.addEventListener("change", () => { masteryFilters[select.dataset.masteryFilter] = select.value; context.rerender(); }));
  container.querySelectorAll("[data-confidence]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.topicId;
    const existing = context.state.mastery[id] || {};
    context.updateState({ ...context.state, mastery: { ...context.state.mastery, [id]: { ...existing, confidence: Number(button.dataset.confidence), lastReviewed: existing.lastReviewed || todayISO(), updatedAt: new Date().toISOString() } } });
    context.showToast("Mastery confidence updated");
  }));
  container.querySelectorAll("[data-mastery-row]").forEach((row) => {
    row.querySelectorAll("[data-mastery-field]").forEach((field) => field.addEventListener("change", () => {
      const id = row.dataset.masteryRow;
      context.updateState({ ...context.state, mastery: { ...context.state.mastery, [id]: { ...(context.state.mastery[id] || {}), [field.dataset.masteryField]: field.value, updatedAt: new Date().toISOString() } } });
      context.showToast("Mastery review saved");
    }));
  });

  container.querySelector("[data-export-json]")?.addEventListener("click", () => { exportJSON(context.state); context.showToast("JSON backup created"); });
  container.querySelector("[data-export-csv]")?.addEventListener("click", () => { exportMistakeCSV(context.data, context.state); context.showToast("Mistake log CSV created"); });
  container.querySelector("[data-export-xlsx]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; button.disabled = true; button.textContent = "Building workbook…";
    try { await exportWorkbook(context.data, context.state); context.showToast("Excel workbook created"); }
    catch (error) { context.showToast(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "Create XLSX"; }
  });
  const fileInput = container.querySelector("[data-import-file]");
  container.querySelector("[data-import-json]")?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try { importDialog(context, JSON.parse(await file.text())); }
    catch (error) { context.openDialog({ title: "Backup rejected safely", body: `<div class="import-error"><p>${escapeHTML(error.message)}</p><p>No existing tracker data was changed.</p></div>` }); }
    fileInput.value = "";
  });

  // A detail that is not a panel name is a mistake ID deep link.
  if (route.detail && route.detail !== "new" && !TAB_IDS.has(route.detail)) requestAnimationFrame(() => openEntry(context, route.detail));
}
