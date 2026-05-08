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

# PII patterns — mask before logging raw question text.
# Intentionally conservative: phone numbers, emails, and national ID (CCCD) only.
_PII_PHONE = re.compile(r"(?<!\d)(0[3-9]\d{8}|\+84[3-9]\d{8})(?!\d)")
_PII_EMAIL = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_PII_CCCD = re.compile(r"(?<!\d)\d{12}(?!\d)")


def _redact_pii(text: str) -> str:
    """Replace PII literals with placeholder tokens."""
    text = _PII_PHONE.sub("[PHONE]", text)
    text = _PII_EMAIL.sub("[EMAIL]", text)
    text = _PII_CCCD.sub("[CCCD]", text)
    return text


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
        "raw_question": _truncate(_redact_pii(state.get("raw_question", ""))),
        "intent": state.get("intent"),
        "template_key": state.get("template_key"),
        "sql_source": state.get("executed_sql_source") or state.get("sql_source") or ("template" if sql else None),
        "sql_sanitized": _sanitize_sql(sql) if sql else "",
        "sql_hash": _hash_sql(sql) if sql else "",
        "row_count": len(rows),
        "correction_attempts": state.get("correction_attempts", 0),
        "outcome": _outcome(state),
        "validation_errors": state.get("validation_errors", []),
        "guard_violations": state.get("guard_violations", []),
        "execution_error": state.get("execution_error"),
    }


def graph_outcome(state: GraphState) -> str:
    """Stable outcome label for audit, learning pipeline, and metrics."""
    return _outcome(state)


async def emit(state: GraphState) -> None:
    event = build_event(state)
    await publish_audit(event)


async def emit_review_request(event: dict[str, Any]) -> None:
    """Publish a human-review request to the audit stream."""
    await publish_audit(event)
