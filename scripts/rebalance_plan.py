"""Apply the reviewed workload revision to the existing September sources.

Idempotent for this revision; preserves dated statuses/notes and non-plan data.
The CSV/JSON files remain authoritative after this migration. Do not rerun the
older restart_plan.py over a revised or in-progress plan.
"""
import csv
import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Tuesday=0 ... Monday=6. Small blocks replace (not stack on) retrieval/QBank.
BLOCKS = {
    8: {3: ("B/B", 20), 4: ("B/B", 30)},
    9: {3: ("B/B", 20), 4: ("B/B", 30)},
    10: {3: ("C/P", 20), 4: ("C/P", 30)},
    11: {3: ("C/P", 20), 4: ("C/P", 30)},
    12: {0: ("B/B", 30)},
    13: {0: ("B/B", 20), 1: ("C/P", 20), 3: ("P/S", 20), 4: ("P/S", 20), 6: ("P/S", 20)},
    14: {0: ("B/B", 30)},
    15: {0: ("C/P", 30)},
    16: {0: ("C/P", 30)},
    17: {0: ("B/B", 20), 1: ("C/P", 20), 2: ("P/S", 20), 4: ("P/S", 20), 6: ("P/S", 20)},
    18: {0: ("P/S", 20), 1: ("P/S", 20)},
    19: {0: ("P/S", 20), 1: ("P/S", 20)},
}


