import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { createMotivationController, EARLY_COUNTDOWN_PHRASES, eligibleKickers, eligiblePhrases, motivationContext, MOTIVATIONAL_PHRASES, MOTIVATION_STORAGE_KEY, PRESSURE_PHRASES, selectMessage, SPECIFIC_KICKERS } from "../js/motivation.js";
import { normalizeState } from "../js/storage.js";
import { loadSiteData } from "../js/data.js";
import { renderToday } from "../js/views/today.js";

const raw = JSON.parse(await fs.readFile(new URL("../data/site-data.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(raw) });
globalThis.window = { location: { search: "?today=2026-10-07", hash: "#today" } };
const data = await loadSiteData();
const pressure = { section: "pressure", countdown: true, days: 60, zeroWork: true, streak: false, complete: false };
const motivation = { section: "motivation", countdown: false, days: 120, zeroWork: false, streak: true, complete: false };
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};
function seeded(seed = 134) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function forcePhrase(context, id, random = () => 0) {
  const phraseUses = Object.fromEntries(eligiblePhrases(context).map(phrase => [phrase.id, phrase.id === id ? 0 : 1]));
  return selectMessage(context, { phraseUses }, random);
}

test("copy and IDs preserve handoff gaps; approved countdown additions use distinct IDs", () => {
  assert.deepEqual(PRESSURE_PHRASES.map(p => p.id), [1,2,3,4,5,6,7,8,9,10,11,12,13,18,22,33,34,36,37,38,39,41]);
  assert.deepEqual(MOTIVATIONAL_PHRASES.map(p => p.id), [14,15,16,24,26,27,29]);
  assert.deepEqual(EARLY_COUNTDOWN_PHRASES.map(p => p.id), ["early-a", "early-b", "early-c"]);
  assert.equal(PRESSURE_PHRASES.find(p => p.id === 39).text, "Bold of you to expect a 520 from a study strategy that's 90% guilt and 10% vibes.");
  assert.equal(PRESSURE_PHRASES.find(p => p.id === 4).text, "That's a $325 exam you're treating like a hobby.");
});

test("specific endings never attach to other phrases, and disappointment cannot double up", () => {
  for (const phrase of [...PRESSURE_PHRASES, ...EARLY_COUNTDOWN_PHRASES]) {
    const pool = eligibleKickers(phrase);
    assert.ok(pool.length);
    for (const ending of SPECIFIC_KICKERS) assert.equal(pool.includes(ending), ending.phraseId === phrase.id);
    if ([37, 41].includes(phrase.id)) assert.ok(pool.every(p => p.id !== "disappointment"));
  }
});

test("mandatory and optional kickers obey rules; motivation never gets an ending", () => {
  for (const phrase of PRESSURE_PHRASES) {
    const yes = forcePhrase(pressure, phrase.id, () => 0);
    const no = forcePhrase(pressure, phrase.id, () => .99);
    assert.ok(yes.current.kickerId, String(phrase.id));
    assert.equal(Boolean(no.current.kickerId), !phrase.optionalKicker, String(phrase.id));
  }
  for (const phrase of MOTIVATIONAL_PHRASES) {
    const result = forcePhrase(motivation, phrase.id);
    assert.equal(result.current.kickerId, "");
    assert.equal(result.current.text, phrase.text);
  }
  let history = {}, optional = 0, attached = 0;
  const random = seeded();
  for (let i = 0; i < 5000; i++) {
    history = selectMessage(pressure, history, random);
    if (PRESSURE_PHRASES.find(p => p.id === history.current.phraseId).optionalKicker) {
      optional++; if (history.current.kickerId) attached++;
    }
  }
  assert.ok(attached / optional > .45 && attached / optional < .55, `${attached}/${optional}`);
});

test("rotation consumes all eligible phrases before repeats; endings have independent memory", () => {
  let history = {};
  const random = seeded();
  const pool = eligiblePhrases(pressure);
  const seen = new Set();
  let previous, lastKicker;
  for (let i = 0; i < 300; i++) {
    history = selectMessage(pressure, history, random);
    assert.notEqual(history.current.phraseId, previous);
    if (i < pool.length) seen.add(history.current.phraseId);
    if (history.current.kickerId) {
      assert.notEqual(history.current.kickerId, lastKicker);
      lastKicker = history.current.kickerId;
    }
    previous = history.current.phraseId;
  }
  assert.equal(seen.size, pool.length);
  const first = forcePhrase(pressure, 37);
  const next = selectMessage(pressure, first, random);
  assert.notEqual(next.current.phraseId, 41);
  assert.ok(!next.current.text.includes("Don't be a disappointment."));
});

test("countdown eligibility uses registered date, planning fallback, and a strict early/late boundary", () => {
  const state = normalizeState({ settings: { registeredExamDate: "2027-03-19" } });
  for (const [date, days, late, early] of [["2026-10-07",163,false,true], ["2026-12-19",90,true,false], ["2026-12-18",91,false,true]]) {
    const context = motivationContext(data, state, date);
    assert.equal(context.days, days);
    const ids = eligiblePhrases(context).map(p => p.id);
    assert.equal(ids.includes(11), late);
    assert.equal(ids.includes(12), late);
    assert.equal(ids.includes("early-a"), early);
  }
  for (const days of [0, -1]) {
    const ids = eligiblePhrases({ ...pressure, countdown: false, days }).map(p => p.id);
    assert.ok(!ids.includes(11) && !ids.includes(12) && !ids.includes("early-a"));
  }
  const early = motivationContext(data, normalizeState({}), "2026-10-07");
  assert.equal(early.registered, false);
  for (const phrase of EARLY_COUNTDOWN_PHRASES) {
    const picked = forcePhrase(early, phrase.id);
    assert.ok(picked.current.text.includes("163 days"));
    assert.ok(!picked.current.text.includes("{days}"));
  }
});

test("section selection recognizes partial work, saved focus and work on past-due assignments", () => {
  const today = "2026-10-07";
  assert.equal(motivationContext(data, normalizeState({}), today).section, "pressure");
  for (const record of [{ completedTasks: { "chapter:PS03": true } }, { status: "in-progress" }, { actualQuestions: 1 }, { actualCars: 1 }, { status: "complete" }]) {
    assert.equal(motivationContext(data, normalizeState({ daily: { [today]: record } }), today).section, "motivation");
  }
  const past = normalizeState({ daily: { "2026-09-22": { status: "complete", updatedAt: "2026-10-07T15:00:00Z" } } });
  assert.equal(motivationContext(data, past, today).section, "motivation");
  past.daily["2026-09-22"].updatedAt = "2026-10-06T15:00:00Z";
  assert.equal(motivationContext(data, past, today).section, "pressure");
  assert.equal(motivationContext(data, past, today).zeroWork, false);
  const session = { minutes: 5, startedAt: "2026-10-07T15:00:00Z", endedAt: "2026-10-07T15:05:00Z" };
  assert.equal(motivationContext(data, normalizeState({ focusSessions: [session] }), today).section, "motivation");
  for (const minutes of [0, -1, 100, "5", NaN]) assert.equal(motivationContext(data, normalizeState({ focusSessions: [{ ...session, minutes }] }), today).section, "pressure");
});

test("rest/before/after plan stay quiet; zero-work, streak and finished-work claims are guarded", () => {
  assert.equal(motivationContext(data, normalizeState({}), "2026-11-26"), null);
  assert.equal(motivationContext(data, normalizeState({}), "2026-08-01"), null);
  assert.equal(motivationContext(data, normalizeState({}), "2027-04-01"), null);
  assert.ok(!eligiblePhrases({ ...pressure, zeroWork: false }).some(p => p.id === 8));
  assert.ok(!eligiblePhrases({ ...motivation, streak: false }).some(p => p.id === 15));
  assert.ok(!eligiblePhrases({ ...motivation, complete: true }).some(p => p.id === 29));
  const dates = ["2026-10-03", "2026-10-05"];
  const state = normalizeState({ daily: Object.fromEntries(dates.map(date => [date, { status: "complete" }])) });
  assert.equal(motivationContext(data, state, "2026-10-05").streak, true);
});

test("reopen/navigation stay stable; timed revisits, day rollover and section transitions rotate", () => {
  const storage = memoryStorage();
  let now = 100;
  const make = () => createMotivationController({ storage, now: () => now, random: seeded() });
  let controller = make();
  const first = controller.get(pressure, "2026-10-07");
  assert.deepEqual(controller.get(pressure, "2026-10-07"), first);
  controller = make();
  assert.deepEqual(controller.get(pressure, "2026-10-07", { revisit: true }), first);
  now += 4 * 60 * 60 * 1000;
  assert.deepEqual(controller.get(pressure, "2026-10-07"), first, "ordinary rerenders never refresh by age");
  const second = controller.get(pressure, "2026-10-07", { revisit: true });
  assert.notEqual(second.phraseId, first.phraseId);
  const third = controller.get(pressure, "2026-10-08");
  assert.notEqual(third.phraseId, second.phraseId);
  assert.equal(controller.get(motivation, "2026-10-08").section, "motivation");
});

test("dismissal survives progress, timed returns and reload; restore and next day work", () => {
  const storage = memoryStorage();
  let now = 100;
  let controller = createMotivationController({ storage, now: () => now });
  controller.get(pressure, "2026-10-07");
  controller.dismiss("2026-10-07");
  now += 5 * 60 * 60 * 1000;
  controller = createMotivationController({ storage, now: () => now });
  assert.deepEqual(controller.get(motivation, "2026-10-07", { revisit: true }), { dismissed: true });
  controller.restore();
  assert.equal(controller.get(motivation, "2026-10-07").section, "motivation");
  controller.dismiss("2026-10-07");
  assert.equal(controller.get(pressure, "2026-10-08").section, "pressure");
});

test("storage failures and malformed cosmetic history cannot block studying", () => {
  for (const storage of [undefined, { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } }, { getItem: () => "{bad", setItem() {} }, { getItem: () => JSON.stringify({ themes: {}, phraseUses: { 1: "bad" }, current: { phraseId: 1 } }), setItem() {} }]) {
    const controller = createMotivationController({ storage });
    assert.equal(controller.get(pressure, "2026-10-07").section, "pressure");
    controller.dismiss("2026-10-07");
    assert.deepEqual(controller.get(pressure, "2026-10-07"), { dismissed: true });
  }
});

test("Today leads with the prominent message before its header and backlog, and labels planning countdowns", () => {
  const context = { data, state: normalizeState({}), motivation: createMotivationController({ storage: memoryStorage() }) };
  const html = renderToday(context);
  const messagePosition = html.indexOf("data-study-message");
  assert.ok(messagePosition >= 0);
  assert.ok(messagePosition < html.indexOf('class="view-header today-header"'));
  assert.ok(messagePosition < html.indexOf('class="catchup-card"'));
  assert.ok(messagePosition < html.indexOf('id="today-assignment"'));
  assert.match(html, /data-go-to-study/);
  assert.match(html, /Hide study messages for today/);
  assert.doesNotMatch(renderToday(context, { detail: "completed" }), /data-study-message/);
  context.motivation.dismiss("2026-10-07");
  assert.match(renderToday(context), /Show study message/);
  assert.doesNotMatch(renderToday(context), /data-study-message/);
  const early = motivationContext(data, context.state, "2026-10-07");
  const picked = forcePhrase(early, "early-a");
  const storage = memoryStorage();
  storage.setItem(MOTIVATION_STORAGE_KEY, JSON.stringify({ ...picked, day: "2026-10-07" }));
  context.motivation = { get: () => picked.current };
  assert.match(renderToday(context), /163 days · planning date/);
});
