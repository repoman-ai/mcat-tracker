import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { bindGuide, renderGuide } from '../js/views/guide.js';
import { assignmentTasks } from '../js/daily.js';
import { bindAssignmentDetail } from '../js/views/shared.js';
import { renderPlan } from '../js/views/plan.js';
import { normalizeState } from '../js/storage.js';
import { loadSiteData } from '../js/data.js';

const raw = JSON.parse(await fs.readFile(new URL('../data/site-data.json', import.meta.url), 'utf8'));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: '?today=2027-01-26', hash: '#plan' } };
const data = await loadSiteData();

test('chapter search retains the matching chapter title, prerequisites and dates', async () => {
  const chapterMap = data.guide.sections.find(section => section.id === 'chapter-map');
  for (const query of ['PS03', 'First pass: 2026-10-02']) {
    let input, html;
    const search = { value: query, isConnected: true, addEventListener(name, callback) { if (name === 'input') input = callback; } };
    const context = { data: { guide: { sections: [chapterMap] } }, rerender() { html = renderGuide(context, {}, { isRouteChange: false }); } };
    bindGuide({ querySelector(selector) { return selector === '[data-guide-search]' ? search : null; } }, context, {});
    input();
    await new Promise(resolve => setTimeout(resolve, 300));
    const text = html.replace(/<[^>]*>/g, '');
    assert.match(text, /PS03 — Behavioral Sciences Ch. 3/);
    assert.match(text, /First pass: 2026-10-02\. Retrieval:/);
    assert.match(text, /Prerequisites:/);
    assert.match(text, /Practice:/);
  }
});

test('buffer instructions are not required tasks and existing task IDs stay stable', () => {
  const row = data.index.scheduleByDate.get('2027-01-26');
  const tasks = assignmentTasks(row);
  assert.ok(tasks.some(task => task.id === 'assignment:0' && task.label === 'Light consolidation'));
  assert.ok(tasks.some(task => task.id === 'practice:0'));
  assert.ok(tasks.some(task => task.id === 'retrieval:scheduled'));
  assert.ok(!tasks.some(task => /unassigned/i.test(task.label)));
});

test('weekly capacity, visible estimate and question sources remain distinct', () => {
  for (const [date, week, sb] of [['2026-12-01', 11, 20], ['2026-12-15', 13, 8], ['2027-01-26', 19, 32]]) {
    window.location.search = `?today=${date}`;
    const html = renderPlan({ data, state: normalizeState({}) }, {});
    assert.match(html, new RegExp(`id="week-${week}"`));
    assert.match(html, new RegExp(`0 UWorld science \\+ ${sb} Section Bank`));
    assert.match(html, /-hour ceiling/);
    assert.match(html, /week-card__body">\s*<p class="muted">Estimated work:/);
    if (week === 19) assert.match(html, /Reserve at least 4 hours/);
  }
});

test('explicit day-form completion acknowledges revised tasks without fabricating question counts', () => {
  const row = data.index.scheduleByDate.get('2026-10-02');
  for (const status of ['complete', 'not-started', 'in-progress']) {
    let submit, saved;
    const form = {
      dataset: { dayForm: row.id },
      elements: { status: { value: status }, actualQuestions: { value: '0' }, actualCars: { value: '' }, notes: { value: 'Keep this note' } },
      querySelector(selector) { return selector === '[data-day-error]' ? { textContent: '' } : null; },
      reportValidity() { return true; },
      addEventListener(name, callback) { if (name === 'submit') submit = callback; },
    };
    const scope = { querySelectorAll(selector) { return selector === '[data-day-form]' ? [form] : []; } };
    const state = normalizeState({ daily: { [row.id]: { status: 'in-progress', completedTasks: { 'chapter:PS03': true }, updatedAt: '2026-09-22T10:00:00Z' } } });
    bindAssignmentDetail(scope, { data, state, updateState(next) { saved = next; } });
    submit({ preventDefault() {} });
    const record = saved.daily[row.id];
    assert.equal(record.actualQuestions, 0);
    assert.equal(record.actualCars, '');
    assert.equal(record.notes, 'Keep this note');
    assert.equal(record.curriculumRevision, status === 'in-progress' ? undefined : '2026-09-23');
    assert.equal(record.completedTasks['chapter:PS03'], status !== 'not-started');
  }
});
