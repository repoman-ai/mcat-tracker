import { debounce, escapeAttr, escapeHTML, safeExternalUrl } from "../utils.js";
import { emptyState } from "./shared.js";

let guideQuery = "";

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(value, query) {
  if (!query) return linkify(value);
  const parts = String(value).split(new RegExp(`(${regexEscape(query)})`, "ig"));
  return parts.map((part) => part.toLowerCase() === query.toLowerCase() ? `<mark>${escapeHTML(part)}</mark>` : linkify(part)).join("");
}

function linkify(value) {
  return String(value).split(/(https?:\/\/[^\s]+)/g).map((part) => {
    if (!/^https?:\/\//.test(part)) return escapeHTML(part);
    const clean = part.replace(/[.,);]+$/, "");
    const suffix = part.slice(clean.length);
    return `<a href="${escapeAttr(safeExternalUrl(clean))}" target="_blank" rel="noreferrer">${escapeHTML(clean)}</a>${escapeHTML(suffix)}`;
  }).join("");
}

function blockText(block) {
  if (["paragraph", "heading", "callout"].includes(block.type)) return `${block.label || ""} ${block.text || ""}`;
  if (block.type === "list") return block.items.join(" ");
  if (block.type === "table") return [...block.headers, ...block.rows.flat()].join(" ");
  return block.label || "";
}

function renderBlock(block, query) {
  if (block.type === "paragraph") return `<p>${highlight(block.text, query)}</p>`;
  if (block.type === "heading") return `<h${block.level}>${highlight(block.text, query)}</h${block.level}>`;
  if (block.type === "callout") return `<aside class="guide-callout"><strong>${highlight(block.label, query)}</strong><p>${highlight(block.text, query)}</p></aside>`;
  if (block.type === "divider") return `<div class="guide-divider"><span>${highlight(block.label, query)}</span></div>`;
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    return `<${tag}>${block.items.map((item) => `<li>${highlight(item, query)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "table") return `<div class="table-wrap guide-table"><table><thead><tr>${block.headers.map((header) => `<th>${highlight(header, query)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${highlight(cell, query)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  return "";
}

function sectionMatches(section, query) {
  if (!query) return true;
  const haystack = `${section.title} ${section.blocks.map(blockText).join(" ")}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchingBlocks(section, query) {
  if (!query) return section.blocks;
  const matches = section.blocks.filter((block) => blockText(block).toLowerCase().includes(query.toLowerCase()));
  return matches.length ? matches : section.blocks;
}

export function renderGuide(context, route) {
  const sections = context.data.guide.sections.filter((section) => sectionMatches(section, guideQuery));
  return `<header class="view-header"><div><span class="eyebrow">Complete meaningful content from the study guide</span><h1>Guide</h1><p>Search the operating rules, phases, time templates, exam guidance, decision rules, registration, and source links.</p></div><a class="button" href="#today">Back to Today</a></header>
    <section class="guide-search-panel"><label class="guide-search">Search guide<input type="search" data-guide-search value="${escapeAttr(guideQuery)}" placeholder="Try “CARS,” “March,” “full-length review”…"><span>${sections.length} matching section${sections.length === 1 ? "" : "s"}</span></label><nav class="guide-section-nav" aria-label="Guide sections">${context.data.guide.sections.map((section) => `<a href="#guide/${escapeAttr(section.id)}" class="${route.detail === section.id ? "is-active" : ""}">${escapeHTML(section.title.replace(/^\d+\.\s*/, ""))}</a>`).join("")}</nav></section>
    <section class="guide-context-cards" aria-label="Frequently needed guidance"><a href="#guide/operating-rules"><span>When you sit down</span><strong>Operating rules</strong></a><a href="#guide/full-length-and-section-bank-schedule"><span>Before an exam</span><strong>Full-length + SB schedule</strong></a><a href="#guide/january-vs-march-decision"><span>At the evidence checkpoint</span><strong>January vs. March</strong></a><a href="#guide/registration-and-resource-controls"><span>After registration</span><strong>Date + resources</strong></a></section>
    <section class="guide-sections" aria-label="Study guide content">${sections.length ? sections.map((section, index) => `<details class="guide-section" id="guide-section-${escapeAttr(section.id)}" data-guide-section="${escapeAttr(section.id)}" ${route.detail === section.id || (guideQuery && index === 0) ? "open" : ""}><summary><span>${escapeHTML(section.title)}</span><span class="disclosure-icon" aria-hidden="true">⌄</span></summary><article>${matchingBlocks(section, guideQuery).map((block) => renderBlock(block, guideQuery)).join("")}</article></details>`).join("") : emptyState("No guide results", `Nothing matched “${guideQuery}”. Try a broader term.`)}</section>
    <section class="guide-source-note"><strong>Source fidelity</strong><p>Chapter names and subsections are generated from <code>kaplan-mcat-books.md</code> and appear contextually in Today, Plan, and Log. They are intentionally not dumped into one giant guide page.</p></section>`;
}

export function bindGuide(container, context, route) {
  const search = container.querySelector("[data-guide-search]");
  search?.addEventListener("input", debounce(() => { guideQuery = search.value.trim(); context.rerender(); }, 250));
  if (route.detail) {
    requestAnimationFrame(() => {
      const section = container.querySelector(`[data-guide-section="${CSS.escape(route.detail)}"]`);
      if (section) { section.open = true; section.scrollIntoView({ block: "start" }); }
    });
  }
}
