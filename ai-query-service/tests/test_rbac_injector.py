import pytest

from app.auth.context import AuthContext
from app.graph.nodes.rbac_injector import make_rbac_injector
from app.rbac.policy import (
    check_template_access,
    compute_allowed_outlets,
    has_global_scope,
)


def _auth(roles: set[str], outlets: set[int]) -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(roles),
        permissions=frozenset(),
        outlet_ids=frozenset(outlets),
    )


def test_compute_allowed_intersection():
    out = compute_allowed_outlets(
        auth_outlet_ids={1, 2, 3},
        requested_outlet_ids=[2, 3, 99],  # 99 not in scope
        roles={"STORE_MANAGER"},
    )
    assert out == [2, 3]


def test_compute_allowed_no_request_uses_full_scope():
    out = compute_allowed_outlets(
        auth_outlet_ids={1, 2},
        requested_outlet_ids=None,
        roles={"STORE_MANAGER"},
    )
    assert out == [1, 2]


def test_cfo_global_scope_via_provider():
    out = compute_allowed_outlets(
        auth_outlet_ids={1},
        requested_outlet_ids=None,
        roles={"CFO"},
        all_outlet_ids_provider=lambda: [1, 2, 3, 4, 5],
    )
    assert out == [1, 2, 3, 4, 5]


def test_cfo_with_specific_request_intersects():
    out = compute_allowed_outlets(
        auth_outlet_ids={1},
        requested_outlet_ids=[2, 3],
        roles={"CFO"},
        all_outlet_ids_provider=lambda: [1, 2, 3, 4, 5],
    )
    assert out == [2, 3]


def test_empty_intersection_raises():
    with pytest.raises(ValueError, match="No allowed outlets"):
        compute_allowed_outlets(
            auth_outlet_ids={1, 2},
            requested_outlet_ids=[99],
            roles={"STORE_MANAGER"},
        )


def test_template_role_restriction_payroll():
    assert check_template_access("T27_payroll_cost_by_outlet", {"CFO"})
    assert check_template_access("T27_payroll_cost_by_outlet", {"ADMIN"})
    assert not check_template_access("T27_payroll_cost_by_outlet", {"STORE_MANAGER"})
    assert not check_template_access("T27_payroll_cost_by_outlet", {"AREA_MANAGER"})


def test_template_no_restriction():
    assert check_template_access("T01_daily_revenue", {"STORE_MANAGER"})


def test_has_global_scope():
    assert has_global_scope({"CFO"})
    assert has_global_scope({"ADMIN"})
    assert not has_global_scope({"STORE_MANAGER"})


def test_injector_renders_with_outlet_filter():
    inject = make_rbac_injector()
    state = {
        "auth": _auth({"STORE_MANAGER"}, {1, 2}),
        "template_key": "T01_daily_revenue",
        "template_params": {"from_date": "2026-01-01", "to_date": "2026-01-31"},
        "resolved_entities": {},
    }
    out = inject(state)
    assert out["allowed_outlet_ids"] == [1, 2]
    assert "outlet_id IN (1,2)" in out["final_sql"]


def test_injector_intersects_requested_with_auth_scope():
    inject = make_rbac_injector()
    state = {
        "auth": _auth({"STORE_MANAGER"}, {1, 2, 3}),
        "template_key": "T01_daily_revenue",
        "template_params": {"from_date": "2026-01-01", "to_date": "2026-01-31"},
        "resolved_entities": {"outlet_ids": [2, 999]},  # 999 not in scope
    }
    out = inject(state)
    assert out["allowed_outlet_ids"] == [2]


def test_injector_empty_scope_records_error():
    inject = make_rbac_injector()
    state = {
        "auth": _auth({"STORE_MANAGER"}, {1, 2}),
        "template_key": "T01_daily_revenue",
        "template_params": {"from_date": "2026-01-01", "to_date": "2026-01-31"},
        "resolved_entities": {"outlet_ids": [999]},
    }
    out = inject(state)
    assert "validation_errors" in out
    assert "final_sql" not in out
