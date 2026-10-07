import { motivationContext } from "../motivation.js?v=20261007-7";
import { createFocusTimer, focusMinutes } from "../focus-timer.js?v=20261007-2";
import { enablePullToRefresh, enableViewPager, pageSwipeTarget } from "../gestures.js?v=20261007-2";
import { completedRows, dueEntries, getTodayContext, isStudyRow, pendingRows, weekRows, modeLabel } from "../data.js?v=20261007-7";
import { recordedCounts, taskProgress } from "../daily.js?v=20261007-7";
import {
  daysBetween,
  escapeAttr,
  escapeHTML,
  formatDateLong,
  plural,
  todayISO,
  uniqueId,
} from "../utils.js?v=20261007-7";
import { bindWorkRows, workRow, bindCompletionButtons, bindTaskChecklist, completionButton, emptyState, progressBar, taskChecklist } from "./shared.js?v=20261007-7";

// Completion and sync rerender Today. Keep one timer across those renders so
// checking off a past day doesn't reset a running block or orphan intervals.
const elapsedClock = createFocusTimer();
const focus = { timer: null, startedAt: "", assignmentId: "", paint: () => {} };

export function leaveToday() {
  elapsedClock.pause();
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
  if (!registered) return `<p class="quiet-countdown">No registered date · planning against ${escapeHTML(formatDateLong(target))}. <a href="#exams">Set date</a></p>`;
  const headline = days >= 0 ? `${days} days` : `${Math.abs(days)} days ago`;
  return `
    <section class="countdown-card ${isRegistered ? "countdown-card--registered" : ""}">
      <div><span class="eyebrow">${isRegistered ? "Registered MCAT" : "Placeholder window"}</span><strong>${headline}</strong></div>
      <p>${escapeHTML(formatDateLong(target))}</p>
      ${target !== data.plan.placeholder_exam_window[0] ? '<p class="schedule-date-notice">Your booked date differs from this plan. <a href="#exams">Review schedule alignment</a></p>' : ""}
      <a href="#exams">${isRegistered ? "Update date" : "Set registered date"}</a>
    </section>`;
}

function weeklyMomentum(rows, state, today) {
  let completed = 0, total = 0;
  const days = rows.map((row) => {
    const progress = taskProgress(row, state);
    completed += progress.completed;
    total += progress.total;
    const done = state.daily[row.id]?.status === "complete";
    const status = row.isRest ? "Rest" : row.isTestWindow ? "Test date" : done ? "Complete" : progress.completed ? `${progress.completed}/${progress.total} steps` : "Planned";
    const shortStatus = row.isRest ? "Rest" : row.isTestWindow ? "Test" : done ? "Done" : progress.completed ? `${progress.completed}/${progress.total}` : "Plan";
    const appearance = row.isRest || row.isTestWindow ? "rest" : done ? "complete" : progress.completed ? "partial" : "planned";
    return `<a class="week-day week-day--${appearance}" href="#plan/${escapeAttr(row.id)}" ${row.date === today ? 'aria-current="date"' : ""} aria-label="${escapeAttr(`${formatDateLong(row.date)}: ${status}. Open scheduled day`)}"><span>${escapeHTML(row.day)}</span><strong aria-hidden="true">${row.isRest ? "–" : done ? "✓" : row.date.slice(-2)}</strong><small>${escapeHTML(shortStatus)}</small></a>`;
  }).join("");
  const message = total && completed === total ? "This week’s steps are complete. Protect your recovery time."
    : rows.some((row) => row.date === today && row.isRest) ? "Rest is scheduled today. Your saved progress will be here when you return."
    : completed ? `${plural(completed, "step")} banked. Small blocks add up; keep the next one manageable.`
      : "Start with one step. Partial progress counts here, too.";
  return `<nav class="week-rhythm" aria-label="Scheduled week progress">${days}</nav>${progressBar(completed, total, "Weekly steps complete")}<p class="momentum-encouragement">${message}</p>`;
}

