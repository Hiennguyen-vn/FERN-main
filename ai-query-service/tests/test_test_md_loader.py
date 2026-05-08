from pathlib import Path

import pytest

from app.evals.test_md_loader import CASE_ID_RE, load_cases


def test_case_id_regex():
    assert CASE_ID_RE.match("SOC-001")
    assert CASE_ID_RE.match("FIN-RBAC-001")
    assert CASE_ID_RE.match("HR-RBAC-001")
    assert not CASE_ID_RE.match("FOO")


def test_md_load_returns_many_cases():
    root = Path(__file__).resolve().parents[1] / "test.md"
    if not root.exists():
        pytest.skip("test.md missing")
    cases, skips = load_cases(root)
    assert len(cases) >= 120
    assert any("§11 TIME" in s for s in skips)
    assert any("§13 multi-turn" in s for s in skips)
    by_id = {c.id: c for c in cases}
    assert by_id["SOC-001"].question == "xin chào"
    assert by_id["SAL-001"].expected_template_key == "T01_daily_revenue"
    assert by_id["SAL-010"].expected_intent == "outlet_compare"
    assert by_id["SAL-022"].expected_intent == "revenue"
    assert by_id["PRD-004"].expected_intent == "product_mix"
    assert by_id["FIN-005"].expected_intent == "pnl"
    assert "from-test-md" in by_id["PRD-041"].tags
    assert "codegen" in by_id["PRD-041"].tags
    assert by_id["PRD-041"].expected_intent is None
    assert by_id["SAL-071"].expected_intent is None
