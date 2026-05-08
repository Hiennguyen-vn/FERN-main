from app.graph.nodes import metadata_context as mc


def test_format_metadata_context_for_prompt_hides_empty():
    assert mc.format_metadata_context_for_prompt(None) == ""
    assert mc.format_metadata_context_for_prompt("x").startswith("\nNgữ cảnh metadata")


def test_metadata_context_uses_local_policy_when_opensearch_fails(monkeypatch):
    class S:
        metadata_context_enabled = True
        metadata_context_max_hits = 5
        metadata_context_max_chars = 2600

    monkeypatch.setattr(mc, "get_settings", lambda: S())
    monkeypatch.setattr(mc, "hybrid_search_metadata", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("os down")))

    state = {"normalized_question": "doanh thu ròng theo thẻ", "intent": "revenue", "trace": []}
    out = mc.metadata_context(state)

    assert "net_revenue" in out["metadata_context"]
    assert "CARD" in out["metadata_context"]
    assert out["trace"][-1]["node"] == "metadata_context"
