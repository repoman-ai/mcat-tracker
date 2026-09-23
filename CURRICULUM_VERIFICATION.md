# September 23 curriculum verification

- All 26 weeks and 182 continuous dates validated; date and exam IDs retained.
- All 83 chapters have explicit prerequisites/subsection links, first exposures, matching practice opportunities and at least four scheduled retrieval dates. Prerequisites precede dependent chapters; same-day blocks retain their listed order.
- Planned first pass ends December 21; first scored full length is December 26. March 19, 2027 remains the planning exam date.
- All 26 upper workload estimates fit their ceilings. Rest days, pre-exam Fridays and two post-exam review days are protected. Tight margins and reading/review uncertainty are documented in the audit.
- Totals reconcile: 222 UWorld science questions, 360 core Section Bank questions (120 per section), 240 optional reserve and 167 CARS passages including full lengths.
- 93 Node tests passed, including the Python workload suite invoked by the tests. Generator checks passed; repeated generation produced byte-identical website data. Git whitespace checks passed.
- Word guide rendered into six pages; every page visually inspected. Revised dates and guide tables checked.
- Workbook: all 182 dates and assignments match the CSV; six sheets, freeze panes and validations retained; independent log/mastery values and formulas and user-entry tracking cells preserved. Updated modes verified, no spreadsheet formula errors found. Preview images inspected across all six sheets.
- Local isolated Chrome checks passed at 320, 390 and 1440 pixels for Today, Plan, searchable chapter map and Exams. No page errors or horizontal page overflow. Retrieval check-off persisted after reload. A narrow-phone toolbar overflow was fixed.
- Browser tests used a mock account and backend. Production authentication and real cloud records were not modified. Existing saved records are retained; revised previously checked assignments display a recheck notice.

The source inventory contains chapter/subsection outlines, not full chapter prose. Practice pools are topic eligibility guidance, not verified vendor question IDs. First-pass completion remains a planned milestone subject to observed reading and review pace.

Local verification artifacts are under `../outputs/feedback-review/`: rendered document pages, workbook previews, browser screenshots, `browser-qa.json`, `workbook-qa.log` and `tests.log`. The final six-page Word render is in `docx-final/`.

## Feedback follow-up

Earlier P/S question blocks and the minimum four-hour week-19 reserve are covered by regression tests. All original date IDs, chapter exposure dates, retrieval/preview dates, CARS targets and exam/rest/review dates were compared with the pre-feedback snapshot and remain unchanged. The week-19 upper estimate is 502 of 780 minutes; all other upper estimates remain within their ceilings. The workbook was compared with the immediate pre-feedback file to verify saved status, independent logs, user-entry fields, freeze panes and validations remain intact. All six final Word pages and affected workbook ranges were visually verified.
