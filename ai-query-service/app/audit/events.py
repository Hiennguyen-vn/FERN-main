"""Audit event publish to Kafka topic fern.audit.ai-query."""
import hashlib
import re
import uuid
from datetime import datetime
from typing import Any

from app.clients.kafka import publish_audit
from app.graph.state import GraphState


_LITERAL_NUMERIC = re.compile(r"\b\d+\b")
_LITERAL_QUOTED = re.compile(r"'[^']*'")


def _sanitize_sql(sql: str) -> str:
    """Strip literal values; keep structure."""
    s = _LITERAL_QUOTED.sub("?", sql)
    s = _LITERAL_NUMERIC.sub("?", s)
    return s


def _hash_sql(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()[:32]


def _truncate(s: str, max_len: int = 500) -> str:
    return s if len(s) <= max_len else s[:max_len] + "..."


def _outcome(state: GraphState) -> str:
    if state.get("validation_errors"):
        errs = state["validation_errors"]
        if any("Role insufficient" in e for e in errs):
            return "role_denied"
        if any("No allowed outlets" in e for e in errs):
            return "scope_empty"
        return "validation_error"
    if not state.get("guard_passed", True):
        return "guard_blocked"
    if state.get("execution_error"):
        return "execution_failed"
    return "success"


def build_event(state: GraphState) -> dict[str, Any]:
    sql = state.get("corrected_sql") or state.get("final_sql") or ""
    rows = state.get("raw_result") or []
    auth = state["auth"]

    return {
        "event_id": str(uuid.uuid4()),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "user_id": auth.user_id,
        "session_id": auth.session_id,
        "correlation_id": auth.correlation_id,
        "outlet_ids": sorted(auth.outlet_ids),
        "roles": sorted(auth.roles),
        "raw_question": _truncate(state.get("raw_question", "")),
        "intent": state.get("intent"),
        "template_key": state.get("template_key"),
        "sql_sanitized": _sanitize_sql(sql) if sql else "",
        "sql_hash": _hash_sql(sql) if sql else "",
        "row_count": len(rows),
        "correction_attempts": state.get("correction_attempts", 0),
        "outcome": _outcome(state),
        "validation_errors": state.get("validation_errors", []),
        "guard_violations": state.get("guard_violations", []),
        "execution_error": state.get("execution_error"),
    }


async def emit(state: GraphState) -> None:
    event = build_event(state)
    await publish_audit(event)
