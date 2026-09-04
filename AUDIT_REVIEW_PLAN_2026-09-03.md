# MCAT Momentum — independent audit review and implementation plan

**Date:** September 3, 2026  
**Status:** Core implementation and independent review completed September 3, 2026. User authorized commit and push after verification. See [implementation handoff](IMPLEMENTATION_HANDOFF_2026-09-03.md) for verification and remaining device checks.  
**Baseline:** working tree at `1154712`, plus the existing untracked `AUDIT_2026-09-03.md`.  
**Relationship:** This reviews the [original audit](AUDIT_2026-09-03.md). Its observations remain useful; the decisions and implementation order below supersede its proposed fixes where they differ.

## 1. Recommendation

Keep the visual identity, the five main destinations, native disclosures, and the static application architecture. A framework migration or full visual redesign is unnecessary. The strongest improvement is to make each screen put its immediate job first and disclose reference material only when needed.

The original audit correctly identifies the clipped Today title, repeated assignment information, heavy Plan DOM, hidden mobile Log tabs, and weak completion feedback. It misses several more consequential issues: Undo can be reversed by a later merge, Plan checkboxes erase unsaved editor text, and daily counts accept invalid numbers. Fix those alongside the core usability work.

Three important changes to the original recommendations:

1. **Keep actual counts honest.** Checklist completion and recorded question counts currently represent different things. Do not silently overwrite actual counts with targets or clear them when reopening work.
2. **Completion should allow closure.** Celebrate finishing today's plan without immediately making overdue work the primary demand. Tomorrow and optional review are enough.
3. **Preserve interaction continuity before adding motion.** Stable inputs, focus, Undo, and modest rendering cost are part of the celebration experience, not separate polish.

## 2. What was checked during the original review

Read the full original audit, current handoff, and the relevant view, storage, daily-task, routing, toast, export, and rendering code. No `AGENTS.md` was found in the workspace search.

Interactive checks used a disposable copy of the current static application, served on `127.0.0.1:8927`, with empty sync configuration and synthetic local records. No real credentials or cloud progress were used. Only the copy's sync configuration differed from application source. Its local-only banner contributes extra height and is not a production defect.

Checked at **390×844**, **375×667**, and **1280×900**, with screenshots and DOM/accessibility inspection. Walkthrough included individual and whole-day completion controls, assignment editing, Plan expansion and filtering, unsaved notes, diagnostic saving, mistake capture, retest resolution, Mastery rating, Export options, Guide search, keyboard skip navigation, deferral, protected rest, and the after-plan view. The deployed Pages entry screen was also inspected read-only; it presented the expected sign-in gate.

Additional small Node reproductions exercised existing checklist handlers with the real merge function and rendered a seven-item repair queue. These were investigative checks, not added test files.

**Limits:** No authenticated production walkthrough, live two-device sync, actual iPhone screen-lock timing, screen-reader speech output, full backup round trip, populated chart screenshot, or CPU-throttled performance benchmark was performed. Findings below distinguish browser observations from code/fixture evidence. No full test suite was run for this documentation-only change. The local and deployed entry screens emitted no captured warning/error logs during inspection; that is not a comprehensive browser-console guarantee.

### Reproduced measurements

| Measurement | This review | Interpretation |
|---|---:|---|
| Today heading at 390 px | 72 px visible / 144 px content | Confirms D-01 precisely |
| Today action card at 390 px, fresh state | ~1,299 px | Confirms the density problem; height varies with environment and state |
| Today document height at 390 px | ~3,060 px | Includes the local-only banner |
| Unfiltered Plan DOM elements | 16,697 | Matches P-01 |
| Plan view HTML | 940,377 characters | Roughly the original figure; this is string length, not transferred bytes |
| Plan textareas / selects | 145 / 149 | All daily editors are eagerly built |
| First Plan day, initial phone view | ~1,528 px from document top | Navigation and filters bury the actual schedule |
| First exam card, initial phone view | ~1,283 px from document top | Empty analytics precede the useful action |
| Full checklist completion | 1/7 days; 0/24 questions; 0/13 CARS | Confirms the semantic mismatch in B-01 |

The original 194 ms rerender measurement was **not** independently repeated. Its prediction of 0.5–1.5 seconds on phones is a hypothesis, not a measured mobile result. Likewise, “~300 px saved” and “one tenth of the nodes” are estimates to validate after implementation.

