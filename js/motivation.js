import { isStudyRow } from "./data.js?v=20261007-7";
import { daysBetween, toISODate } from "./utils.js?v=20261007-7";

// Original copy is verbatim except the approved 515 → 520 change in #39.
// IDs retain the handoff's deliberate gaps.
export const PRESSURE_PHRASES = [
  [1, "Somebody with a worse GPA and a better schedule is studying right now. Enjoy your scroll.", "scroll"],
  [2, "You said you wanted to be a doctor. Doctors don't skip practice passages because they're 'tired.'", "reluctance"],
  [3, "Future you is gonna look back at today and either say thank god or what the fuck were you doing. Pick one.", "future"],
  [4, "That's a $325 exam you're treating like a hobby.", "money"],
  [5, "Every hour you skip is an hour you'll pay back at 2am the week before test day. With interest.", "time"],
  [6, "Your med school application doesn't care about your feelings. It cares about your score.", "admissions"],
  [7, "You paid for those prep books. They're not gonna read themselves, dipshit.", "money"],
  [8, "Zero hours logged. Bold strategy for someone who wants to be called 'Doctor.'", "zero"],
  [9, "You don't have to feel like it. You just have to fucking do it.", "reluctance"],
  [10, "One session. Phone away. 25 minutes. Then you can hate it all you want.", "start"],
  [11, "Test day doesn't move. Your excuses shouldn't either.", "countdown"],
  [12, "You will never be this far from test day again. Make it count or make peace with a retake.", "countdown"],
  [13, "Don't let your brain rot. Go study.", "start"],
  [18, "You've got time to doomscroll but not one passage? Interesting priorities for a future physician.", "scroll"],
  [22, "Remember when you swore this time you'd actually stick to the plan? Don't make a liar out of yourself.", "plan"],
  [33, "'I'll start tomorrow' is not a study plan. It's a hostage note from your laziness.", "plan"],
  [34, "Imagine telling an admissions committee you're passionate about medicine after not even doing a single passage.", "admissions"],
  [36, "Somewhere out there, a future patient is praying their doctor isn't the type to skip studying for reels.", "scroll"],
  [37, "Your brain cells are filing a formal complaint with HR for being unemployed. Don't be a disappointment.", "disappointment"],
  [38, "You're not 'taking a break.' You're a grown adult hiding from a multiple-choice test like it owes you money.", "avoidance"],
  [39, "Bold of you to expect a 520 from a study strategy that's 90% guilt and 10% vibes.", "score"],
  [41, "Don't be a disappointment.", "disappointment"],
].map(([id, text, theme]) => ({ id, text, theme, countdown: id === 11 || id === 12, optionalKicker: [9, 10, 11, 12, 13].includes(id) }));

// New IDs deliberately do not fill any gaps in the original numbered pool.
export const EARLY_COUNTDOWN_PHRASES = [
  ["early-a", "You have {days} days. That's runway, not permission to fuck around."],
  ["early-b", "{days} days until test day. Future you would appreciate one less ‘I'll start tomorrow.’"],
  ["early-c", "{days} days left. Plenty of time to build a routine. Plenty of time to bullshit yourself, too."],
].map(([id, text]) => ({ id, text, theme: "countdown", earlyCountdown: true }));

export const MOTIVATIONAL_PHRASES = [
  [14, "That's what I'm talking about. Do it again tomorrow.", "stacking"],
  [15, "Streak's alive. Don't you dare be the one to kill it.", "streak"],
  [16, "Look at you, acting like someone who's actually getting into med school.", "admissions"],
  [24, "Fuck yeah, that's a real session. Stack another one tomorrow.", "stacking"],
  [26, "This is how scores get built: one boring, unglamorous session after another. Keep stacking.", "stacking"],
  [27, "Tired, bored, and you did it anyway. That's the entire game, and you're playing it.", "persistence"],
  [29, "The hardest part is sitting down, and you already did it. Stay there.", "continue"],
].map(([id, text, theme]) => ({ id, text, theme }));

