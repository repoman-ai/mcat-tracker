import assert from "node:assert/strict";
import { test } from "node:test";
import { createStateUpdater } from "../js/state-actions.js";
import { createToastController } from "../js/toast.js";
import { captureViewState } from "../js/view-state.js";
import { bindExams } from "../js/views/exams.js";

test("failed local saves preserve state and forms without success, cleanup, render or sync", () => {
  const events = [];
  const update = createStateUpdater({
    save() { throw new Error("Quota exceeded"); },
    apply() { events.push("apply"); }, render() { events.push("render"); }, sync() { events.push("sync"); },
    showToast: (...args) => events.push(args),
  });
  assert.equal(update({ value: "edited" }, { success: "Saved", onSaved: () => events.push("close form") }), false);
  assert.deepEqual(events, [["Could not save locally: Quota exceeded", "error"]]);
});

test("successful local saves apply normalized state and UI cleanup before rendering", () => {
  const events = [];
  const update = createStateUpdater({
    save: (next) => { events.push("persist"); return { ...next, normalized: true }; },
    apply: (saved) => { assert.equal(saved.normalized, true); events.push("apply"); },
    render: () => events.push("render"), sync: () => events.push("sync"), showToast: (message) => events.push(message),
  });
  assert.equal(update({}, { success: "Saved", onSaved: () => events.push("clear editor") }), true);
  assert.deepEqual(events, ["persist", "apply", "clear editor", "render", "Saved", "sync"]);
});

test("drafts avoid rerenders; cloud failure cannot masquerade as a failed local save", () => {
  let applied = false;
  const messages = [];
  const update = createStateUpdater({
    save: (next, options) => { assert.equal(options.notify, false); return next; },
    apply: () => { applied = true; }, render: () => assert.fail("draft rerendered"),
    sync: () => { throw new Error("offline"); }, showToast: (message) => messages.push(message),
  });
  assert.equal(update({}, { notify: false }), true);
  assert.equal(applied, true);
  assert.match(messages[0], /^Saved locally/);
});

test("exam-save bindings use guarded feedback and leave the form intact on storage failure", () => {
  const OriginalFormData = globalThis.FormData;
  globalThis.FormData = class { constructor(form) { this.form = form; } *[Symbol.iterator]() { yield* Object.entries(this.form.values); } };
  let submit;
  const form = { dataset: { examForm: "exam-01" }, values: { total: "510", notes: "keep draft" }, elements: { completed: { checked: true }, unfinishedSection: { checked: false } }, querySelectorAll: () => [], addEventListener: (_, callback) => { submit = callback; } };
  const container = { querySelector: () => null, querySelectorAll: (selector) => selector === "[data-exam-form]" ? [form] : [] };
  const messages = [];
  const context = { state: { exams: {} }, showToast: (...args) => messages.push(args) };
  context.updateState = createStateUpdater({ save() { throw new Error("Quota exceeded"); }, apply() { assert.fail("unsaved state applied"); }, render() { assert.fail("form replaced"); }, sync() { assert.fail("unsaved record synced"); }, showToast: context.showToast });
  try {
    bindExams(container, context);
    submit({ preventDefault() {}, currentTarget: form });
    assert.deepEqual(context.state.exams, {});
    assert.equal(form.values.notes, "keep draft");
    assert.equal(messages.length, 1);
    assert.equal(messages[0][1], "error");
  } finally { globalThis.FormData = OriginalFormData; }
});

test("Undo shortcut is one-shot, expires, and never intercepts native text undo", () => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let timeout;
  let keydown;
  let button;
  let hovered = false;
  let visible = false;
  let undone = 0;
  globalThis.setTimeout = (fn) => { timeout = fn; return 1; };
  globalThis.clearTimeout = () => {};
  const document = {
    addEventListener: (_, fn) => { keydown = fn; },
    createElement: () => { button = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(_, fn) { this.click = fn; } }; return button; },
  };
  const toast = { dataset: {}, matches: () => hovered, classList: { add() { visible = true; }, remove() { visible = false; } }, append() {} };
  const event = (editable = false, overrides = {}) => ({ key: "z", metaKey: true, target: { closest: () => editable }, preventDefault() { this.prevented = true; }, ...overrides });
  try {
    const show = createToastController(toast, document);
    show("Completed", "success", { label: "Undo", onClick: () => { undone += 1; } });
    assert.match(button.textContent, /Ctrl\/⌘Z/);
    assert.equal(button.attributes["aria-keyshortcuts"], "Control+Z Meta+Z");
    const typing = event(true); keydown(typing);
    assert.equal(typing.prevented, undefined);
    assert.equal(undone, 0);
    const redo = event(false, { shiftKey: true }); keydown(redo);
    assert.equal(undone, 0);
    const undo = event(); keydown(undo); keydown(event());
    assert.equal(undo.prevented, true);
    assert.equal(undone, 1);
    show("Completed again", "success", { label: "Undo", onClick: () => { undone += 1; } });
    hovered = true; timeout(); assert.equal(visible, true);
    hovered = false; timeout(); assert.equal(visible, false); assert.equal(toast.inert, true);
    keydown(event()); assert.equal(undone, 1);
    show("Saved"); keydown(event()); assert.equal(undone, 1); assert.equal(toast.inert, false);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test("view restoration preserves closed details, internal scroll and nearby Plan position", () => {
  const window = { scrollX: 0, scrollY: 1000, scrollTo({ left, top }) { this.scrollX = left; this.scrollY = top; } };
  const makeControl = (id, position) => ({ dataset: { viewFocus: id }, position, closest: () => null, getBoundingClientRect() { return { top: this.position - window.scrollY }; }, focus() { this.focused = true; } });
  const a = makeControl("a", 1200); const b = makeControl("b", 1300);
  let controls = [a, b];
  let details = [{ id: "week-1", open: false }, { id: "week-2", open: true }];
  let scrolls = [{ dataset: { viewScroll: "catchup" }, scrollTop: 152 }];
  const root = { ownerDocument: { activeElement: a }, querySelectorAll: (selector) => selector === "details" ? details : selector === "[data-view-scroll]" ? scrolls : controls };
  const restore = captureViewState(root, window);
  controls = [makeControl("b", 1200)]; // Checking a removed it and shortened the page.
  details = [{ id: "week-1", open: true }, { id: "week-2", open: false }];
  scrolls = [{ dataset: { viewScroll: "catchup" }, scrollTop: 0 }];
  restore();
  assert.deepEqual(details.map((item) => item.open), [false, true]);
  assert.equal(scrolls[0].scrollTop, 152);
  assert.equal(controls[0].focused, true);
  assert.equal(controls[0].getBoundingClientRect().top, 300);
});