function weeklyCapacity(data, row) {
  const check = data.validation.weeklyChecks.find((item) => item.week === row.week);
  if (!check || check.capacityRisk === "within-budget") return "";
  const range = `${(check.estimatedLowMinutes / 60).toFixed(1)}–${(check.estimatedHighMinutes / 60).toFixed(1)}`;
  return `<details class="capacity-guidance" data-view-key="weekly-capacity"><summary>${check.budgetMinutes / 60}-hour weekly ceiling · watch the workload</summary><p>Estimated ${range} hours including answer review. ${check.capacityRisk === "midpoint-over-budget" ? "Even the midpoint exceeds this week’s ceiling. " : "Deeper review could exceed this week’s ceiling. "}Protect exam review and rest. Trim new practice first; replan if you overrun twice.</p><a href="#plan/${escapeAttr(row.id)}">Review this week’s workload</a></details>`;
}

function todayTabs(completedCount, completed = false) {
  return `<nav class="today-tabs" aria-label="Study work"><a href="#today" ${completed ? "" : 'aria-current="page"'}>Today</a><a href="#today/completed" ${completed ? 'aria-current="page"' : ""}>Completed <span>${completedCount}</span></a><button class="button button--quiet" type="button" data-refresh-today data-view-focus="refresh-today">Refresh</button></nav>`;
}

function catchUpSection(rows, state, today) {
  if (!rows.length) return "";
  const deferred = rows.filter((row) => state.daily[row.id]?.status === "deferred").length;
  return `<section class="catchup-card" aria-labelledby="catchup-title">
    <header><h2 id="catchup-title">Past due <span>${rows.length}</span></h2><a href="#plan/past-due">View all ${rows.length} in Plan</a></header>
    <ul class="catchup-list" aria-label="Past-due assignments, oldest first">${rows.slice(0, 3).map((row) => workRow(row, state, today, false, { chapterLines: true })).join("")}</ul>
    <p>${rows.length > 3 ? `Showing oldest 3 of ${rows.length}` : "Oldest first"}${deferred ? ` · ${deferred} deferred (included)` : ""}</p>
  </section>`;
}

