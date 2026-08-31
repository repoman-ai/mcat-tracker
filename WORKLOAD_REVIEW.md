# Workload review — August 31, 2026

## Decisions

`planned_hours` is the capacity budget, unchanged at 426 hours across preparation weeks. Estimates are an independent advisory model, not numbers forced to match that budget. Generation fails if a week's low estimate exceeds capacity. Midpoint/upper-bound overruns are shown in Plan; they call for scope reduction and reassessment using actual time. The midpoint is not a probabilistic prediction.

Front-loading all B/B and C/P banks into four content-heavy weeks was not worth retaining. The revised plan uses 20–30-question blocks from October 23 through January 6: 50/week in weeks 8–11, 100 mixed-science questions in each holiday float, and smaller early-week blocks in official-exam weeks. The 80 UWorld micro-quotas in weeks 8–11 are replaced by SB work, taking UWorld from 564 to 484. All 600 SB questions and all 83 chapters remain scheduled. No study-hour budgets were increased.

## Disposition of findings

1. **Agreed and rebalanced.** Weeks 8/11 change from 21.9–35.1 to 16.8–27.1 estimated hours; weeks 9/10 from 22.8–36.4 to 17.7–28.5. All SB blocks are at most 30 questions. Heavy Monday stacks are gone. Saturday blocks are timed checkpoints with review. Estimates remain ranges, not guarantees.
2. **Partly agreed.** Unknown modes lacked validation, and Rapid review depended on a fallback/override. But Light retrieval already matched the old `"retrieval" in mode_name` branch: January 12–14 were not zero-cost. Replaced loose matching with an explicit registry; unknown tokens fail before any special-day return. Added regression tests.
3. **Agreed.** Removed the Week 1 override. Each rapid-review chapter contributes 30–45 minutes; questions/review, CARS and maintenance are additive. A 3.5-hour execution stop rule remains separate and never changes the estimate or marks unfinished work complete.
4. **Agreed.** Removed the unreachable assignment-text logistics floor. Logistics is an explicit 20–45-minute mode.
5. **Mostly agreed.** Required logistics on January 15/18–21 are tasks, not rest. January 16 remains genuine rest with explicitly optional flashcards. The January 22/23 placeholders show a conditional 7.5–8-hour exam; neither is counted as a booked exam or added to preparation totals.
6. **Agreed.** Workbook validation requires the tracker tab derived from `prep_weeks`. A missing/wrong tracker tab now fails.
7. **Agreed.** Deduplicated mode labels and cards in the UI only. Raw tokens remain unchanged in source/export and still count per chapter.
8. **Agreed.** Removed wall-clock `generatedAt`. Unchanged source hashes produce byte-identical site data and content map on repeated generation.
9. **Agreed.** Exam dates/count and total/per-section SB targets come from plan configuration. Removed the unused singular-CARS normalization counter and content-map wording.
10. **Kept dates, added feedback.** October 24/31 and November 7/14 now explicitly contain timed 30-question science checkpoints inside the existing SB total. They give section-level feedback, not a scaled score or full-length stamina check. The October 10–November 21 full-length gap remains; adding an exam would displace content or protected review. January 9 stays the final full-length, preserving review and taper before the unconfirmed January 22/23 window.
11. **History retained; summary clarified.** August records are not active progress but remain recoverable in backups/sync. Import now separately reports current-plan and historical daily record counts; no records are purged.

An additional issue found during implementation: several full-length review Mondays had small UWorld/CARS quotas ignored by the old early-return estimator. Moved them to Tuesday–Thursday and added a validation guard against extra quotas or chapters on protected review/rest days.

## Remaining capacity risk

Preparation estimates total about 344–519 hours versus 426 budgeted, excluding the conditional test-window days. Every weekly low bound fits, but the midpoint exceeds budget in weeks 5–7, 12–16 and 18–19. These are visible warnings, not claims of guaranteed completion. If review runs long, stop new questions and replace lower-priority volume; reconsider the plan after two actual overruns. Do not increase hours or silently skip review to make a progress indicator green.

The unchanged exam schedule and small-block allocation are planning judgments, not AAMC requirements. General reference: [AAMC study-plan guidance](https://students-residents.aamc.org/prepare-mcat-exam/creating-your-mcat-exam-study-plan).

## Verification

- Ten Node test suites pass, including nine Python workload unit tests.
- Schedule continuity, unique chapter coverage, weekly question totals, holidays, exam/review placement, exported workbook and saved-state preservation pass.
- Unknown modes, missing tracker sheet, configured totals, additive rapid review, multiple SB blocks, logistics, conditional exams and capacity-risk behavior have regression checks.
- Two unchanged-source regenerations produce identical SHA-256 hashes.
- Updated local Word and Excel copies are generated from the same sources; old copies are archived. No private progress files are published to GitHub Pages.
- All 11 final Word pages and previews of every worksheet were visually checked; document table geometry, workbook values and preserved independent data pass verification.