## 3. Decisions on the original audit

| Original item | Decision / refinement |
|---|---|
| D-01: heading clipping | Accept. Use a short meaningful subject heading, e.g. **Gen Chem + CARS**, with `3 chapters · Rapid review` underneath. A tooltip or long `aria-label` is not a replacement for visible full task names. |
| D-02: repeated facts | Accept. Remove the repeated chapter line and Today fact grid. Keep full task labels and resource/mode context once. Preserve time limits, maintenance, and special instructions that the checklist does not express. |
| D-03: duplicate progress | Accept. Keep one weekly summary. Do not repeat phase, percentage, and day fraction in neighboring cards. |
| D-04: placeholder countdown | Accept. Quiet date-setting link until a registered date exists. Even a registered countdown should remain secondary to today's work. |
| D-05: empty Log | Accept with narrower conditions. Empty repair patterns depend on relevant entries; Mastery progress can exist with zero mistakes and must not disappear just because `mistakes.length === 0`. |
| D-06: Plan navigation | Simplify more decisively: show the current week before phase/reference content. Keep one persistent current-week jump, including when no backlog exists. One main reset; a contextual empty-results recovery action is also reasonable. |
| D-07: Guide navigation | Accept. Search + question-based shortcuts + accordion. Remove the parallel chip index. Hide shortcuts while searching if they compete with results. |
| D-08: Mastery null copy | Accept. Give confidence controls meaningful accessible names on every viewport, not only desktop. Keep “not rated” distinct from zero confidence. |
| P-01: Plan rendering | Prefer lazy editor mounting first, preserving opened editors and drafts. Only add targeted view patching if measurement still justifies it. Neither arbitrary virtualization nor a rewrite is needed for 145 summaries. |
| B-01: missing actual counts | Observation accepted; proposed write/clear behavior rejected. See §5. |
| B-02: timer | Accept elapsed-time calculation. Preserve the documented pause-on-leaving-Today behavior; distinguish route changes from backgrounding/locking the device. Screen-lock behavior still needs hardware verification. |
| B-03: offscreen tabs | Accept. Scroll the active tab within its own container; avoid moving the whole page. Prefer visible overflow affordance or wrapping over a permanent mask that fades useful text/focus outlines. No need to fix a Guide chip row being removed. |
| B-04: focus history | Show a small saved-session summary in Completed. Do not discard existing history. |
| B-05: motion setting | Use the existing field only with explicit, validated reduced-motion semantics. Do not make “Always celebrate” secretly override the OS setting. See §7. |
| B-06: unscored diagnostic | Accept, but new raw/percentage fields must be distinct from scaled fields. Do not relabel old 118–132 values as percentages. Update exports and readiness/chart exclusions together. |
| B-07: capture friction | Accept. Add reachable capture near the checklist; staged capture requires explicit incomplete-entry handling throughout repair, summaries, export, and import. |
| S-01: completed Today | Accept as part of the same Today redesign, not a later phase after animation. Avoid sudden collapse under the focused final checkbox. |

**Source corrections:** The current generator is `scripts/generate_site_data.py`, not the original audit's suggested `scripts/build_mcat_tracker.mjs`. Do not hand-edit `data/site-data.json`. Current Today displays the oldest **three** overdue rows with an explicit total and View all link (`today.js:50`), despite older handoff prose describing an uncapped Today list. Preserve the current visible-total/full-list route unless intentionally revisiting that decision.

## 4. Additional findings

### R-01 · High · Undo does not survive merging an already-synced completion

**Evidence: code + executable reproduction.** `js/views/shared.js:35–52` and `:130–147` restore `previousRecord` with its old timestamp, or delete the day when no prior record existed. `js/storage.js:194–206,232` merges daily records by their own timestamps and has no daily deletion tombstone.

Using the existing task click handler, copying its completed state as the hypothetical cloud version, invoking Undo, and merging the two produced:

```text
Prior record absent:   Undo -> absent       Merge -> complete
Prior record present:  Undo -> in-progress  Merge -> complete
```

This is a deterministic merge failure, not an observed production-sync incident.

**Plan:** Treat Undo as a new daily edit. Restore prior semantic values with a fresh `updatedAt`. When the old record was absent, save an explicit neutral `not-started` record with no completed tasks and a fresh timestamp instead of deleting the key. Preserve the existing guard against overwriting a newer edit. Keep actual counts/notes exactly as they were before the action, apart from the timestamp. Share this helper between whole-day and step Undo.

