#!/usr/bin/env python3
"""Generate the MCAT tracker deployment data from the authoritative sources.

This script deliberately uses only the Python standard library so the static site
can be regenerated without installing a project dependency stack.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


TRACKER_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = TRACKER_ROOT.parent
OUTPUT_PATH = TRACKER_ROOT / "data" / "site-data.json"
CONTENT_MAP_PATH = TRACKER_ROOT / "CONTENT_MAP.md"

SCHEDULE_PATH = SOURCE_ROOT / "schedule.csv"
PLAN_PATH = SOURCE_ROOT / "plan.json"
CHAPTERS_PATH = SOURCE_ROOT / "kaplan-mcat-books.md"
GUIDE_PATH = SOURCE_ROOT / "study-guide.json"
WORKBOOK_PATH = SOURCE_ROOT / "MCAT_520_Plus_Mistake_Log.xlsx"
README_PATH = SOURCE_ROOT / "README.md"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
X = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

SUBJECT_CODES = {
    "Biology": "BIO",
    "Biochemistry": "BCH",
    "General Chemistry": "GC",
    "Behavioral Sciences": "PS",
    "Critical Analysis and Reasoning Skills": "CARS",
    "Physics and Math": "PHY",
    "Organic Chemistry": "OC",
}

EXPECTED_GUIDE_SECTIONS = {
    "what-changed",
    "operating-rules",
    "phase-map",
    "honest-time-templates",
    "week-by-week-plan",
    "start-here-week-1",
    "full-length-and-section-bank-schedule",
    "january-vs-march-decision",
    "registration-and-resource-controls",
}

REQUIRED_SCHEDULE_FIELDS = {
    "date",
    "day",
    "week",
    "phase",
    "weekly_focus",
    "resource",
    "chapter_id",
    "assignment",
    "mode",
    "practice_target",
    "cars_passages",
    "weekly_hours",
    "weekly_milestone",
    "status",
    "notes",
}


class ValidationError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ValidationError(message)


def slugify(value: str) -> str:
    value = re.sub(r"\(continued\)", "", value, flags=re.I)
    value = re.sub(r"^\d+\.\s*", "", value.strip())
    value = value.lower().replace("vs.", "vs")
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_chapters() -> list[dict[str, Any]]:
    chapters: list[dict[str, Any]] = []
    current_subject = ""
    current_code = ""
    current: dict[str, Any] | None = None

    for raw_line in CHAPTERS_PATH.read_text(encoding="utf-8").splitlines():
        if raw_line.startswith("## Kaplan MCAT "):
            current_subject = raw_line.removeprefix("## Kaplan MCAT ").split(" Review")[0]
            current_code = SUBJECT_CODES.get(current_subject, "")
            current = None
            continue

        chapter_match = re.match(r"^(\d+)\.\s+(.+)$", raw_line)
        if chapter_match and current_code:
            number = int(chapter_match.group(1))
            title = chapter_match.group(2).strip()
            current = {
                "id": f"{current_code}{number:02d}",
                "subject": current_subject,
                "subjectCode": current_code,
                "number": number,
                "title": title,
                "fullTitle": f"{current_subject} Ch. {number} - {title}",
                "subsections": [],
            }
            chapters.append(current)
            continue

        subsection_match = re.match(r"^\s+(\d+\.\d+)\s+(.+)$", raw_line)
        if subsection_match and current is not None:
            current["subsections"].append(
                {"number": subsection_match.group(1), "title": subsection_match.group(2).strip()}
            )

    if len(chapters) != 83:
        fail(f"Expected exactly 83 Kaplan chapters, found {len(chapters)}")
    ids = [chapter["id"] for chapter in chapters]
    if len(set(ids)) != len(ids):
        fail("Kaplan chapter IDs are not unique")
    return chapters


def paragraph_payload(node: ET.Element) -> dict[str, Any] | None:
    text = "".join(piece.text or "" for piece in node.iter(f"{W}t")).strip()
    if not text:
        return None
    ppr = node.find(f"{W}pPr")
    style = ""
    is_list = False
    is_callout = False
    if ppr is not None:
        style_node = ppr.find(f"{W}pStyle")
        if style_node is not None:
            style = style_node.get(f"{W}val", "")
        is_list = ppr.find(f"{W}numPr") is not None or style.lower().startswith("list")
        is_callout = ppr.find(f"{W}shd") is not None
    return {
        "text": text,
        "style": style,
        "isList": is_list,
        "ordered": "number" in style.lower(),
        "isCallout": is_callout,
    }


def table_payload(node: ET.Element) -> dict[str, Any] | None:
    rows: list[list[str]] = []
    for tr in node.findall(f"{W}tr"):
        row = []
        for tc in tr.findall(f"{W}tc"):
            parts = []
            for paragraph in tc.findall(f"{W}p"):
                text = "".join(piece.text or "" for piece in paragraph.iter(f"{W}t")).strip()
                if text:
                    parts.append(text)
            row.append("\n".join(parts))
        if any(row):
            rows.append(row)
    if not rows:
        return None
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    return {"type": "table", "headers": rows[0], "rows": rows[1:]}


def parse_guide() -> dict[str, Any]:
    if GUIDE_PATH.suffix == ".json":
        guide = json.loads(GUIDE_PATH.read_text(encoding="utf-8"))
        ids = [section["id"] for section in guide["sections"]]
        if len(ids) != len(set(ids)) or not EXPECTED_GUIDE_SECTIONS.issubset(ids):
            fail("Study guide has missing or duplicate sections")
        return guide
    with zipfile.ZipFile(GUIDE_PATH) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find(f"{W}body")
    if body is None:
        fail("The study guide has no Word document body")

    sections: list[dict[str, Any]] = [
        {"id": "overview", "title": "Plan overview", "blocks": []}
    ]
    section_by_id = {"overview": sections[0]}
    current = sections[0]

    for child in body:
        if child.tag == f"{W}p":
            payload = paragraph_payload(child)
            if payload is None:
                continue
            text = payload["text"]
            style = payload["style"]
            if style == "Heading1":
                section_id = slugify(text)
                if section_id in section_by_id:
                    current = section_by_id[section_id]
                    current["blocks"].append({"type": "divider", "label": text})
                else:
                    current = {"id": section_id, "title": text, "blocks": []}
                    sections.append(current)
                    section_by_id[section_id] = current
                continue
            if style in {"Heading2", "Heading3"}:
                current["blocks"].append(
                    {"type": "heading", "level": 2 if style == "Heading2" else 3, "text": text}
                )
                continue
            if payload["isList"]:
                ordered = payload["ordered"]
                if (
                    current["blocks"]
                    and current["blocks"][-1].get("type") == "list"
                    and current["blocks"][-1].get("ordered") == ordered
                ):
                    current["blocks"][-1]["items"].append(text)
                else:
                    current["blocks"].append({"type": "list", "ordered": ordered, "items": [text]})
            elif payload["isCallout"]:
                label, sep, rest = text.partition(":")
                current["blocks"].append(
                    {
                        "type": "callout",
                        "label": label if sep else "Note",
                        "text": rest.strip() if sep else text,
                    }
                )
            else:
                current["blocks"].append({"type": "paragraph", "text": text})
        elif child.tag == f"{W}tbl":
            table = table_payload(child)
            if table:
                current["blocks"].append(table)

    section_ids = {section["id"] for section in sections}
    missing = sorted(EXPECTED_GUIDE_SECTIONS - section_ids)
    if missing:
        fail(f"Meaningful guide sections missing from extraction: {missing}")

    urls = []
    for section in sections:
        for block in section["blocks"]:
            texts: list[str] = []
            if block["type"] in {"paragraph", "callout", "heading"}:
                texts.append(block.get("text", ""))
            elif block["type"] == "list":
                texts.extend(block["items"])
            elif block["type"] == "table":
                texts.extend(block["headers"])
                texts.extend(value for row in block["rows"] for value in row)
            for value in texts:
                urls.extend(re.findall(r"https?://[^\s]+", value))

    resources = []
    for url in dict.fromkeys(url.rstrip(".,);" ) for url in urls):
        label = url
        for section in sections:
            found = False
            for block in section["blocks"]:
                if block["type"] == "paragraph" and url in block.get("text", ""):
                    label = block["text"].split(": http", 1)[0]
                    found = True
                    break
            if found:
                break
        resources.append({"label": label, "url": url})

    return {"sections": sections, "resources": resources}


def column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref)
    if not letters:
        return 0
    result = 0
    for char in letters.group(0):
        result = result * 26 + ord(char) - 64
    return result - 1


def parse_xlsx_sheets() -> dict[str, list[list[Any]]]:
    with zipfile.ZipFile(WORKBOOK_PATH) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall(f"{X}si"):
                shared_strings.append("".join(part.text or "" for part in item.iter(f"{X}t")))

        workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {
            rel.get("Id", ""): rel.get("Target", "")
            for rel in rels_root.findall(f"{PKG_REL}Relationship")
        }
        sheet_paths = {}
        sheets_node = workbook_root.find(f"{X}sheets")
        if sheets_node is None:
            fail("The workbook has no worksheets")
        for sheet in sheets_node.findall(f"{X}sheet"):
            name = sheet.get("name", "")
            target = rel_targets.get(sheet.get(f"{R}id", ""), "")
            if not target:
                continue
            normalized_target = target.lstrip("/")
            sheet_paths[name] = normalized_target if normalized_target.startswith("xl/") else "xl/" + normalized_target

        result: dict[str, list[list[Any]]] = {}
        for name, sheet_path in sheet_paths.items():
            root = ET.fromstring(archive.read(sheet_path))
            values_by_row: dict[int, dict[int, Any]] = defaultdict(dict)
            max_column = -1
            for cell in root.findall(f".//{X}c"):
                ref = cell.get("r", "A1")
                row_match = re.search(r"(\d+)$", ref)
                if not row_match:
                    continue
                row_index = int(row_match.group(1)) - 1
                col_index = column_index(ref)
                max_column = max(max_column, col_index)
                cell_type = cell.get("t", "")
                value_node = cell.find(f"{X}v")
                value: Any = None
                if cell_type == "inlineStr":
                    value = "".join(part.text or "" for part in cell.iter(f"{X}t"))
                elif value_node is not None:
                    raw = value_node.text or ""
                    if cell_type == "s":
                        index = int(raw)
                        value = shared_strings[index] if index < len(shared_strings) else ""
                    elif cell_type == "b":
                        value = raw == "1"
                    elif cell_type in {"str", "e"}:
                        value = raw
                    else:
                        try:
                            number = float(raw)
                            value = int(number) if number.is_integer() else number
                        except ValueError:
                            value = raw
                values_by_row[row_index][col_index] = value
            rows: list[list[Any]] = []
            if values_by_row:
                for row_index in range(max(values_by_row) + 1):
                    row = [None] * (max_column + 1)
                    for col_index, value in values_by_row.get(row_index, {}).items():
                        row[col_index] = value
                    rows.append(row)
            result[name] = rows
    return result


def workbook_content(plan: dict[str, Any]) -> dict[str, Any]:
    sheets = parse_xlsx_sheets()
    expected = {
        f"{plan['prep_weeks']}-Week Tracker",
        "Daily Schedule",
        "Mistake Log",
        "Weekly Pattern Review",
        "High-Yield Mastery Checklist",
        "Lists",
    }
    if not expected.issubset(sheets):
        fail(f"Workbook is missing sheets: {sorted(expected - set(sheets))}")

    def row(sheet: str, one_based: int) -> list[Any]:
        rows = sheets[sheet]
        return rows[one_based - 1] if len(rows) >= one_based else []

    mistake_headers = [value for value in row("Mistake Log", 4) if value not in (None, "")]
    pattern_headers = [value for value in row("Weekly Pattern Review", 4) if value not in (None, "")]
    list_headers = row("Lists", 4)
    list_rows = sheets["Lists"][4:]
    allowed_values: dict[str, list[Any]] = {}
    for index, header in enumerate(list_headers):
        if not header:
            continue
        allowed_values[str(header)] = [
            values[index]
            for values in list_rows
            if index < len(values) and values[index] not in (None, "")
        ]

    mastery_rows = sheets["High-Yield Mastery Checklist"][4:]
    mastery_topics = []
    for index, values in enumerate(mastery_rows, start=1):
        if len(values) < 2 or not values[1]:
            continue
        section = str(values[0])
        mastery_topics.append(
            {
                "id": f"mastery-{index:02d}-{slugify(str(values[1]))}",
                "section": section,
                "category": {"CP": "Chemical and Physical", "BB": "Biological and Biochemical", "PS": "Psychological and Social", "CARS": "CARS"}.get(section, section),
                "topic": str(values[1]),
                "defaultNeedsReview": values[7] == "Y" if len(values) > 7 else True,
            }
        )
    if len(mastery_topics) != 40:
        fail(f"Expected 40 high-yield mastery topics, found {len(mastery_topics)}")

    field_definitions = [
        {"key": "id", "label": "Unique entry ID", "type": "text", "required": True},
        {"key": "date", "label": "Date", "type": "date", "required": True, "workbookField": "Date"},
        {"key": "source", "label": "Source", "type": "select", "required": True, "optionsKey": "Sources", "workbookField": "Source"},
        {"key": "section", "label": "MCAT section", "type": "select", "required": True, "optionsKey": "Sections", "workbookField": "Section"},
        {"key": "chapterId", "label": "Chapter ID", "type": "chapter", "required": False},
        {"key": "topic", "label": "Topic", "type": "text", "required": True, "workbookField": "Topic"},
        {"key": "questionRef", "label": "Question or passage reference", "type": "text", "required": False},
        {"key": "description", "label": "Short question description", "type": "textarea", "required": False},
        {"key": "result", "label": "Result", "type": "select", "required": True, "options": ["Incorrect", "Flagged", "Guessed-correct"], "workbookField": "Outcome"},
        {"key": "errorType", "label": "Error type", "type": "select", "required": True, "optionsKey": "Error Types", "workbookField": "Error Type"},
        {"key": "whyMissed", "label": "Why it was missed", "type": "textarea", "required": True, "workbookField": "Why I Missed It"},
        {"key": "takeaway", "label": "Correct reasoning or takeaway", "type": "textarea", "required": True},
        {"key": "fix", "label": "Concrete fix", "type": "textarea", "required": True, "workbookField": "Fix Strategy"},
        {"key": "retestDate", "label": "Retest date", "type": "date", "required": False, "workbookField": "Retest Due"},
        {"key": "retestStatus", "label": "Retest status", "type": "select", "required": False, "options": ["Not scheduled", "Scheduled", "Due", "Retested", "Resolved"]},
        {"key": "retestResult", "label": "Retest result", "type": "textarea", "required": False, "workbookField": "Retest Result / Evidence"},
        {"key": "confidence", "label": "Confidence", "type": "select", "required": False, "options": [0, 1, 2, 3]},
        {"key": "tags", "label": "Tags", "type": "tags", "required": False},
        {"key": "notes", "label": "Additional notes", "type": "textarea", "required": False, "workbookField": "Card / Notes"},
        {"key": "assignmentId", "label": "Assignment reference", "type": "text", "required": False},
        {"key": "createdAt", "label": "Created timestamp", "type": "datetime", "required": True},
        {"key": "updatedAt", "label": "Updated timestamp", "type": "datetime", "required": True},
    ]

    return {
        "sheetNames": list(sheets),
        "mistakeLog": {
            "sourceNote": row("Mistake Log", 2)[0],
            "sourceFields": mistake_headers,
            "fieldDefinitions": field_definitions,
        },
        "weeklyPatternReview": {
            "sourceNote": row("Weekly Pattern Review", 2)[0],
            "fields": pattern_headers,
        },
        "mastery": {
            "sourceNote": row("High-Yield Mastery Checklist", 2)[0],
            "fields": [value for value in row("High-Yield Mastery Checklist", 4) if value],
            "topics": mastery_topics,
        },
        "allowedValues": allowed_values,
    }


def parse_int(value: str, field: str, row_number: int) -> int:
    try:
        return int(value or 0)
    except ValueError as error:
        fail(f"Schedule row {row_number}: {field} must be numeric")
        raise error


# Each chapter token is a separate block. Operational blocks include maintenance;
# question costs include answering AND review, never an additional review block.
MODE_MINUTES = {
    "full read": (90, 135),
    "objectives + checks": (50, 80),
    "questions first": (30, 55),
    "rapid review": (30, 45),
    "evidence-driven review": (75, 120),
    "practice / retrieval": (35, 70),
    "light retrieval": (35, 70),
    "section bank / review": (15, 30),
    "logistics": (20, 45),
    "rest": (0, 30),
    "rest / logistics": (20, 45),
    "exam under test conditions": (450, 480),
    "exam if officially scheduled": (450, 480),
}


def infer_workload(row: dict[str, Any]) -> dict[str, Any]:
    modes = [piece.strip().lower() for piece in row["mode"].split(";")]
    unknown = set(modes) - MODE_MINUTES.keys()
    if unknown:
        fail(f"Unknown workload modes on {row['date']}: {sorted(unknown)}")
    if (row["isRest"] or row["isExam"] or row["isFullLengthReview"] or "exam if officially scheduled" in modes) and len(modes) != 1:
        fail(f"Protected/conditional day {row['date']} cannot stack extra mode blocks")
    if "exam if officially scheduled" in modes:
        return {"lowMinutes": 450, "highMinutes": 480, "label": "If registered: ~7.5-8 hr", "basis": "Conditional placeholder, not a booked exam; otherwise rest. Excluded from preparation totals.", "conditional": True}
    if row["isRest"]:
        return {"lowMinutes": 0, "highMinutes": 30, "label": "Rest day", "basis": "Optional light maintenance only"}
    if row["isExam"]:
        return {"lowMinutes": 450, "highMinutes": 480, "label": "~7.5-8 hr", "basis": "Full-length under test conditions"}
    if row["isFullLengthReview"]:
        sunday = row["day"] == "Sun"
        return {"lowMinutes": 240 if sunday else 120, "highMinutes": 300 if sunday else 150, "label": "~4-5 hr" if sunday else "~2-2.5 hr", "basis": "Protected exam review; no new chapters"}
    low = sum(MODE_MINUTES[mode][0] for mode in modes)
    high = sum(MODE_MINUTES[mode][1] for mode in modes)
    if row["chapterIds"]:
        low += 15
        high += 30

    practice = row["practiceTarget"]
    for count in re.findall(r"(\d+)\s+UWorld", practice, flags=re.I):
        count = int(count)
        low += count * 4
        high += count * 7
    for count in re.findall(r"(\d+)\s+[^;]*Section Bank", practice, flags=re.I):
        count = int(count)
        low += count * 5
        high += count * 8
    if row["carsPassages"]:
        low += row["carsPassages"] * 15
        high += row["carsPassages"] * 22

    def hours_label(minutes: int) -> str:
        return f"{minutes / 60:.1f}".replace(".0", "")

    if low >= 60:
        workload_label = f"~{hours_label(low)}–{hours_label(high)} hr"
    elif high >= 60:
        workload_label = f"~{low} min–{hours_label(high)} hr"
    else:
        workload_label = f"~{low}–{high} min"

    return {
        "lowMinutes": low,
        "highMinutes": high,
        "label": workload_label,
        "basis": "Advisory sum: each mode block + questions with review + CARS; chapter days add 15-30 min maintenance. No week-specific caps.",
    }


def guide_links_for(row: dict[str, Any]) -> list[str]:
    links = ["operating-rules", "phase-map"]
    if row["isExam"] or row["isFullLengthReview"] or row["isSectionBank"]:
        links.append("full-length-and-section-bank-schedule")
    if row["isTestWindow"]:
        links.append("registration-and-resource-controls")
    if row["week"] in {16, 17, 18, 19, 20, "TEST"}:
        links.append("january-vs-march-decision")
    return list(dict.fromkeys(links))


def parse_schedule(chapter_index: dict[str, dict[str, Any]], plan: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    with SCHEDULE_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if set(reader.fieldnames or []) != REQUIRED_SCHEDULE_FIELDS:
            missing = sorted(REQUIRED_SCHEDULE_FIELDS - set(reader.fieldnames or []))
            extra = sorted(set(reader.fieldnames or []) - REQUIRED_SCHEDULE_FIELDS)
            fail(f"Schedule columns mismatch. Missing={missing}; extra={extra}")
        raw_rows = list(reader)

    expected_days = (date.fromisoformat(plan["plan_end"]) - date.fromisoformat(plan["plan_start"])).days + 1
    if len(raw_rows) != expected_days:
        fail(f"Expected exactly {expected_days} daily schedule rows, found {len(raw_rows)}")

    schedule: list[dict[str, Any]] = []
    unknown_chapters: set[str] = set()
    assigned_chapters: list[str] = []
    start = date.fromisoformat(plan["plan_start"])

    for index, raw in enumerate(raw_rows, start=2):
        missing_values = [field for field in ["date", "day", "week", "phase", "weekly_focus", "assignment", "mode", "status"] if not raw[field].strip()]
        if missing_values:
            fail(f"Schedule row {index} is missing required values: {missing_values}")
        try:
            current = date.fromisoformat(raw["date"])
        except ValueError as error:
            fail(f"Schedule row {index} has an invalid date: {raw['date']}")
            raise error
        chapter_ids = [piece.strip() for piece in raw["chapter_id"].split(";") if piece.strip()]
        for chapter_id in chapter_ids:
            assigned_chapters.append(chapter_id)
            if chapter_id not in chapter_index:
                unknown_chapters.add(chapter_id)

        week: int | str = int(raw["week"]) if raw["week"].isdigit() else raw["week"]
        assignment_lower = raw["assignment"].lower()
        mode_lower = raw["mode"].lower()
        is_rest = mode_lower == "rest"
        is_exam = "exam under test conditions" in mode_lower
        is_review = "full-length review" in assignment_lower or "finish full-length review" in assignment_lower
        is_section_bank = "section bank" in raw["practice_target"].lower()
        is_test_window = week == "TEST"
        is_logistics = mode_lower in {"logistics", "rest / logistics"}
        if is_test_window:
            day_type = "test-window"
        elif is_exam:
            day_type = "exam"
        elif is_review:
            day_type = "full-length-review"
        elif is_rest:
            day_type = "rest"
        elif is_logistics:
            day_type = "logistics"
        elif is_section_bank:
            day_type = "section-bank"
        else:
            day_type = "study"

        row = {
            "id": raw["date"],
            "date": raw["date"],
            "day": raw["day"],
            "week": week,
            "phase": raw["phase"],
            "weeklyFocus": raw["weekly_focus"],
            "resource": raw["resource"],
            "chapterIds": chapter_ids,
            "chapters": [chapter_index[chapter_id] for chapter_id in chapter_ids if chapter_id in chapter_index],
            "assignment": raw["assignment"],
            "mode": raw["mode"],
            "practiceTarget": raw["practice_target"],
            "practiceTargetDisplay": raw["practice_target"],
            "carsPassages": parse_int(raw["cars_passages"], "cars_passages", index),
            "weeklyHours": parse_int(raw["weekly_hours"], "weekly_hours", index),
            "weeklyMilestone": raw["weekly_milestone"],
            "sourceStatus": raw["status"],
            "sourceNotes": raw["notes"],
            "dayType": day_type,
            "isRest": is_rest,
            "isExam": is_exam,
            "isFullLengthReview": is_review,
            "isSectionBank": is_section_bank,
            "isTestWindow": is_test_window,
        }
        extra_questions = re.search(r"\d+\s+(?:UWorld|[^;]*Section Bank)", row["practiceTarget"], re.I)
        if ((is_rest or is_review) and row["carsPassages"]) or ((is_rest or is_review or is_exam) and extra_questions):
            fail(f"Protected rest/review day {row['date']} has an extra practice quota")
        if (is_rest or is_review or is_exam) and chapter_ids:
            fail(f"Protected day {row['date']} has new chapters")
        row["estimatedWorkload"] = infer_workload(row)
        row["relatedGuideSections"] = guide_links_for(row)
        schedule.append(row)

    if unknown_chapters:
        fail(f"Unknown chapter IDs in schedule: {sorted(unknown_chapters)}")
    if len(assigned_chapters) != 83 or len(set(assigned_chapters)) != 83:
        fail(f"Expected 83 uniquely assigned chapters, found {len(assigned_chapters)} assignments and {len(set(assigned_chapters))} unique")
    if set(assigned_chapters) != set(chapter_index):
        fail(f"Schedule/chapter source mismatch. Missing={sorted(set(chapter_index) - set(assigned_chapters))}; extra={sorted(set(assigned_chapters) - set(chapter_index))}")

    dates = [date.fromisoformat(row["date"]) for row in schedule]
    if dates[0] != start or dates[-1].isoformat() != plan["plan_end"]:
        fail("Schedule endpoints do not match plan dates")
    duplicates = [value.isoformat() for value, count in Counter(dates).items() if count > 1]
    if duplicates:
        fail(f"Duplicate schedule dates: {duplicates}")
    expected_dates = [dates[0] + timedelta(days=offset) for offset in range((dates[-1] - dates[0]).days + 1)]
    if dates != expected_dates:
        missing = sorted(set(expected_dates) - set(dates))
        fail(f"Schedule does not cover a continuous date range. Missing={[value.isoformat() for value in missing]}")

    for row, current in zip(schedule, dates):
        if row["day"] != current.strftime("%a"):
            fail(f"Weekday mismatch on {row['date']}: expected {current.strftime('%a')}, found {row['day']}")
        if isinstance(row["week"], int):
            expected_week = ((current - start).days // 7) + 1
            if row["week"] != expected_week:
                fail(f"Week boundary mismatch on {row['date']}: expected Week {expected_week}, found {row['week']}")
            week_start = start + timedelta(days=(row["week"] - 1) * 7)
            boundary = f"{week_start.strftime('%A')}-{(week_start + timedelta(days=6)).strftime('%A')}"
            if boundary != plan["week_boundary"]:
                fail(f"Week {row['week']} is not {plan['week_boundary']}")

    plan_weeks = {int(week["week"]): week for week in plan["weeks"]}
    if len(plan["weeks"]) != plan["prep_weeks"] or set(plan_weeks) != set(range(1, plan["prep_weeks"] + 1)):
        fail("plan.json must contain every preparation week exactly once")
    weekly_checks = []
    for week_number, week in plan_weeks.items():
        rows = [row for row in schedule if row["week"] == week_number]
        if len(rows) != 7:
            fail(f"Week {week_number} must contain exactly seven days")
        for row in rows:
            if row["phase"] != week["phase"] or row["weeklyFocus"] != week["focus"] or row["weeklyHours"] != int(week["planned_hours"]) or row["weeklyMilestone"] != week["milestone"]:
                fail(f"Schedule values for Week {week_number} do not align with plan.json")
        cars_total = sum(row["carsPassages"] for row in rows)
        uworld_total = sum(
            int(count)
            for row in rows
            for count in re.findall(r"(\d+)\s+UWorld", row["practiceTarget"], flags=re.I)
        )
        if cars_total != int(week["cars_passages"]):
            fail(f"Week {week_number} CARS target mismatch: schedule={cars_total}, plan={week['cars_passages']}")
        if uworld_total != int(week["uworld_questions"]):
            fail(f"Week {week_number} UWorld target mismatch: schedule={uworld_total}, plan={week['uworld_questions']}")
        workload = validate_week_workload(rows, week)
        weekly_checks.append({"week": week_number, "dailyRows": 7, "carsPassages": cars_total, "uworldQuestions": uworld_total, **workload})

    return schedule, {
        "dailyRows": len(schedule),
        "dateRange": {"start": schedule[0]["date"], "end": schedule[-1]["date"]},
        "duplicateDates": 0,
        "missingDates": 0,
        "weekBoundary": plan["week_boundary"],
        "numericWeeks": plan["prep_weeks"],
        "chapterAssignments": len(assigned_chapters),
        "uniqueChapterAssignments": len(set(assigned_chapters)),
        "unknownChapterIds": [],
        "weeklyChecks": weekly_checks,
    }


def validate_week_workload(rows: list[dict[str, Any]], week: dict[str, Any]) -> dict[str, Any]:
    low = sum(row["estimatedWorkload"]["lowMinutes"] for row in rows)
    high = sum(row["estimatedWorkload"]["highMinutes"] for row in rows)
    budget = week["planned_hours"] * 60
    if low > budget:
        fail(f"Week {week['week']} minimum estimate {low} min exceeds {budget} min budget; revise assignments, not estimates")
    risk = "midpoint-over-budget" if (low + high) / 2 > budget else "upper-over-budget" if high > budget else "within-budget"
    return {"estimatedLowMinutes": low, "estimatedHighMinutes": high, "budgetMinutes": budget, "capacityRisk": risk}


def derive_phase_map(plan: dict[str, Any]) -> list[dict[str, Any]]:
    phases: list[dict[str, Any]] = []
    for week in plan["weeks"]:
        if phases and phases[-1]["phase"] == week["phase"]:
            phases[-1]["endWeek"] = week["week"]
            phases[-1]["focuses"].append(week["focus"])
        else:
            phases.append(
                {
                    "phase": week["phase"],
                    "startWeek": week["week"],
                    "endWeek": week["week"],
                    "focuses": [week["focus"]],
                }
            )
    start = date.fromisoformat(plan["plan_start"])
    for phase in phases:
        phase_start = start + timedelta(days=(phase["startWeek"] - 1) * 7)
        phase_end = start + timedelta(days=phase["endWeek"] * 7 - 1)
        phase["startDate"] = phase_start.isoformat()
        phase["endDate"] = phase_end.isoformat()
    return phases


def derive_exams(schedule: list[dict[str, Any]], plan: dict[str, Any]) -> list[dict[str, Any]]:
    exams = []
    for index, row in enumerate(schedule):
        if not row["isExam"]:
            continue
        assignment = row["assignment"]
        official = assignment.startswith("AAMC Practice Exam")
        source = row["resource"] or ("AAMC" if assignment.startswith("AAMC") else "Third party")
        exams.append(
            {
                "id": f"exam-{len(exams) + 1:02d}",
                "name": assignment,
                "source": source,
                "plannedDate": row["date"],
                "week": row["week"],
                "official": official,
                "diagnostic": "Unscored Sample" in assignment,
                "assignmentId": row["id"],
                "reviewAssignmentIds": [
                    candidate["id"]
                    for candidate in schedule[index + 1:index + 4]
                    if candidate["isFullLengthReview"]
                ],
            }
        )
    if [exam["plannedDate"] for exam in exams] != plan["full_length_dates"]:
        fail("Full-length dates/count do not match plan.json full_length_dates")
    if any(date.fromisoformat(exam["plannedDate"]).weekday() != 5 or len(exam["reviewAssignmentIds"]) != 2 for exam in exams):
        fail("Every full-length needs a Saturday exam and two protected review days")
    return exams


def derive_section_banks(schedule: list[dict[str, Any]], plan: dict[str, Any]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in schedule:
        for count, section in re.findall(r"(\d+)\s+([^;]+?) Section Bank questions", row["practiceTarget"], flags=re.I):
            key = section.strip()
            group = groups.setdefault(key, {"name": f"AAMC {key} Section Bank", "section": key, "totalQuestions": 0, "assignments": []})
            group["totalQuestions"] += int(count)
            group["assignments"].append({"date": row["date"], "week": row["week"], "questions": int(count), "assignmentId": row["id"]})
    output = []
    for index, group in enumerate(groups.values(), start=1):
        group["id"] = f"section-bank-{index:02d}"
        output.append(group)
    if sum(group["totalQuestions"] for group in output) != plan["question_targets"]["section_bank"]:
        fail("Section Bank total does not match plan.json")
    if {group["section"]: group["totalQuestions"] for group in output} != plan["question_targets"]["section_bank_by_section"]:
        fail("Section Bank section totals do not match plan.json")
    return output


def find_guide_mode_table(guide: dict[str, Any]) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for section in guide["sections"]:
        for block in section["blocks"]:
            if block["type"] != "table" or block["headers"][:3] != ["Mode", "When to use", "Required output"]:
                continue
            for row in block["rows"]:
                if len(row) >= 3:
                    result[row[0]] = {"whenToUse": row[1], "requiredOutput": row[2]}
    return result


def build_mode_definitions(plan: dict[str, Any], guide: dict[str, Any]) -> list[dict[str, Any]]:
    guide_modes = find_guide_mode_table(guide)
    definitions = []
    for name, summary in plan["study_modes"].items():
        if name == "override_rule":
            continue
        guide_row = guide_modes.get(name, {})
        definitions.append(
            {
                "id": slugify(name),
                "name": name,
                "summary": summary,
                "whenToUse": guide_row.get("whenToUse", "Use the diagnostic confidence rule in the plan."),
                "requiredOutput": guide_row.get("requiredOutput", summary),
                "completeInstructions": " ".join(filter(None, [summary, guide_row.get("whenToUse", ""), guide_row.get("requiredOutput", "")]))
            }
        )

    operational = [
        ("Exam under test conditions", "Treat the exam as the week's main practice volume. Reproduce testing conditions and do not stack a normal QBank quota on top."),
        ("Evidence-driven review", "Review every incorrect, flagged, and guessed-correct item. Name the cause, record one concrete fix, and schedule a retest 7-14 days later."),
        ("Practice / retrieval", "Use questions, spaced retrieval, and the mistake log to choose the next repair target. Count deeply reviewed work, not screens completed."),
        ("Section Bank / review", "Complete the named questions and review incorrect, flagged and guessed-correct answers. Review time is included in the per-question estimate; only 15-30 minutes of maintenance is added."),
        ("Light retrieval", "Use only short, confidence-building retrieval. Stop broad content work and protect sleep during the taper."),
        ("Rest", "Rest is planned work. Optional Anki maintenance may stay brief, but there is no catch-up quota."),
        ("Rest / logistics", "Protect recovery and complete only the named logistics task. Do not turn the block into an unplanned study marathon."),
        ("Logistics", "Complete only the named checklist, route, ID or food task in 20-45 minutes. This is a short task, not a zero-work rest day."),
        ("Exam if officially scheduled", "This is a placeholder window only. Treat it as test day only after the registered AAMC date is entered."),
    ]
    for name, instructions in operational:
        definitions.append(
            {
                "id": slugify(name),
                "name": name,
                "summary": instructions,
                "whenToUse": "Use when this exact mode appears on the dated schedule.",
                "requiredOutput": "Complete the named block without adding unrelated volume.",
                "completeInstructions": instructions,
            }
        )
    return definitions


def write_content_map(validation: dict[str, Any]) -> None:
    content = f"""# MCAT Tracker Content Coverage Map

