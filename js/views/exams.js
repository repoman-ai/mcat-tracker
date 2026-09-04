import { clearEditorDraft } from "../editor-drafts.js";
import { withDailyCompletion } from "../daily.js";
import { escapeAttr, escapeHTML, formatDateLong } from "../utils.js";

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function examRecord(exam, state) {
  return { ...state.exams[exam.id], id: exam.id, exam };
}

function readiness(data, state) {
  const official = data.exams
    .filter((exam) => exam.official && !exam.diagnostic)
    .map((exam) => examRecord(exam, state))
    .filter((record) => record.completed && score(record.total))
    .sort((a, b) => a.exam.plannedDate.localeCompare(b.exam.plannedDate));
  if (official.length < 2) {
    return { status: "insufficient", label: "Not enough official data yet", detail: `Enter ${2 - official.length} more completed official full-length${official.length ? "" : "s"} to apply the plan’s rule.`, average: null, records: official };
  }
  const recent = official.slice(-2);
  const average = (Number(recent[0].total) + Number(recent[1].total)) / 2;
  const trend = Number(recent[1].total) - Number(recent[0].total);
  const sections = ["cp", "cars", "bb", "ps"];
  const allSectionsPresent = recent.every((record) => sections.every((key) => score(record[key])));
  const noSectionBelow = allSectionsPresent && recent.every((record) => sections.every((key) => Number(record[key]) >= 126));
  const persistentLow = sections.some((key) => recent.every((record) => score(record[key]) && Number(record[key]) < 126));
  const timingStable = recent.every((record) => record.timingStatus === "Stable" && !record.unfinishedSection);
  const repeatedUnfinished = recent.every((record) => record.unfinishedSection);

  if (average < 515 || repeatedUnfinished || persistentLow) {
    return { status: "move", label: "Plan points toward March", detail: "The plan’s move-to-March trigger is present: an average below 515, repeated unfinished sections, or a persistent section below 126.", average, trend, records: recent };
  }
  if (average >= 517 && noSectionBelow && timingStable && trend >= 0) {
    return { status: "keep", label: "Plan supports keeping January", detail: "The two-exam average is at least 517, no section is below 126, timing is stable, and the trend is flat-to-rising.", average, trend, records: recent };
  }
  if (average >= 515 && average <= 516 && trend > 0 && !recent.some((record) => record.unfinishedSection)) {
    return { status: "borderline", label: "Borderline, with upward evidence", detail: "The plan allows January at 515-516 only with a clear upward trend and no unfinished section. Keep watching section floors and timing.", average, trend, records: recent };
  }
  return { status: "borderline", label: "Borderline under the plan’s rule", detail: "The data does not yet satisfy every keep-January condition and does not trigger a clear move-to-March condition. Use the confirmed 30-day deadline and the next official exam.", average, trend, records: recent };
}

function readinessCard(data, state) {
  const result = readiness(data, state);
  return `<section class="readiness-card readiness-card--${result.status}" aria-labelledby="readiness-title">
    <div class="readiness-card__lead"><span class="eyebrow">Plan rule, not a definitive recommendation</span><h2 id="readiness-title">${escapeHTML(result.label)}</h2><p>${escapeHTML(result.detail)}</p></div>
    <div class="readiness-stats"><div><span>Recent two-exam average</span><strong>${result.average === null ? "—" : result.average.toFixed(1)}</strong></div><div><span>Target score</span><strong>${data.plan.target_score}</strong></div><div><span>Trend</span><strong>${result.trend === undefined ? "—" : result.trend > 0 ? `+${result.trend}` : result.trend}</strong></div></div>
    <details><summary>Read the exact January/March rules</summary><dl class="rule-list"><div><dt>Keep January</dt><dd>${escapeHTML(data.plan.readiness_rule.keep_january)}</dd></div><div><dt>Borderline</dt><dd>${escapeHTML(data.plan.readiness_rule.borderline)}</dd></div><div><dt>Move to March</dt><dd>${escapeHTML(data.plan.readiness_rule.move_to_march)}</dd></div></dl></details>
  </section>`;
}

