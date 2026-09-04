import { bindEditorDrafts, clearEditorDraft } from "../editor-drafts.js";
import { captureViewState } from "../view-state.js";
import { getModeDetails, isStudyRow, modeLabel } from "../data.js";
import { assignmentTasks, taskProgress, withDailyCompletion, withDailyStatus, withDailyTask, resumedStatus, restoredDailyRecord, parseActualCount } from "../daily.js";
import { escapeAttr, escapeHTML, formatDate, formatDateLong, daysBetween, countPracticeQuestions } from "../utils.js";

export function statusLabel(status = "not-started") {
  return {
    "not-started": "Not started",
    "in-progress": "In progress",
    complete: "Complete",
    deferred: "Deferred",
  }[status] || "Not started";
}

export function completionButton(row, state, { compact = false, focusPrefix = "complete" } = {}) {
  const complete = state.daily[row.id]?.status === "complete";
  const label = `${row.historical ? "Completed — saved history (read-only):" : complete ? "Completed — reopen" : "Mark complete:"} ${formatDateLong(row.date)} — ${row.assignment}`;
  return `<button class="completion-check ${complete ? "is-checked" : ""} ${compact ? "completion-check--compact" : ""}" type="button" ${row.historical ? "disabled" : `data-toggle-complete="${escapeAttr(row.id)}" data-view-focus="${focusPrefix}-${escapeAttr(row.id)}"`} aria-pressed="${complete}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"><span class="completion-check__box" aria-hidden="true">${complete ? "✓" : ""}</span><span>${complete ? "Reopen day" : "Mark all steps done"}</span></button>`;
}

const boundCompletion = new WeakSet();
const boundTasks = new WeakSet();
export function bindCompletionButtons(container, context) {
  container.querySelectorAll("[data-toggle-complete]").forEach((button) => {
    if (boundCompletion.has(button)) return;
    boundCompletion.add(button);
    button.addEventListener("click", (event) => {
      // Plan checkboxes sit in the day summary; checking must not toggle details.
      event.preventDefault();
      const id = button.dataset.toggleComplete;
      const row = context.data?.index?.scheduleByDate?.get(id);
      const previous = context.state.daily[id]?.status || "not-started";
      const status = previous === "complete" ? "not-started" : "complete";
      const previousRecord = context.state.daily[id] ? structuredClone(context.state.daily[id]) : null;
      const next = row ? withDailyCompletion(context.state, row, status === "complete") : withDailyStatus(context.state, id, status);
      // Don't report success (or offer undo) when local storage rejected the write.
      const origin = button.closest?.("dialog") ? "dialog" : button.closest?.(".today-action") ? "today" : "plan";
      if (context.updateState(next) === false) return;
      const feedback = status === "complete" ? context.celebrate?.({ row, previous: previousRecord, next: next.daily[id], origin }) : "";
      const savedAt = next.daily[id].updatedAt;
      context.showToast(feedback || `${formatDateLong(id)} ${status === "complete" ? "completed" : "reopened"}`, "success", {
        label: "Undo",
        onClick: () => {
          // An undo must not overwrite a newer edit arriving from another device.
          const current = context.state.daily[id];
          if (current?.status !== status || current?.updatedAt !== savedAt) {
            context.showToast("This day has changed since then. Open its record to edit it.", "error");
            return;
          }
          const daily = { ...context.state.daily };
          daily[id] = restoredDailyRecord(previousRecord, current);
          context.updateState({ ...context.state, daily }, { success: "Completion change undone" });
        },
      });
    });
  });
}

export function workRow(row, state, today, completed = false, { chapterLines = false } = {}) {
  const age = daysBetween(row.date, today);
  const deferred = state.daily[row.id]?.status === "deferred";
  const timing = completed ? "Completed" : `${deferred ? "Deferred" : "Past due"} · ${age === 1 ? "yesterday" : `${age} days ago`}`;
  const assignment = chapterLines && row.chapters?.length
    ? `<span class="work-row__chapters">${row.chapters.map((chapter) => `<span><span class="work-row__chapter-code">${escapeHTML(chapter.id)}</span> ${escapeHTML(chapter.title)}</span>`).join("")}</span>`
    : `<strong>${escapeHTML(row.assignment)}</strong>`;
  const text = `<span class="work-row__date ${deferred ? "is-deferred" : ""}">${escapeHTML(formatDate(row.date, { includeYear: completed }))} · ${escapeHTML(timing)}</span>${assignment}`;
  return `<li class="work-row" data-work-row="${escapeAttr(row.id)}">
    ${completionButton(row, state, { compact: true, focusPrefix: "work-complete" })}
    ${row.historical ? `<div class="work-row__detail">${text}<small>Saved history · outside the current plan</small></div>` : `<button class="work-row__detail" type="button" data-open-assignment="${escapeAttr(row.id)}" data-view-focus="open-${escapeAttr(row.id)}" aria-label="${escapeAttr(`Open ${formatDateLong(row.date)} — ${row.assignment}`)}">${text}<small>View details</small></button>`}
    ${!completed && !row.historical ? `<button class="button button--quiet work-row__defer" type="button" data-defer-day="${escapeAttr(row.id)}" data-view-focus="defer-${escapeAttr(row.id)}" aria-label="${escapeAttr(`${deferred ? "Resume" : "Defer"} ${formatDateLong(row.date)}`)}">${deferred ? "Resume" : "Defer"}</button>` : ""}
  </li>`;
}

