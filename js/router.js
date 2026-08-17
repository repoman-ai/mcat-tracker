const VALID_VIEWS = new Set(["today", "plan", "exams", "log", "guide"]);

export function parseRoute(hash = window.location.hash) {
  const cleaned = hash.replace(/^#\/?/, "") || "today";
  const [viewName, ...rest] = cleaned.split("/");
  return {
    view: VALID_VIEWS.has(viewName) ? viewName : "today",
    detail: rest.length ? decodeURIComponent(rest.join("/")) : "",
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
