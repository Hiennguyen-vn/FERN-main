"""CSV artifact builder.

Produces a single ``.csv`` file with the full result rows (within
``EXPORTS_MAX_ROWS``) and a leading metadata banner so users can verify
the agent's answer against ground-truth data.
"""

from __future__ import annotations

import csv
import json
import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from app.config import get_settings
from app.exports.catalog import ExportArtifact, register_artifact
from app.exports.policy import safe_filename_stem
from app.exports.storage import artifact_path

logger = logging.getLogger(__name__)


def _json_cell(value: Any) -> Any:
    """JSON-serialisable cell for machine-readable exports (no Decimal/datetime leaks)."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return "<binary>"
    return str(value)


def _json_rows(rows: list[dict[str, Any]], columns: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append({c: _json_cell(row.get(c)) for c in columns})
    return out


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, Decimal):
        return str(float(value))
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return "<binary>"
    return str(value)


def _collect_columns(rows: list[dict[str, Any]]) -> list[str]:
    cols: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            k = str(key)
            if k not in seen:
                seen.add(k)
                cols.append(k)
    return cols


def _write_metadata_banner(
    writer: csv.writer,
    *,
    question: str,
    correlation_id: str,
    user_id: int,
    template_key: str | None,
    intent: str | None,
    rationale_vi: str | None,
    tables_used: list[str],
    time_range: dict[str, str],
    allowed_outlet_count: int,
    data_source: dict[str, Any] | None,
    full_row_count: int,
    truncated: bool,
    cap: int,
) -> None:
    writer.writerow(["# FERN AI Query Export"])
    writer.writerow(["# generated_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")])
    writer.writerow(["# correlation_id", correlation_id])
    writer.writerow(["# user_id", str(user_id)])
    writer.writerow(["# question", (question or "")[:500]])
    writer.writerow(["# intent", str(intent or "")])
    writer.writerow(["# template_key", str(template_key or "")])
    if rationale_vi:
        writer.writerow(["# rationale_vi", str(rationale_vi)[:500]])
    if tables_used:
        writer.writerow(["# tables_used", ", ".join(str(t) for t in tables_used)])
    writer.writerow(
        [
            "# time_range",
            f"{time_range.get('from_date', '')} → {time_range.get('to_date', '')}",
        ]
    )
    writer.writerow(["# allowed_outlet_count", str(allowed_outlet_count)])
    if data_source:
        writer.writerow(
            [
                "# data_source",
                str(data_source.get("primary_dataset") or ""),
                "time_column=" + str(data_source.get("time_column") or ""),
                "coverage_status=" + str(data_source.get("coverage_status") or ""),
            ]
        )
    writer.writerow(["# total_rows_in_result", str(full_row_count)])
    if truncated:
        writer.writerow(
            [
                "# truncation_warning",
                f"only first {cap} rows exported (EXPORTS_MAX_ROWS); query yielded more",
            ]
        )
    writer.writerow([])  # blank line separator before data section


def build_csv_artifact(
    *,
    rows: list[dict[str, Any]],
    question: str,
    correlation_id: str,
    user_id: int,
    template_key: str | None,
    intent: str | None,
    rationale_vi: str | None,
    tables_used: list[str],
    time_range: dict[str, str],
    allowed_outlet_count: int,
    data_source: dict[str, Any] | None,
) -> ExportArtifact | None:
    """Materialise rows into a CSV file and register it. Returns artifact or None on failure."""
    s = get_settings()
    if not s.exports_enabled:
        return None
    if not rows:
        return None

    cap = max(1, int(s.exports_max_rows))
    truncated = len(rows) > cap
    materialised = rows[:cap]

    artifact_id = str(uuid.uuid4())
    stem = safe_filename_stem(question, intent)
    filename = f"{stem}-{artifact_id[:8]}.csv"
    path = artifact_path(artifact_id, filename)

    columns = _collect_columns(materialised)
    if not columns:
        return None

    try:
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
            _write_metadata_banner(
                writer,
                question=question,
                correlation_id=correlation_id,
                user_id=user_id,
                template_key=template_key,
                intent=intent,
                rationale_vi=rationale_vi,
                tables_used=tables_used,
                time_range=time_range,
                allowed_outlet_count=allowed_outlet_count,
                data_source=data_source,
                full_row_count=len(rows),
                truncated=truncated,
                cap=cap,
            )
            writer.writerow(columns)
            for row in materialised:
                if not isinstance(row, dict):
                    continue
                writer.writerow([_stringify(row.get(c)) for c in columns])
    except OSError as e:
        logger.warning("CSV export write failed: %s", e)
        return None

    return register_artifact(
        artifact_id=artifact_id,
        user_id=user_id,
        correlation_id=correlation_id,
        filename=filename,
        fmt="csv",
        path=path,
        row_count=len(materialised),
        question=question,
        metadata={
            "template_key": template_key,
            "intent": intent,
            "tables_used": list(tables_used or []),
            "truncated": truncated,
        },
    )


def build_json_artifact(
    *,
    rows: list[dict[str, Any]],
    question: str,
    correlation_id: str,
    user_id: int,
    template_key: str | None,
    intent: str | None,
    tables_used: list[str],
    time_range: dict[str, str],
    allowed_outlet_count: int,
    data_source: dict[str, Any] | None,
) -> ExportArtifact | None:
    """Machine-readable JSON export: columns + rows only (typed), minimal meta — no comment banners."""
    s = get_settings()
    if not s.exports_enabled or not getattr(s, "exports_json_enabled", True):
        return None
    if not rows:
        return None

    cap = max(1, int(s.exports_max_rows))
    truncated = len(rows) > cap
    materialised = rows[:cap]

    artifact_id = str(uuid.uuid4())
    stem = safe_filename_stem(question, intent)
    filename = f"{stem}-{artifact_id[:8]}.json"
    path = artifact_path(artifact_id, filename)

    columns = _collect_columns(materialised)
    if not columns:
        return None

    payload = {
        "schema": "fern.ai_query_export/v1",
        "meta": {
            "correlation_id": correlation_id,
            "user_id": user_id,
            "question": (question or "")[:500],
            "intent": str(intent or ""),
            "template_key": str(template_key or ""),
            "tables_used": [str(t) for t in (tables_used or [])],
            "time_range": {
                "from_date": str((time_range or {}).get("from_date", "") or ""),
                "to_date": str((time_range or {}).get("to_date", "") or ""),
            },
            "allowed_outlet_count": allowed_outlet_count,
            "data_source": data_source or {},
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "full_row_count": len(rows),
            "materialised_row_count": len(materialised),
            "truncated": truncated,
        },
        "columns": columns,
        "rows": _json_rows(materialised, columns),
    }

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except OSError as e:
        logger.warning("JSON export write failed: %s", e)
        return None

    return register_artifact(
        artifact_id=artifact_id,
        user_id=user_id,
        correlation_id=correlation_id,
        filename=filename,
        fmt="json",
        path=path,
        row_count=len(materialised),
        question=question,
        metadata={
            "template_key": template_key,
            "intent": intent,
            "tables_used": list(tables_used or []),
            "truncated": truncated,
        },
    )