export function bindWorkRows(container, context) {
  container.querySelectorAll("[data-defer-day]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.deferDay;
    const status = context.state.daily[id]?.status === "deferred" ? resumedStatus(context.state.daily[id]) : "deferred";
    context.updateState(withDailyStatus(context.state, id, status), {
      success: status === "deferred" ? "Deferred — still in your unfinished work" : "Assignment resumed",
    });
  }));
  container.querySelectorAll("[data-open-assignment]").forEach((button) => button.addEventListener("click", () => {
    const row = context.data.index.scheduleByDate.get(button.dataset.openAssignment);
    context.openDialog({
      title: "Assignment details",
      body: assignmentDetailHTML(row, context.data, context.state),
      onMount: (dialog) => {
        const mount = () => {
          bindAssignmentDetail(dialog, modalContext);
          bindCompletionButtons(dialog, modalContext);
        };
        const modalContext = { ...context, get state() { return context.state; }, updateState(next, options) {
          const restore = captureViewState(dialog, window);
          const top = dialog.scrollTop;
          const saved = context.updateState(next, options);
          if (saved !== false && dialog.open) {
            dialog.querySelector("[data-dialog-body]").innerHTML = assignmentDetailHTML(row, context.data, context.state);
            mount();
            restore();
            dialog.scrollTop = top;
          }
          return saved;
        } };
        mount();
      },
    });
  }));
}

export function taskChecklist(row, state) {
  const { tasks, completed, total } = taskProgress(row, state);
  if (!total) return "";
  const daily = state.daily[row.id] || {};
  return `<section class="task-checklist" aria-label="Checklist for ${escapeAttr(row.assignment)}">
    <header><div><span class="eyebrow">Block checklist</span><h3>${total} ${total === 1 ? "step" : "steps"}</h3></div><strong>${completed}/${total} done</strong></header>
    <ul>${tasks.map((task) => {
      const checked = daily.status === "complete" || daily.completedTasks?.[task.id] === true;
      return `<li><button class="task-check ${checked ? "is-checked" : ""}" type="button" data-toggle-task="${escapeAttr(task.id)}" data-task-assignment="${escapeAttr(row.id)}" data-view-focus="task-${escapeAttr(row.id)}-${escapeAttr(task.id)}" aria-pressed="${checked}" aria-label="${checked ? "Reopen" : "Mark done"}: ${escapeAttr(task.label)}"><span class="task-check__box" aria-hidden="true">${checked ? "✓" : ""}</span><span><strong>${escapeHTML(task.label)}</strong>${task.meta !== modeLabel(row.mode) && task.meta !== "Practice + review" ? `<small>${escapeHTML(task.meta)}</small>` : ""}</span></button></li>`;
    }).join("")}</ul>
  </section>`;
}

export function bindTaskChecklist(container, context) {
  container.querySelectorAll("[data-toggle-task]").forEach((button) => {
    if (boundTasks.has(button)) return;
    boundTasks.add(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const row = context.data.index.scheduleByDate.get(button.dataset.taskAssignment);
      if (!row) return;
      const task = assignmentTasks(row).find((item) => item.id === button.dataset.toggleTask);
      if (!task) return;
      const current = context.state.daily[row.id] || {};
      const wasComplete = current.status === "complete" || current.completedTasks?.[task.id] === true;
      const previousRecord = context.state.daily[row.id] ? structuredClone(context.state.daily[row.id]) : null;
      const next = withDailyTask(context.state, row, task.id, !wasComplete);
      const origin = button.closest?.("dialog") ? "dialog" : button.closest?.(".today-action") ? "today" : "plan";
      if (context.updateState(next) === false) return;
      const feedback = !wasComplete ? context.celebrate?.({ row, previous: previousRecord, next: next.daily[row.id], taskId: task.id, origin }) : "";
      const savedAt = next.daily[row.id].updatedAt;
      context.showToast(feedback || `${wasComplete ? "Reopened" : "Completed"}: ${task.label}`, "success", {
        label: "Undo",
        onClick: () => {
          if (context.state.daily[row.id]?.updatedAt !== savedAt) {
            context.showToast("This day has changed since then. Open its record to edit it.", "error");
            return;
          }
          const daily = { ...context.state.daily };
          daily[row.id] = restoredDailyRecord(previousRecord, context.state.daily[row.id]);
          context.updateState({ ...context.state, daily }, { success: "Checklist change undone" });
        },
      });
    });
  });
}