This map shows where every authoritative source component appears. `data/site-data.json` is generated; it is not an editable source of truth.

| Authoritative source | Source component | Website location | Treatment |
|---|---|---|---|
| `schedule.csv` | All {validation['dailyRows']} dated rows | Today; Plan; Daily Schedule export | Today prioritizes the current/next action; Plan exposes every row and complete details. |
| `schedule.csv` | Assignments, resources, modes, targets, CARS, milestones | Today details; Plan day accordions; contextual Log prefills | Raw source text and per-chapter mode multiplicity are preserved; repeated modes are displayed once. |
| `plan.json` | Metadata, {validation['numericWeeks']} weeks, targets, phases | Today; Plan; Guide | Weekly progress uses the exact planned hours, UWorld, CARS, focus, and milestone values. |
| `plan.json` | Preferred/fallback windows, placeholders, registration, readiness rules | Today countdown; Exams; Guide | January 22-23 remain clearly labeled placeholders until a registered date is saved. |
| `plan.json` + guide | Study modes and complete instructions | Today/Plan detail drawer; Guide | The plan summary is merged with the guide’s when-to-use and required-output rules. |
| `kaplan-mcat-books.md` | 83 chapter IDs, titles, and every subsection | Today/Plan chapter details; Log chapter selector | Generated directly; no second editable chapter-title list is maintained. |
| Study guide | Plan overview and What Changed | Guide → Plan overview / What Changed | Full extracted text, callouts, and lists. |
| Study guide | Operating Rules + study-mode rule | Guide; Today/Plan contextual links | Full rules and table; surfaced beside daily work. |
| Study guide | Phase Map + question-volume budget | Guide; Plan phase map | Complete tables and phase navigation. |
| Study guide | Honest Time Templates | Guide; Today workload context | Complete guide section; Today adds a clearly labeled inference. |
| Study guide | Week-by-Week Plan + Week 1 | Guide; Plan | Full guide tables plus the complete interactive daily schedule. |
| Study guide | Full-Length and Section Bank Schedule | Exams; Plan; Guide | All {validation['fullLengthEvents']} exams and {validation['sectionBankQuestions']} Section Bank questions are linked to dated assignments. |
| Study guide | January vs. March Decision + March protocol | Exams readiness card; Guide | The plan’s own decision rule is shown as guidance, not definitive advice. |
| Study guide | Registration and Resource Controls + source links | Exams date setting; Guide | Full content and clickable source links. |
| Workbook | Mistake Log fields and validation lists | Log quick capture; complete log; CSV/XLSX | The fast form keeps common fields visible and retains workbook-compatible concepts. |
| Workbook | Weekly Pattern Review | Log summaries; XLSX export | Counts by error, topic, section, source, repeat issue, and retest status. |
| Workbook | Complete 40-topic mastery checklist | Log → Mastery | Confidence, review dates, notes, related mistakes, and contextual links. |
| `schedule.csv` + `plan.json` | Daily Schedule / week progress | Plan; progress summaries; XLSX export | Dates come from the current plan, not the legacy workbook. Current browser state is added at export time. |

