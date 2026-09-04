"""Stdlib regression tests; no Office runtime or parent-source fixtures required."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("site_generator", Path(__file__).resolve().parents[1] / "scripts/generate_site_data.py")
g = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(g)


def row(**changes):
    baseline = dict(date="2026-09-01", day="Tue", week=1, assignment="Review",
                    mode="Rapid review", chapterIds=["PHY10"], isRest=False,
                    isExam=False, isFullLengthReview=False, practiceTarget="",
                    carsPassages=0)
    return {**baseline, **changes}


class WorkloadTests(unittest.TestCase):
    def test_stop_rule_is_explicit_and_source_rewording_requires_review(self):
        rule = g.TODAY_STOP_RULES["2026-09-03"]
        self.assertEqual(g.stop_rule_for(dict(date="2026-09-03", notes=rule)), rule)
        with self.assertRaisesRegex(g.ValidationError, "source notes changed"):
            g.stop_rule_for(dict(date="2026-09-03", notes="Reworded guardrail"))
        self.assertEqual(g.stop_rule_for(dict(date="2026-09-08", notes="")), "")

    def test_unknown_modes_rejected_even_before_special_day_returns(self):
        for flags in ({}, {"isRest": True}, {"isExam": True}, {"isFullLengthReview": True}):
            with self.subTest(flags=flags), self.assertRaisesRegex(g.ValidationError, "Unknown workload modes"):
                g.infer_workload(row(mode="New surprise", **flags))
        with self.assertRaisesRegex(g.ValidationError, "cannot stack"):
            g.infer_workload(row(isExam=True, mode="Exam under test conditions; Light retrieval"))

    def test_launch_is_additive_and_week_independent(self):
        a = g.infer_workload(row(mode="Rapid review; Rapid review", chapterIds=["PHY10", "PHY11"]))
        b = g.infer_workload(row(mode="Rapid review; Rapid review; Rapid review", chapterIds=["GC01", "GC02", "GC03"]))
        self.assertEqual(b["lowMinutes"] - a["lowMinutes"], 30)
        self.assertEqual(b["highMinutes"] - a["highMinutes"], 45)
        self.assertEqual(a, g.infer_workload(row(week=7, mode="Rapid review; Rapid review", chapterIds=["PHY10", "PHY11"])))

    def test_light_retrieval_and_logistics_are_not_zero(self):
        for mode, low, high in [("Light retrieval", 35, 70), ("Logistics", 20, 45), ("Rest / logistics", 20, 45)]:
            result = g.infer_workload(row(mode=mode, chapterIds=[]))
            self.assertEqual((result["lowMinutes"], result["highMinutes"]), (low, high))

    def test_all_question_blocks_count_with_review(self):
        result = g.infer_workload(row(mode="Section Bank / review", chapterIds=[], practiceTarget="10 B/B Section Bank questions; 20 C/P Section Bank questions; 5 UWorld questions", carsPassages=2))
        self.assertEqual(result["lowMinutes"], 15 + 30*5 + 5*4 + 2*15)
        self.assertEqual(result["highMinutes"], 30 + 30*8 + 5*7 + 2*22)

    def test_placeholder_conditional_not_half_hour_study(self):
        result = g.infer_workload(row(mode="Exam if officially scheduled", chapterIds=[], week="TEST"))
        self.assertTrue(result["conditional"])
        self.assertEqual((result["lowMinutes"], result["highMinutes"]), (450, 480))
        self.assertIn("If registered", result["label"])

    def test_budget_failure_and_advisory_risks(self):
        rows = [{"estimatedWorkload": {"lowMinutes": 121, "highMinutes": 180}}]
        with self.assertRaisesRegex(g.ValidationError, "minimum estimate"):
            g.validate_week_workload(rows, {"week": 4, "planned_hours": 2})
        rows[0]["estimatedWorkload"]["lowMinutes"] = 60
        self.assertEqual(g.validate_week_workload(rows, {"week": 4, "planned_hours": 2})["capacityRisk"], "upper-over-budget")
        rows[0]["estimatedWorkload"]["lowMinutes"] = 120
        self.assertEqual(g.validate_week_workload(rows, {"week": 4, "planned_hours": 2})["capacityRisk"], "midpoint-over-budget")

    def test_required_tracker_is_dynamic(self):
        sheets = {name: [] for name in ["Daily Schedule", "Mistake Log", "Weekly Pattern Review", "High-Yield Mastery Checklist", "Lists", "22-Week Tracker"]}
        with patch.object(g, "parse_xlsx_sheets", return_value=sheets), self.assertRaisesRegex(g.ValidationError, "20-Week Tracker"):
            g.workbook_content({"prep_weeks": 20})

    def test_section_totals_come_from_plan(self):
        rows = [{"practiceTarget": "7 B/B Section Bank questions", "date": "2026-10-20", "week": 8, "id": "2026-10-20"}]
        plan = {"question_targets": {"section_bank": 7, "section_bank_by_section": {"B/B": 7}}}
        self.assertEqual(g.derive_section_banks(rows, plan)[0]["totalQuestions"], 7)
        plan["question_targets"]["section_bank_by_section"]["B/B"] = 8
        with self.assertRaises(g.ValidationError):
            g.derive_section_banks(rows, plan)

    def test_exam_count_comes_from_configured_dates(self):
        plan = {"full_length_dates": ["2026-09-05"]}
        rows = [{"id": "2026-09-05", "isExam": True, "assignment": "AAMC Unscored Sample", "resource": "AAMC", "date": "2026-09-05", "week": 1},
                {"id": "2026-09-06", "isExam": False, "isFullLengthReview": True},
                {"id": "2026-09-07", "isExam": False, "isFullLengthReview": True}]
        self.assertEqual(len(g.derive_exams(rows, plan)), 1)
        with self.assertRaises(g.ValidationError):
            g.derive_exams(rows, {"full_length_dates": []})


if __name__ == "__main__":
    unittest.main()
