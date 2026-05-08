import pytest

from app.graph import builder
from app.graph.nodes import self_correction as sc


def test_self_correction_classifier_is_strict():
    assert sc.is_self_correction_candidate("Code: 62. DB::Exception: Syntax error: failed at position 14")
    assert sc.is_self_correction_candidate("Unknown function sumIff")
    assert not sc.is_self_correction_candidate("Access denied: permission denied")
    assert not sc.is_self_correction_candidate("Unknown table analytics.nope")
    assert not sc.is_self_correction_candidate("Memory limit exceeded")


def test_route_after_executor_only_retries_fixable_errors():
    assert builder._route_after_executor(  # noqa: SLF001
        {"execution_error": "Syntax error: failed at position 9", "correction_attempts": 1}
    ) == "self_correction"
    assert builder._route_after_executor(  # noqa: SLF001
        {"execution_error": "Unknown table analytics.nope", "correction_attempts": 1}
    ) == "answer_formatter"


def test_route_after_self_correction_stops_when_no_fix_was_applied():
    assert builder._route_after_self_correction({"self_correction_applied": False}) == "answer_formatter"  # noqa: SLF001
    assert builder._route_after_self_correction(  # noqa: SLF001
        {"self_correction_applied": True, "corrected_sql": "SELECT 1"}
    ) == "sql_logical_check"


@pytest.mark.asyncio
async def test_self_correction_aborts_without_retry_when_llm_declines(monkeypatch):
    async def fake_llm(*_args, **_kwargs):
        return {"abort": True, "corrected_sql": None, "reasoning": "not fixable"}, {"latency_ms": 1}

    monkeypatch.setattr(sc, "llm_call_json", fake_llm)
    state = {
        "execution_error": "Syntax error: failed at position 9",
        "final_sql": "SELECT bad FROM analytics.ai_sales_daily",
        "correction_attempts": 1,
        "trace": [],
    }

    out = await sc.self_correction(state)

    assert out["self_correction_applied"] is False
    assert out.get("corrected_sql") is None
    assert out["trace"][-1]["outcome"] == "aborted"


@pytest.mark.asyncio
async def test_self_correction_skips_non_fixable_error(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not run for non-fixable executor errors")

    monkeypatch.setattr(sc, "llm_call_json", fail_llm)
    state = {
        "execution_error": "Unknown table analytics.nope",
        "final_sql": "SELECT * FROM analytics.nope",
        "correction_attempts": 1,
        "trace": [],
    }

    out = await sc.self_correction(state)

    assert out["self_correction_applied"] is False
    assert out["trace"][-1]["reason"] == "non_fixable_error"