export function progressBar(value, total, label) {
  const bounded = Math.max(0, Math.min(Number(total) || 0, Number(value) || 0));
  const pct = total ? Math.round((bounded / total) * 100) : 0;
  return `<div class="progress-block"><div class="progress-copy"><span>${escapeHTML(label)}</span><strong>${value}/${total}</strong></div><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${bounded}" aria-label="${escapeAttr(label)}"><span style="width:${pct}%"></span></div></div>`;
}

export function chapterDetails(chapters = []) {
  if (!chapters.length) return "";
  return chapters.map((chapter) => `
    <section class="chapter-detail" id="chapter-${escapeAttr(chapter.id)}">
      <div class="eyebrow">${escapeHTML(chapter.id)} · ${escapeHTML(chapter.subject)}</div>
      <h4>${escapeHTML(chapter.title)}</h4>
      ${chapter.subsections.length ? `<ol class="subsection-list">${chapter.subsections.map((item) => `<li><span>${escapeHTML(item.number)}</span>${escapeHTML(item.title)}</li>`).join("")}</ol>` : `<p class="muted">No subsections are listed for this chapter.</p>`}
    </section>`).join("");
}

export function modeDetails(data, modeString) {
  return getModeDetails(data, modeString).map((mode) => `
    <section class="mode-detail">
      <div class="eyebrow">Study mode</div>
      <h4>${escapeHTML(mode.name)}</h4>
      <p>${escapeHTML(mode.summary)}</p>
      ${mode.whenToUse ? `<dl class="detail-list"><div><dt>Use it when</dt><dd>${escapeHTML(mode.whenToUse)}</dd></div><div><dt>Required output</dt><dd>${escapeHTML(mode.requiredOutput)}</dd></div></dl>` : ""}
    </section>`).join("");
}

