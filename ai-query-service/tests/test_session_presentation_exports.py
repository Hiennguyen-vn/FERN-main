"""Tests for session digest, presentation bundle, and JSON exports."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from app.exports.catalog import ExportArtifact
from app.presentation.structured_output import build_presentation_bundle


def test_build_session_digest_timeline_and_signals():
    from app.memory.session_digest import build_session_digest

    state = {
        "conversation_turns": [
            {"role": "user", "content": "Doanh thu tháng 2?"},
            {"role": "assistant", "content": "Đã có số liệu..."},
        ],
        "question_frame": {"effective_question": "Doanh thu tháng 2/2026 theo tuần"},
        "intent": "revenue",
        "template_key": "T35_weekly_revenue_trend",
        "time_range": {"from_date": "2026-02-01", "to_date": "2026-02-28"},
        "raw_result": [{"week_start": "2026-02-02", "net_revenue": 100.0}],
    }
    d = build_session_digest(state)
    assert "Doanh thu tháng 2" in d["intent_summary_vi"]
    assert "Bạn" in d["timeline_markdown"]
    assert d["signals"]["template_key"] == "T35_weekly_revenue_trend"


def test_build_presentation_markdown_and_chart():
    state = {
        "response_kind": "answer",
        "raw_result": [
            {"week_start": "2026-02-02", "net_revenue": 10},
            {"week_start": "2026-02-09", "net_revenue": 20},
        ],
    }
    p = build_presentation_bundle(state)
    assert "| week_start |" in p["markdown_table"]
    assert p["chart_spec"]["type"] == "line"
    assert p["chart_spec"]["data"]["datasets"][0]["label"] == "net_revenue"


def test_build_presentation_suppresses_lookup_chart():
    state = {
        "response_kind": "answer",
        "intent": "lookup",
        "template_key": "T37_ai_sales_daily_outlets",
        "raw_result": [
            {"first_business_date": "2025-01-01", "outlet_name": "Outlet 1", "net_revenue": 10},
            {"first_business_date": "2025-01-02", "outlet_name": "Outlet 2", "net_revenue": 20},
        ],
    }
    p = build_presentation_bundle(state)
    assert "| first_business_date |" in p["markdown_table"]
    assert "chart_spec" not in p


def test_build_json_artifact_roundtrip(tmp_path: Path):
    from app.exports.builder import build_json_artifact

    with patch("app.exports.builder.get_settings") as gs, patch(
        "app.exports.builder.artifact_path"
    ) as ap, patch("app.exports.builder.register_artifact") as reg:

        class S:
            exports_enabled = True
            exports_json_enabled = True
            exports_max_rows = 1000
            exports_ttl_hours = 24

        gs.return_value = S()

        def _apath(_aid: str, fn: str):
            return tmp_path / fn

        ap.side_effect = _apath

        def _reg(**kwargs):
            p = kwargs["path"]
            assert p.exists()
            payload = json.loads(p.read_text(encoding="utf-8"))
            assert payload["schema"] == "fern.ai_query_export/v1"
            assert payload["columns"] == ["a"]
            assert payload["rows"] == [{"a": 1}, {"a": 2}]
            now = datetime.now(timezone.utc)
            return ExportArtifact(
                artifact_id=kwargs["artifact_id"],
                user_id=kwargs["user_id"],
                correlation_id=kwargs["correlation_id"],
                filename=kwargs["filename"],
                format=kwargs["fmt"],
                path=p,
                row_count=kwargs["row_count"],
                size_bytes=1,
                sha256="a",
                created_at=now - timedelta(hours=1),
                expires_at=now + timedelta(hours=1),
            )

        reg.side_effect = _reg

        out = build_json_artifact(
            rows=[{"a": 1}, {"a": 2}],
            question="qo",
            correlation_id="cid",
            user_id=7,
            template_key="T01",
            intent="revenue",
            tables_used=["t"],
            time_range={"from_date": "2026-01-01", "to_date": "2026-01-31"},
            allowed_outlet_count=2,
            data_source={"primary_dataset": "x"},
        )
        assert out is not None
        assert out.format == "json"


def test_export_builder_appends_json():
    from app.graph.nodes.export_builder import export_builder

    with patch("app.graph.nodes.export_builder.get_settings") as gs, patch(
        "app.graph.nodes.export_builder.should_generate_export"
    ) as sge, patch("app.graph.nodes.export_builder.build_csv_artifact") as bc, patch(
        "app.graph.nodes.export_builder.build_json_artifact"
    ) as bj:

        class S:
            exports_enabled = True
            exports_json_enabled = True

        gs.return_value = S()
        sge.return_value = (True, "ok")

        class A:
            correlation_id = "c"
            user_id = 1

        class Art:
            def __init__(self, fmt: str, aid: str):
                self.artifact_id = aid
                self.format = fmt
                self.filename = f"f.{fmt}"
                self.row_count = 1
                self.size_bytes = 2
                self.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                self.sha256 = "x"

        bc.return_value = Art("csv", "id1")
        bj.return_value = Art("json", "id2")

        st = {
            "auth": A(),
            "raw_result": [{"x": 1}],
            "question_frame": {"effective_question": "q"},
            "intent": "revenue",
            "template_key": "T1",
            "response_kind": "answer",
            "time_range": {},
            "allowed_outlet_ids": [],
            "trace": [],
        }
        out = export_builder(st)
        ex = out.get("exports") or []
        assert len(ex) == 2
        assert {e["format"] for e in ex} == {"csv", "json"}
