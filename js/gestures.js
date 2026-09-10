/**
 * Touch gestures for phones and tablets.
 *
 * Every gesture here is a shortcut for a control that is already on screen and
 * reachable by keyboard, so nothing is lost when the pointer is precise, when
 * the gesture is never discovered, or when a screen reader is driving. Each
 * binder is a no-op unless the device actually has a coarse pointer, and each
 * returns its own cleanup so a view can unbind on the way out.
 */

// A drag is only claimed once one axis clearly wins, so a diagonal thumb keeps
// scrolling the page instead of triggering an action the user did not intend.
const AXIS_RATIO = 1.4;
const SLOP = 10;
// A short flick commits even when it is well short of the distance threshold.
const FLICK_VELOCITY = 0.45; // px per ms

export function dominantAxis(dx, dy) {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x < SLOP && y < SLOP) return "";
  if (x > y * AXIS_RATIO) return "x";
  if (y > x * AXIS_RATIO) return "y";
  return "";
}

/** A finished drag commits on distance or on speed, never on direction alone. */
export function swipeOutcome({ distance, elapsed, limit }) {
  if (!(distance > 0) || !(limit > 0)) return "cancel";
  const velocity = elapsed > 0 ? distance / elapsed : 0;
  return distance >= limit || (distance >= 40 && velocity >= FLICK_VELOCITY) ? "commit" : "cancel";
}

/** Track the finger for the first `linear` px, then ease asymptotically to `max`. */
export function resist(distance, { linear = 0, max = Infinity } = {}) {
  if (!(distance > 0)) return 0;
  if (distance <= linear) return distance;
  if (!Number.isFinite(max)) return distance;
  const room = Math.max(max - linear, 0);
  if (!room) return linear;
  const extra = distance - linear;
  return linear + room * (1 - room / (extra + room));
}

/** Today has exactly two pages; the ends of the strip absorb the swipe. */
export function pageSwipeTarget(detail, direction) {
  const pages = ["", "completed"];
  const index = Math.max(pages.indexOf(detail === "completed" ? "completed" : ""), 0);
  const next = index + (direction === "left" ? 1 : -1);
  return next >= 0 && next < pages.length ? pages[next] : null;
}

export function coarsePointer(view = globalThis) {
  return Boolean(view.matchMedia?.("(pointer: coarse)").matches);
}

function phone(view = globalThis) {
  return Boolean(view.matchMedia?.("(max-width: 559px)").matches);
}

function reducedMotion(document) {
  return document?.documentElement?.dataset?.reduceMotion === "on";
}

/** Text selection, carets, and native control drags always outrank a gesture. */
function inControl(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

/** Nested scrollers keep their own gestures; clipped overflow is not scrollable. */
function inScroller(target, boundary, view, axis = "X") {
  for (let node = target; node && node !== boundary; node = node.parentElement) {
    if ((axis === "X" ? node.scrollWidth <= node.clientWidth + 1 : node.scrollHeight <= node.clientHeight + 1)) continue;
    const overflow = view.getComputedStyle?.(node)?.[`overflow${axis}`];
    if (overflow === "auto" || overflow === "scroll") return true;
  }
  return false;
}

function singleTouch(event) {
  return event.touches?.length === 1 ? event.touches[0] : null;
}

function listen(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

function bundle(...offs) {
  return () => { for (const off of offs) { try { off(); } catch { /* already gone */ } } };
}

// Only eligible touch sequences need a blocking move listener. Ordinary page
// scrolling, controls, and inner scrollers never install one.
function touchMoves(target, move) {
  let off;
  return {
    start() { off ||= listen(target, "touchmove", move, { passive: false }); },
    stop() { off?.(); off = null; },
  };
}

function atEdge(touch, view) {
  return touch.clientX < 24 || touch.clientX > (view.innerWidth || 375) - 24;
}

/** Drag from the sticky header, or from a body already scrolled to its top. */
export function enableSheetDismiss(dialog, { view = globalThis, onDismiss } = {}) {
  if (!coarsePointer(view)) return () => {};
  let drag = null;
  const reset = () => {
    moves.stop();
    dialog.classList.remove("is-dragging");
    dialog.style.transform = "";
    drag = null;
  };
  const start = (event) => {
    reset();
    const touch = singleTouch(event);
    if (!dialog.open || !coarsePointer(view) || !touch || inControl(event.target)) return;
    const header = event.target.closest?.(".dialog-shell > header");
    if (!header && (dialog.scrollTop > 0 || !event.target.closest?.("[data-dialog-body]") || inScroller(event.target, dialog, view, "Y"))) return;
    drag = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, axis: "", offset: 0 };
    moves.start();
  };
  const move = (event) => {
    const touch = singleTouch(event);
    if (!drag || !touch || !event.cancelable || !dialog.open) { reset(); return; }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.axis) {
      const axis = dominantAxis(dx, dy);
      if (!axis) return;
      if (axis === "x" || dy < 0) { reset(); return; }
      drag.axis = axis;
      dialog.classList.add("is-dragging");
    }
    event.preventDefault();
    drag.offset = Math.max(dy, 0);
    dialog.style.transform = reducedMotion(dialog.ownerDocument) ? "" : `translateY(${drag.offset}px)`;
  };
  const moves = touchMoves(dialog, move);
  const end = (event) => {
    const finished = drag;
    reset();
    if (!finished?.axis) return;
    if (event.cancelable) event.preventDefault();
    const limit = Math.min(Math.max(dialog.offsetHeight * 0.28, 90), 200);
    if (swipeOutcome({ distance: finished.offset, elapsed: event.timeStamp - finished.at, limit }) === "commit") {
      // Commit immediately: an old animation must never close a newer sheet.
      onDismiss ? onDismiss() : dialog.close();
    }
  };
  return bundle(
    listen(dialog, "touchstart", start, { passive: true }),
    listen(dialog, "touchend", end, { passive: false }),
    listen(dialog, "touchcancel", reset, { passive: true }),
    listen(dialog, "close", () => { if (!dialog.open) reset(); }),
    reset,
  );
}