export function assignmentDetailHTML(row, data, state) {
  const daily = state.daily[row.id] || {};
  return `
    <div class="detail-stack">
      <section class="detail-hero detail-hero--${escapeAttr(row.dayType)}">
        <div class="eyebrow">${escapeHTML(formatDateLong(row.date))} · ${typeof row.week === "number" ? `Week ${row.week}` : "Placeholder window"}</div>
        <h3>${escapeHTML(row.assignment)}</h3>
        <div class="chip-row">
          <span class="chip">${escapeHTML(row.phase)}</span>
          <span class="chip chip--soft">${escapeHTML(row.estimatedWorkload.label)}</span>
        </div>
      </section>
      ${isStudyRow(row) ? `<div class="button-row">${completionButton(row, state, { focusPrefix: "detail-complete" })}<span class="status-badge status-badge--${escapeAttr(daily.status || "not-started")}">${escapeHTML(statusLabel(daily.status))}</span></div>` : ""}
      ${taskChecklist(row, state)}
      <form class="inline-editor" novalidate data-draft-form="day-${escapeAttr(row.id)}" data-day-form="${escapeAttr(row.id)}">
        <h4>Your record for this day</h4><p class="form-hint">Counts are optional. QBank questions exclude CARS passages and full-length exams. Leave blank if unrecorded. Unfinished edits are kept in this tab.</p>
        <p class="muted">Deferred keeps this day unfinished, with its original date. Resume it whenever you are ready.</p>
        <div class="form-grid form-grid--three">
          <label>Status<select name="status" data-detail-status data-assignment-id="${escapeAttr(row.id)}">
            ${["not-started", "in-progress", "complete", "deferred"].map((value) => `<option value="${value}" ${daily.status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}
          </select></label>
          <label>Recorded QBank questions<input name="actualQuestions" data-detail-questions data-assignment-id="${escapeAttr(row.id)}" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttr(daily.actualQuestions ?? "")}" placeholder="Planned: ${countPracticeQuestions(row.practiceTarget)}"></label>
          <label>Recorded CARS passages<input name="actualCars" data-detail-cars data-assignment-id="${escapeAttr(row.id)}" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttr(daily.actualCars ?? "")}" placeholder="Planned: ${row.carsPassages || 0}"></label>
        </div>
        <label>Notes<textarea name="notes" data-detail-notes data-assignment-id="${escapeAttr(row.id)}" rows="4" placeholder="What clicked? What needs repair?">${escapeHTML(daily.notes || "")}</textarea></label>
        <p class="form-error" data-day-error role="alert"></p><div class="button-row"><button class="button button--primary" type="submit" data-save-day="${escapeAttr(row.id)}">Save day</button><button class="button button--quiet" type="button" data-use-planned>Use planned amounts: ${countPracticeQuestions(row.practiceTarget)} questions, ${row.carsPassages || 0} CARS</button></div>
      </form>
      <details class="assignment-reference" data-view-key="reference-${escapeAttr(row.id)}"><summary>Assignment reference and study guidance</summary>
      <dl class="detail-list detail-list--grid">
        <div><dt>Resource</dt><dd>${escapeHTML(row.resource || "No resource required")}</dd></div>
        <div><dt>Mode</dt><dd>${escapeHTML(modeLabel(row.mode))}</dd></div>
        <div><dt>Practice</dt><dd>${escapeHTML(row.practiceTargetDisplay || "No practice quota")}</dd></div>
        <div><dt>CARS</dt><dd>${row.carsPassages || 0} passage${row.carsPassages === 1 ? "" : "s"}</dd></div>
        <div><dt>Milestone</dt><dd>${escapeHTML(row.weeklyMilestone)}</dd></div>
        <div><dt>Estimate</dt><dd>${escapeHTML(row.estimatedWorkload.label)} <span class="muted">(${escapeHTML(row.estimatedWorkload.basis)})</span></dd></div>
      </dl>
      ${row.sourceNotes ? `<aside class="assignment-guidance"><span class="eyebrow">Guardrails for this block</span><p>${escapeHTML(row.sourceNotes)}</p></aside>` : ""}
      ${chapterDetails(row.chapters)}
      ${modeDetails(data, row.mode)}
      </details>
      <nav class="context-links" aria-label="Related guide sections">
        ${row.relatedGuideSections.map((sectionId) => {
          const section = data.index.guideById.get(sectionId);
          return section ? `<a href="#guide/${escapeAttr(section.id)}">${escapeHTML(section.title)}</a>` : "";
        }).join("")}
      </nav>
    </div>`;
}

export function bindAssignmentDetail(scope, context) {
  bindTaskChecklist(scope, context);
  bindEditorDrafts(scope);
  scope.querySelectorAll("[data-day-form]").forEach((form) => {
    form.querySelector("[data-use-planned]")?.addEventListener("click", () => {
      const row = context.data.index.scheduleByDate.get(form.dataset.dayForm);
      for (const [name, amount] of [["actualQuestions", countPracticeQuestions(row.practiceTarget)], ["actualCars", row.carsPassages || 0]]) {
        const field = form.elements[name];
        if (field.value !== "") continue; // Never overwrite an explicit number, including zero.
        field.value = amount;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const error = form.querySelector("[data-day-error]");
      error.textContent = "";
      let actualQuestions, actualCars;
      try {
        actualQuestions = parseActualCount(form.elements.actualQuestions.value);
        actualCars = parseActualCount(form.elements.actualCars.value);
      } catch (problem) { error.textContent = problem.message; return; }
      if (!form.reportValidity()) return;
      const id = form.dataset.dayForm;
      const existing = context.state.daily[id] || {};
      const row = context.data.index.scheduleByDate.get(id);
      const status = form.elements.status.value;
      const completedTasks = ["complete", "not-started"].includes(status)
        ? Object.fromEntries(assignmentTasks(row).map((task) => [task.id, status === "complete"])) : existing.completedTasks;
      context.updateState({ ...context.state, daily: { ...context.state.daily, [id]: {
        ...withDailyStatus(context.state, id, status).daily[id],
        ...(completedTasks ? { completedTasks } : {}), actualQuestions, actualCars, notes: form.elements.notes.value,
      } } }, { success: "Day saved", onSaved: () => { clearEditorDraft(`day-${id}`); if (typeof scope.close === "function") scope.close(); } });
    });
  });
}

export function emptyState(title, body, action = "") {
  return `<section class="empty-state"><div class="empty-icon" aria-hidden="true">◎</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p>${action}</section>`;
}
