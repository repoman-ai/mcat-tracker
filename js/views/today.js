import { getTodayContext, weekRows } from "../data.js";
import {
  countPracticeQuestions,
  daysBetween,
  escapeAttr,
  escapeHTML,
  formatDate,
  formatDateLong,
  percent,
  plural,
  todayISO,
  uniqueId,
} from "../utils.js";
import { assignmentDetailHTML, bindAssignmentDetail, progressBar, statusLabel } from "./shared.js";

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

function carryoverRows(data, state, today, activeId) {
  return data.schedule
    .filter((row) => row.date < today && row.id !== activeId && !row.isRest && !row.isTestWindow && state.daily[row.id]?.status !== "complete")
    .slice(-2);
}

function actionCopy(row, status, contextState) {
  if (contextState === "before-plan") return { eyebrow: "Coming up first", button: "Preview first block" };
  if (row.isRest) return { eyebrow: "Recovery is on the plan", button: "Review rest guidance" };
  if (row.isTestWindow) return { eyebrow: "Unconfirmed test window", button: "Review date guidance" };
  if (status === "complete") return { eyebrow: "Today is complete", button: "Review what you logged" };
  if (status === "in-progress") return { eyebrow: "Block in progress", button: "Review assignment" };
  if (row.isExam) return { eyebrow: "Full-length day", button: "Review exam plan" };
  if (row.isFullLengthReview) return { eyebrow: "Full-length review day", button: "Review assignment" };
  return { eyebrow: "Your next concrete action", button: "Review assignment" };
}

