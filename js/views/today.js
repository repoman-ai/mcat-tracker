import { completedRows, dueEntries, getTodayContext, isStudyRow, pendingRows, weekRows, modeLabel } from "../data.js";
import { withDailyStatus } from "../daily.js";
import {
  countPracticeQuestions,
  daysBetween,
  escapeAttr,
  escapeHTML,
  formatDateLong,
  percent,
  plural,
  todayISO,
  uniqueId,
} from "../utils.js";
import { bindWorkRows, workRow, bindCompletionButtons, bindTaskChecklist, completionButton, emptyState, progressBar, statusLabel, taskChecklist } from "./shared.js";

// Completion and sync rerender Today. Keep one timer across those renders so
// checking off a past day doesn't reset a running block or orphan intervals.
const focus = { remaining: 25 * 60, timer: null, startedAt: "", assignmentId: "", paint: () => {} };

export function leaveToday() {
  clearInterval(focus.timer);
  focus.timer = null;
  focus.paint = () => {};
}

function countdown(data, state, today) {
  const registered = state.settings.registeredExamDate;
  const target = registered || data.plan.placeholder_exam_window[0];
  const days = daysBetween(today, target);
  const isRegistered = Boolean(registered);
  if (days === null) return "";
  const headline = days >= 0 ? `${days} days` : `${Math.abs(days)} days ago`;
  return `
    <section class="countdown-card ${isRegistered ? "countdown-card--registered" : ""}">
      <div><span class="eyebrow">${isRegistered ? "Registered MCAT" : "Placeholder window"}</span><strong>${headline}</strong></div>
      <p>${isRegistered ? escapeHTML(formatDateLong(target)) : `Jan 22-23, 2027 · not confirmed test dates`}</p>
      <a href="#exams">${isRegistered ? "Update date" : "Set registered date"}</a>
    </section>`;
}

function todayTabs(completedCount, completed = false) {
  return `<nav class="today-tabs" aria-label="Study work"><a href="#today" ${completed ? "" : 'aria-current="page"'}>Today</a><a href="#today/completed" ${completed ? 'aria-current="page"' : ""}>Completed <span>${completedCount}</span></a></nav>`;
}

function catchUpSection(rows, state, today) {
  if (!rows.length) return "";
  const deferred = rows.filter((row) => state.daily[row.id]?.status === "deferred").length;
  return `<section class="catchup-card" aria-labelledby="catchup-title">
    <header><h2 id="catchup-title">Past due <span>${rows.length}</span></h2><a href="#plan/past-due">View all ${rows.length} in Plan</a></header>
    <ul class="catchup-list" aria-label="Past-due assignments, oldest first">${rows.slice(0, 3).map((row) => workRow(row, state, today)).join("")}</ul>
    <p>${rows.length > 3 ? `Showing oldest 3 of ${rows.length}` : "Oldest first"}${deferred ? ` · ${deferred} deferred (included)` : ""} · <a href="#plan">Full schedule</a></p>
  </section>`;
}

function renderCompleted(context, rows, today) {
  return `<header class="view-header today-header"><div><span class="eyebrow">Your finished work</span><h1>Completed</h1></div></header>
    ${todayTabs(rows.length, true)}
    <section class="completed-work" aria-label="Completed assignments">
      <p class="muted">All checked-off days, newest scheduled date first. Tap a checked box to reopen a current-plan day; notes and counts stay saved. Earlier plan history is read-only.</p>
      ${rows.length ? `<ul class="completed-list">${rows.map((row) => workRow(row, context.state, today, true)).join("")}</ul>` : emptyState("Nothing checked off yet", "Completed study days will appear here, including work you check off later.", '<a class="button" href="#today">Back to today</a>')}
    </section>`;
}