**Acceptance:** Complete → sync snapshot → Undo → merge stays undone in both cases. A genuinely newer remote edit still defeats stale Undo. Update tests that currently assert byte-for-byte restoration of the old timestamp.

### R-02 · High · Plan task clicks discard unsaved editor data

**Evidence: browser + code.** Open Sep 1 in Plan, type `AUDIT unsaved note`, then check `Review PHY10`. The note becomes empty immediately. `app.js:370–398` rebuilds the view; `view-state.js:19–56` restores disclosures, scroll, and selected focus anchors, but not field values. The dialog-specific wrapper in `shared.js:75–98` does preserve drafts; a corresponding modal check retained the note.

Other continuity problems share this cause: an exam card closes after Save because it has neither an `id` nor a `data-view-key`; ordinary editor fields lack stable focus keys. Sync-triggered full rerenders can affect those mounted editors too (code evidence; no live sync test).

**Plan:** Preserve dirty drafts by entity and field, separately from committed tracker records. First cover mounted Plan editors, then exam editors. Give disclosures and inputs stable keys, preserve caret/selection, and keep the editor mounted when its own checklist changes. Do not equate DOM focus restoration with draft protection. Across navigation, provide recoverable local drafts or an explicit dirty-form decision; never silently discard text.

**Acceptance:** Unsaved notes/counts survive step toggles, saves elsewhere, and a simulated sync update; intentional filter/route changes have a defined recovery policy. Fresh remote data may update untouched fields but cannot silently replace dirty ones.

### R-03 · High · “Save day” accepts negative and fractional counts

**Evidence: browser + code.** Enter `-5` in Actual questions and Save day. The dialog closes successfully, the weekly meter becomes **-5/24**, and reopening shows `-5`. `shared.js:213–247` uses a plain button outside a validating form and converts values with `Number(...)`; `min="0"` alone does not enforce the constraint. Saving untouched blanks also converts unknown counts to zero.

**Plan:** Use a form submission with explicit finite, nonnegative integer validation, an inline field error, and retained input on failure. Preserve blank as unknown. Explain the unit as `QBank questions (excluding CARS passages and full-length exams)` if that is the intended metric. Validate imported values consistently or present legacy-invalid values for correction rather than silently rewriting them.

Also clamp a progress bar's ARIA value and visual width to its valid range while retaining an honest text total for legitimate over-target work (`shared.js:155–157`).

**Acceptance:** Negative, fractional, and non-finite input cannot save; blank differs from explicit zero; above-target counts remain valid and readable; failed saves preserve all draft fields.

### R-04 · Medium · Skip navigation sends the person to Today

**Evidence: keyboard/browser + code.** From Guide, activate “Skip to main content.” The URL becomes `#view-root`, and the page becomes **Today**. `index.html:27` uses an in-page hash that `router.js:3–10` interprets as an unknown route and falls back to Today.

**Plan:** Handle this link as an in-page focus action without invoking routing, or distinguish document anchors from app routes. Focus the current main region and keep the current route.

**Acceptance:** Skip works from every primary route and subview without changing content or discarding drafts.

### R-05 · Medium · Guide search loses keyboard focus after its debounce

**Evidence: browser + code.** Type `sleep`; four matching sections appear, but `document.activeElement` becomes `BODY`, not the search input. `guide.js:70` rebuilds the root after 250 ms, and the input lacks a stable focus key. This interrupts typing whenever the person pauses. Log entry search uses a similar rerender path (`log.js:370`) and should be checked in the same fix.

**Plan:** Keep search controls mounted and patch results, or restore input focus, selection, and composition state explicitly. Announce only the result count. Provide a visible Clear search action for empty results.

**Acceptance:** Type, pause, continue typing, select/edit text, and use IME composition without losing focus or moving the caret.

### R-06 · Medium · Repair queue hides extra due entries and cannot reschedule in place

**Evidence: code + fixture; dialog inspected in browser.** `log.js:129` renders `priority.slice(0, 6)` with no remaining-count link. Seven synthetic due entries yielded `7 today`, six cards, and no Show all/Load more control. Further entries become visible as earlier ones are resolved, but cannot be directly reached from the queue. Entries is an alternate route, not an adequate overflow cue.

