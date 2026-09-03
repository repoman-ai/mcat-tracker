import { focusTarget } from "../view-state.js";
import { isPastDue, isStudyRow, pendingRows, scheduledWeekForDate } from "../data.js";
import { taskProgress } from "../daily.js";
import { escapeAttr, escapeHTML, formatDate, todayISO } from "../utils.js";
import { assignmentDetailHTML, bindAssignmentDetail, bindCompletionButtons, completionButton, statusLabel, workRow, bindWorkRows } from "./shared.js";

const defaultFilters = {
  phase: "all",
  resource: "all",
  status: "all",
  dayType: "all",
  currentWeekOnly: false,
};

const filters = { ...defaultFilters };

function option(value, label, selected) {
  return `<option value="${escapeAttr(value)}" ${selected === value ? "selected" : ""}>${escapeHTML(label)}</option>`;
}

function phaseMap(data, currentWeek) {
  return `<section class="phase-map" aria-labelledby="phase-heading"><div class="section-heading"><div><span class="eyebrow">The arc of the plan</span><h2 id="phase-heading">Phase map</h2></div><a href="#guide/phase-map">Read complete guidance</a></div><div class="phase-track">${data.phaseMap.map((phase) => {
    const active = currentWeek >= phase.startWeek && currentWeek <= phase.endWeek;
    return `<article class="phase-step ${active ? "is-active" : ""}"><span>${phase.startWeek === phase.endWeek ? `Week ${phase.startWeek}` : `Weeks ${phase.startWeek}-${phase.endWeek}`}</span><strong>${escapeHTML(phase.phase)}</strong><small>${escapeHTML(formatDate(phase.startDate))} – ${escapeHTML(formatDate(phase.endDate))}</small></article>`;
  }).join("")}</div></section>`;
}

function rowMatches(row, state, currentWeek, today) {
  const status = state.daily[row.id]?.status || "not-started";
  if (filters.currentWeekOnly && row.week !== currentWeek) return false;
  if (filters.phase !== "all" && row.phase !== filters.phase) return false;
  if (filters.resource !== "all" && !row.resource.includes(filters.resource)) return false;
  if (filters.status === "complete" && status !== "complete") return false;
  if (filters.status === "incomplete" && status === "complete") return false;
  if (filters.status === "deferred" && status !== "deferred") return false;
  if (filters.status === "past-due" && !isPastDue(row, state, today)) return false;
  if (filters.dayType !== "all" && row.dayType !== filters.dayType) return false;
  return true;
}

function dayCard(row, context, forceOpen, today) {
  const daily = context.state.daily[row.id] || {};
  const status = daily.status || "not-started";
  const steps = taskProgress(row, context.state);
  return `
    <details class="plan-day plan-day--${escapeAttr(row.dayType)} ${row.date === today ? "is-today" : ""}" data-assignment-details="${escapeAttr(row.id)}" data-view-key="day-${escapeAttr(row.id)}" ${forceOpen ? "open" : ""}>
      <summary>
        <div class="date-tile"><span>${escapeHTML(row.day)}</span><strong>${escapeHTML(formatDate(row.date, { weekday: undefined, month: "short" }).replace(/^\w+,\s*/, ""))}</strong></div>
        <div class="plan-day__main"><div class="plan-day__meta">${row.date === today ? '<span class="today-label">Today</span>' : ""}${status === "deferred" ? '<span class="deferred-label">Deferred</span>' : ""}${isPastDue(row, context.state, today) ? '<span class="past-due-label">Past due</span>' : ""}<span>${escapeHTML(row.resource || row.dayType.replaceAll("-", " "))}</span>${row.chapterIds.length ? `<span>${escapeHTML(row.chapterIds.join(" · "))}</span>` : ""}</div><h4>${escapeHTML(row.assignment)}</h4><p>${steps.total ? `<strong class="plan-day__progress">${steps.completed}/${steps.total} steps</strong> · ` : ""}${escapeHTML(row.practiceTargetDisplay || (row.isRest ? "Protected rest" : "No practice quota"))}</p></div>
        ${isStudyRow(row) ? completionButton(row, context.state, { compact: true }) : `<span class="status-badge status-badge--${escapeAttr(status)}">${escapeHTML(statusLabel(status))}</span>`}
        <span class="disclosure-icon" aria-hidden="true">⌄</span>
      </summary>
      <div class="plan-day__detail">
        ${assignmentDetailHTML(row, context.data, context.state)}
        <div class="button-row"><button class="button button--primary" type="button" data-log-from-plan="${escapeAttr(row.id)}">Log question from this assignment</button></div>
      </div>
    </details>`;
}