/** Swipe right to press the row's own completion button, including its Undo. */
export function enableSwipeComplete(container, { view = globalThis } = {}) {
  if (!coarsePointer(view)) return () => {};
  let drag = null;
  const reset = () => {
    moves.stop();
    if (drag) {
      drag.row.classList.remove("is-swiping");
      drag.row.style.removeProperty("--swipe-x");
      drag.row.style.removeProperty("--swipe-progress");
    }
    drag = null;
  };
  const start = (event) => {
    reset();
    const touch = singleTouch(event);
    const row = event.target.closest?.("[data-swipe-complete]");
    if (!coarsePointer(view) || !touch || atEdge(touch, view) || !row || inControl(event.target) || inScroller(event.target, container, view)) return;
    const action = row.querySelector('[data-toggle-complete]:not([disabled]):not([aria-pressed="true"])');
    if (!action) return;
    drag = { row, action, x: touch.clientX, y: touch.clientY, at: event.timeStamp, axis: "", offset: 0, limit: Math.min(Math.max(row.offsetWidth * 0.35, 88), 150) };
    moves.start();
  };
  const move = (event) => {
    const touch = singleTouch(event);
    if (!drag || !touch || !event.cancelable || !container.contains(drag.row)) { reset(); return; }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.axis) {
      const axis = dominantAxis(dx, dy);
      if (!axis) return;
      if (axis === "y" || dx < 0) { reset(); return; }
      drag.axis = axis;
      drag.row.classList.add("is-swiping");
    }
    event.preventDefault();
    drag.offset = Math.max(dx, 0);
    const offset = reducedMotion(container.ownerDocument) ? 0 : resist(drag.offset, { linear: drag.limit, max: drag.limit + 70 });
    drag.row.style.setProperty("--swipe-x", `${offset}px`);
    drag.row.style.setProperty("--swipe-progress", String(Math.min(drag.offset / drag.limit, 1)));
  };
  const moves = touchMoves(container, move);
  const end = (event) => {
    const finished = drag;
    reset();
    if (!finished?.axis) return;
    // Cancel only this touch sequence's compatibility click. No shared click
    // flag can swallow a keyboard tap or the completion button's own click().
    if (event.cancelable) event.preventDefault();
    const { row, action, offset, at, limit } = finished;
    if (!container.contains(row) || !row.contains(action) || action.disabled || action.getAttribute("aria-pressed") === "true") return;
    if (swipeOutcome({ distance: offset, elapsed: event.timeStamp - at, limit }) === "commit") action.click();
  };
  return bundle(
    listen(container, "touchstart", start, { passive: true }),
    listen(container, "touchend", end, { passive: false }),
    listen(container, "touchcancel", reset, { passive: true }),
    reset,
  );
}

// A refresh can rerender Today before its promise settles. The next binder
// inherits the busy indicator; an outgoing binder cannot clear its successor.
const refreshes = new WeakMap();

