/** Route changes must not inherit CSS smooth scrolling and race their target. */
export function scrollInstantly(window, { left = 0, top = 0 } = {}) {
  const element = window.document?.documentElement;
  const previous = element?.style.scrollBehavior;
  if (element) element.style.scrollBehavior = "auto";
  window.scrollTo({ left, top, behavior: "instant" });
  if (element) element.style.scrollBehavior = previous;
}

export function focusTarget(element) {
  if (!element) return;
  const focus = element.matches("details") ? element.querySelector("summary") : element;
  focus?.focus({ preventScroll: true });
  element.scrollIntoView({ block: "start", behavior: "instant" });
}

/** Preserve a mounted view during data updates; route/filter changes opt out. */
export function captureViewState(root, window) {
  const key = (element) => element.id || element.dataset.viewKey;
  const details = [...root.querySelectorAll("details")].filter(key).map((element) => [key(element), element.open]);
  const scrolls = [...root.querySelectorAll("[data-view-scroll]")].map((element) => [element.dataset.viewScroll, element.scrollTop]);
  const controls = [...root.querySelectorAll("[data-view-focus]")];
  const focused = root.ownerDocument.activeElement;
  const selection = focused && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  const index = controls.indexOf(focused);
  const candidates = index < 0 ? [] : [...controls.slice(index), ...controls.slice(0, index).reverse()];
  const anchors = candidates.map((element) => [element.dataset.viewFocus, element.getBoundingClientRect().top]);
  const anchorWindow = index >= 0 && !focused.closest("[data-view-scroll]");
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  return ({ afterRestore } = {}) => {
    const restoreDetails = () => {
      const detailMap = new Map([...root.querySelectorAll("details")].filter(key).map((element) => [key(element), element]));
      for (const [id, open] of details) { const element = detailMap.get(id); if (element) element.open = open; }
    };
    restoreDetails();
    afterRestore?.();
    // Lazy editors now exist, including their nested reference disclosures.
    restoreDetails();
    const scrollMap = new Map([...root.querySelectorAll("[data-view-scroll]")].map((element) => [element.dataset.viewScroll, element]));
    for (const [id, top] of scrolls) { const element = scrollMap.get(id); if (element) element.scrollTop = top; }
    const focusMap = new Map([...root.querySelectorAll("[data-view-focus]")].map((element) => [element.dataset.viewFocus, element]));
    const anchor = anchors.find(([id]) => focusMap.has(id));
    let top = scrollY;
    if (anchor) {
      const element = focusMap.get(anchor[0]);
      if (anchorWindow) top = window.scrollY + element.getBoundingClientRect().top - anchor[1];
      element.focus({ preventScroll: true });
      if (selection && element.dataset.viewFocus === focused?.dataset.viewFocus) { try { element.setSelectionRange(...selection); } catch {} }
    } else if (index >= 0) root.focus({ preventScroll: true });
    const documentElement = root.ownerDocument.documentElement;
    const previousBehavior = documentElement?.style.scrollBehavior;
    if (documentElement) documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ left: scrollX, top, behavior: "auto" });
    if (documentElement) documentElement.style.scrollBehavior = previousBehavior;
  };
}
