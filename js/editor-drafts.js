// Tab-local editor recovery, separate from committed/synced study records.
const KEY = "mcatMomentum.editorDrafts.v1";
let drafts;
const bound = new WeakSet();
function records() {
  if (!drafts) {
    try { drafts = JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { drafts = {}; }
    if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) drafts = {};
  }
  return drafts;
}
function record(key) {
  const saved = records()[key];
  if (saved?.version === 2 && saved.values && saved.bases) return saved;
  // Preserve old drafts, but their unknown baselines need an explicit decision.
  return { version: 2, values: saved || {}, bases: {} };
}
function persist() { try { sessionStorage.setItem(KEY, JSON.stringify(records())); } catch { /* In-memory recovery remains available. */ } }
export function clearEditorDraft(key) { delete records()[key]; persist(); }
export function clearEditorDrafts() { drafts = {}; persist(); }

export function draftConflicts(draft, baseline) {
  return Object.keys(draft.values).filter((name) => baseline.has(name)
    && draft.values[name] !== baseline.get(name)
    && (!Object.hasOwn(draft.bases, name) || draft.bases[name] !== baseline.get(name)));
}

export function bindEditorDrafts(root) {
  root.querySelectorAll("[data-draft-form]").forEach((form) => {
    if (bound.has(form)) return;
    bound.add(form);
    const key = form.dataset.draftForm;
    const read = (field) => field.type === "checkbox" ? field.checked : field.value;
    const write = (field, value) => { if (field.type === "checkbox") field.checked = value === true; else field.value = value; };
    const fields = [...form.querySelectorAll("input[name], select[name], textarea[name]")];
    const baseline = new Map(fields.map((field) => [field.name, read(field)]));
    const saved = record(key);
    fields.forEach((field) => {
      field.dataset.viewFocus ||= `${key}:${field.name}`;
      if (Object.hasOwn(saved.values, field.name)) write(field, saved.values[field.name]);
    });
    let notice;
    const store = (draft) => {
      if (Object.keys(draft.values).length) records()[key] = draft;
      else delete records()[key];
      persist();
    };
    const renderNotice = () => {
      notice?.remove(); notice = null;
      const draft = record(key);
      const conflicts = draftConflicts(draft, baseline);
      if (!conflicts.length || !form.ownerDocument) return;
      const doc = form.ownerDocument;
      notice = doc.createElement("section");
      notice.className = "draft-conflict notice-card";
      notice.tabIndex = -1;
      const heading = doc.createElement("strong");
      heading.textContent = "Saved values differ from your unsaved edits";
      const explanation = doc.createElement("p");
      explanation.textContent = "Your local edits are shown below. Compare these fields and choose which values to use before saving.";
      const list = doc.createElement("dl");
      for (const name of conflicts) {
        const field = fields.find((item) => item.name === name);
        const label = doc.createElement("dt");
        label.textContent = field.labels?.[0]?.firstChild?.textContent.trim() || name;
        const value = doc.createElement("dd");
        const display = (value) => value === "" ? "(blank)" : String(value);
        value.textContent = `Saved: ${display(baseline.get(name))} · Your edit: ${display(draft.values[name])}`;
        list.append(label, value);
      }
      const actions = doc.createElement("div"); actions.className = "button-row";
      for (const [label, useSaved] of [["Use saved values", true], ["Keep my edits", false]]) {
        const button = doc.createElement("button");
        button.type = "button"; button.className = "button button--small"; button.textContent = label;
        button.addEventListener("click", () => {
          const next = record(key);
          for (const name of conflicts) {
            if (useSaved) { write(fields.find((field) => field.name === name), baseline.get(name)); delete next.values[name]; delete next.bases[name]; }
            else next.bases[name] = baseline.get(name);
          }
          store(next); renderNotice();
          fields.find((field) => field.name === conflicts[0])?.focus();
          form.dispatchEvent(new Event("draft-resolved", { bubbles: true }));
        });
        actions.append(button);
      }
      notice.append(heading, explanation, list, actions); form.prepend(notice);
    };
    const capture = (event) => {
      const field = event.target;
      if (!fields.includes(field)) return;
      const next = record(key);
      if (read(field) === baseline.get(field.name)) { delete next.values[field.name]; delete next.bases[field.name]; }
      else {
        if (!Object.hasOwn(next.values, field.name)) next.bases[field.name] = baseline.get(field.name);
        next.values[field.name] = read(field);
      }
      store(next); renderNotice();
    };
    form.addEventListener("input", capture);
    form.addEventListener("change", capture);
    // Capture phase precedes the view's save handler, even when bound afterward.
    form.addEventListener("submit", (event) => {
      if (!draftConflicts(record(key), baseline).length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      renderNotice(); notice?.focus(); notice?.scrollIntoView({ block: "nearest" });
    }, true);
    renderNotice();
  });
}
