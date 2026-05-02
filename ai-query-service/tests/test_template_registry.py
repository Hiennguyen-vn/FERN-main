import pytest

from app.templates.registry import (
    TEMPLATES,
    SQL_DIR,
    list_templates,
    render,
    template_exists,
)
from app.guard.sql_ast import validate_sql


def test_all_templates_have_sql_file():
    missing = [k for k in TEMPLATES if not (SQL_DIR / f"{k}.sql").exists()]
    assert not missing, f"Missing SQL files: {missing}"


def test_thirty_templates_registered():
    assert len(TEMPLATES) == 30


def test_render_t01():
    sql = render(
        "T01_daily_revenue",
        outlet_ids=[1, 2, 3],
        from_date="2026-01-01",
        to_date="2026-01-31",
    )
    assert "outlet_id IN (1,2,3)" in sql
    assert "2026-01-01" in sql
    assert "2026-01-31" in sql


def test_render_missing_required_param():
    with pytest.raises(ValueError, match="Missing required params"):
        render("T01_daily_revenue", outlet_ids=[1])


def test_render_empty_outlet_ids_rejected():
    with pytest.raises(ValueError, match="cannot be empty"):
        render("T01_daily_revenue", outlet_ids=[], from_date="2026-01-01", to_date="2026-01-31")


def test_render_non_int_outlet_ids_rejected():
    with pytest.raises(ValueError, match="list\\[int\\]"):
        render(
            "T01_daily_revenue",
            outlet_ids=["1; DROP TABLE"],  # type: ignore
            from_date="2026-01-01",
            to_date="2026-01-31",
        )


def test_render_optional_param_default():
    sql = render(
        "T04_top_products",
        outlet_ids=[1],
        from_date="2026-01-01",
        to_date="2026-01-31",
    )
    assert "LIMIT 10" in sql  # default

    sql2 = render(
        "T04_top_products",
        outlet_ids=[1],
        from_date="2026-01-01",
        to_date="2026-01-31",
        limit=5,
    )
    assert "LIMIT 5" in sql2


@pytest.mark.parametrize("key", sorted(TEMPLATES.keys()))
def test_every_template_passes_sql_guard(key):
    """Render with safe defaults, verify result passes SQL guard."""
    meta = TEMPLATES[key]
    params = {}
    for p in meta.required_params:
        if "date" in p:
            params[p] = "2026-01-01" if "from" in p else "2026-01-31"
        elif p == "limit":
            params[p] = 10
        elif p == "threshold":
            params[p] = 5
    sql = render(key, outlet_ids=[1, 2], **params)
    result = validate_sql(sql)
    assert result.passed, f"{key} failed guard: {result.violations}\nSQL:\n{sql}"