The Record retest dialog offers **Scheduled** but no new date; its save handler leaves the old `retestDate` unchanged (`log.js:274–283`).

**Plan:** Show `Showing 6 of N due` and a paginated/full due queue. Replace vague status choices with clear outcomes such as Resolved / Needs another retest; the latter requires a next date. Keep manual status editing available where appropriate. Use the same due-entry predicate for Today, badges, queue, and filtered Entries.

**Acceptance:** Every due entry is discoverable without resolving another first. Rescheduling moves it to the chosen date. No result/date disappears during failed saves.

### R-07 · Medium · Exam completion is separate from daily completion

**Evidence: browser + code.** Saving the diagnostic with Exam completed checked increments Exams to 1/8. The handler writes only `state.exams`; Plan/Today derive completion only from `state.daily` (`exams.js:151–169`, `daily.js:76–122`, `data.js` study-row derivations). A person can report an exam complete and still see its scheduled day as unfinished. Review status is a third, separate concept.

**Plan:** Define the relationship explicitly before adding exam celebrations. Recommended: completing an exam through Exams offers a clearly labelled “Also complete the scheduled exam day” action, defaulted on where the mapping is unambiguous, committed in the same state update. Completing a schedule day must not fabricate scores or claim its review is complete. Show a quiet link for mismatches in existing records; do not bulk reconcile historical data silently.

**Acceptance:** Exam taken, scored result, scheduled-day completion, and protected review completion are accurately represented. A multi-day exam review is never all completed by a single exam checkbox.

### R-08 · Medium · Score chart mixes two scales with only one labelled axis

**Evidence: code inspection, not populated-chart visual verification.** `exams.js:112–132` overlays total scores mapped to 472–528 and section scores mapped to 118–132, but labels only the total axis. The accessible name promises only a total trend. Empty analytics also push the first editable exam below the first phone screen.

**Plan:** Lead Exams with the next/recent exam action. Show total trend first and a separate labelled section-trend view or small multiples, plus a compact accessible value table. Distinguish official and third-party sources. Keep diagnostic results out of scaled charts and readiness. When all four section scores exist, validate that a manually edited total agrees with their sum; allow clearly identified total-only entries.

**Acceptance:** A reader can identify series, units, dates, and source without relying on color. Empty charts become one useful prompt. Raw diagnostic percentages never enter readiness calculations.

### R-09 · Medium · Accessibility announcements are broader than the changes

**Evidence: markup/code.** `index.html` marks the entire frequently replaced `#view-root` as `aria-live="polite"`; the timer is also a live output updated every second (`today.js:159,208–209`). Combined with the toast, this can produce redundant/noisy announcements. Actual assistive-technology speech has not been tested.

**Plan:** Use a dedicated small status region for task completion, save feedback, and result counts; ordinary main content should not be a live region. Announce timer start/pause/finish, not every second. Give confidence buttons labels such as `2 — Explain` at all sizes. Preserve visible focus and measure contrast and zoom/reflow during implementation.

This follows the purpose of [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): announce meaningful status without requiring focus movement. It does not establish whole-site WCAG conformance.

### R-10 · Low/medium · “Start block” and “Continue today” lack a useful next action

**Evidence: code.** `today.js:193–196` changes status to `in-progress` and shows a toast. “Continue today” calls exactly the same write again; it does not open a study workspace, focus the next task, or start the separate optional timer.

**Plan:** Make the checklist the primary interaction. Remove the redundant start-state write, or make Start/Continue focus the next incomplete item with a real purpose. Keep `Start 25-minute timer` explicit and optional. Whole-day completion becomes `Mark all steps done`, secondary to individual checks.

**Acceptance:** Every prominent verb changes something useful and predictable; “Continue” does not merely resave an unchanged status.

### R-11 · Low/medium · Mastery links depend on exact free-text equality

**Evidence: browser + code.** A synthetic unit-conversion mistake did not relate to the dimensional-analysis mastery topic; `log.js:197,209` compares the entry's free-text topic with the full mastery topic string. Similar language is not linked, so the apparent lack of evidence can be misleading.

**Plan:** Add optional explicit mastery-topic selection to capture/edit and store stable topic IDs, keeping free-text descriptions. Use exact legacy matching only as a fallback. Avoid automatic fuzzy assignment of educational evidence. Offer quick confirmation of suggested links later if needed.