export const UNIVERSAL_KICKERS = [
  ["ass", "Get your ass studying.", "study"],
  ["book", "Open the book.", "book"],
  ["shit", "Go do that shit.", "action"],
  ["stalling", "Quit stalling and go study.", "excuses"],
  ["coward", "Stop being a coward and open the book.", "book"],
  ["passages", "Less excuses, more passages.", "excuses"],
  ["now", "Go. Right now. I'm not asking.", "action"],
  ["after-it", "Get off your ass and get after it.", "action"],
  ["phone", "Phone down, brain on, let's fucking go.", "phone"],
  ["score", "Do the work or explain yourself to your MCAT score.", "score"],
  ["reading", "Stop reading this and go study. Seriously.", "study"],
  ["work", "Quit being a bitch about it and get to work.", "action"],
  ["negotiating", "Stop negotiating with yourself and sit the fuck down.", "excuses"],
  ["later", "Go study now, feel sorry for yourself later.", "study"],
  ["close", "Close this and open a passage. Today's not gonna fix itself.", "passage"],
  ["disappointment", "Don't be a disappointment.", "disappointment"],
].map(([id, text, theme]) => ({ id, text, theme }));
export const SPECIFIC_KICKERS = [
  [1, "Or close the app and go earn your seat.", "action"],
  [4, "Stop lighting money on fire and go study.", "money"],
  [5, "So pay it now, sit down, and grind.", "money"],
  [7, "Crack one open before I lose my shit.", "book"],
  [8, "Fix it. Now. Go.", "action"],
].map(([phraseId, text, theme]) => ({ id: `specific-${phraseId}`, phraseId, text, theme }));

export const MOTIVATION_OPTIONS = Object.freeze({ countdownDays: 90, returnAfterMs: 4 * 60 * 60 * 1000 });
export const MOTIVATION_STORAGE_KEY = "mcatMomentum.motivation.v1";
const dayOf = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? toISODate(date) : "";
};
function savedFocus(session) {
  return typeof session?.minutes === "number" && Number.isFinite(session.minutes)
    && session.minutes > 0 && session.minutes <= 25;
}
function recordedWork(record) {
  return record?.status === "complete" || record?.status === "in-progress"
    || Object.values(record?.completedTasks || {}).some(value => value === true)
    || Number(record?.actualQuestions) > 0 || Number(record?.actualCars) > 0;
}

/** Saved work counts even when today's session tackled a past-due assignment. */
export function motivationContext(data, state, today, options = MOTIVATION_OPTIONS) {
  const row = data.index.scheduleByDate.get(today);
  if (!row || !isStudyRow(row)) return null;
  const studyDates = data.schedule.filter(isStudyRow).filter(item => item.date <= today);
  const workDates = new Set(Object.values(state.daily).filter(recordedWork)
    .map(record => dayOf(record.lastStudiedAt ?? record.updatedAt)));
  const hasWork = (date) => recordedWork(state.daily[date]) || workDates.has(date) || (state.focusSessions || []).some(session =>
    savedFocus(session) && dayOf(session.endedAt || session.startedAt) === date);
  const studied = hasWork(today);
  // Rest days neither create nor break a streak. Require two study dates with
  // saved work; no inference from calendar age alone.
  let streak = 0;
  for (const date of studyDates.map(item => item.date).reverse()) {
    if (!hasWork(date)) break;
    streak++;
  }
  const days = daysBetween(today, state.settings.registeredExamDate || data.plan.placeholder_exam_window[0]);
  return {
    section: studied ? "motivation" : "pressure",
    days, registered: Boolean(state.settings.registeredExamDate),
    countdown: days !== null && days > 0 && days <= options.countdownDays,
    streak: streak >= 2,
    complete: state.daily[row.id]?.status === "complete",
    // #8 describes recorded hours, so reserve it for a tracker with no saved
    // work at all rather than saying 'zero' after yesterday's session.
    zeroWork: !Object.values(state.daily).some(recordedWork)
      && !(state.focusSessions || []).some(savedFocus),
  };
}

export function eligiblePhrases(context) {
  if (!context) return [];
  return (context.section === "motivation" ? MOTIVATIONAL_PHRASES : [...PRESSURE_PHRASES, ...EARLY_COUNTDOWN_PHRASES]).filter(phrase =>
    (!phrase.countdown || context.countdown)
    && (!phrase.earlyCountdown || context.days > 90)
    && (phrase.id !== 8 || context.zeroWork)
    && (phrase.id !== 15 || context.streak)
    && (phrase.id !== 29 || !context.complete));
}

export function eligibleKickers(phrase) {
  return [...UNIVERSAL_KICKERS, ...SPECIFIC_KICKERS.filter(kicker => kicker.phraseId === phrase.id)]
    .filter(kicker => !phrase.text.includes(kicker.text));
}

