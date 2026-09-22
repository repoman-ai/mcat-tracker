const VALID_VIEWS = new Set(["today", "plan", "exams", "log", "guide"]);

export function parseRoute(hash = window.location.hash) {
  const cleaned = hash.replace(/^#\/?/, "") || "today";
  const [viewName, ...rest] = cleaned.split("/");
  let detail = "";
  try { detail = rest.length ? decodeURIComponent(rest.join("/")) : ""; }
  catch { /* A damaged deep link must not prevent the view from opening. */ }
  return {
    view: VALID_VIEWS.has(viewName) ? viewName : "today",
    detail,
  };
}

export function navigate(view, detail = "") {
  const next = `#${view}${detail ? `/${encodeURIComponent(detail)}` : ""}`;
  if (window.location.hash === next) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = next;
}

export function startRouter(callback) {
  const handle = () => callback(parseRoute());
  window.addEventListener("hashchange", handle);
  handle();
  return () => window.removeEventListener("hashchange", handle);
}
