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
function persist() { try { sessionStorage.setItem(KEY, JSON.stringify(records())); } catch { /* In-memory recovery remains available. */ } }
export function clearEditorDraft(key) { delete records()[key]; persist(); }
export function clearEditorDrafts() { drafts = {}; persist(); }
export function bindEditorDrafts(root) {
  root.querySelectorAll("[data-draft-form]").forEach((form) => {
    if (bound.has(form)) return;
    bound.add(form);
    const key = form.dataset.draftForm;
    const read = (field) => field.type === "checkbox" ? field.checked : field.value;
    const fields = [...form.querySelectorAll("input[name], select[name], textarea[name]")];
    const baseline = new Map(fields.map((field) => [field.name, read(field)]));
    fields.forEach((field) => {
      field.dataset.viewFocus ||= `${key}:${field.name}`;
      if (Object.hasOwn(records()[key] || {}, field.name)) {
        if (field.type === "checkbox") field.checked = records()[key][field.name] === true;
        else field.value = records()[key][field.name];
      }
    });
    const capture = (event) => {
      const field = event.target;
      if (!fields.includes(field)) return;
      const next = { ...records()[key] };
      if (read(field) === baseline.get(field.name)) delete next[field.name];
      else next[field.name] = read(field);
      if (Object.keys(next).length) records()[key] = next;
      else delete records()[key];
      persist();
    };
    form.addEventListener("input", capture);
    form.addEventListener("change", capture);
  });
}