function pickFresh(pool, uses, recentThemes, previousId, random) {
  const withoutPrevious = pool.filter(item => item.id !== previousId);
  const candidates = withoutPrevious.length ? withoutPrevious : pool;
  const minimum = Math.min(...candidates.map(item => uses[item.id] || 0));
  // Finish the eligible deck before starting over. Theme spacing is secondary
  // so a theme cannot permanently starve an unused phrase.
  const fresh = candidates.filter(item => (uses[item.id] || 0) === minimum);
  const spaced = fresh.filter(item => !recentThemes.includes(item.theme));
  const choices = spaced.length ? spaced : fresh;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

function messageText(phrase, kicker, context) {
  return `${phrase.text.replaceAll("{days}", String(context.days))}${kicker ? ` ${kicker.text}` : ""}`;
}

/** Pure selection with independent phrase and ending histories. */
export function selectMessage(context, history = {}, random = Math.random) {
  const pool = eligiblePhrases(context);
  if (!pool.length) return null;
  const phraseUses = { ...history.phraseUses }, kickerUses = { ...history.kickerUses };
  const previousText = typeof history.current?.text === "string" ? history.current.text : "";
  const withoutEcho = pool.filter(phrase => !previousText.includes(messageText(phrase, null, context)));
  const phrase = pickFresh(withoutEcho.length ? withoutEcho : pool, phraseUses, history.themes || [], history.current?.phraseId, random);
  let kicker = null;
  if (context.section === "pressure" && (!phrase.optionalKicker || random() < .5)) {
    const kickers = eligibleKickers(phrase);
    const withoutEchoKicker = kickers.filter(item => !previousText.includes(item.text));
    kicker = pickFresh(withoutEchoKicker.length ? withoutEchoKicker : kickers, kickerUses, [history.lastKickerTheme], history.lastKickerId, random);
    kickerUses[kicker.id] = (kickerUses[kicker.id] || 0) + 1;
  }
  phraseUses[phrase.id] = (phraseUses[phrase.id] || 0) + 1;
  return {
    ...history, phraseUses, kickerUses,
    themes: [...(history.themes || []), phrase.theme].slice(-2),
    lastKickerId: kicker?.id || history.lastKickerId,
    lastKickerTheme: kicker?.theme || history.lastKickerTheme,
    current: { phraseId: phrase.id, kickerId: kicker?.id || "", section: context.section, text: messageText(phrase, kicker, context) },
  };
}

/** Cosmetic history is device-local, kept out of progress and cloud writes. */
export function createMotivationController({ storage, now = () => Date.now(), random = Math.random, options = MOTIVATION_OPTIONS } = {}) {
  let history = {};
  try {
    const saved = JSON.parse(storage?.getItem(MOTIVATION_STORAGE_KEY) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const useCounts = value => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
        .filter(([, count]) => Number.isSafeInteger(count) && count >= 0));
      history = { ...saved, phraseUses: useCounts(saved.phraseUses), kickerUses: useCounts(saved.kickerUses),
        themes: Array.isArray(saved.themes) ? saved.themes.filter(theme => typeof theme === "string").slice(-2) : [] };
    }
  } catch { /* Cosmetic storage may be blocked or unreadable; study still works. */ }
  const persist = () => { try { storage?.setItem(MOTIVATION_STORAGE_KEY, JSON.stringify(history)); } catch {} };
  const keyFor = context => `${context.section}:${context.countdown}:${context.streak}:${context.complete}:${context.zeroWork}:${context.days}:${context.registered}`;
  return {
    get(context, today, { revisit = false } = {}) {
      if (!context) return null;
      const timestamp = now();
      const key = keyFor(context);
      const current = history.current;
      const phrase = eligiblePhrases(context).find(item => item.id === current?.phraseId);
      const kicker = phrase && eligibleKickers(phrase).find(item => item.id === current?.kickerId);
      const validKicker = context.section === "pressure"
        ? (current?.kickerId ? Boolean(kicker) : phrase?.optionalKicker)
        : !current?.kickerId;
      const valid = phrase && validKicker && current?.section === context.section
        && current?.text === messageText(phrase, kicker, context);
      const validTimestamp = Number.isFinite(history.selectedAt) && history.selectedAt <= timestamp;
      const rotate = !valid || !validTimestamp || history.day !== today || history.contextKey !== key
        || (revisit && timestamp - (history.selectedAt || 0) >= options.returnAfterMs);
      if (history.dismissedDay === today) return { dismissed: true };
      if (rotate) {
        history = { ...selectMessage(context, history, random), day: today, contextKey: key, selectedAt: timestamp };
        persist();
      }
      return history.current;
    },
    dismiss(today) { history = { ...history, dismissedDay: today }; persist(); },
    restore() { history = { ...history, dismissedDay: "" }; persist(); },
  };
}
