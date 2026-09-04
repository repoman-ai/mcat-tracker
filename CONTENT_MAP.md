# MCAT Tracker Content Coverage Map

This map shows where every authoritative source component appears. `data/site-data.json` is generated; it is not an editable source of truth.

| Authoritative source | Source component | Website location | Treatment |
|---|---|---|---|
| `schedule.csv` | All 145 dated rows | Today; Plan; Daily Schedule export | Today prioritizes the current/next action; Plan exposes every row and complete details. |
| `schedule.csv` + saved daily records | Pending and completed study days | Today Past due disclosure; Today → Completed; Plan | Unfinished work stays secondary to today. Completed includes saved historical records. No inferred completion dates. |
| `schedule.csv` | Assignments, resources, modes, targets, CARS, milestones | Today details; Plan day accordions; contextual Log prefills | Raw source text and per-chapter mode multiplicity are preserved; repeated modes are displayed once. |
| `plan.json` | Metadata, 20 weeks, targets, phases | Today; Plan; Guide | Planned hours, CARS, focus, and milestones use source values; QBank totals sum scheduled UWorld and Section Bank quantities. |
| `plan.json` | Preferred/fallback windows, placeholders, registration, readiness rules | Today countdown; Exams; Guide | January 22-23 remain clearly labeled placeholders until a registered date is saved. |
| `plan.json` + guide | Study modes and complete instructions | Today/Plan detail drawer; Guide | The plan summary is merged with the guide’s when-to-use and required-output rules. |
| `kaplan-mcat-books.md` | 83 chapter IDs, titles, and every subsection | Today/Plan chapter details; Log chapter selector | Generated directly; no second editable chapter-title list is maintained. |
| Study guide | Plan overview and What Changed | Guide → Plan overview / What Changed | Full extracted text, callouts, and lists. |
| Study guide | Operating Rules + study-mode rule | Guide; Today/Plan contextual links | Full rules and table; surfaced beside daily work. |
| Study guide | Phase Map + question-volume budget | Guide; Plan phase map | Complete tables and phase navigation. |
| Study guide | Honest Time Templates | Guide; Today workload context | Complete guide section; Today adds a clearly labeled inference. |
| Study guide | Week-by-Week Plan + Week 1 | Guide; Plan | Full guide tables plus the complete interactive daily schedule. |
| Study guide | Full-Length and Section Bank Schedule | Exams; Plan; Guide | All 8 exams and 600 Section Bank questions are linked to dated assignments. |
| Study guide | January vs. March Decision + March protocol | Exams readiness card; Guide | The plan’s own decision rule is shown as guidance, not definitive advice. |
| Study guide | Registration and Resource Controls + source links | Exams date setting; Guide | Full content and clickable source links. |
| Workbook | Mistake Log fields and validation lists | Log quick capture; complete log; CSV/XLSX | The fast form keeps common fields visible and retains workbook-compatible concepts. |
| Workbook | Weekly Pattern Review | Log summaries; XLSX export | Counts by error, topic, section, source, repeat issue, and retest status. |
| Workbook | Complete 40-topic mastery checklist | Log → Mastery | Confidence, review dates, notes, related mistakes, and contextual links. |
| `schedule.csv` + `plan.json` | Daily Schedule / week progress | Plan; progress summaries; XLSX export | Dates come from the current plan, not the legacy workbook. Current browser state is added at export time. |

## Validation snapshot

- Daily rows: 145 (2026-09-01 through 2027-01-23, continuous)
- Duplicate dates: 0
- Missing dates: 0
- Week boundaries: Tuesday-Monday
- Kaplan assignments resolved: 83 / 83; unknown IDs: 0
- Plan weeks reconciled: 20 / 20
- Full-length events: 8
- Section Bank questions: 600
- Workload: every mode explicitly costed; every week's low estimate within its budget; upper/midpoint risks shown in Plan
- Mastery topics: 40
- Meaningful guide sections mapped: 9 / 9, plus plan overview and source links