function examCard(exam, state, data, nextId) {
  const record = state.exams[exam.id] || {};
  const total = exam.diagnostic ? null : score(record.total);
  const scheduled = data.schedule.find((row) => row.date === exam.plannedDate && row.isExam);
  const scoreCopy = total ? `${total}` : exam.diagnostic ? "Unscored" : "Not entered";
  return `<details class="exam-card ${record.completed ? "is-complete" : ""}" data-exam-card="${escapeAttr(exam.id)}" data-view-key="exam-${escapeAttr(exam.id)}" ${nextId === exam.id ? "open" : ""}>
    <summary><div class="exam-date"><span>${escapeHTML(exam.plannedDate.slice(5, 7))}</span><strong>${escapeHTML(exam.plannedDate.slice(8))}</strong></div><div class="exam-summary"><span class="eyebrow">${escapeHTML(exam.source)} · ${escapeHTML(formatDateLong(exam.plannedDate))}</span><h3>${escapeHTML(exam.name)}</h3><p>${record.reviewStatus === "Complete" ? "Review complete" : record.completed ? "Exam complete · review still matters" : "Planned"}</p></div><div class="exam-total"><strong>${escapeHTML(scoreCopy)}</strong><span>${total ? "total" : "score"}</span></div><span class="disclosure-icon" aria-hidden="true">⌄</span></summary>
    <form class="exam-form" data-exam-form="${escapeAttr(exam.id)}" data-draft-form="exam-${escapeAttr(exam.id)}"><p class="form-hint">Unfinished edits are kept in this tab.${exam.diagnostic ? " Enter section percent correct (0–100); this exam has no scaled total." : " Scaled sections: 118–132; total: 472–528."}</p>
      <div class="form-grid form-grid--four score-grid">${[["cp", "C/P"], ["cars", "CARS"], ["bb", "B/B"], ["ps", "P/S"]].map(([key, label]) => `<label>${label}${exam.diagnostic ? " % correct" : ""}<input name="${exam.diagnostic ? `percent_${key}` : key}" type="number" min="${exam.diagnostic ? 0 : 118}" max="${exam.diagnostic ? 100 : 132}" step="${exam.diagnostic ? ".1" : "1"}" inputmode="decimal" value="${escapeAttr(exam.diagnostic ? record.diagnosticPercent?.[key] ?? "" : record[key] ?? "")}"></label>`).join("")}</div>
      <div class="form-grid form-grid--three">
        ${exam.diagnostic ? "" : `<label>Total score<input name="total" type="number" min="472" max="528" inputmode="numeric" value="${escapeAttr(record.total ?? "")}" placeholder="Auto-sums sections"></label>`}
        <label>Timing status<select name="timingStatus"><option value="">Select</option>${["Stable", "Mixed", "Unstable"].map((value) => `<option ${record.timingStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label>Review status<select name="reviewStatus">${["Not started", "In progress", "Complete"].map((value) => `<option ${record.reviewStatus === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label>Review completion date<input name="reviewDate" type="date" value="${escapeAttr(record.reviewDate || "")}"></label>
        <label class="check-control"><input name="completed" type="checkbox" ${record.completed ? "checked" : ""}><span>Exam completed</span></label>
        <label class="check-control"><input name="unfinishedSection" type="checkbox" ${record.unfinishedSection ? "checked" : ""}><span>Any section unfinished</span></label>
      </div>
      ${scheduled && state.daily[scheduled.id]?.status !== "complete" ? `<label class="check-control"><input name="completeScheduledDay" type="checkbox" checked><span>Also complete the scheduled exam day when saving a completed exam</span></label>` : ""}
      <p class="form-error" data-exam-error role="alert"></p>
      <label>Key repair themes<textarea name="repairThemes" rows="3" placeholder="At most three concrete repair themes">${escapeHTML(record.repairThemes || "")}</textarea></label>
      <label>Notes<textarea name="notes" rows="3" placeholder="Timing, stamina, review context">${escapeHTML(record.notes || "")}</textarea></label>
      <div class="button-row"><button class="button button--primary" type="submit">Save exam</button>${exam.reviewAssignmentIds.length ? `<a class="button button--quiet" href="#plan/${escapeAttr(exam.reviewAssignmentIds[0])}">Open review day</a>` : ""}</div>
    </form>
  </details>`;
}

export function renderExams(context) {
  const registered = context.state.settings.registeredExamDate;
  const completed = context.data.exams.filter((exam) => context.state.exams[exam.id]?.completed).length;
  const nextId = context.data.exams.find((exam) => !context.state.exams[exam.id]?.completed)?.id;
  return `<header class="view-header"><div><span class="eyebrow">${completed}/${context.data.exams.length} exams complete</span><h1>Exams</h1><p>Track scores, timing, review, and the repair themes that matter more than the score alone.</p></div><a class="button" href="#guide/full-length-and-section-bank-schedule">Full-length guidance</a></header>
    <details class="registered-date-control" data-view-key="exam-registration"><summary>${registered ? "Registered MCAT date" : "Set registered MCAT date · Jan 22–23 are placeholders"}</summary><section class="exam-date-setting"><div><span class="eyebrow">Countdown anchor</span><h2>${registered ? "Registered date saved" : "January 22-23 are placeholders"}</h2><p>${registered ? `Your countdown uses ${escapeHTML(formatDateLong(registered))}.` : "Enter the registered MCAT date after scheduling. The placeholder window remains clearly labeled until then."}</p></div><form data-exam-date-form><label>Registered MCAT date<input name="registeredExamDate" type="date" value="${escapeAttr(registered || "")}"></label><button class="button button--primary" type="submit">Save date</button>${registered ? `<button class="button button--quiet" type="button" data-clear-exam-date>Clear</button>` : ""}</form></section></details>
    <section class="exam-list" aria-label="Full-length exam tracker">${context.data.exams.map((exam) => examCard(exam, context.state, context.data, nextId)).join("")}</section>
    ${readinessCard(context.data, context.state)}
    <section class="score-trends" aria-labelledby="trend-title"><div class="section-heading"><div><span class="eyebrow">Progress, not verdict</span><h2 id="trend-title">Score trends</h2></div><span class="target-chip">Target ${context.data.plan.target_score}</span></div>
      <h3>Total score · 472–528</h3><div class="chart-shell"><canvas data-score-chart role="img" aria-label="Total score trend for completed full-length exams"></canvas><div class="chart-empty" data-chart-empty hidden>No scored exams yet. Save a completed exam score to begin the trend.</div></div>
      <h3>Section scores · 118–132</h3><div class="chart-shell"><canvas data-section-chart role="img" aria-label="Section score trends on a 118 to 132 scale; values in the table below"></canvas><div class="chart-empty" data-chart-empty hidden>No section scores yet.</div></div>
      <div class="trend-legend"><span class="legend-cp">C/P</span><span class="legend-cars">CARS</span><span class="legend-bb">B/B</span><span class="legend-ps">P/S</span></div>
    ${scoreTable(context.data, context.state)}</section>
`;
}

function scoreTable(data, state) {
  const records = data.exams.filter((exam) => !exam.diagnostic && state.exams[exam.id]?.completed);
  if (!records.length) return "";
  return `<details class="score-values" data-view-key="score-values"><summary>Score values and sources</summary><div class="table-wrap"><table class="data-table"><caption>Scaled scores · dates are planned dates</caption><thead><tr><th>Exam / source</th><th>Date</th><th>Total</th><th>C/P</th><th>CARS</th><th>B/B</th><th>P/S</th></tr></thead><tbody>${records.map((exam) => `<tr><th>${escapeHTML(exam.name)} · ${exam.official ? "Official" : "Third-party"}</th><td>${escapeHTML(exam.plannedDate)}</td>${["total", "cp", "cars", "bb", "ps"].map((key) => `<td>${escapeHTML(state.exams[exam.id][key] || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

function drawChart(canvas, data, state, sections = false) {
  const records = data.exams.map((exam) => ({ exam, ...state.exams[exam.id] })).filter((record) => !record.exam.diagnostic && record.completed && (sections ? ["cp", "cars", "bb", "ps"].some((key) => score(record[key])) : score(record.total)));
  const empty = canvas.parentElement.querySelector("[data-chart-empty]");
  if (!records.length) { empty.hidden = false; canvas.hidden = true; return; }
  empty.hidden = true;
  canvas.hidden = false;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(280, rect.width);
  const height = 260;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  const pad = { left: 45, right: 20, top: 22, bottom: 48 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (records.length === 1 ? plotWidth / 2 : (index / (records.length - 1)) * plotWidth);
  const totalY = (value) => pad.top + ((528 - value) / (528 - 472)) * plotHeight;
  const sectionY = (value) => pad.top + ((132 - value) / 14) * plotHeight;
  ctx.font = "12px system-ui";
  ctx.strokeStyle = "#d7e2e8";
  ctx.fillStyle = "#607381";
  (sections ? [118, 120, 122, 124, 126, 128, 130, 132] : [472, 486, 500, 514, 528]).forEach((tick) => {
    const y = sections ? sectionY(tick) : totalY(tick);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillText(String(tick), 8, y + 4);
  });
  if (!sections) {
    const targetY = totalY(data.plan.target_score);
    ctx.strokeStyle = "#d9902f"; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pad.left, targetY); ctx.lineTo(width - pad.right, targetY); ctx.stroke(); ctx.setLineDash([]);
  }
  const series = [
    { key: "total", color: "#0e2a47", map: totalY, width: 3 },
    { key: "cp", color: "#2b6f8a", map: sectionY, width: 1.7 },
    { key: "cars", color: "#8a5e95", map: sectionY, width: 1.7 },
    { key: "bb", color: "#4f8a6d", map: sectionY, width: 1.7 },
    { key: "ps", color: "#c88444", map: sectionY, width: 1.7 },
  ];
  series.filter((item) => sections ? item.key !== "total" : item.key === "total").forEach((item) => {
    const points = records.map((record, index) => ({ x: x(index), y: score(record[item.key]) ? item.map(Number(record[item.key])) : null })).filter((point) => point.y !== null);
    if (!points.length) return;
    ctx.strokeStyle = item.color; ctx.fillStyle = item.color; ctx.lineWidth = item.width; ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    points.forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, item.key === "total" ? 4 : 3, 0, Math.PI * 2); ctx.fill(); });
  });
  records.forEach((record, index) => { ctx.fillStyle = "#607381"; ctx.textAlign = "center"; ctx.fillText(record.exam.official ? record.exam.name.replace("AAMC Practice Exam ", "PE") : "3P FL", x(index), height - 18); });
  ctx.textAlign = "start";
}

export function bindExams(container, context) {
  container.querySelector("[data-exam-date-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const registeredExamDate = new FormData(event.currentTarget).get("registeredExamDate") || "";
    context.updateState({ ...context.state, settings: { ...context.state.settings, registeredExamDate, updatedAt: new Date().toISOString() } }, { success: "Registered exam date saved" });
  });
  container.querySelector("[data-clear-exam-date]")?.addEventListener("click", () => {
    context.updateState({ ...context.state, settings: { ...context.state.settings, registeredExamDate: "", updatedAt: new Date().toISOString() } }, { success: "Countdown returned to the placeholder window" });
  });
  container.querySelectorAll("[data-exam-form]").forEach((form) => {
    const sectionInputs = [...form.querySelectorAll('input[name="cp"],input[name="cars"],input[name="bb"],input[name="ps"]')];
    sectionInputs.forEach((input) => input.addEventListener("input", () => {
      const values = sectionInputs.map((item) => score(item.value));
      if (values.every(Boolean)) {
        form.elements.total.value = values.reduce((sum, value) => sum + value, 0);
        form.elements.total.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = form.dataset.examForm;
      const values = Object.fromEntries(new FormData(form));
      const exam = context.data?.exams.find((item) => item.id === id);
      const existing = context.state.exams[id] || {};
      const keys = ["cp", "cars", "bb", "ps"];
      const diagnostic = exam?.diagnostic;
      const fields = diagnostic ? keys.map((key) => `percent_${key}`) : [...keys, "total"];
      const valid = fields.every((key) => !values[key] || (Number.isFinite(Number(values[key])) && Number(values[key]) >= (diagnostic ? 0 : key === "total" ? 472 : 118) && Number(values[key]) <= (diagnostic ? 100 : key === "total" ? 528 : 132) && (diagnostic || Number.isInteger(Number(values[key])))));
      const completeSections = keys.every((key) => values[key] !== "" && values[key] !== undefined);
      if (!diagnostic && completeSections && !values.total) values.total = String(keys.reduce((sum, key) => sum + Number(values[key]), 0));
      const mismatch = !diagnostic && completeSections && values.total && Number(values.total) !== keys.reduce((sum, key) => sum + Number(values[key]), 0);
      if (!valid || mismatch) {
        const error = form.querySelector("[data-exam-error]");
        error.textContent = mismatch ? "Total must equal the four section scores." : "Check the score ranges shown above.";
        return;
      }
      const scores = diagnostic
        ? { diagnosticPercent: Object.fromEntries(keys.map((key) => [key, values[`percent_${key}`] === "" ? "" : Number(values[`percent_${key}`])])) }
        : Object.fromEntries([...keys, "total"].map((key) => [key, values[key] ? Number(values[key]) : ""]));
      const record = {
        ...existing, ...scores,
        timingStatus: values.timingStatus || "", reviewStatus: values.reviewStatus || "Not started", reviewDate: values.reviewDate || "",
        completed: form.elements.completed.checked, unfinishedSection: form.elements.unfinishedSection.checked,
        repairThemes: values.repairThemes || "", notes: values.notes || "", updatedAt: new Date().toISOString(),
      };
      let next = { ...context.state, exams: { ...context.state.exams, [id]: record } };
      const scheduled = context.data?.schedule.find((row) => row.date === exam?.plannedDate && row.isExam);
      if (scheduled && record.completed && form.elements.completeScheduledDay?.checked) next = withDailyCompletion(next, scheduled, true);
      context.updateState(next, { success: "Exam record saved", onSaved: () => clearEditorDraft(`exam-${id}`) });
    });
  });
  for (const selector of ["[data-score-chart]", "[data-section-chart]"]) {
    const canvas = container.querySelector(selector);
    if (!canvas) continue;
    const paint = () => drawChart(canvas, context.data, context.state, selector === "[data-section-chart]");
    paint();
    const observer = new ResizeObserver(() => { if (canvas.isConnected) paint(); else observer.disconnect(); });
    observer.observe(canvas.parentElement);
    // Dispose when this view is replaced, even if the window never resizes.
    context.registerViewCleanup?.(() => observer.disconnect());
  }
}