def save_json(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def main():
    plan = json.loads((ROOT / "plan.json").read_text())
    if plan["plan_start"] != "2026-09-01" or plan["prep_weeks"] != 20:
        raise SystemExit("This migration applies only to the September 1, 20-week plan")
    with (ROOT / "schedule.csv").open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    guide = json.loads((ROOT / "study-guide.json").read_text())
    plan["revision"] = "2026-08-31-workload-review"
    plan["full_length_dates"] = [r["date"] for r in rows if r["mode"] == "Exam under test conditions"]
    plan["question_targets"]["section_bank_by_section"] = {"B/B": 200, "C/P": 200, "P/S": 200}
    plan["workload_policy"] = {
        "budget_role": "planned_hours is the weekly capacity budget, not a promise that every upper-bound estimate fits.",
        "validation": "Fail if the low estimate exceeds the budget. Show midpoint and upper-bound risks; never clamp estimates to fit.",
        "execution": "Protect exams, their review and sleep. If the budget is reached, stop new questions, finish their review next session, and replace lower-priority work rather than adding catch-up debt. Log actual time and replan if two weeks overrun.",
        "maintenance": "Chapter days add 15-30 minutes Anki/log maintenance. Operational mode blocks already include maintenance; exam/review days have no extra quota.",
        "estimates": "Mode ranges and question review allowances are planning assumptions, not measured completion times. The midpoint is a sensitivity check, not a statistical forecast.",
    }
    for week in plan["weeks"]:
        w = week["week"]
        if 8 <= w <= 11:
            week["uworld_questions"] = 0
            week["cars_passages"] = 12
            subject = "B/B" if w < 10 else "C/P"
            tail = {8: "Keep review current", 9: "Equations cold by Nov 2", 10: "Finish P/S first pass", 11: "All 83 chapters covered by Nov 16"}[w]
            week["milestone"] = f"50 {subject} Section Bank: Fri 20 + Sat 30 timed; {tail}"
        if w in {13, 17}:
            week["focus"] = "Thanksgiving float + mixed Section Banks" if w == 13 else "Holiday float + mixed Section Banks"
            week["exam_or_section_bank"] = "Mixed SB"
            week["cars_passages"] = 10
            week["milestone"] = "100 Section Bank: B/B 20, C/P 20, P/S 60; five 20-question blocks; holiday and Sunday off"
        if w in {12, 14, 15, 16, 18, 19}:
            week["cars_passages"] = 15
            # Remove a previous revision suffix without touching the exam milestone.
            week["milestone"] = week["milestone"].split("; SB:")[0]
            section, _ = next(iter(BLOCKS[w].values()))
            count = sum(n for _, n in BLOCKS[w].values())
            week["milestone"] += f"; SB: {count} {section} early-week, replacing retrieval"
    plan["question_targets"]["uworld_baseline"] = sum(w["uworld_questions"] for w in plan["weeks"])
    plan["question_targets"]["uworld_evidence_driven_range"] = "484 scheduled baseline; optional expansion only after review fits the weekly budget"
    weeks = {w["week"]: w for w in plan["weeks"]}
    for row in rows:
        w = int(row["week"]) if row["week"].isdigit() else None
        off = (date.fromisoformat(row["date"]) - date.fromisoformat(plan["plan_start"])).days % 7
        if w:
            week = weeks[w]
            row.update(phase=week["phase"], weekly_focus=week["focus"], weekly_hours=str(week["planned_hours"]), weekly_milestone=week["milestone"])
        parts = [p for p in row["practice_target"].split("; ") if p and "Section Bank" not in p]
        if w and 8 <= w <= 11:
            parts = [p for p in parts if "UWorld" not in p and "CARS" not in p]
            row["cars_passages"] = "0" if row["mode"] == "Rest" else "2"
            if row["cars_passages"] != "0":
                parts.append("2 CARS passages")
        # Review days carry no new question/CARS quota. Move those to Tue-Thu.
        if w == 6 and off in {0, 1, 2}:
            parts = [p for p in parts if "UWorld" not in p]
            parts.insert(0, f"{[7, 7, 6][off]} UWorld topic questions")
        if w in {12, 14, 15, 16, 18, 19} and off in {0, 1, 2}:
            row["cars_passages"] = "2"
            parts = [p for p in parts if "CARS" not in p] + ["2 CARS passages"]
        if w == 17 and off in {0, 1}:
            row["cars_passages"] = "2"
            parts = [p for p in parts if "CARS" not in p] + ["2 CARS passages"]
        if "Full-length review" in row["assignment"] or "Finish full-length review" in row["assignment"]:
            parts, row["cars_passages"] = [], "0"
        resources = [s for s in row["resource"].split("; ") if s and s != "AAMC Section Bank"]
        if off in BLOCKS.get(w, {}):
            section, count = BLOCKS[w][off]
            parts.append(f"{count} {section} Section Bank questions")
            resources.append("AAMC Section Bank")
            if not row["chapter_id"]:
                row["mode"] = "Section Bank / review"
                suffix = "; January/March readiness decision; verify registered deadline" if row["date"] in {"2026-12-22", "2026-12-23"} else ""
                row["assignment"] = f"{section} Section Bank + answer review + brief maintenance" + suffix
            note = "Review every incorrect, flagged and guessed-correct answer before adding questions; this replaces extra retrieval/QBank volume."
            if 8 <= w <= 11 and off == 4:
                note = "Timed science checkpoint: 30 questions in about 48 minutes (adjust for approved accommodations), then review. Log accuracy, unfinished items and top three gaps; no scaled-score conversion."
            if note not in row["notes"]:
                row["notes"] = " ".join(filter(None, [row["notes"], note]))
        if w == 1 and off < 3:
            new_note = "Rapid review 30-45 min per chapter + 8 UWorld with review + 1 CARS passage + 15-30 min maintenance. Stop after 3.5 hours; flag unfinished review for after the diagnostic, never rush to tick boxes."
            old_note = "Cap the whole block at 3-3.5 hours including questions/review and 15-20 minutes Anki. Flag unfamiliar topics; repair them after the diagnostic."
            if not row["notes"].startswith(new_note):
                saved = row["notes"].removeprefix(old_note).strip()
                row["notes"] = new_note + ("\nSaved note: " + saved if saved else "")
        if row["date"] in {"2027-01-15", "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21"}:
            row["mode"] = "Logistics"
        if row["date"] == "2027-01-16":
            row["mode"] = "Rest"
            row["assignment"] = "Rest; optional light flashcards; protect sleep"
        row["practice_target"], row["resource"] = "; ".join(parts), "; ".join(resources)

    sections = {s["id"]: s for s in guide["sections"]}
    para = lambda text: {"type": "paragraph", "text": text}
    table = lambda heads, data: {"type": "table", "headers": heads, "rows": data}
    changed = sections["what-changed"]["blocks"][0]["items"]
    changed[4] = "484 UWorld questions plus 600 Section Bank questions. Weeks 8-11 use Section Banks instead of extra UWorld; expand only when review fits."
    changed[5] = "Section Banks use 20-30-question blocks from October 23 through January 6. Holiday floats mix all three sciences; full-length review and rest days have no extra quotas."
    for block in sections["operating-rules"]["blocks"]:
        if block["type"] == "list":
            block["items"] = ["Anki/log maintenance: 15-30 minutes on chapter days; included in operational blocks. Exam and review days have no separate maintenance quota. Prioritize due cards; do not grow a catch-up debt." if item.startswith("Anki is capped") else item for item in block["items"]]
    phase = sections["phase-map"]["blocks"][0]["rows"]
    phase[2][3] = "Finish content; small timed B/B and C/P blocks"
    phase[3][3] = "Six official exams; mixed Section Banks through January 6"
    sections["phase-map"]["blocks"][1] = para("Budget: 484 UWorld + 600 Section Bank questions; one diagnostic, one third-party and six official full-lengths. Exam CARS counts toward weekly totals.")
    sections["honest-time-templates"]["blocks"] = [
        table(["Week type", "Budget", "Execution rule"], [
            ["Launch", "26 hr", "Rapid review costs 30-45 min/chapter; add questions, CARS and maintenance. Stop Tue-Thu at 3.5 hr; take the diagnostic even if unfinished."],
            ["Content / SB", "22-24 hr", "Review depth follows diagnostic evidence. Weeks 8-11 replace UWorld with 50 SB/week; no 50-question days."],
            ["Full-length", "20-22 hr", "Protect exam and two review days. Early-week SB replaces general retrieval; review days have no new quotas."],
            ["Holiday floats", "16 / 18 hr", "Five 20-question mixed SB blocks; holiday and Sunday off."],
            ["Taper", "8 hr maximum", "Short retrieval and 20-45-minute logistics; genuine rest days have only optional maintenance."],
        ]),
        {"type": "heading", "text": "Budget and estimate rules", "level": 2},
        para("Weekly hours are your capacity budget, not a guarantee that the upper estimate fits. The generator rejects a week if even its low estimate exceeds capacity; midpoint and upper-bound risks stay visible. These ranges are planning assumptions, not measured completion times or statistical forecasts."),
        para(plan["workload_policy"]["execution"]),
        para("The website reports weekly estimate ranges and capacity warnings. Budget overrun is a signal to reduce scope or replan, not to read faster or skip answer review."),
    ]
    start = date.fromisoformat(plan["plan_start"])
    sections["week-by-week-plan"]["blocks"] = [table(["Week", "Dates", "Focus / hours", "Practice / milestone"], [[str(w["week"]), f"{start + timedelta(days=(w['week']-1)*7)} to {start + timedelta(days=w['week']*7-1)}", f"{w['focus']} | {w['planned_hours']} hr", f"UWorld {w['uworld_questions']}; CARS {w['cars_passages']}. {w['milestone']}"] for w in plan["weeks"]])]
    sections["start-here-week-1"]["blocks"][1]["rows"] = [[r["date"], r["assignment"], r["practice_target"] or "No quota", r["notes"]] for r in rows[:7]]
    blocks = sections["full-length-and-section-bank-schedule"]["blocks"]
    blocks[1] = table(["Weeks", "Section Bank", "Questions"], [
        ["8-9; 12-14; 17", "B/B; 20-30 per block", "200"],
        ["10-11; 13; 15-17", "C/P; 20-30 per block", "200"],
        ["13; 17-19", "P/S; 20 per block", "200"],
    ])
    checkpoint = para("October 24/31 and November 7/14: timed 30-question science checkpoints, followed by review, within the scheduled Section Bank volume. These provide section-level feedback during the 42-day full-length gap, not a substitute scaled score or stamina test. Keep January 9 as the final full-length; all new Section Bank questions finish January 6.")
    blocks[:] = blocks[:3] + [checkpoint]
    save_json("plan.json", plan)
    save_json("study-guide.json", guide)
    with (ROOT / "schedule.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    markdown = ["# MCAT September 1 Restart", ""]
    escape = lambda value: str(value).replace("|", "/").replace("\n", " ")
    for section in guide["sections"]:
        markdown += ["## " + section["title"], ""]
        for block in section["blocks"]:
            if block["type"] in {"paragraph", "heading", "callout"}:
                markdown += [block.get("text", ""), ""]
            elif block["type"] == "list":
                markdown += ["- " + item for item in block["items"]] + [""]
            elif block["type"] == "table":
                markdown += ["| " + " | ".join(map(escape, block["headers"])) + " |", "| " + " | ".join("---" for _ in block["headers"]) + " |"]
                markdown += ["| " + " | ".join(map(escape, row)) + " |" for row in block["rows"]] + [""]
    (ROOT / "MCAT_Study_Plan_2026-09-01.md").write_text("\n".join(markdown))


if __name__ == "__main__":
    main()