/** Pull from the top of Today to re-check the date and sync. */
export function enablePullToRefresh(container, { indicator, onRefresh, onError = () => {}, view = globalThis } = {}) {
  if (!coarsePointer(view) || !indicator || typeof onRefresh !== "function") return () => {};
  const LIMIT = 68;
  let drag = null;
  const paint = (offset) => {
    indicator.style.setProperty("--pull-y", `${offset}px`);
    indicator.classList.toggle("is-visible", offset > 0);
    indicator.classList.toggle("is-armed", offset >= LIMIT);
  };
  const reset = () => {
    moves.stop();
    drag = null;
    const busy = refreshes.has(indicator);
    indicator.classList.toggle("is-busy", busy);
    paint(busy ? LIMIT : 0);
  };
  const start = (event) => {
    reset();
    const touch = singleTouch(event);
    if (!coarsePointer(view) || refreshes.has(indicator) || !touch || atEdge(touch, view) || view.scrollY > 0 || inControl(event.target) || inScroller(event.target, container, view, "Y") || inScroller(event.target, container, view)) return;
    drag = { x: touch.clientX, y: touch.clientY, axis: "", pull: 0 };
    moves.start();
  };
  const move = (event) => {
    const touch = singleTouch(event);
    if (!drag || !touch || !event.cancelable) { reset(); return; }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.axis) {
      const axis = dominantAxis(dx, dy);
      if (!axis) return;
      if (axis === "x" || dy < 0 || view.scrollY > 0) { reset(); return; }
      drag.axis = axis;
    }
    event.preventDefault();
    // The release threshold and the visible armed state use the same distance.
    drag.pull = resist(Math.max(dy, 0), { linear: LIMIT, max: LIMIT + 42 });
    paint(drag.pull);
  };
  const moves = touchMoves(container, move);
  const end = async (event) => {
    const finished = drag;
    reset();
    if (!finished?.axis) return;
    if (event.cancelable) event.preventDefault();
    if (finished.pull < LIMIT) return;
    const job = { reset };
    refreshes.set(indicator, job);
    reset();
    try { await onRefresh(); } catch (error) { onError(error); } finally {
      refreshes.delete(indicator);
      job.reset?.();
    }
  };
  const pending = refreshes.get(indicator);
  if (pending) pending.reset = reset;
  reset();
  return bundle(
    listen(container, "touchstart", start, { passive: true }),
    listen(container, "touchend", end, { passive: false }),
    listen(container, "touchcancel", reset, { passive: true }),
    () => {
      reset();
      const job = refreshes.get(indicator);
      if (job?.reset === reset) job.reset = null;
      indicator.classList.remove("is-busy");
      paint(0);
    },
  );
}

/** Swipe between Today and Completed, leaving screen edges to browser history. */
export function enableViewPager(container, { onSwipe, view = globalThis } = {}) {
  if (!coarsePointer(view) || !phone(view) || typeof onSwipe !== "function") return () => {};
  let drag = null;
  const reset = () => {
    moves.stop();
    container.classList.remove("is-paging");
    container.style.transform = "";
    drag = null;
  };
  const start = (event) => {
    reset();
    const touch = singleTouch(event);
    if (!coarsePointer(view) || !phone(view) || !touch || atEdge(touch, view) || inControl(event.target)) return;
    if (event.target.closest?.("[data-swipe-complete]") || inScroller(event.target, container, view)) return;
    drag = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, axis: "", dx: 0 };
    moves.start();
  };
  const move = (event) => {
    const touch = singleTouch(event);
    if (!drag || !touch || !event.cancelable || !phone(view)) { reset(); return; }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.axis) {
      const axis = dominantAxis(dx, dy);
      if (!axis) return;
      if (axis === "y") { reset(); return; }
      drag.axis = axis;
      container.classList.add("is-paging");
    }
    event.preventDefault();
    drag.dx = dx;
    container.style.transform = reducedMotion(container.ownerDocument) ? "" : `translateX(${Math.sign(dx) * resist(Math.abs(dx), { max: 58 })}px)`;
  };
  const moves = touchMoves(container, move);
  const end = (event) => {
    const finished = drag;
    reset();
    if (!finished?.axis) return;
    if (event.cancelable) event.preventDefault();
    if (!phone(view)) return;
    const limit = Math.min(Math.max((view.innerWidth || 375) * 0.22, 64), 130);
    if (swipeOutcome({ distance: Math.abs(finished.dx), elapsed: event.timeStamp - finished.at, limit }) === "commit") onSwipe(finished.dx < 0 ? "left" : "right");
  };
  return bundle(
    listen(container, "touchstart", start, { passive: true }),
    listen(container, "touchend", end, { passive: false }),
    listen(container, "touchcancel", reset, { passive: true }),
    listen(view, "resize", reset, { passive: true }),
    reset,
  );
}
