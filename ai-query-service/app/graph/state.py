from typing import Any, TypedDict

from app.auth.context import AuthContext


class GraphState(TypedDict, total=False):
    # Input
    raw_question: str
    auth: AuthContext

    # Preprocess
    normalized_question: str
    detected_language: str

    # Supervisor
    intent: str
    time_range: dict[str, str]
    raw_entities: dict[str, list[str]]

    # Entity Resolver
    resolved_entities: dict[str, list[int]]

    # Template Matcher
    template_key: str | None
    template_params: dict[str, Any]
    template_confidence: float
    clarification_question: str | None

    # Validator
    validation_errors: list[str]

    # RBAC Injector
    allowed_outlet_ids: list[int]
    final_sql: str

    # SQL Guard
    guard_passed: bool
    guard_violations: list[str]

    # Executor
    raw_result: list[dict]
    execution_error: str | None
    correction_attempts: int

    # Self Correction
    corrected_sql: str | None

    # Answer
    answer_text: str
    citations: list[dict]

    # Trace
    trace: list[dict]