**Acceptance:** Related mistake counts and repeated-topic filters use explicit links consistently; older records remain readable without a forced migration.

## 5. Actual counts: resolve B-01 without inventing work

The current behavior preserves user-entered counts intentionally; the handoff and checklist tests document this. The bug is primarily that the UI calls missing counts “complete” while presenting checklist completion as the normal workflow.

**Recommended first release:**

- Keep one prominent weekly metric: **study days completed**.
- Rename the other figures **Recorded QBank questions** and **Recorded CARS passages**, and present missing values as unrecorded rather than proof of zero work.
- Put an optional compact count editor beside the practice steps or in the completed summary. Offer **Use planned amounts: 8 questions, 1 passage** as an explicit action. Let the person edit first if they stopped early.
- Save actual values only through that explicit count action/editor. Existing counts, including explicit zero, always win over suggestions. Reopening a task never erases them.
- Celebrate completed steps/days even when counts are absent. Do not hold the requested day celebration behind optional bookkeeping.

If a later design wants checking a quota task to record its stated quantity automatically, first add structured task metadata (`kind`, `quantity`, `unit`, `source`) and provenance for suggested versus user-recorded counts. Do not infer this from `practice:0`/`practice:1`: order differs across days, including mixed CARS and Section Bank work. Preserve existing task IDs during a metadata addition.

No numeric result should mix inferred planned quantities with actual records under an “actual” label. Avoid percentages based on incomplete count reporting.

## 6. Screen plan

### Today — one actionable card

Suggested hierarchy:

```text
Today                           Week 1 · 1/7 days
Gen Chem + CARS
3 chapters · Rapid review
Stop after 3.5 hours · View full guidance

Your checklist                                  2/5
[ ] Review GC04 · Compounds and Stoichiometry
[✓] Review CARS01 · About CARS
[✓] Review CARS02 · Analyzing Rhetoric
[ ] Complete 8 UWorld topic questions + review
[ ] Complete 1 CARS passage

Log a question     Assignment details
Mark all steps done                     [secondary]

Optional: Start 25-minute timer
2 unfinished days · Review in Plan       [compact]
Tomorrow: formula recall + diagnostic logistics
```

Use a short subject summary rather than a generic “3 chapters” heading alone. Keep exact full names in the checklist/details. Resource and mode can be compact group context when shared; do not repeat “Rapid review” under every identical row if it is already clear above them. Keep task-specific exceptions.

Preserve a prominent applicable stop rule. Today's `~2.5–4 hr` advisory estimate and “Stop after 3.5 hours” can appear contradictory; explain the distinction and make the stop rule primary. Do not regex-delete arbitrary clauses from source notes. Add a reviewed short display summary in authoritative source data if necessary, retaining full notes in details.

Move chapter subsections/study-method essays below editor controls inside Assignment details. “Review what you logged” should either show actual logged entries or be renamed “Review day”; it currently opens assignment details, not a filtered mistake history.

On a protected rest day: show **Rest is today's plan**, suppress `Not started`, omit zero quotas, and keep backlog available as a quiet link. Do not transform recovery into a catch-up assignment. For exam, review, before-plan, gap, and after-plan states, use the same hierarchy with appropriate language rather than forcing the ordinary chapter template.

### Completed Today

```text
✓ Today's plan is complete
5/5 steps · Week 1: 2/7 study days
Tomorrow: Light formula recall + diagnostic logistics

Review completed steps       Log a question
Undo                         [while available]
2 unfinished days · Review when useful   [secondary]
```

Numbers here are illustrative. Generate them from committed state. Do not show advisory hours as time actually studied. Keep completion summary available on reload without replaying effects. Make completed steps expandable and reopening explicit.

During the finishing interaction, preserve the clicked control and scroll position. Show acknowledgement beside it immediately; do not collapse a tall list from under keyboard focus or force-scroll to the card top. The compact summary can be the next-entry presentation, or collapse after an explicit action with focus moved deliberately.

### Plan

Order: current-week schedule → compact filter/disclosure controls → other weeks → optional phase/guidance overview. Keep full schedule and deep links. A week switcher is optional; a second calendar/grid navigation is not necessary.

Render all lightweight week/day summaries; lazily mount expensive editor content only when opened. Hydrate deep-linked and restored-open days before restoring focus/scroll. Bind task/save handlers exactly once per mounted editor. Preserve dirty editors when closed; invalidate clean cached content when state changes. Use the same rules for the full backlog view.