function weekCard(week, rows, context, currentWeek, detail, today) {
  const matching = rows.filter((row) => rowMatches(row, context.state, currentWeek, today));
  if (!matching.length) return "";
  const completed = rows.filter((row) => isStudyRow(row) && context.state.daily[row.id]?.status === "complete").length;
  const studyDays = rows.filter(isStudyRow).length;
  const open = week.week === currentWeek || matching.some((row) => row.date === detail);
  const workload = context.data.validation.weeklyChecks.find((check) => check.week === week.week);
  const estimate = workload ? `${(workload.estimatedLowMinutes / 60).toFixed(1)}–${(workload.estimatedHighMinutes / 60).toFixed(1)} hr` : "Not available";
  const warning = workload?.capacityRisk === "midpoint-over-budget"
    ? "Capacity risk: even the range midpoint exceeds the budget. Prioritize review, trim lower-priority volume, and replan if actual time confirms the overrun."
    : workload?.capacityRisk === "upper-over-budget"
      ? "Deeper review may exceed the budget. Stop new questions at the time limit; do not skip their review or borrow from sleep."
      : "Estimated workload fits the budget.";
  return `
    <details class="week-card" ${open ? "open" : ""} id="week-${week.week}">
      <summary>
        <div class="week-number"><span>Week</span><strong>${week.week}</strong></div>
        <div class="week-summary"><span class="eyebrow">${escapeHTML(week.phase)} · ${week.planned_hours} planned hours</span><h3>${escapeHTML(week.focus)}</h3><p>${escapeHTML(week.milestone)}</p><p>Advisory estimate: ${escapeHTML(estimate)}${workload?.capacityRisk === "midpoint-over-budget" ? " · Capacity risk" : ""}</p></div>
        <div class="week-score"><strong>${completed}/${studyDays}</strong><span>days</span></div><span class="disclosure-icon" aria-hidden="true">⌄</span>
      </summary>
      <div class="week-card__body">
        <p class="muted">${escapeHTML(warning)} <a href="#guide/honest-time-templates">Budget and estimate rules</a></p>
        <div class="week-targets"><span><strong>${week.uworld_questions}</strong> UWorld</span><span><strong>${week.cars_passages}</strong> CARS passages</span>${week.exam_or_section_bank ? `<span><strong>${escapeHTML(week.exam_or_section_bank)}</strong> event</span>` : ""}</div>
        <div class="plan-days">${matching.map((row) => dayCard(row, context, row.date === detail, today)).join("")}</div>
      </div>
    </details>`;
}

function pastDueSection(context, today, detail) {
  const rows = pendingRows(context.data, context.state, today);
  if (!rows.length && detail !== "past-due") return "";
  const deferred = rows.filter((row) => context.state.daily[row.id]?.status === "deferred").length;
  return `<section class="plan-backlog" id="plan-past-due" tabindex="-1" aria-labelledby="backlog-heading">
    <div class="section-heading"><div><span class="eyebrow">Unfinished work</span><h2 id="backlog-heading">${rows.length ? `Past due · ${rows.length}` : "No past-due days"}</h2></div><button class="button button--small" type="button" data-plan-jump>Jump to current week</button></div>
    <p>${rows.length ? `Oldest first${deferred ? ` · ${deferred} deferred (included)` : ""}. The full schedule continues below.` : "You’re caught up. Your full schedule is below."}</p>
    ${rows.length ? `<details class="backlog-disclosure" id="backlog-list" ${detail === "past-due" ? "open" : ""}><summary>Review ${rows.length} unfinished days<span class="disclosure-icon" aria-hidden="true">⌄</span></summary><ul class="catchup-list">${rows.map((row) => workRow(row, context.state, today)).join("")}</ul><p class="muted">Deferred means set aside, still unfinished. It does not change the scheduled date.</p></details>` : ""}
  </section>`;
}

