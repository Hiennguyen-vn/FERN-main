from app.knowledge.lexicon import format_lexicon_hints, load_lexicon_map


def test_lexicon_load_contains_revenue_template():
    mp = load_lexicon_map()
    assert "T02_revenue_by_outlet" in mp
    assert "outlet" in mp["T02_revenue_by_outlet"].lower()


def test_format_lexicon_hints_truncates():
    keys = [f"T{i:02d}_x" for i in range(1, 40)]
    text = format_lexicon_hints(keys, max_keys=5, max_chars=500)
    lines = [x for x in text.split("\n") if x.strip()]
    assert len(lines) <= 6
    assert "T01_x" in text or len(lines) <= 5
