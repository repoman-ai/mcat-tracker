/** Daily records sync last-write-wins per day, including completion and undo. */
export function withDailyStatus(state, id, status) {
  const record = { ...state.daily[id] };
  if (status === "deferred" && record.status !== "deferred") {
    record.statusBeforeDeferred = record.status || "not-started";
  } else if (status !== "deferred") {
    delete record.statusBeforeDeferred;
  }
  return {
    ...state,
    daily: {
      ...state.daily,
      [id]: { ...record, status, updatedAt: new Date().toISOString() },
    },
  };
}

/** Old deferred records lack a prior status: infer only from recorded work. */
export function resumedStatus(record = {}) {
  if (["not-started", "in-progress", "complete"].includes(record.statusBeforeDeferred)) return record.statusBeforeDeferred;
  return Object.values(record.completedTasks || {}).some((done) => done === true) ? "in-progress" : "not-started";
}

function taskVerb(mode = "") {
  const normalized = mode.toLowerCase();
  if (normalized.includes("full read")) return "Read";
  if (normalized.includes("rapid review")) return "Review";
  if (normalized.includes("questions first")) return "Work through";
  if (normalized.includes("retrieval")) return "Retrieve";
  if (normalized.includes("review")) return "Review";
  return "Study";
}

/** Build stable, human-sized steps from one generated schedule row. */
export function assignmentTasks(row) {
  if (!row || row.isRest || row.isTestWindow) return [];
  const modes = String(row.mode || "").split(";").map((item) => item.trim()).filter(Boolean);
  const tasks = (row.chapters || []).map((chapter, index) => ({
    id: `chapter:${chapter.id}`,
    label: `${taskVerb(modes[index] || modes[0])} ${chapter.id} · ${chapter.title}`,
    meta: modes[index] || modes[0] || row.resource || "Content block",
  }));

  if (!tasks.length && row.assignment) {
    if (/^full-length review: incorrect, flagged, and guessed-correct$/i.test(row.assignment)) {
      tasks.push(
        { id: "review:incorrect", label: "Review incorrect questions", meta: modes[0] || "Evidence-driven review" },
        { id: "review:flagged", label: "Review flagged questions", meta: modes[0] || "Evidence-driven review" },
        { id: "review:guessed-correct", label: "Review guessed-correct questions", meta: modes[0] || "Evidence-driven review" },
      );
    } else {
      const parts = row.assignment.split(/\s+\+\s+|;\s+/).map((label, index) => ({ label: label.trim(), index })).filter(({ label }) => label);
      const actionable = parts.filter(({ label }) => {
        if (/^stop (?:broad studying|early)$/i.test(label)) return false;
        if (/section bank$/i.test(label) && /section bank/i.test(row.practiceTarget || "")) return false;
        if (/^light cars$/i.test(label) && /cars passage/i.test(row.practiceTarget || "")) return false;
        return true;
      });
      (actionable.length ? actionable : parts.slice(0, 1)).forEach(({ label, index }) => tasks.push({
        id: `assignment:${index}`,
        label: label[0].toUpperCase() + label.slice(1),
        meta: modes[0] || row.resource || "Planned block",
      }));
    }
  }

  String(row.practiceTarget || "").split(";").map((item) => item.trim()).filter(Boolean).forEach((target, index) => {
    // An exam is already represented by the assignment itself; its descriptive
    // target and explicit "no quota" notes are not extra pieces of work.
    if (/^no\b/i.test(target) || (row.isExam && /full[- ]length exam/i.test(target))) return;
    tasks.push({ id: `practice:${index}`, label: `Complete ${target}`, meta: "Practice + review" });
  });
  return tasks;
}

export function taskProgress(row, state) {
  const tasks = assignmentTasks(row);
  const daily = state.daily[row.id] || {};
  const completed = tasks.filter((task) => daily.status === "complete" || daily.completedTasks?.[task.id] === true).length;
  return { tasks, completed, total: tasks.length };
}

export function withDailyTask(state, row, taskId, complete) {
  const existing = state.daily[row.id] || {};
  const tasks = assignmentTasks(row);
  const completedTasks = Object.fromEntries(tasks.map((task) => [
    task.id,
    task.id === taskId ? complete : existing.status === "complete" || existing.completedTasks?.[task.id] === true,
  ]));
  const completed = tasks.filter((task) => completedTasks[task.id]).length;
  const status = tasks.length && completed === tasks.length
    ? "complete"
    : completed > 0 || existing.status === "in-progress"
      ? "in-progress"
      : existing.status === "deferred" ? "deferred" : "not-started";
  return {
    ...state,
    daily: {
      ...state.daily,
      [row.id]: { ...existing, status, completedTasks, updatedAt: new Date().toISOString() },
    },
  };
}

export function withDailyCompletion(state, row, complete) {
  const existing = state.daily[row.id] || {};
  const completedTasks = Object.fromEntries(assignmentTasks(row).map((task) => [task.id, complete]));
  return {
    ...state,
    daily: {
      ...state.daily,
      [row.id]: {
        ...existing,
        status: complete ? "complete" : "not-started",
        completedTasks,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}
