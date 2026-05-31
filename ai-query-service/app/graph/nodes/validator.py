"""Pure Python: validate template_key + params + role access."""
from datetime import date

from app.graph.state import GraphState
from app.rbac.policy import check_template_access
from app.templates.registry import TEMPLATES, ensure_runtime_templates_loaded


MAX_DATE_RANGE_DAYS = 2557
MAX_LIMIT = 1000


def _parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def validator(state: GraphState) -> GraphState:
    ensure_runtime_templates_loaded()
    errors: list[str] = []
    template_key = state.get("template_key")
    params = dict(state.get("template_params", {}) or {})
    auth = state["auth"]

    if not template_key:
        errors.append("No template selected")
        state["validation_errors"] = errors
        return state

    if template_key not in TEMPLATES:
        errors.append(f"Unknown template: {template_key}")
        state["validation_errors"] = errors
        return state

    if not check_template_access(template_key, auth.roles):
        errors.append(f"Role insufficient for template {template_key}")
        state["validation_errors"] = errors
        return state

    meta = TEMPLATES[template_key]
    time_range = state.get("time_range")
    if (
        isinstance(time_range, dict)
        and "from_date" in meta.required_params
        and "to_date" in meta.required_params
    ):
        for key in ("from_date", "to_date"):
            value = str(time_range.get(key) or "").strip()
            if value:
                params[key] = value

    for req in meta.required_params:
        if req not in params or params[req] in (None, ""):
            errors.append(f"Missing required param: {req}")

    # Date range checks
    from_date = _parse_date(params.get("from_date", ""))
    to_date = _parse_date(params.get("to_date", ""))
    if "from_date" in meta.required_params and from_date is None:
        errors.append("Invalid from_date format (expected YYYY-MM-DD)")
    if "to_date" in meta.required_params and to_date is None:
        errors.append("Invalid to_date format (expected YYYY-MM-DD)")
    if from_date and to_date:
        if from_date > to_date:
            errors.append("from_date > to_date")
        elif (to_date - from_date).days > MAX_DATE_RANGE_DAYS:
            errors.append(f"Date range > {MAX_DATE_RANGE_DAYS} days")

    # Clamp limit
    if "limit" in params:
        try:
            params["limit"] = max(1, min(int(params["limit"]), MAX_LIMIT))
        except (ValueError, TypeError):
            params["limit"] = 10

    if "threshold" in params:
        try:
            params["threshold"] = max(0, int(params["threshold"]))
        except (ValueError, TypeError):
            params["threshold"] = 10

    state["template_params"] = params
    state["validation_errors"] = errors
    return state