Measure before introducing targeted summary patches. Those patches must update every visible occurrence of a date, weekly totals, filtered membership, and Completed counts; an isolated visual tick that leaves other surfaces stale is not an optimization.

### Log, Repair, Mastery, and Export

- Make all five section choices discoverable at phone width: compact wrapping navigation, or a horizontally scrollable strip with an active item kept visible and a clear overflow affordance. Prefer removing descriptive subtitles from every tab before adding controls.
- For quick capture, retain default date/result, ask for source + question reference or short topic, and allow **Save for review**. Detailed cause/reasoning/fix are required for completing the repair record, not for capturing a reminder mid-session. Store an explicit capture-completeness state and keep it distinct from retest status. Legacy complete entries remain complete.
- Repair opens with **Needs review** and **Due retests**, then patterns only when they add useful evidence. Empty queue = one message + next action.
- Entries on phones should offer a readable compact row/card containing topic, source/date, and retest state; move nine filters behind one Filter control. Keep the full table for desktop/export.
- Mastery retains all 40 topics and section filters; use plain confidence labels and explicit evidence links. No repetitive absence messages.
- Export leads with **Back up all data (JSON)** / **Restore backup**, then XLSX and CSV under Reports. Preserve the existing validation and safety-backup workflow. Remove unrelated four-stat overview and implementation-oriented phrases from this task flow.

### Exams and Guide

Exams: next/recent exam + record action first, registered-date setting compactly nearby, then available evidence and collapsed readiness rules. Avoid four panels of missing data before the first form. Add an actual taken date only if date-shifted exams need support; otherwise label existing chronology as planned dates rather than implying it is actual chronology.

Guide: keep the useful question-based shortcuts and searchable accordion, fix focus, and remove the source-fidelity developer note from the everyday reading path. Put provenance in an About/reference disclosure or repository docs. Do not remove substantive study guidance to achieve a height target.

## 7. Celebration design and event contract

### Visual behavior

| Event | Feedback |
|---|---|
| Individual step completed | Check appears immediately; a 120–180 ms stamp on that checkbox and a brief progress accent; concise Undo feedback. No particles per step. |
| Today's final step or explicit Mark all | Static success summary immediately; one small 0.8–1.2 s burst near the completed control/card, optional; short check-draw animation. |
| Older/future day checked in Plan or backlog | Date-specific acknowledgement and Undo. Same respect for completed work, lower visual intensity in a navigation-heavy view. Never say “Today complete” for another date. |
| Week completed | One enhanced message using the week milestone. Replace the day burst with the week treatment; do not stack animations. Defer this tier until daily feedback is reliable. |
| Reopen, Undo, sync, import, reload, route entry | Update the static UI appropriately; no celebration effect. |

No sound or vibration in the initial release. They add settings/support concerns without solving the main feedback gap. A motion-free completion state is a first-class design, not a lesser toast-only fallback.

### Triggering and deduplication

The original two-line edge test is necessary but insufficient: it does not by itself suppress re-completion after Undo, double triggers on the final step, duplicate bindings, or route-specific presentation.

Use one shared completion-action path with an explicit transient event payload: action ID, row/date, origin surface, previous/committed status, changed task ID, and Undo action. Emit only after local persistence succeeds; do not wait for cloud sync. The rendering function reads committed state; it must never infer an animation simply because a record is complete.

Track celebrated row/date IDs in a session-scoped set, outside synced study records, to suppress replay on immediate Undo/recheck. Reload/import/sync emit no user-completion event. Suppress bursts for date previews. If day and week finish together, choose the higher tier once. Nonfinal steps stay Tier 1. A completion animation failure must never prevent saving or Undo.

For assignment dialogs, animate/acknowledge inside the active dialog; a body-level canvas can sit beneath the browser's dialog top layer. Do not move focus out of the dialog to a Today panel behind it. Status-dropdown saves may stay quiet bookkeeping, as in the original audit.

### Undo and focus

First ship R-01. For the smallest reliable implementation, retain the existing toast-owned Undo action and keyboard shortcut while adding the visual summary. If Undo appears in both toast and panel later, extract one action controller with shared expiry, validity, and focus handling. Do not reach into `toast.js`'s private `undoButton` reference from the celebration module.

