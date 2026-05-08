"""Execution-accuracy evals for the agent-mode pipeline.

Three layers:

- ``golden_cases`` — typed dataset of natural-language → expected (route,
  intent, template_key, tables_used, optional golden_sql).
- ``runner``       — runs the agent end-to-end and grades each case.
- ``scripts/run_openai_evals.py`` — CLI wrapper (local / shadow / full).
"""

from app.evals.golden_cases import GOLDEN_CASES, GoldenCase
from app.evals.runner import GradeResult, grade_case, run_eval_suite

__all__ = [
    "GOLDEN_CASES",
    "GoldenCase",
    "GradeResult",
    "grade_case",
    "run_eval_suite",
]