export function renderPlan(context, route, { isRouteChange = true } = {}) {
  const today = todayISO();
  if (isRouteChange) Object.assign(filters, defaultFilters);
  const currentWeek = scheduledWeekForDate(context.data, today) || 1;
  const phases = [...new Set(context.data.schedule.map((row) => row.phase))];
  const resources = [...new Set(context.data.schedule.flatMap((row) => row.resource.split(";").map((item) => item.trim())).filter(Boolean))].sort();
  const weeksHTML = context.data.plan.weeks.map((week) => weekCard(week, context.data.schedule.filter((row) => row.week === week.week), context, currentWeek, route.detail, today)).join("");
  const testRows = context.data.schedule.filter((row) => row.week === "TEST").filter((row) => rowMatches(row, context.state, currentWeek, today));

  const matchedCount = context.data.schedule.filter((row) => rowMatches(row, context.state, currentWeek, today)).length;
  const filtered = Object.keys(defaultFilters).some((key) => filters[key] !== defaultFilters[key]);
  return `
    <header class="view-header"><div><span class="eyebrow">${context.data.schedule.length} dated rows · ${context.data.plan.prep_weeks} ${escapeHTML(context.data.plan.week_boundary)} weeks</span><h1>Plan</h1><p>Your full schedule, with unfinished work kept in view. Expand a week or day for details.</p></div>
      <div class="button-row"><button class="button button--primary" type="button" data-plan-jump>Jump to week ${currentWeek}</button><a class="button" href="#guide/week-by-week-plan">Plan guidance</a></div></header>
    ${filtered ? `<div class="plan-filter-notice" role="status">Showing ${matchedCount} of ${context.data.schedule.length} scheduled days · Filters active <button class="button button--small" type="button" data-plan-reset>Show full schedule</button></div>` : ""}
    ${pastDueSection(context, today, route.detail)}
    ${phaseMap(context.data, currentWeek)}
    <section class="filter-panel" tabindex="-1" aria-labelledby="plan-filter-heading">
      <div><span class="eyebrow">Narrow the calendar</span><h2 id="plan-filter-heading">Schedule filters</h2><p class="filter-count">${matchedCount} of ${context.data.schedule.length} days</p></div>
      <div class="filter-grid">
        <label>Phase<select data-plan-filter="phase">${option("all", "All phases", filters.phase)}${phases.map((phase) => option(phase, phase, filters.phase)).join("")}</select></label>
        <label>Resource<select data-plan-filter="resource">${option("all", "All resources", filters.resource)}${resources.map((resource) => option(resource, resource, filters.resource)).join("")}</select></label>
        <label>Status<select data-plan-filter="status">${option("all", "All statuses", filters.status)}${option("past-due", "Past due", filters.status)}${option("deferred", "Deferred", filters.status)}${option("complete", "Complete", filters.status)}${option("incomplete", "Incomplete", filters.status)}</select></label>
        <label>Day type<select data-plan-filter="dayType">${option("all", "All day types", filters.dayType)}${option("study", "Study days", filters.dayType)}${option("exam", "Full-length days", filters.dayType)}${option("full-length-review", "FL review days", filters.dayType)}${option("section-bank", "Section Bank days", filters.dayType)}${option("rest", "Rest days", filters.dayType)}${option("logistics", "Logistics tasks", filters.dayType)}${option("test-window", "Placeholder window", filters.dayType)}</select></label>
        <label class="check-control"><input type="checkbox" data-plan-current ${filters.currentWeekOnly ? "checked" : ""}><span>Current week only</span></label>
        <button class="button button--quiet" type="button" data-plan-reset>Reset filters</button>
      </div>
    </section>
    <section class="week-list" aria-label="${context.data.plan.prep_weeks}-week study schedule">${weeksHTML || `<div class="empty-state"><h3>No days match these filters</h3><p>Reset one or more filters to bring the schedule back.</p><button class="button" type="button" data-plan-reset>Show full schedule</button></div>`}</section>
    ${testRows.length ? `<section class="test-window-section"><div class="section-heading"><div><span class="eyebrow">Not a confirmed exam date</span><h2>Placeholder test window</h2></div><a href="#exams">Set registered date</a></div><p>January 22-23 are planning placeholders. The registered date setting controls the live countdown.</p><div class="plan-days">${testRows.map((row) => dayCard(row, context, row.date === route.detail, today)).join("")}</div></section>` : ""}`;
}

export function bindPlan(container, context, { isRouteChange = true } = {}) {
  bindCompletionButtons(container, context);
  bindWorkRows(container, context);
  const filterChanged = () => {
    context.rerender({ preserveView: false });
    focusTarget(container.querySelector(".filter-panel"));
  };
  container.querySelectorAll("[data-plan-jump]").forEach((button) => button.addEventListener("click", () => {
    const currentWeek = scheduledWeekForDate(context.data, todayISO()) || 1;
    Object.assign(filters, defaultFilters);
    context.rerender({ preserveView: false });
    const target = container.querySelector(`#week-${currentWeek}`);
    if (target) { target.open = true; focusTarget(target); }
  }));
  container.querySelectorAll("[data-plan-filter]").forEach((select) => {
    select.addEventListener("change", () => { filters[select.dataset.planFilter] = select.value; filterChanged(); });
  });
  container.querySelector("[data-plan-current]")?.addEventListener("change", (event) => { filters.currentWeekOnly = event.currentTarget.checked; filterChanged(); });
  container.querySelectorAll("[data-plan-reset]").forEach((button) => button.addEventListener("click", () => { Object.assign(filters, defaultFilters); filterChanged(); }));

  container.querySelectorAll("[data-assignment-details]").forEach((details) => bindAssignmentDetail(details, context));
  container.querySelectorAll("[data-log-from-plan]").forEach((button) => button.addEventListener("click", () => context.openQuickLog(context.data.index.scheduleByDate.get(button.dataset.logFromPlan))));

  if (isRouteChange && window.location.hash === "#plan/past-due") {
    focusTarget(container.querySelector("#plan-past-due"));
  } else if (isRouteChange && window.location.hash.includes("/")) {
    const target = container.querySelector(`[data-assignment-details="${CSS.escape(decodeURIComponent(window.location.hash.split("/").slice(1).join("/")))}"]`);
    if (target) focusTarget(target);
  }
}
