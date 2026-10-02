# Website sanity check — October 2, 2026

The curriculum and feedback revisions were already published in `44f5d74` and `a6995e8`. This follow-up fixes website behavior and clarity without changing dated assignments, chapter coverage, core targets, exam IDs, or the saved-progress schema.

## Fixes

- Chapter-map search keeps a chapter's heading, prerequisite explanation, retrieval dates and practice dates together. Changing the query returns to the beginning of the results, even when searching from deep within the sticky chapter-map view.
- Guide offers a direct Chapter map shortcut and explains that chapter IDs such as PS03 are searchable.
- Plan distinguishes weekly hour ceilings from estimated work, including answer review. Estimates stay visible on phones. Question totals explicitly separate UWorld science and Section Bank; CARS totals identify exam inclusion.
- Week 19's instruction to leave catch-up capacity unassigned remains guidance, not a required checkbox task. Other task IDs are unchanged.
- Explicit completion/reset through Save day acknowledges the revised assignment, matching the checklist controls. Partial progress does not silently acknowledge an old assignment. Notes, explicit zero counts and blank counts retain their meanings.
- Local module URLs share a release version so returning browsers load the matching module graph. The handoff now identifies the actual published curriculum and marks old notes as historical.

## Verification

- Full automated suite: 97 passed, zero failed, including schedule/workload integrity, storage and sync merge, authentication mocks, exports, routing, draft recovery, checklists, and 11 Python workload checks invoked by the suite.
- Focused rerun after the final search-position change covers Guide, UI workflow and tracked module resolution.
- Chrome at 320, 390 and 1440 pixels: all five main views render without horizontal page overflow or uncaught page errors. Checked visible navigation, chapter search, modal-to-Guide navigation, draft recovery, save/reload persistence, explicit zero counts, and the buffer-week display/checklist.
- All seven source hashes in `data/site-data.json` match the authoritative workspace files, including the schedule, plan, guide, workbook and chapter map. No source regeneration was needed for these UI changes.
- Existing saved progress was not reset or migrated. Browser QA used disposable mock accounts, not the owner's live account. Production authentication and actual cross-device synchronization were not exercised against private data.

Local screenshots and browser results are in `../outputs/site-sanity-2026-10-02/`. The prior Word/workbook layout verification remains in `../outputs/feedback-review/`; those artifacts were unchanged by this website-only follow-up.
