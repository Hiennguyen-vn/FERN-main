#!/usr/bin/env python3
"""Promote staged learning events into knowledge/learned_scenarios.yaml.

Input is a JSONL file where each line is a learning event emitted by
``app.audit.learning.build_learning_event``. This keeps runtime writes out of
the production container; humans or automation can review/promote offline.

Usage:
    python scripts/promote_learning_scenarios.py staging.jsonl
    python scripts/promote_learning_scenarios.py staging.jsonl --min-occurrences 2
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "knowledge" / "learned_scenarios.yaml"


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        obj = json.loads(raw)
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _merge_examples(current: list[str], incoming: list[str], *, cap: int = 6) -> list[str]:
    out: list[str] = []
    for text in [*current, *incoming]:
        clean = str(text or "").strip()
        if clean and clean not in out:
            out.append(clean)
        if len(out) >= cap:
            break
    return out


def _merge_string_lists(current: list[str], incoming: list[str], *, cap: int = 10) -> list[str]:
    out: list[str] = []
    for value in [*current, *incoming]:
        clean = str(value or "").strip()
        if clean and clean not in out:
            out.append(clean)
        if len(out) >= cap:
            break
    return out


def _clean_sql_plan(plan: Any) -> dict[str, Any]:
    data = plan if isinstance(plan, dict) else {}
    list_fields = {
        "primary_tables": 8,
        "optional_tables": 8,
        "metric_plan_vi": 10,
        "join_hints_vi": 8,
        "filter_hints_vi": 8,
        "risk_notes_vi": 6,
        "must_avoid_vi": 10,
        "logical_steps_vi": 12,
    }
    out: dict[str, Any] = {
        "goal_vi": str(data.get("goal_vi") or "")[:400],
        "grain_vi": str(data.get("grain_vi") or "")[:300],
        "time_binding_vi": str(data.get("time_binding_vi") or "")[:300],
    }
    for field, cap in list_fields.items():
        out[field] = _merge_string_lists([], [str(x) for x in (data.get(field) or [])], cap=cap)
    return out


def promote(rows: list[dict[str, Any]], *, min_occurrences: int, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing if isinstance(existing, dict) else {}
    current_rows = existing.get("scenarios") if isinstance(existing.get("scenarios"), list) else []
    by_key: dict[str, dict[str, Any]] = {
        str(row.get("scenario_key") or ""): dict(row)
        for row in current_rows
        if isinstance(row, dict) and str(row.get("scenario_key") or "").strip()
    }

    grouped: dict[str, list[dict[str, Any]]] = {}
    grouped_sql_writer: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        candidate = row.get("scenario_candidate")
        if not isinstance(candidate, dict):
            candidate = None
        if isinstance(candidate, dict):
            key = str(candidate.get("scenario_key") or "").strip()
            if key and candidate.get("template_key"):
                grouped.setdefault(key, []).append(candidate)

        sql_writer = row.get("sql_writer_candidate")
        if isinstance(sql_writer, dict) and sql_writer.get("trial_passed"):
            key = str(sql_writer.get("scenario_key") or "").strip()
            if key and (sql_writer.get("dataset_candidates") or sql_writer.get("tables_used")):
                grouped_sql_writer.setdefault(key, []).append(sql_writer)

    for key, items in grouped.items():
        if len(items) < min_occurrences:
            continue
        base = dict(by_key.get(key) or {})
        latest = dict(items[-1])
        base["scenario_key"] = key
        base["template_key"] = latest.get("template_key")
        base["intent"] = latest.get("intent")
        base["domain"] = latest.get("domain")
        base["task_type"] = latest.get("task_type")
        base["metric_ids"] = _merge_string_lists(base.get("metric_ids") or [], latest.get("metric_ids") or [], cap=8)
        base["required_slots"] = _merge_string_lists(base.get("required_slots") or [], latest.get("required_slots") or [], cap=8)
        base["dataset_candidates"] = _merge_string_lists(
            base.get("dataset_candidates") or [],
            latest.get("dataset_candidates") or [],
            cap=10,
        )
        base["example_questions"] = _merge_examples(
            base.get("example_questions") or [],
            [str(x) for item in items for x in (item.get("example_questions") or [])],
            cap=6,
        )
        base["report_spec"] = latest.get("report_spec") or {}
        base["permission_profile"] = latest.get("permission_profile") or {}
        base["min_confidence"] = latest.get("min_confidence", 0.78)
        base["enabled"] = True
        base["promoted_occurrences"] = len(items)
        by_key[key] = base

    for key, items in grouped_sql_writer.items():
        if len(items) < min_occurrences:
            continue
        base = dict(by_key.get(key) or {})
        latest = dict(items[-1])
        base["scenario_type"] = "sql_writer"
        base["scenario_key"] = key
        base["template_key"] = None
        base["intent"] = latest.get("intent")
        base["domain"] = latest.get("domain")
        base["task_type"] = latest.get("task_type")
        base["metric_ids"] = _merge_string_lists(base.get("metric_ids") or [], latest.get("metric_ids") or [], cap=8)
        base["required_slots"] = _merge_string_lists(
            base.get("required_slots") or [],
            latest.get("required_slots") or [],
            cap=8,
        )
        base["dataset_candidates"] = _merge_string_lists(
            base.get("dataset_candidates") or [],
            latest.get("dataset_candidates") or [],
            cap=10,
        )
        base["tables_used"] = _merge_string_lists(
            base.get("tables_used") or [],
            latest.get("tables_used") or [],
            cap=10,
        )
        base["sql_hashes"] = _merge_string_lists(
            base.get("sql_hashes") or [],
            [str(item.get("sql_hash") or "") for item in items],
            cap=12,
        )
        base["example_questions"] = _merge_examples(
            base.get("example_questions") or [],
            [str(x) for item in items for x in (item.get("example_questions") or [])],
            cap=8,
        )
        base["report_spec"] = latest.get("report_spec") or {}
        base["sql_plan"] = _clean_sql_plan(latest.get("sql_plan"))
        base["permission_profile"] = latest.get("permission_profile") or {}
        base["min_confidence"] = max(float(latest.get("min_confidence") or 0.8), 0.8)
        base["enabled"] = True
        base["requires_codegen_trial"] = True
        base["promotion_policy"] = "runtime_blueprint_only_no_raw_sql"
        base["promoted_occurrences"] = len(items)
        by_key[key] = base

    promoted = [by_key[key] for key in sorted(by_key)]
    return {"version": 1, "scenarios": promoted}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="JSONL file with learning events")
    parser.add_argument("--output", default=str(DEFAULT_OUT), help="YAML output path")
    parser.add_argument("--min-occurrences", type=int, default=2)
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    output_path = Path(args.output)
    existing = yaml.safe_load(output_path.read_text(encoding="utf-8")) if output_path.exists() else {"version": 1, "scenarios": []}
    promoted = promote(_load_jsonl(input_path), min_occurrences=max(1, int(args.min_occurrences)), existing=existing)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(yaml.safe_dump(promoted, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"Wrote {len(promoted.get('scenarios') or [])} promoted scenarios to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