function actionCopy(row, status, contextState) {
  if (contextState === "before-plan") return { eyebrow: "Coming up first", button: "Preview first block" };
  if (row.isRest) return { eyebrow: "Recovery is on the plan", button: "Review rest guidance" };
  if (row.isTestWindow) return { eyebrow: "Unconfirmed test window", button: "Review date guidance" };
  if (status === "complete") return { eyebrow: "Today is complete", button: "Review what you logged" };
  if (status === "deferred") return { eyebrow: "Set aside for later", button: "Review deferred block" };
  if (status === "in-progress") return { eyebrow: "Block in progress", button: "Review assignment" };
  if (row.isExam) return { eyebrow: "Full-length day", button: "Review exam plan" };
  if (row.isFullLengthReview) return { eyebrow: "Full-length review day", button: "Review assignment" };
  return { eyebrow: "Your next concrete action", button: "Review assignment" };
}

export function renderToday(context, route = {}) {
  const { data, state } = context;
  const today = todayISO();
  const completed = completedRows(data, state);
  if (route.detail === "completed") return renderCompleted(context, completed, today);
  const pending = pendingRows(data, state, today);
  const catchup = catchUpSection(pending, state, today);
  const due = dueEntries(state, today).filter((entry) => entry.dueState !== "upcoming");
  const repairs = due.length ? `<p class="pending-repairs"><a href="#log/repair">${plural(due.length, "retest")} due</a> · Record retests in Log</p>` : "";
  const todayContext = getTodayContext(data, today);
  const row = todayContext.row;
  if (!row) {
    return `
      <header class="view-header today-header"><div><span class="eyebrow">${escapeHTML(formatDateLong(today))}</span><h1>End of the dated plan</h1><p>Choose your next block using your registered exam date and readiness evidence.</p></div></header>
      ${todayTabs(completed.length)}
      <div class="today-grid"><div class="today-main">${catchup}<section class="card card--hero"><h2>Protect the work you built</h2><p>Keep repairs narrow: mistake-log retests, mastery topics, CARS, and logistics.</p><div class="button-row"><a class="button button--primary" href="#log/repair">Open repair queue</a><a class="button" href="#exams">Review exams</a></div></section>${repairs}</div><aside class="today-sidebar">${countdown(data, state, today)}</aside></div>`;
  }

  const daily = state.daily[row.id] || {};
  const status = daily.status || "not-started";
  const copy = actionCopy(row, status, todayContext.state);
  const rows = typeof row.week === "number" ? weekRows(data, row.week) : data.schedule.filter((item) => item.week === "TEST");
  const studyRows = rows.filter(isStudyRow);
  const completedDays = studyRows.filter((item) => state.daily[item.id]?.status === "complete").length;
  const plannedQuestions = rows.reduce((sum, item) => sum + countPracticeQuestions(item.practiceTarget), 0);
  const actualQuestions = rows.reduce((sum, item) => sum + Number(state.daily[item.id]?.actualQuestions || 0), 0);
  const plannedCars = rows.reduce((sum, item) => sum + Number(item.carsPassages || 0), 0);
  const actualCars = rows.reduce((sum, item) => sum + Number(state.daily[item.id]?.actualCars || 0), 0);
  const isActionable = isStudyRow(row);
  const startsIn = daysBetween(today, row.date);
  const timingLine = todayContext.state === "before-plan"
    ? `The plan begins ${formatDateLong(row.date)} (${plural(startsIn, "day")} from now). No catch-up is needed.`
    : todayContext.state === "gap"
      ? `No row is assigned for today. The next scheduled block is ${formatDateLong(row.date)}.`
      : `${typeof row.week === "number" ? `Week ${row.week}` : "Test window"} · ${row.phase}`;

  // The topbar already carries the full date, so the heading leads with the
  // orienting fact instead of repeating it, keeping the action card near the top
  // of a phone screen. Off-schedule states still explain themselves in prose.
  const isScheduled = todayContext.state === "scheduled";
  const heading = isScheduled ? "Today" : "Your next block";
  const name = state.settings.displayName;
  const guidance = row.week === 1 && data.plan.restart
    ? `Fresh start · diagnostic Saturday, September 5. ${row.sourceNotes || data.plan.restart.note}`
    : row.sourceNotes;
  return `
    <header class="view-header today-header">
      <div><span class="eyebrow">${escapeHTML(timingLine)}</span><h1>${escapeHTML(name ? `${heading}, ${name}` : heading)}</h1>${isScheduled ? "" : `<p>${escapeHTML(formatDateLong(row.date))}</p>`}</div>
    </header>
    ${todayTabs(completed.length)}
    ${pending.length ? `<a class="today-backlog-link" href="#plan/past-due">${pending.length} past-due days · Review in Plan →</a>` : ""}
    <div class="today-grid">
      <div class="today-main">
        <article id="today-assignment" tabindex="-1" class="today-action today-action--${escapeAttr(row.dayType)} ${status === "complete" ? "is-complete" : ""}">
          <div class="today-action__top">
            <div><span class="eyebrow">${escapeHTML(copy.eyebrow)}</span><span class="status-badge status-badge--${escapeAttr(status)}">${escapeHTML(statusLabel(status))}</span></div>
            <span class="workload-pill">${escapeHTML(row.estimatedWorkload.label)}</span>
          </div>
          <h2>${escapeHTML(row.assignment)}</h2>
          <div class="action-buttons today-primary-actions ${status === "complete" ? "today-primary-actions--complete" : ""}">
            ${isActionable && isScheduled ? completionButton(row, state) : ""}
            ${isActionable && status !== "complete" && isScheduled ? `<button class="button button--primary" type="button" data-start-day="${escapeAttr(row.id)}">${status === "in-progress" ? "Continue today" : "Start block"}</button>` : ""}
            <button class="button ${!isActionable || !isScheduled ? "button--primary action-buttons__lead" : "button--quiet action-buttons__trail"}" type="button" data-open-assignment="${escapeAttr(row.id)}">${escapeHTML(copy.button)}</button>
          </div>
          ${isActionable && isScheduled ? taskChecklist(row, state) : ""}
          ${guidance ? `<aside class="assignment-guidance"><span class="eyebrow">Guardrails for today</span><p>${escapeHTML(guidance)}</p></aside>` : ""}
          ${row.chapters.length ? `<p class="chapter-line">${row.chapters.map((chapter) => `<span>${escapeHTML(chapter.id)}</span> ${escapeHTML(chapter.title)}`).join(" · ")}</p>` : ""}
          <dl class="today-facts">
            <div><dt>Resource</dt><dd>${escapeHTML(row.resource || "None required")}</dd></div>
            <div><dt>Mode</dt><dd>${escapeHTML(modeLabel(row.mode))}</dd></div>
            <div><dt>Practice</dt><dd>${escapeHTML(row.practiceTargetDisplay || "No practice quota")}</dd></div>
            <div><dt>CARS</dt><dd>${row.carsPassages || 0} passage${row.carsPassages === 1 ? "" : "s"}</dd></div>
          </dl>
          <div class="milestone-line"><span aria-hidden="true">◇</span><div><strong>This week’s milestone</strong><p>${escapeHTML(row.weeklyMilestone)}</p></div></div>
          ${isActionable && isScheduled ? `<div class="button-row"><button class="button button--quiet" type="button" data-log-assignment="${escapeAttr(row.id)}">Log a question</button></div>` : ""}
        </article>
        ${catchup}
        ${repairs}

        ${isActionable && todayContext.state === "scheduled" ? `
          <section class="focus-card" aria-labelledby="focus-title">
            <div><span class="eyebrow">Optional focus mode</span><h3 id="focus-title">One calm block</h3><p>A 25-minute timer. Leaving Today pauses it; return to resume. Only finishing saves a session.</p></div>
            <div class="focus-controls"><output data-focus-clock aria-live="polite">25:00</output><button class="button" type="button" data-focus-toggle>Start</button><button class="button button--quiet" type="button" data-focus-finish disabled>Finish block</button></div>
          </section>` : ""}

      </div>

      <aside class="today-sidebar">
        ${countdown(data, state, today)}
        <section class="card momentum-card">
          <span class="eyebrow">Weekly momentum</span>
          <h3>${typeof row.week === "number" ? `Week ${row.week}` : "Placeholder window"}</h3>
          ${progressBar(completedDays, studyRows.length, "Study days complete")}
          ${!pending.length && today >= data.plan.plan_start ? '<p class="caught-up">✓ No past-due study days</p>' : ""}
          ${plannedQuestions ? progressBar(actualQuestions, plannedQuestions, "Practice questions complete") : ""}
          ${plannedCars ? progressBar(actualCars, plannedCars, "CARS passages complete") : ""}
          <p class="gentle-copy">${completedDays === 0 ? "A clean start is enough. Finish one manageable block." : completedDays < studyRows.length ? "You are building the week one finished block at a time." : "The week’s planned study days are complete."}</p>
        </section>
        <section class="card next-week-card">
          <span class="eyebrow">At a glance</span>
          <dl class="compact-stats">
            <div><dt>Phase</dt><dd>${escapeHTML(row.phase)}</dd></div>
            <div><dt>Planned hours</dt><dd>${row.weeklyHours}</dd></div>
            <div><dt>Week progress</dt><dd>${percent(completedDays, studyRows.length)}%</dd></div>
            <div><dt>Next retests</dt><dd><a href="#log/repair">View queue</a></dd></div>
          </dl>
        </section>
      </aside>
    </div>`;
}

