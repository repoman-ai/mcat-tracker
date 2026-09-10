import assert from "node:assert/strict";
import { test } from "node:test";
import { dominantAxis, enablePullToRefresh, enableSheetDismiss, enableSwipeComplete, enableViewPager, pageSwipeTarget, resist, swipeOutcome } from "../js/gestures.js";

test("a drag only claims an axis once one clearly wins, so diagonals keep scrolling", () => {
  assert.equal(dominantAxis(3, 4), "", "a tap-sized wobble claims nothing");
  assert.equal(dominantAxis(40, 12), "x");
  assert.equal(dominantAxis(-40, 12), "x", "direction is the caller's business, not the axis test's");
  assert.equal(dominantAxis(12, 40), "y");
  assert.equal(dominantAxis(30, 28), "", "a diagonal stays unclaimed rather than guessing");
});

test("a swipe commits on distance or on speed, and never on a backwards drag", () => {
  assert.equal(swipeOutcome({ distance: 120, elapsed: 400, limit: 100 }), "commit");
  assert.equal(swipeOutcome({ distance: 60, elapsed: 900, limit: 100 }), "cancel", "a slow short drag springs back");
  assert.equal(swipeOutcome({ distance: 60, elapsed: 100, limit: 100 }), "commit", "a fast flick still counts");
  assert.equal(swipeOutcome({ distance: 0, elapsed: 50, limit: 100 }), "cancel");
  assert.equal(swipeOutcome({ distance: -80, elapsed: 200, limit: 100 }), "cancel");
});

test("resistance tracks the finger, then eases toward a ceiling it never crosses", () => {
  assert.equal(resist(0, { max: 100 }), 0);
  assert.equal(resist(40, { linear: 60, max: 120 }), 40, "inside the linear run it is 1:1");
  assert.ok(resist(200, { max: 100 }) < 100);
  assert.ok(resist(5000, { max: 100 }) < 100, "the ceiling holds no matter how far the drag goes");
  assert.ok(resist(300, { max: 100 }) > resist(150, { max: 100 }), "further still reads as further");
});

test("the Today pager stops at both ends instead of wrapping around", () => {
  assert.equal(pageSwipeTarget("", "left"), "completed");
  assert.equal(pageSwipeTarget("completed", "right"), "");
  assert.equal(pageSwipeTarget("", "right"), null, "there is nothing before Today");
  assert.equal(pageSwipeTarget("completed", "left"), null, "there is nothing after Completed");
  assert.equal(pageSwipeTarget("2026-09-20", "left"), "completed", "an unknown detail is treated as Today");
});

const finePointer = { matchMedia: () => ({ matches: false }) };

test("gestures stay off entirely on a precise pointer, leaving the desktop untouched", () => {
  const target = { addEventListener: () => assert.fail("bound a touch listener on a mouse device") };
  for (const bind of [enablePullToRefresh, enableSheetDismiss, enableSwipeComplete, enableViewPager]) {
    assert.equal(typeof bind(target, { view: finePointer, onSwipe: () => {} }), "function");
  }
});

/* ---- The shared modal sheet ---- */

function fakeDialog() {
  const listeners = new Map();
  const el = {
    open: false,
    listeners,
    nodes: { "#dialog-title": { textContent: "" }, "[data-dialog-body]": { innerHTML: "" }, "[data-dialog-close]": null },
    querySelector: (selector) => (selector in el.nodes ? el.nodes[selector] : null),
    querySelectorAll: () => [],
    addEventListener: (type, handler) => listeners.set(type, [...(listeners.get(type) || []), handler]),
    showModal() { el.open = true; },
    // close() only queues the event; the DOM dispatches it on a later task.
    close() { el.open = false; el.queued = true; },
    deliverClose() { if (!el.queued) return; el.queued = false; for (const fn of listeners.get("close") || []) fn(); },
  };
  return el;
}