export function renderToday(context) {
  const { data, state } = context;
  const today = todayISO();
  const todayContext = getTodayContext(data, today);
  const row = todayContext.row;
  const previewNote = new URLSearchParams(window.location.search).get("today")
    ? `<span class="preview-pill">Previewing ${escapeHTML(formatDate(today))}</span>` : "";

  if (!row) {
    return `
      <header class="view-header"><div><span class="eyebrow">${escapeHTML(formatDateLong(today))}</span><h1>Plan complete</h1><p>You reached the end of the dated plan. Use your registered exam date and readiness evidence to choose the next block.</p></div>${previewNote}</header>
      <div class="today-grid">${countdown(data, state, today)}<section class="card card--hero"><h2>Protect the work you built</h2><p>Keep repairs narrow: mistake-log retests, mastery topics, CARS, and logistics.</p><div class="button-row"><a class="button button--primary" href="#log/repair">Open repair queue</a><a class="button" href="#exams">Review exams</a></div></section></div>`;
  }

  const daily = state.daily[row.id] || {};
  const status = daily.status || "not-started";
  const copy = actionCopy(row, status, todayContext.state);
  const rows = typeof row.week === "number" ? weekRows(data, row.week) : data.schedule.filter((item) => item.week === "TEST");
  const studyRows = rows.filter((item) => !item.isRest);
  const completedDays = studyRows.filter((item) => state.daily[item.id]?.status === "complete").length;
  const plannedQuestions = rows.reduce((sum, item) => sum + countPracticeQuestions(item.practiceTarget), 0);
  const actualQuestions = rows.reduce((sum, item) => sum + Number(state.daily[item.id]?.actualQuestions || 0), 0);
  const plannedCars = rows.reduce((sum, item) => sum + Number(item.carsPassages || 0), 0);
  const actualCars = rows.reduce((sum, item) => sum + Number(state.daily[item.id]?.actualCars || 0), 0);
  const carryover = row.isRest || row.isTestWindow || row.isExam ? [] : carryoverRows(data, state, today, row.id);
  const isActionable = !row.isRest && !row.isTestWindow;
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
  return `
    <header class="view-header today-header">
      <div><span class="eyebrow">${escapeHTML(timingLine)}</span><h1>${escapeHTML(name ? `${heading}, ${name}` : heading)}</h1>${isScheduled ? "" : `<p>${escapeHTML(formatDateLong(row.date))}</p>`}</div>
      ${previewNote}
    </header>
    <div class="today-grid">
      <main class="today-main">
        <article class="today-action today-action--${escapeAttr(row.dayType)} ${status === "complete" ? "is-complete" : ""}">
          <div class="today-action__top">
            <div><span class="eyebrow">${escapeHTML(copy.eyebrow)}</span><span class="status-badge status-badge--${escapeAttr(status)}">${escapeHTML(statusLabel(status))}</span></div>
            <span class="workload-pill">${escapeHTML(row.estimatedWorkload.label)}</span>
          </div>
          <h2>${escapeHTML(row.assignment)}</h2>
          ${row.week === 1 && data.plan.restart ? `<p class="gentle-copy">Fresh start · diagnostic Saturday, September 5. ${escapeHTML(row.sourceNotes || data.plan.restart.note)}</p>` : ""}
          ${row.chapters.length ? `<p class="chapter-line">${row.chapters.map((chapter) => `<span>${escapeHTML(chapter.id)}</span> ${escapeHTML(chapter.title)}`).join(" · ")}</p>` : ""}
          <dl class="today-facts">
            <div><dt>Resource</dt><dd>${escapeHTML(row.resource || "None required")}</dd></div>
            <div><dt>Mode</dt><dd>${escapeHTML(row.mode)}</dd></div>
            <div><dt>Practice</dt><dd>${escapeHTML(row.practiceTargetDisplay || "No practice quota")}</dd></div>
            <div><dt>CARS</dt><dd>${row.carsPassages || 0} passage${row.carsPassages === 1 ? "" : "s"}</dd></div>
          </dl>
          <div class="milestone-line"><span aria-hidden="true">◇</span><div><strong>This week’s milestone</strong><p>${escapeHTML(row.weeklyMilestone)}</p></div></div>
          <div class="action-buttons">
            ${isActionable && status !== "complete" && isScheduled ? `<button class="button button--primary action-buttons__lead" type="button" data-start-day="${escapeAttr(row.id)}">${status === "in-progress" ? "Continue today" : "Start study block"}</button>` : ""}
            ${isActionable && status !== "complete" && isScheduled ? `<button class="button button--success" type="button" data-complete-day="${escapeAttr(row.id)}">Mark complete</button>` : ""}
            <button class="button ${row.isRest || row.isTestWindow || status === "complete" || !isScheduled ? "button--primary action-buttons__lead" : ""}" type="button" data-open-assignment="${escapeAttr(row.id)}">${escapeHTML(copy.button)}</button>
            ${isActionable && isScheduled ? `<button class="button button--quiet action-buttons__trail" type="button" data-log-assignment="${escapeAttr(row.id)}">Log a question</button>` : ""}
          </div>
        </article>

        ${isActionable && todayContext.state === "scheduled" ? `
          <section class="focus-card" aria-labelledby="focus-title">
            <div><span class="eyebrow">Optional focus mode</span><h3 id="focus-title">One calm block</h3><p>Use a simple 25-minute timer. It will only save a session when you finish it.</p></div>
            <div class="focus-controls"><output data-focus-clock aria-live="polite">25:00</output><button class="button" type="button" data-focus-toggle>Start</button><button class="button button--quiet" type="button" data-focus-finish disabled>Finish block</button></div>
          </section>` : ""}

        ${carryover.length ? `<section class="carryover-card"><div><span class="eyebrow">Keep it manageable</span><h3>Two small carryovers</h3><p>Only bring forward what helps the next useful action.</p></div><ul>${carryover.map((item) => `<li><button type="button" data-open-assignment="${escapeAttr(item.id)}"><span>${escapeHTML(formatDate(item.date))}</span>${escapeHTML(item.assignment)}</button></li>`).join("")}</ul></section>` : ""}
      </main>

      <aside class="today-sidebar">
        ${countdown(data, state, today)}
        <section class="card momentum-card">
          <span class="eyebrow">Weekly momentum</span>
          <h3>${typeof row.week === "number" ? `Week ${row.week}` : "Placeholder window"}</h3>
          ${progressBar(completedDays, studyRows.length, "Study days complete")}
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
  container.querySelectorAll("[data-open-assignment]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = context.data.index.scheduleByDate.get(button.dataset.openAssignment);
      context.openDialog({
        title: "Assignment details",
        body: assignmentDetailHTML(row, context.data, context.state),
        onMount: (dialog) => bindAssignmentDetail(dialog, context),
      });
    });
  });

  container.querySelector("[data-start-day]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.startDay;
    context.updateState({
      ...context.state,
      daily: { ...context.state.daily, [id]: { ...(context.state.daily[id] || {}), status: "in-progress", updatedAt: new Date().toISOString() } },
    });
    context.showToast("Study block started");
  });

  container.querySelector("[data-complete-day]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.completeDay;
    context.updateState({
      ...context.state,
      daily: { ...context.state.daily, [id]: { ...(context.state.daily[id] || {}), status: "complete", updatedAt: new Date().toISOString() } },
    });
    context.showToast("Today marked complete");
  });

  container.querySelector("[data-log-assignment]")?.addEventListener("click", (event) => {
    const row = context.data.index.scheduleByDate.get(event.currentTarget.dataset.logAssignment);
    context.openQuickLog(row);
  });

  const clock = container.querySelector("[data-focus-clock]");
  const toggle = container.querySelector("[data-focus-toggle]");
  const finish = container.querySelector("[data-focus-finish]");
  if (clock && toggle && finish) {
    let remaining = 25 * 60;
    let timer = null;
    let startedAt = "";
    const paint = () => { clock.value = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`; clock.textContent = clock.value; };
    const stop = () => { clearInterval(timer); timer = null; toggle.textContent = remaining < 25 * 60 ? "Resume" : "Start"; };
    toggle.addEventListener("click", () => {
      if (timer) { stop(); return; }
      startedAt ||= new Date().toISOString();
      toggle.textContent = "Pause";
      finish.disabled = false;
      timer = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        paint();
        if (remaining === 0) { stop(); context.showToast("Focus block complete"); }
      }, 1000);
    });
    finish.addEventListener("click", () => {
      stop();
      const row = getTodayContext(context.data, todayISO()).row;
      const session = { id: uniqueId("focus"), assignmentId: row?.id || "", startedAt: startedAt || new Date().toISOString(), endedAt: new Date().toISOString(), minutes: Math.max(1, Math.round((25 * 60 - remaining) / 60)) };
      context.updateState({ ...context.state, focusSessions: [...context.state.focusSessions, session] });
      context.showToast("Focus session saved");
    });
    paint();
  }
}
