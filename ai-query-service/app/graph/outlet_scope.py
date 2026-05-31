from __future__ import annotations

from typing import Any

from app.graph.state import GraphState


def _int_list(value: Any) -> list[int]:
    out: list[int] = []
    for item in value or []:
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            continue
        if parsed not in out:
            out.append(parsed)
    return out


def resolved_outlet_ids(state: GraphState) -> list[int]:
    resolved = state.get("resolved_entities") or {}
    return _int_list(resolved.get("outlet_ids") if isinstance(resolved, dict) else [])


def scope_outlet_ids(state: GraphState) -> list[int]:
    return _int_list(state.get("scope_outlet_ids") or [])


def requested_outlet_ids_for_rbac(state: GraphState) -> list[int]:
    """Use explicit question outlet entities first; UI scope is only the default."""
    explicit = resolved_outlet_ids(state)
    return explicit if explicit else scope_outlet_ids(state)
