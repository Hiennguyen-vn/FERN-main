"""NO LLM. Critical security node. Inject outlet_id filter from auth headers."""
from typing import Callable

from app.graph.state import GraphState
from app.rbac.policy import compute_allowed_outlets
from app.templates.registry import render


def make_rbac_injector(all_outlet_ids_provider: Callable[[], list[int]] | None = None):
    """Factory: returns node function with injected outlets provider.

    `all_outlet_ids_provider` is called only for CFO/ADMIN to expand scope to all outlets.
    Production: ClickHouse query `SELECT outlet_id FROM fern.dim_outlet FINAL`.
    Tests: pass a stub.
    """

    def rbac_injector(state: GraphState) -> GraphState:
        auth = state["auth"]
        template_key = state.get("template_key")
        if template_key is None:
            state["validation_errors"] = state.get("validation_errors", []) + [
                "No template selected; cannot inject RBAC"
            ]
            state.setdefault("trace", []).append({"node": "rbac_injector", "outcome": "missing_template"})
            return state

        resolved = state.get("resolved_entities", {}) or {}
        requested = list(resolved.get("outlet_ids", []) or [])

        try:
            allowed = compute_allowed_outlets(
                auth_outlet_ids=auth.outlet_ids,
                requested_outlet_ids=requested,
                roles=auth.roles,
                all_outlet_ids_provider=all_outlet_ids_provider,
            )
        except ValueError as e:
            state["validation_errors"] = state.get("validation_errors", []) + [str(e)]
            state.setdefault("trace", []).append({"node": "rbac_injector", "outcome": "rejected"})
            return state

        # Type assertion — defense against Jinja2 injection
        assert all(isinstance(x, int) for x in allowed), "outlet_ids must be list[int]"
        assert len(allowed) > 0

        params = {k: v for k, v in (state.get("template_params", {}) or {}).items() if v is not None}
        sql = render(template_key, outlet_ids=allowed, **params)

        state["allowed_outlet_ids"] = allowed
        state["final_sql"] = sql
        state.setdefault("trace", []).append({"node": "rbac_injector", "outlets": len(allowed)})
        return state

    return rbac_injector