function renderCompleted(context, rows, today) {
  const sessions = (context.state.focusSessions || []).filter((session) => {
    try { focusMinutes(session); return true; } catch { return false; }
  });
  const minutes = sessions.reduce((total, session) => total + Number(session.minutes || 0), 0);
  const currentWeek = getTodayContext(context.data, today).row?.week;
  const weekIds = new Set(weekRows(context.data, currentWeek).map((row) => row.id));
  const weekMinutes = sessions.filter((session) => weekIds.has(session.assignmentId)).reduce((total, session) => total + Number(session.minutes || 0), 0);
  return `<header class="view-header today-header"><div><span class="eyebrow">Your finished work</span><h1>Completed</h1></div></header>
    ${todayTabs(rows.length, true)}
    ${sessions.length ? `<p class="focus-history">Saved focus time: <strong>${Math.round(weekMinutes)} min</strong> for this week’s assignments · ${Math.round(minutes)} min total</p>` : ""}
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

export function dayTitle(row) {
  const names = { "General Chemistry": "Gen Chem", "Critical Analysis and Reasoning Skills": "CARS", "Physics and Math": "Physics + Math", "Organic Chemistry": "Organic Chem", "Behavioral Sciences": "Psych/Soc" };
  const subjects = [...new Set((row.chapters || []).map((chapter) => names[chapter.subject] || chapter.subject))];
  return subjects.length ? subjects.join(" + ") : row.assignment;
}

function studyMessage(context, today, isRouteChange) {
  const eligibility = motivationContext(context.data, context.state, today);
  const message = context.motivation?.get(eligibility, today, { revisit: isRouteChange });
  if (!message) return "";
  if (message.dismissed) return `<div class="study-message-restore"><button class="button button--quiet" type="button" data-restore-study-message data-view-focus="study-message">Show study message</button></div>`;
  const label = formatDateLong(today);
  const countdownLabel = ([11, 12].includes(message.phraseId) || String(message.phraseId).startsWith("early-"))
    ? `<span class="study-message__countdown">${eligibility.days} days · ${eligibility.registered ? "registered exam" : "planning date"}</span>` : "";
  const heading = label || countdownLabel
    ? `<div class="study-message__heading">${label ? `<span class="eyebrow"><span aria-hidden="true">✦</span> ${escapeHTML(label)}</span>` : ""}${countdownLabel}</div>` : "";
  return `<aside class="study-message study-message--${message.section}${heading ? "" : " study-message--no-heading"}" aria-label="Study message" data-study-message ${focus.timer ? "hidden" : ""}>
    ${heading}<button class="button button--quiet study-message__dismiss" type="button" data-dismiss-study-message data-view-focus="study-message" aria-label="Hide study messages for today" title="Hide for today">×</button>
    <p>${escapeHTML(message.text)}</p>
    <button class="study-message__action" type="button" data-go-to-study data-view-focus="go-to-study">Today's block <span aria-hidden="true">↓</span></button>
  </aside>`;
}

export function renderToday(context, route = {}, { isRouteChange = true, revisit = false } = {}) {
  const { data, state } = context;
  const today = todayISO();
  const completed = completedRows(data, state);
  if (route.detail === "completed") return renderCompleted(context, completed, today);
  const pending = pendingRows(data, state, today);
  const todayContext = getTodayContext(data, today);
  const row = todayContext.row;
  const due = dueEntries(state, today).filter((entry) => entry.dueState !== "upcoming");
  const repairs = due.length ? `<p class="pending-repairs"><a href="#log/repair">${plural(due.length, "retest")} due</a></p>` : "";
  if (!row) return `<header class="view-header today-header"><div><h1>End of the dated plan</h1><p>Choose your next block using your registered exam date and readiness evidence.</p></div></header>${todayTabs(completed.length)}${catchUpSection(pending, state, today)}<section class="card"><h2>Protect the work you built</h2><p>Keep repairs narrow: mistake-log retests, mastery topics, CARS, and logistics.</p><a class="button" href="#log/repair">Open repair queue</a> <a href="#exams">Review exams</a></section>${repairs}${countdown(data, state, today)}`;
  const daily = state.daily[row.id] || {};
  const status = daily.status || "not-started";
  const done = status === "complete";
  const isScheduled = todayContext.state === "scheduled";
  const actionable = isStudyRow(row) && isScheduled;
  const rows = weekRows(data, row.week);
  const studyRows = rows.filter(isStudyRow);
  const completedDays = studyRows.filter((item) => state.daily[item.id]?.status === "complete").length;
  const tomorrow = data.schedule.find((item) => item.date > row.date);
  const next = tomorrow ? `<p class="tomorrow-preview"><span>Next · ${escapeHTML(formatDateLong(tomorrow.date))}</span><strong>${escapeHTML(dayTitle(tomorrow))}</strong></p>` : '<p class="tomorrow-preview">You reached the end of the dated plan.</p>';
  const questions = recordedCounts(rows, state, "actualQuestions"), cars = recordedCounts(rows, state, "actualCars");
  const recorded = ({ total, days }) => days ? `${total} · ${plural(days, "day")} recorded` : "Not recorded yet";
  const stopRule = row.stopRule || "";
  const heading = isScheduled ? "Today" : "Your next block";
  const timing = todayContext.state === "before-plan" ? `The plan begins ${formatDateLong(row.date)}. No catch-up is needed.` : todayContext.state === "gap" ? `No row is assigned today. Next block: ${formatDateLong(row.date)}.` : `${typeof row.week === "number" ? `Week ${row.week}` : "Test window"} · ${row.phase}`;
  const displayName = /^([\p{L}\p{N}])\1{7,}$/u.test(state.settings.displayName || "") ? "" : state.settings.displayName;
  const greeting = displayName
    ? `${escapeHTML(heading)}, <span class="today-greeting-name" title="${escapeAttr(displayName)}">${escapeHTML(displayName)}</span>`
    : escapeHTML(heading);
  return `${studyMessage(context, today, isRouteChange || revisit)}
    <header class="view-header today-header"><div><span class="eyebrow">${escapeHTML(timing)}</span><h1>${greeting}</h1></div></header>
    ${todayTabs(completed.length)}
    ${catchUpSection(pending, state, today)}
    <div class="today-grid"><div class="today-main">
    <article id="today-assignment" tabindex="-1" class="today-action today-action--${escapeAttr(row.dayType)} ${done ? "is-complete" : ""}">
      <div class="today-action__top"><span class="eyebrow">${done ? "Today is complete" : row.isRest ? "Rest is today's plan" : escapeHTML(actionCopy(row, status, todayContext.state).eyebrow)}</span>${!done && !row.isRest ? `<span class="workload-pill" title="Advisory workload estimate">${escapeHTML(row.estimatedWorkload.label)}</span>` : ""}</div>
      ${done ? `<div class="day-success"><span aria-hidden="true">✓</span><div><h2>${isScheduled ? "Today's plan is complete" : "Block complete"}</h2><p>${escapeHTML(dayTitle(row))} · ${completedDays}/${studyRows.length} study days this week</p></div></div>` : `<h2>${escapeHTML(dayTitle(row))}</h2>`}
      ${!done && row.chapters.length ? `<p class="assignment-subtitle">${plural(row.chapters.length, "chapter")} · ${escapeHTML(modeLabel(row.mode))} · ${escapeHTML(row.resource)}</p>` : ""}
      ${!done && stopRule ? `<p class="stop-rule">${escapeHTML(stopRule)}</p>` : ""}
      ${row.isRest ? '<p class="rest-encouragement">Recovery is part of the plan. You do not need to clear past-due work to earn today’s rest.</p>' : ""}
      ${actionable ? (done ? `<details class="completed-checklist" data-view-key="completed-${escapeAttr(row.id)}" ${!isRouteChange ? "open" : ""}><summary>Review completed steps</summary>${taskChecklist(row, state)}</details>` : taskChecklist(row, state)) : ""}
      <div class="button-row today-tools">${actionable ? `<button class="button" type="button" data-log-assignment="${escapeAttr(row.id)}">Log a question</button>` : ""}<button class="button button--quiet" type="button" data-open-assignment="${escapeAttr(row.id)}">${done ? "Review day" : row.isRest ? "Review rest guidance" : "Details & counts"}</button></div>
      ${actionable ? `<div class="today-complete-action">${completionButton(row, state)}</div>` : ""}
      ${!done && row.sourceNotes ? `<details class="assignment-guidance" data-view-key="today-guidance"><summary>Guardrails for today</summary><p>${escapeHTML(row.sourceNotes)}</p></details>` : ""}
      ${done ? next : ""}
    </article>
    ${actionable && (!done || focus.startedAt) ? `<section class="focus-card" aria-labelledby="focus-title"><div><h3 id="focus-title">One calm block</h3><p>Optional 25-minute timer. Leaving Today pauses it; return to resume.</p></div><div class="focus-controls"><output data-focus-clock aria-live="off">25:00</output><button class="button" type="button" data-focus-toggle>Start</button><button class="button button--quiet" type="button" data-focus-finish disabled>Finish block</button></div></section>` : ""}
    ${repairs}
    ${!done ? next : ""}
    </div><aside class="today-sidebar"><section class="card momentum-card"><span class="eyebrow">Weekly momentum</span><h3>${typeof row.week === "number" ? `Week ${row.week}` : "Test window"}</h3>${weeklyMomentum(rows, state, today)}<p class="form-hint">${completedDays}/${studyRows.length} study days complete · rest days are protected.</p>${weeklyCapacity(data, row)}<dl class="recorded-counts"><div><dt>Recorded QBank questions</dt><dd>${recorded(questions)}</dd></div><div><dt>Recorded CARS passages</dt><dd>${recorded(cars)}</dd></div></dl><p class="form-hint">Optional counts are separate from checklist completion.</p><details data-view-key="today-milestone"><summary>This week’s milestone</summary><p>${escapeHTML(row.weeklyMilestone)}</p></details>${!pending.length && today >= data.plan.plan_start ? '<p class="caught-up">✓ No past-due study days</p>' : ""}</section>${countdown(data, state, today)}</aside></div>`;
}

export function bindToday(container, context, route = { detail: "" }) {
  focus.paint = () => {};
  bindCompletionButtons(container, context);
  bindTaskChecklist(container, context);
  bindWorkRows(container, context);

  container.querySelector("[data-refresh-today]")?.addEventListener("click", () => context.refreshNow?.());
  const view = container.ownerDocument?.defaultView || globalThis;
  const indicator = container.ownerDocument?.querySelector("[data-pull-refresh]");
  // Both gestures are rebound per render because they close over this route,
  // so each one hands back its cleanup for the next render to run.
  context.registerViewCleanup?.(enablePullToRefresh(container, { indicator, view, onRefresh: () => context.refreshNow?.(), onError: () => context.showToast("Refresh failed. Try again.", "error") }));
  context.registerViewCleanup?.(enableViewPager(container, {
    view,
    onSwipe: (direction) => {
      const target = pageSwipeTarget(route.detail, direction);
      if (target !== null) context.navigate("today", target);
    },
  }));

  container.querySelector("[data-log-assignment]")?.addEventListener("click", (event) => {
    const row = context.data.index.scheduleByDate.get(event.currentTarget.dataset.logAssignment);
    context.openQuickLog(row);
  });

  container.querySelector("[data-go-to-study]")?.addEventListener("click", () => {
    const assignment = container.querySelector("#today-assignment");
    assignment?.scrollIntoView({ block: "start", behavior: "instant" });
    assignment?.focus({ preventScroll: true });
  });

  container.querySelector("[data-dismiss-study-message]")?.addEventListener("click", () => {
    context.motivation.dismiss(todayISO());
    context.rerender();
    container.querySelector("[data-restore-study-message]")?.focus({ preventScroll: true });
  });
  container.querySelector("[data-restore-study-message]")?.addEventListener("click", () => {
    context.motivation.restore();
    context.rerender();
    container.querySelector("[data-dismiss-study-message]")?.focus({ preventScroll: true });
  });

  const clock = container.querySelector("[data-focus-clock]");
  const toggle = container.querySelector("[data-focus-toggle]");
  const finish = container.querySelector("[data-focus-finish]");
  if (clock && toggle && finish) {
    focus.paint = () => {
      const message = container.querySelector("[data-study-message]");
      if (message) message.hidden = Boolean(focus.timer);
      clock.value = `${String(Math.floor(elapsedClock.remaining / 60)).padStart(2, "0")}:${String(elapsedClock.remaining % 60).padStart(2, "0")}`;
      clock.textContent = clock.value;
      toggle.textContent = elapsedClock.remaining === 0 ? "Save block" : focus.timer ? "Pause" : focus.startedAt ? "Resume" : "Start";
      toggle.disabled = false;
      finish.disabled = !focus.startedAt;
    };
    const stop = () => { elapsedClock.pause(); clearInterval(focus.timer); focus.timer = null; focus.paint(); };
    toggle.addEventListener("click", () => {
      if (elapsedClock.remaining === 0) { finish.click(); return; }
      if (focus.timer) { stop(); return; }
      if (!focus.startedAt) {
        focus.startedAt = new Date().toISOString();
        focus.assignmentId = getTodayContext(context.data, todayISO()).row?.id || "";
      }
      elapsedClock.start();
      focus.timer = setInterval(() => {
        focus.paint();
        if (elapsedClock.remaining === 0) { stop(); context.showToast("Focus block complete"); }
      }, 1000);
      focus.paint();
    });
    finish.addEventListener("click", () => {
      if (elapsedClock.elapsed < 1000) { context.showToast("No focus time to save yet."); return; }
      stop();
      const session = { id: uniqueId("focus"), assignmentId: focus.assignmentId, startedAt: focus.startedAt, endedAt: new Date().toISOString(), minutes: Math.round(elapsedClock.elapsed / 600) / 100 };
      context.updateState({ ...context.state, focusSessions: [...context.state.focusSessions, session] }, {
        success: "Focus session saved",
        onSaved: () => { elapsedClock.reset(); Object.assign(focus, { startedAt: "", assignmentId: "" }); focus.paint(); },
      });
    });
    focus.paint();
  }
}