Do not duplicate speech announcements across checkbox, panel, and toast. State the meaningful transition once, e.g. “Today's plan complete. Week 1, 2 of 7 study days.” Retain the current focus unless its control must disappear; in that case provide a deliberate focus destination.

### Motion preference

Make the label describe what the stored field means: **Reduce motion: Use device setting / On / Off**. Default to System; On disables movement. Any explicit Off override needs clear wording. If a separate “celebrations off” option is desired, add a separate validated setting rather than overloading reduced motion, sound, and haptics into one enum. Unknown/legacy values fall back to System.

Check the effective preference in JavaScript before allocating canvas or scheduling frames, and apply the same preference to CSS animations. Cancel active effects on navigation, lock, tab hiding, or preference change. Keep the completion summary and Undo regardless. [W3C guidance on interaction-triggered animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) supports making nonessential motion disableable.

A small locally implemented canvas effect or a few SVG particles are both viable. Use one bounded surface, cap particle count/device-pixel ratio, avoid layout reads per frame, and clean up on completion/cancellation. Do not prescribe 80 particles or an “80-line module” before profiling. No new framework or animation package is needed for this scope.

### Streaks

Do not ship the proposed `completionStreak()` as a “study streak.” Daily keys are scheduled dates; `updatedAt` is edit time, not study time. Checking off old days today could produce an apparent multi-day streak. Its sample function also drops to zero at the start of an unfinished current day.

Use **2/7 scheduled study days completed** instead. A later true activity streak would need separately defined activity dates, local-day/timezone rules, rest behavior, and historical migration policy. That complexity is unnecessary for the requested celebrations.

## 8. Other worthwhile optimizations

1. **Load ExcelJS only for XLSX export.** `index.html` currently loads the ~928 KiB local vendor file on every visit, including sign-in and Today. `js/export.js:187` only needs it for workbook creation. Use one shared load promise, explicit loading/error/retry state, and preserve local vendoring. Do not delay JSON/CSV export behind it. File size is uncompressed disk size, not measured network transfer.
2. **Timer correctness and visibility.** Derive elapsed time from timestamps plus accumulated active duration; intervals only repaint. Keep pause-on-route-change, handle background resume correctly, and never credit more than the defined block. Do not round a zero-second session into a minute. Background timers can be throttled, so repaint ticks cannot be the clock ([MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)). Show saved session time in Completed; refresh persistence is a separate explicit product choice.
3. **Avoid unnecessary derived-data work.** Index schedule rows by week and counts once where appropriate, and cache task definitions for immutable schedule data. This is secondary to removing 145 mounted editors. Keep state-derived progress fresh.
4. **Date rollover behavior.** The current date is evaluated during rendering, with no dedicated midnight/foreground refresh in the inspected app. Add a date-change check on foreground return so a long-open page cannot invite work on yesterday's card. Preserve drafts/running-session identity; validate actual device behavior before choosing a periodic timer.
5. **Keep the style, reduce nested panels.** Use fewer borders, uppercase eyebrows, and tiny explanatory labels. Spend space on task titles and controls; reduce density by removing repetition, not shrinking text or tap areas. Treat 44 px touch controls as a design target and test 200% zoom, keyboard navigation, and small widths.

## 9. Implementation sequence and gates

Implementation was subsequently authorized and completed in this task. Checked items below are implemented; gates describe the intended verification bar, not a claim that every device scenario has been exercised. Current results and limits are in the [implementation handoff](IMPLEMENTATION_HANDOFF_2026-09-03.md).

### Stage 1 — trustworthy actions and uninterrupted editing

- [x] R-01: fresh-timestamp Undo, including absent previous records.
- [x] R-03 + B-01: validated optional actual counts, honest labels, preserve unknown/zero distinction.
- [x] R-02: Plan draft preservation and stable focus/disclosures; reuse for exam editors.
- [x] R-04/R-05/R-09: skip-link routing, search continuity, scoped announcements.

**Gate:** Meaningful regression tests for merge-after-Undo, newer-edit guards, rejected storage writes, invalid counts, and dirty form retention. Manual keyboard verification from all routes. No animation yet relies on unreliable data.

### Stage 2 — Today redesign and completion feedback, one coherent change