test("a queued close event cannot blank a sheet that was already reopened", async () => {
  const { createDialogController } = await import("../js/dialog.js");
  const dialog = fakeDialog();
  const opener = { isConnected: true, focused: 0, focus() { this.focused++; } };
  const controller = createDialogController(dialog, { document: { activeElement: opener }, view: {} });

  controller.open({ title: "Mistake entry", body: "<p>first</p>" });
  controller.open({ title: "Record retest", body: "<p>second</p>" });
  // Even an already queued native event cannot clear the replacement.
  dialog.queued = true;
  dialog.deliverClose();

  assert.equal(dialog.nodes["[data-dialog-body]"].innerHTML, "<p>second</p>", "the live sheet was blanked by the outgoing one");
  assert.equal(dialog.nodes["#dialog-title"].textContent, "Record retest");
  assert.equal(opener.focused, 0, "focus was yanked back while a sheet was still open");

  // Closing for real still clears the sheet and returns focus to its opener.
  controller.close();
  dialog.deliverClose();
  assert.equal(dialog.nodes["[data-dialog-body]"].innerHTML, "");
  assert.equal(opener.focused, 1, "focus should return to the control that opened the first sheet");
});

test("closing a sheet whose opener is gone leaves focus alone instead of throwing", async () => {
  const { createDialogController } = await import("../js/dialog.js");
  const dialog = fakeDialog();
  const opener = { isConnected: false, focus() { assert.fail("focused a detached element"); } };
  const controller = createDialogController(dialog, { document: { activeElement: opener }, view: {} });
  controller.open({ title: "Assignment details", body: "<p>x</p>" });
  controller.close();
  dialog.deliverClose();
  assert.equal(dialog.nodes["[data-dialog-body]"].innerHTML, "");
});

