import { getModeDetails, modeLabel } from "../data.js";
import { withDailyStatus } from "../daily.js";
import { escapeAttr, escapeHTML, formatDateLong, countPracticeQuestions } from "../utils.js";

export function statusLabel(status = "not-started") {
  return {
    "not-started": "Not started",
    "in-progress": "In progress",
    complete: "Complete",
    deferred: "Deferred",
  }[status] || "Not started";
}

export function completionButton(row, state, { compact = false } = {}) {
  const complete = state.daily[row.id]?.status === "complete";
  const label = `${row.historical ? "Completed — saved history (read-only):" : complete ? "Completed — reopen" : "Mark complete:"} ${formatDateLong(row.date)} — ${row.assignment}`;
  return `<button class="completion-check ${complete ? "is-checked" : ""} ${compact ? "completion-check--compact" : ""}" type="button" ${row.historical ? "disabled" : `data-toggle-complete="${escapeAttr(row.id)}" data-view-focus="complete-${escapeAttr(row.id)}"`} aria-pressed="${complete}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"><span class="completion-check__box" aria-hidden="true">${complete ? "✓" : ""}</span><span>${complete ? "Completed" : "Mark complete"}</span></button>`;
}

export function bindCompletionButtons(container, context) {
  container.querySelectorAll("[data-toggle-complete]").forEach((button) => {
    button.addEventListener("click", (event) => {
      // Plan checkboxes sit in the day summary; checking must not toggle details.
      event.preventDefault();
      const id = button.dataset.toggleComplete;
      const previous = context.state.daily[id]?.status || "not-started";
      const status = previous === "complete" ? "not-started" : "complete";
      const next = withDailyStatus(context.state, id, status);
      // Don't report success (or offer undo) when local storage rejected the write.
      if (context.updateState(next) === false) return;
      const savedAt = next.daily[id].updatedAt;
      context.showToast(`${formatDateLong(id)} ${status === "complete" ? "completed" : "reopened"}`, "success", {
        label: "Undo",
        onClick: () => {
          // An undo must not overwrite a newer edit arriving from another device.
          const current = context.state.daily[id];
          if (current?.status !== status || current?.updatedAt !== savedAt) {
            context.showToast("This day has changed since then. Open its record to edit it.", "error");
            return;
          }
          context.updateState(withDailyStatus(context.state, id, previous), { success: "Completion change undone" });
        },
      });
    });
  });
}

export function progressBar(value, total, label) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return `<div class="progress-block"><div class="progress-copy"><span>${escapeHTML(label)}</span><strong>${value}/${total}</strong></div><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${value}" aria-label="${escapeAttr(label)}"><span style="width:${pct}%"></span></div></div>`;
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
      <dl class="detail-list detail-list--grid">
        <div><dt>Resource</dt><dd>${escapeHTML(row.resource || "No resource required")}</dd></div>
        <div><dt>Mode</dt><dd>${escapeHTML(modeLabel(row.mode))}</dd></div>
        <div><dt>Practice</dt><dd>${escapeHTML(row.practiceTargetDisplay || "No practice quota")}</dd></div>
        <div><dt>CARS</dt><dd>${row.carsPassages || 0} passage${row.carsPassages === 1 ? "" : "s"}</dd></div>
        <div><dt>Milestone</dt><dd>${escapeHTML(row.weeklyMilestone)}</dd></div>
        <div><dt>Estimate</dt><dd>${escapeHTML(row.estimatedWorkload.label)} <span class="muted">(${escapeHTML(row.estimatedWorkload.basis)})</span></dd></div>
      </dl>
      ${chapterDetails(row.chapters)}
      ${modeDetails(data, row.mode)}
      <section class="inline-editor">
        <h4>Your record for this day</h4>
        <div class="form-grid form-grid--three">
          <label>Status<select data-detail-status data-assignment-id="${escapeAttr(row.id)}">
            ${["not-started", "in-progress", "complete", "deferred"].map((value) => `<option value="${value}" ${daily.status === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}
          </select></label>
          <label>Actual questions<input data-detail-questions data-assignment-id="${escapeAttr(row.id)}" type="number" min="0" inputmode="numeric" value="${escapeAttr(daily.actualQuestions ?? "")}" placeholder="Planned: ${countPracticeQuestions(row.practiceTarget)}"></label>
          <label>Actual CARS passages<input data-detail-cars data-assignment-id="${escapeAttr(row.id)}" type="number" min="0" inputmode="numeric" value="${escapeAttr(daily.actualCars ?? "")}" placeholder="Planned: ${row.carsPassages || 0}"></label>
        </div>
        <label>Notes<textarea data-detail-notes data-assignment-id="${escapeAttr(row.id)}" rows="4" placeholder="What clicked? What needs repair?">${escapeHTML(daily.notes || "")}</textarea></label>
        <button class="button button--primary" type="button" data-save-day="${escapeAttr(row.id)}">Save day</button>
      </section>
      <nav class="context-links" aria-label="Related guide sections">
        ${row.relatedGuideSections.map((sectionId) => {
          const section = data.index.guideById.get(sectionId);
          return section ? `<a href="#guide/${escapeAttr(section.id)}">${escapeHTML(section.title)}</a>` : "";
        }).join("")}
      </nav>
    </div>`;
}

export function bindAssignmentDetail(dialog, context) {
  dialog.querySelector("[data-save-day]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.saveDay;
    const existing = context.state.daily[id] || {};
    context.updateState({
      ...context.state,
      daily: {
        ...context.state.daily,
        [id]: {
          ...existing,
          status: dialog.querySelector(`[data-detail-status][data-assignment-id="${CSS.escape(id)}"]`)?.value || "not-started",
          actualQuestions: Number(dialog.querySelector(`[data-detail-questions][data-assignment-id="${CSS.escape(id)}"]`)?.value || 0),
          actualCars: Number(dialog.querySelector(`[data-detail-cars][data-assignment-id="${CSS.escape(id)}"]`)?.value || 0),
          notes: dialog.querySelector(`[data-detail-notes][data-assignment-id="${CSS.escape(id)}"]`)?.value || "",
          updatedAt: new Date().toISOString(),
        },
      },
    }, { success: "Day saved", onSaved: () => { if (typeof dialog.close === "function") dialog.close(); } });
  });
}

export function emptyState(title, body, action = "") {
  return `<section class="empty-state"><div class="empty-icon" aria-hidden="true">◎</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p>${action}</section>`;
}
