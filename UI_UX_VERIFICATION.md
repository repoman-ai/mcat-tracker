# Past-due and Plan UX verification — September 3, 2026

Verified in a local preview before committing and pushing. This report supersedes the diagnosis-only status in `PAST_DUE_UX_HANDOFF.md`.

## Browser reproduction

Tested in the Codex in-app browser using an isolated localhost origin, with the local preview server serving an empty sync configuration. The repository's `js/sync-config.js` and real account data were not changed.

Before changes, `?today=2026-09-20` reproduced 18 overdue days. View all reduced Plan to 3 weeks and 18 days, Plan navigation retained the filter, and the current-day deep link could not render its target. At 375 × 667, the list was 96px high with 76px rows. Saving Deferred left the same Past due label. Before the plan start, the backlog route showed no schedule.

## Implemented behavior

- Plan has a dedicated backlog section above the complete schedule. It opens on `#plan/past-due` and can be collapsed. Its rows open assignment details without duplicating the schedule's day editors.
- Every navigation into Plan resets filters, including tapping the already-selected Plan tab. Data saves retain intentional filters and view position.
- Explicit filtering shows a result count and a prominent full-schedule reset. Jump to current week clears filters and expands its target. Filters do not automatically expand every matching week; the current week and explicitly linked day retain their expanded context.
- Route resets and deep-link positioning are instantaneous, with an 88px sticky-header offset. Every navigation initially focuses the main view; Plan and Guide refine focus to the requested target. Guide positioning runs synchronously after mounting. Current-day cards have a Today label.
- Today places the current assignment and primary controls first. A compact backlog link remains above the assignment; the oldest three complete, wrapping backlog rows appear below it. There is no nested vertical scroller.
- Deferred labels and counts appear on Today and Plan; the schedule supports a Deferred filter. Backlog rows have Defer/Resume actions. Deferred remains unfinished and retains its original date; no rescheduling semantics were introduced. Defer/Resume preserves the prior status, including when Deferred is saved through the editor. Legacy records without a prior status use recorded checklist progress to distinguish In progress from Not started.
- Assignment dialogs have a completion button and live checklist feedback. Updates preserve unsaved notes, count edits, focus, and scroll position. Completion stays in the dialog so drafts remain available. Guide links close the dialog and reach the requested section.
- Guide navigation clears stale search filters that would hide the destination.
- Background tints, borders, and decorative accents are more subdued; state labels and focus indicators remain explicit.

## Verified in browser

At 375 × 667, 375 × 812, and 1280 × 900 across the original and follow-up reviews:

- View all retains 20 week cards and 145 schedule day cards, including today; backlog target lands at approximately 88px.
- Manual Deferred filtering shows the matching day and accurate count. Selecting Plan restores all 145 days.
- `#plan/2026-09-20` opens the day and its week at approximately 88px.
- `?today=2026-08-25#plan/past-due` shows No past-due days and the full schedule; week 1 jump works.
- A Complete filter that removes week 3 is cleared by Jump to week 3, restoring the full schedule and landing on that week.
- Three Today preview rows wrap naturally; no inner clipping or horizontal page overflow. After the follow-up change, the Start control for September 21 sits at approximately 481–525px, above the mobile navigation on both tested phone heights. The current assignment starts at approximately 321px, ahead of the preview.
- Defer/Resume updates labels immediately; completion removes the day from the backlog. An untouched September 3 record returns to Not started after Defer/Resume, and the Resume button has equal client/scroll widths (56px) with no text overflow.
- Dialog checklist toggles immediately show the checked state. Unsaved notes and question counts survive updates, including completion.
- Guide links work after a zero-results search and from inside an assignment dialog. Follow-up checks confirmed fresh loads and real clicks from the Plan phase map land at approximately 88px, with focus on the section summary. Log's repair route shows the repair panel; Today → Log a question and Today → Completed retain focus on the main view rather than the body.
- Plan focus-restoration keys are unique across backlog, summaries, and detail controls.

Automated validation: `node --test --test-reporter=tap --test-concurrency=1 tests/*.test.mjs` — 44 tests pass. Regression coverage includes full-plan navigation, retained filters on saves, deferred filtering, the empty backlog, exhaustive queue access, instantaneous scrolling, synchronous Guide binding, status restoration through Defer/Resume, and bounded week expansion. `git diff --check` passes.

Browser testing used synthetic dates and local-only records. Live cross-device sync was not exercised; all browser edits were isolated test records.

## Follow-up review decisions

The reported Guide failure did not reproduce in this browser before the follow-up edits: its section was already at 88px with summary focus. The asynchronous callback was nevertheless removed, and a direct binding regression test now enforces immediate landing. Missing fallback focus and Today's below-fold primary controls did reproduce and were corrected.

The subdued palette was retained because reduced saturation was explicitly requested. Showing a backlog summary alongside its scheduled days is intentional: removing those days from their weeks would violate the full-schedule requirement. The backlog remains collapsible. Duplicate/dead CSS rules and the unused Today import were removed.