## Validation snapshot

- Daily rows: {validation['dailyRows']} ({validation['dateRange']['start']} through {validation['dateRange']['end']}, continuous)
- Duplicate dates: {validation['duplicateDates']}
- Missing dates: {validation['missingDates']}
- Week boundaries: {validation['weekBoundary']}
- Kaplan assignments resolved: {validation['chapterAssignments']} / 83; unknown IDs: 0
- Plan weeks reconciled: {validation['numericWeeks']} / {validation['numericWeeks']}
- Full-length events: {validation['fullLengthEvents']}
- Section Bank questions: {validation['sectionBankQuestions']}
- Workload: every mode explicitly costed; every week's low estimate within its budget; upper/midpoint risks shown in Plan
- Mastery topics: 40
- Meaningful guide sections mapped: 9 / 9, plus plan overview and source links
"""
    CONTENT_MAP_PATH.write_text(content, encoding="utf-8")


def main() -> int:
    for path in [SCHEDULE_PATH, PLAN_PATH, CHAPTERS_PATH, GUIDE_PATH, WORKBOOK_PATH, README_PATH]:
        if not path.exists():
            fail(f"Missing authoritative source: {path}")

    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    chapters = parse_chapters()
    chapter_index = {chapter["id"]: chapter for chapter in chapters}
    guide = parse_guide()
    workbook = workbook_content(plan)
    schedule, validation = parse_schedule(chapter_index, plan)
    exams = derive_exams(schedule, plan)
    section_banks = derive_section_banks(schedule, plan)
    phase_map = derive_phase_map(plan)
    mode_definitions = build_mode_definitions(plan, guide)
    known_modes = {mode["name"].lower() for mode in mode_definitions}
    for row in schedule:
        if any(mode.strip().lower() not in known_modes for mode in row["mode"].split(";")):
            fail(f"Missing UI mode definition on {row['date']}")
    if sum(week["uworld_questions"] for week in plan["weeks"]) != plan["question_targets"]["uworld_baseline"]:
        fail("UWorld baseline does not match weekly totals")

    validation.update(
        {
            "planWeeks": len(plan["weeks"]),
            "kaplanChapters": len(chapters),
            "fullLengthEvents": len(exams),
            "sectionBankQuestions": sum(group["totalQuestions"] for group in section_banks),
            "guideSections": len([section for section in guide["sections"] if section["id"] != "overview"]),
            "expectedGuideSectionsPresent": len(EXPECTED_GUIDE_SECTIONS),
            "masteryTopics": len(workbook["mastery"]["topics"]),
            "status": "passed",
        }
    )

    source_paths = [SCHEDULE_PATH, PLAN_PATH, CHAPTERS_PATH, GUIDE_PATH, WORKBOOK_PATH, README_PATH]
    payload = {
        "schemaVersion": 1,
        "sourceProvenance": [
            {"file": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}
            for path in source_paths
        ],
        "plan": plan,
        "phaseMap": phase_map,
        "studyModes": mode_definitions,
        "chapters": chapters,
        "schedule": schedule,
        "exams": exams,
        "sectionBanks": section_banks,
        "guide": guide,
        "workbook": workbook,
        "validation": validation,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_content_map(validation)
    print(
        json.dumps(
            {
                "output": str(OUTPUT_PATH),
                "dailyRows": validation["dailyRows"],
                "chapters": validation["kaplanChapters"],
                "guideSections": validation["guideSections"],
                "masteryTopics": validation["masteryTopics"],
                "status": validation["status"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as error:
        print(f"Validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