- [x] Short subject heading, single actionable checklist, prominent stop rule, reachable capture.
- [x] Remove repeated chapter/fact/progress panels and demote placeholder countdown.
- [x] Distinct completed/rest/exam/review/off-schedule states with explicit reopening.
- [x] Tier 1 + Tier 2, reduced-motion handling, persistent static summary, session replay suppression.
- [x] Keep Undo usable and preserve final-checkbox focus/scroll.

**Gate:** At 375×667 and 390×844, the heading, useful next action, and first checklist item are reachable without a wall of reference prose. Aim for a material reduction in the ~1,299 px card (initial design budget roughly 800–900 px for this five-step day), not a hard maximum on long assignments or zoomed text. Validate no title/content clipping. Check final-step, Mark all, modal, Plan, older day, failure, Undo/recheck, sync/import/reload, reduced motion, and preview-date cases. Effects never block the next tap.

### Stage 3 — Plan and initial-load performance

- [x] Current week first; consolidated navigation and filters.
- [x] Lazy daily editor hydration with restored-open/deep-link support.
- [x] Scoped single binding, dirty-editor preservation, clean cache invalidation.
- [x] On-demand ExcelJS and measured derived-data optimizations.

**Gate:** Closed Plan days create no editors. Initial DOM size falls substantially from 16,697 elements; record actual results before setting a fixed budget. Measure tap-to-visible-feedback and full action cost on the same browser/device before/after, including CPU throttling or a real phone. Aim for responsive feedback within ~100 ms on the chosen reference device and no repeated long stalls. Deep links, filtering, all backlog entries, notes, Undo, focus, scroll, and both visible instances of a date stay correct. Do not claim a phone speedup from desktop render-string timing alone.

### Stage 4 — repair and exam workflows

- [x] R-06: all-due access and in-place rescheduling.
- [x] B-07: staged capture with a separate Needs review queue and backward-compatible exports/imports.
- [x] B-06/R-07/R-08: diagnostic-specific fields, exam/day relationship, clear charts and totals validation.
- [x] B-03/D-05/D-08: visible Log navigation, useful empty states, readable confidence controls.
- [x] R-11: optional stable mastery-topic links.

**Gate:** Complete one synthetic cycle: capture incomplete reminder → finish repair → schedule → retest → resolve → find entry. Repeat with seven due entries. Test old/new backup data and diagnostic/scaled records separately. Confirm exam completion never fabricates score or multi-day review completion.

### Stage 5 — supporting polish

- [x] B-02/B-04: elapsed-time timer and saved-session summary.
- [x] Guide simplification, source-note relocation, Export/Reports hierarchy.
- [x] Foreground date rollover refresh; responsive and keyboard fixes.
- [ ] Remaining physical-device, zoom, screen-reader, and two-device verification; see handoff.
- [ ] Optional weekly milestone treatment after observing daily celebration frequency. Deferred intentionally; daily feedback is implemented.

**Gate:** Relevant existing regression suite passes; no generated data/source drift; document real-device timer findings and any deferred platform limitations. Run the full repository suite once implementation is ready, then repeat only checks affected by later changes.

## 10. Reproduction checklist for implementation review

1. **Clipping/density:** fresh local state, Sep 3, 390 px; inspect Today heading visible vs scroll height and full card height.
2. **Counts:** complete all five steps; compare weekly day/count labels. Enter `-5`, then blank, then explicit `0`, then a valid over-target count; verify defined behavior.
3. **Draft loss:** Plan → current week → Sep 1 → type note/count → tick a chapter. Repeat in the modal and with a simulated state update.
4. **Undo merge:** retain a completed cloud snapshot → Undo locally → `mergeStates(undone, snapshot)`. Test absent and existing prior daily records, then a genuinely newer edit.
5. **Navigation:** Guide → keyboard Skip; type search, pause beyond 250 ms, continue. At 390 px, enter Mastery and ensure its active navigation remains visible.
6. **Repair:** render seven due entries and reach the seventh without completing another. Reschedule from the retest dialog and verify the next date.
7. **Special days:** inspect Sep 5 diagnostic, Sep 6–7 review, Sep 13 rest, dates before Sep 1, and Jan 25 after-plan. Preserve guidance and full backlog access.
8. **Celebration:** local final-step and Mark all success; local save failure; repeat click; immediate Undo/recheck; stale Undo; modal; past/future date; sync; import; reload; hidden tab; reduced motion; week/day simultaneous transition.

The success criterion is that someone can see what to do, record it accurately, finish with satisfying feedback, and leave without losing work or being pushed into more work.