export function bindToday(container, context) {
  focus.paint = () => {};
  bindCompletionButtons(container, context);
  bindTaskChecklist(container, context);
  bindWorkRows(container, context);

  container.querySelector("[data-start-day]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.startDay;
    context.updateState(withDailyStatus(context.state, id, "in-progress"), { success: "Study block started" });
  });

  container.querySelector("[data-log-assignment]")?.addEventListener("click", (event) => {
    const row = context.data.index.scheduleByDate.get(event.currentTarget.dataset.logAssignment);
    context.openQuickLog(row);
  });

  const clock = container.querySelector("[data-focus-clock]");
  const toggle = container.querySelector("[data-focus-toggle]");
  const finish = container.querySelector("[data-focus-finish]");
  if (clock && toggle && finish) {
    focus.paint = () => {
      clock.value = `${String(Math.floor(focus.remaining / 60)).padStart(2, "0")}:${String(focus.remaining % 60).padStart(2, "0")}`;
      clock.textContent = clock.value;
      toggle.textContent = focus.remaining === 0 ? "Save block" : focus.timer ? "Pause" : focus.startedAt ? "Resume" : "Start";
      toggle.disabled = false;
      finish.disabled = !focus.startedAt;
    };
    const stop = () => { clearInterval(focus.timer); focus.timer = null; focus.paint(); };
    toggle.addEventListener("click", () => {
      if (focus.remaining === 0) { finish.click(); return; }
      if (focus.timer) { stop(); return; }
      if (!focus.startedAt) {
        focus.startedAt = new Date().toISOString();
        focus.assignmentId = getTodayContext(context.data, todayISO()).row?.id || "";
      }
      focus.timer = setInterval(() => {
        focus.remaining = Math.max(0, focus.remaining - 1);
        focus.paint();
        if (focus.remaining === 0) { stop(); context.showToast("Focus block complete"); }
      }, 1000);
      focus.paint();
    });
    finish.addEventListener("click", () => {
      stop();
      const session = { id: uniqueId("focus"), assignmentId: focus.assignmentId, startedAt: focus.startedAt, endedAt: new Date().toISOString(), minutes: Math.max(1, Math.round((25 * 60 - focus.remaining) / 60)) };
      context.updateState({ ...context.state, focusSessions: [...context.state.focusSessions, session] }, {
        success: "Focus session saved",
        onSaved: () => { Object.assign(focus, { remaining: 25 * 60, startedAt: "", assignmentId: "" }); focus.paint(); },
      });
    });
    focus.paint();
  }
}