function target() {
  const listeners = new Map();
  const classes = new Set();
  const styles = new Map();
  return {
    listeners, classes, styles, parentElement: null, scrollTop: 0,
    scrollWidth: 300, clientWidth: 300, scrollHeight: 500, clientHeight: 500,
    offsetWidth: 300, offsetHeight: 500, open: true,
    style: { transform: "", setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) },
    classList: { add: (key) => classes.add(key), remove: (...keys) => keys.forEach(key => classes.delete(key)), toggle(key, value) { value ? classes.add(key) : classes.delete(key); } },
    addEventListener(type, fn, options) {
      const entries = listeners.get(type) || new Map();
      entries.set(fn, options); listeners.set(type, entries);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    async emit(type, props = {}) {
      const event = { target: this, touches: [{ clientX: 100, clientY: 100 }], timeStamp: 0, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
      for (const fn of [...(listeners.get(type)?.keys() || [])]) await fn(event);
      return event;
    },
    contains(node) { for (; node; node = node.parentElement) if (node === this) return true; return false; },
    closest(selector) { return this.selectors?.includes(selector) ? this : this.parentElement?.closest(selector); },
    querySelector() { return null; },
    count(type) { return listeners.get(type)?.size || 0; },
  };
}

function fixture() {
  const view = Object.assign(target(), { innerWidth: 375, scrollY: 0, matchMedia(query) { return { matches: query !== "(max-width: 559px)" || this.innerWidth < 560 }; }, getComputedStyle: node => node.overflow || {} });
  const container = target();
  container.ownerDocument = { documentElement: { dataset: {} }, defaultView: view };
  const row = Object.assign(target(), { selectors: ["[data-swipe-complete]"], parentElement: container });
  const action = Object.assign(target(), { parentElement: row, clicks: 0, disabled: false, getAttribute() { return this.pressed || "false"; }, click() { this.clicks++; } });
  row.querySelector = () => action;
  return { view, container, row, action };
}
const point = (x, y) => [{ clientX: x, clientY: y }];
async function swipe(el, node, { dx = 130, dy = 0, elapsed = 500 } = {}) {
  await el.emit("touchstart", { target: node });
  const move = await el.emit("touchmove", { target: node, touches: point(100 + dx, 100 + dy), timeStamp: elapsed / 2 });
  const end = await el.emit("touchend", { target: node, touches: [], timeStamp: elapsed });
  return { move, end };
}

test("row completion cancels only the dragged touch's click, with no timer or sticky click flag", async () => {
  const { container, row, action, view } = fixture();
  const off = enableSwipeComplete(container, { view });
  assert.equal(container.count("touchmove"), 0);
  const events = await swipe(container, row);
  assert.ok(events.move.defaultPrevented && events.end.defaultPrevented);
  assert.equal(action.clicks, 1);
  assert.equal(container.count("click"), 0);
  assert.equal(container.count("touchmove"), 0);
  const tap = await swipe(container, row, { dx: 3 });
  assert.equal(tap.end.defaultPrevented, false);
  action.click();
  assert.equal(action.clicks, 2, "a later ordinary click is untouched");
  off(); off();
  assert.ok([...container.listeners.values()].every(entries => entries.size === 0));
});

test("short, leftward, vertical, diagonal, cancelled, and detached row drags never complete", async () => {
  const { container, row, action, view } = fixture();
  enableSwipeComplete(container, { view });
  for (const options of [{ dx: 20 }, { dx: -150 }, { dx: 0, dy: 150 }, { dx: 100, dy: 100 }, { dx: 12, elapsed: 10 }]) await swipe(container, row, options);
  await container.emit("touchstart", { target: row });
  await container.emit("touchmove", { target: row, touches: point(230, 100) });
  await container.emit("touchcancel");
  assert.equal(row.styles.size, 0);
  await container.emit("touchend", { touches: [] });
  await container.emit("touchstart", { target: row });
  await container.emit("touchmove", { target: row, touches: point(230, 100) });
  row.parentElement = null;
  await container.emit("touchend", { touches: [] });
  assert.equal(action.clicks, 0);
});

test("cleanup and a second finger abort an active row drag, and completed buttons cannot reopen", async () => {
  const { container, row, action, view } = fixture();
  const off = enableSwipeComplete(container, { view });
  await container.emit("touchstart", { target: row });
  await container.emit("touchmove", { target: row, touches: point(230, 100) });
  await container.emit("touchstart", { target: row, touches: [...point(230, 100), ...point(150, 100)] });
  assert.equal(row.styles.size, 0);
  await container.emit("touchend", { touches: point(230, 100) });
  assert.equal(action.clicks, 0);
  await container.emit("touchstart", { target: row });
  await container.emit("touchmove", { target: row, touches: point(230, 100) });
  off();
  await container.emit("touchend", { touches: [] });
  assert.equal(action.clicks, 0);
  assert.equal(row.styles.size, 0);
  enableSwipeComplete(container, { view });
  action.pressed = "true";
  await swipe(container, row);
  assert.equal(action.clicks, 0);
});

test("native scrolling wins once touchmove is no longer cancelable", async () => {
  const { container, row, action, view } = fixture();
  enableSwipeComplete(container, { view });
  await container.emit("touchstart", { target: row });
  await container.emit("touchmove", { target: row, touches: point(250, 100), cancelable: false });
  await container.emit("touchend", { touches: [] });
  assert.equal(action.clicks, 0);
  assert.equal(container.count("touchmove"), 0);
});

test("sheet drags preserve body scrolling and nested controls, but the sticky header always works", async () => {
  const { container: dialog, view } = fixture();
  let closes = 0;
  const body = Object.assign(target(), { parentElement: dialog, selectors: ["[data-dialog-body]"] });
  const header = Object.assign(target(), { parentElement: dialog, selectors: [".dialog-shell > header"] });
  const off = enableSheetDismiss(dialog, { view, onDismiss: () => closes++ });
  dialog.scrollTop = 80;
  await swipe(dialog, body, { dx: 0, dy: 180 });
  assert.equal(closes, 0);
  await swipe(dialog, header, { dx: 0, dy: 180 });
  assert.equal(closes, 1);
  dialog.scrollTop = 0;
  await swipe(dialog, body, { dx: 0, dy: 180 });
  assert.equal(closes, 2);
  const nested = Object.assign(target(), { parentElement: body, scrollHeight: 800, overflow: { overflowY: "auto" } });
  await swipe(dialog, nested, { dx: 0, dy: 180 });
  assert.equal(closes, 2);
  await dialog.emit("touchstart", { target: body });
  await dialog.emit("touchmove", { target: body, touches: point(100, 180) });
  off();
  assert.equal(dialog.style.transform, "");
  assert.equal(dialog.count("touchmove"), 0);
});

test("refresh arms at the visible threshold, survives rebind while busy, and cleans up on route exit", async () => {
  const { container, view } = fixture();
  const indicator = target();
  let resolve, refreshCount = 0;
  const onRefresh = () => { refreshCount++; return new Promise(done => { resolve = done; }); };
  let off = enablePullToRefresh(container, { view, indicator, onRefresh });
  await swipe(container, container, { dx: 0, dy: 60 });
  assert.equal(refreshCount, 0);
  await container.emit("touchstart");
  await container.emit("touchmove", { touches: point(100, 168) });
  assert.ok(indicator.classes.has("is-armed"));
  const end = container.emit("touchend", { touches: [] });
  assert.equal(refreshCount, 1);
  off();
  off = enablePullToRefresh(container, { view, indicator, onRefresh });
  assert.ok(indicator.classes.has("is-busy"));
  await swipe(container, container, { dx: 0, dy: 100 });
  assert.equal(refreshCount, 1);
  resolve(); await end;
  assert.equal(indicator.classes.has("is-visible"), false);
  await container.emit("touchstart");
  await container.emit("touchmove", { touches: point(100, 180) });
  off();
  assert.equal(indicator.classes.has("is-visible"), false);
  assert.equal(container.count("touchmove"), 0);
});

test("a rejected refresh reports failure and releases the indicator", async () => {
  const { container, view } = fixture();
  const indicator = target();
  let error;
  enablePullToRefresh(container, { view, indicator, onRefresh: async () => { throw new Error("offline"); }, onError: problem => { error = problem; } });
  await swipe(container, container, { dx: 0, dy: 100 });
  assert.equal(error.message, "offline");
  assert.equal(indicator.classes.has("is-busy"), false);
});

test("pager excludes browser edges, row gestures and side scrollers, and resets on resize and cleanup", async () => {
  const { container, row, view } = fixture();
  const pages = [];
  const off = enableViewPager(container, { view, onSwipe: page => pages.push(page) });
  for (const x of [5, 370]) {
    await container.emit("touchstart", { touches: point(x, 100) });
    assert.equal(container.count("touchmove"), 0);
  }
  await swipe(container, row, { dx: -100 });
  assert.equal(pages.length, 0);
  const scroller = Object.assign(target(), { parentElement: container, scrollWidth: 800, overflow: { overflowX: "auto" } });
  await swipe(container, scroller, { dx: -100 });
  assert.equal(pages.length, 0);
  const events = await swipe(container, container, { dx: -100 });
  assert.deepEqual(pages, ["left"]);
  assert.ok(events.end.defaultPrevented);
  await container.emit("touchstart");
  await container.emit("touchmove", { touches: point(200, 100) });
  view.innerWidth = 800;
  await view.emit("resize");
  await container.emit("touchend", { touches: [] });
  assert.equal(container.style.transform, "");
  assert.equal(pages.length, 1);
  off();
  assert.equal(view.count("resize"), 0);
  assert.ok([...container.listeners.values()].every(entries => entries.size === 0));
});

test("reduced motion preserves completion and paging without translating content", async () => {
  const { container, row, action, view } = fixture();
  container.ownerDocument.documentElement.dataset.reduceMotion = "on";
  enableSwipeComplete(container, { view });
  await container.emit("touchstart", { target: row });
  await container.emit("touchmove", { target: row, touches: point(230, 100) });
  assert.equal(row.styles.get("--swipe-x"), "0px");
  await container.emit("touchend", { touches: [] });
  assert.equal(action.clicks, 1);
  enableViewPager(container, { view, onSwipe() {} });
  await container.emit("touchstart");
  await container.emit("touchmove", { touches: point(230, 100) });
  assert.equal(container.style.transform, "");
});

test("close then reopen before the native close task preserves content and the original focus target", async () => {
  const { createDialogController } = await import("../js/dialog.js");
  const dialog = fakeDialog();
  const opener = { isConnected: true, focused: 0, focus() { this.focused++; } };
  const document = { activeElement: opener };
  const controller = createDialogController(dialog, { document, view: {} });
  controller.open({ title: "First", body: "First body" });
  controller.close();
  document.activeElement = { isConnected: true, focus() { assert.fail("lost original focus target"); } };
  controller.open({ title: "Second", body: "Live body" });
  dialog.deliverClose();
  assert.equal(dialog.nodes["[data-dialog-body]"].innerHTML, "Live body");
  controller.close();
  dialog.deliverClose();
  assert.equal(opener.focused, 1);
});
