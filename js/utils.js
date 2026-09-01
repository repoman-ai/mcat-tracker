export const APP_VERSION = "1.1.0";

export function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttr(value = "") {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

export function parseISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toISODate(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  const preview = new URLSearchParams(window.location.search).get("today");
  return parseISODate(preview) ? preview : toISODate(new Date());
}

export function formatDate(value, options = {}) {
  const parsed = value instanceof Date ? value : parseISODate(value);
  if (!parsed) return value || "—";
  return new Intl.DateTimeFormat("en-US", {
    weekday: options.weekday ?? "short",
    month: options.month ?? "short",
    day: options.day ?? "numeric",
    year: options.year ?? (options.includeYear ? "numeric" : undefined),
  }).format(parsed);
}

export function formatDateLong(value) {
  return formatDate(value, { weekday: "long", month: "long", includeYear: true });
}

export function daysBetween(from, to) {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return null;
  return Math.round((b - a) / 86_400_000);
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

export function uniqueId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function debounce(callback, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function countPracticeQuestions(target = "") {
  return [...target.matchAll(/(\d+)\s+(?:UWorld|[^;]*Section Bank)\b/gi)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
}

export function topCounts(values, limit = 5) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

export function csvCell(value) {
  if (Array.isArray(value)) value = value.join("; ");
  if (value === null || value === undefined) value = "";
  const string = String(value);
  return /[",\n\r]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

export function plural(value, singular, pluralValue = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralValue}`;
}

export function formToObject(form) {
  const output = {};
  new FormData(form).forEach((value, key) => {
    if (output[key] === undefined) output[key] = value;
    else output[key] = Array.isArray(output[key]) ? [...output[key], value] : [output[key], value];
  });
  return output;
}

export function setDocumentTitle(viewTitle) {
  document.title = viewTitle ? `${viewTitle} · MCAT Momentum` : "MCAT Momentum";
}

export function makeDateFromISO(value) {
  const dateValue = parseISODate(value);
  return dateValue || value || "";
}
