from typing import Any, TypedDict

from app.auth.context import AuthContext


class GraphState(TypedDict, total=False):
    # Input
    raw_question: str
    auth: AuthContext
    conversation_turns: list[dict[str, str]]

    # Preprocess
    normalized_question: str
    detected_language: str
    conversation_context: str
    contextualized_question: str | None
    """Standalone/effective question for follow-up turns; original question is preserved."""
    contextualization_source: str | None
    """Rule/agent that produced contextualized_question, for workflow debug."""
    """Rule-based shortcut: greeting | thanks — skips supervisor LLM."""
    social_kind: str | None

    # Supervisor
    agent_route: str
    intent: str
    time_range: dict[str, str]
    time_context: dict[str, Any]
    raw_entities: dict[str, list[str]]
    visualization_requested: bool
    question_frame: dict[str, Any]
    planning_frame: dict[str, Any]
    route_confidence: float
    ambiguities: list[str]
    escalation_candidate: bool
    escalation_reason: str | None
    escalation_target: str | None
    needs_sql_writer: bool

    # Lightweight planner (structured outline / decision for matcher prompt)
    reasoning_outline: dict[str, Any] | None
    planning_decision: dict[str, Any] | None

    """Allow-listed ClickHouse column snapshot text for prompts (optional)."""
    catalog_digest: str | None
    """Semantic metadata context from query_policy/OpenSearch (metric definitions, aliases, preferred tables)."""
    metadata_context: str | None
    data_coverage_context: dict[str, Any] | None
    """Selected business data source/time contract plus coverage caveats for the final answer/API."""
    data_source_context: dict[str, Any] | None

    # Entity Resolver
    resolved_entities: dict[str, list[int]]
    """Outlet ids selected in the frontend scope picker; used only when the question has no explicit outlet."""
    scope_outlet_ids: list[int]

    # Controlled HR lane (static Postgres queries)
    hr_query_kind: str | None

    # Template Matcher
    template_key: str | None
    template_params: dict[str, Any]
    template_confidence: float
    verified_query_asset: dict[str, Any] | None
    learned_scenario_asset: dict[str, Any] | None
    learned_sql_writer_scenario_asset: dict[str, Any] | None
    clarification_question: str | None
    matcher_missing_info: list[str]
    response_kind: str
    response_hints: list[str]

    # Validator
    validation_errors: list[str]

    # RBAC Injector
    allowed_outlet_ids: list[int]
    final_sql: str

    # SQL Guard
    guard_passed: bool
    guard_violations: list[str]
    guard_allowed_tables: list[str]

    # Logical coherence (final SQL vs question) — informational; executor still guarded by AST/rules
    sql_logical_check: dict[str, Any] | None

    # Executor
    raw_result: list[dict]
    execution_error: str | None
    correction_attempts: int
    executed_sql_source: str | None

    # Self Correction
    corrected_sql: str | None
    self_correction_applied: bool

    # Answer
    analysis_brief: dict[str, Any]
    answer_text: str
    citations: list[dict]
    chart_spec: dict[str, Any] | None
    """Preset answer from social_reply — formatter skips LLM."""
    skip_answer_formatter_llm: bool

    # Trace
    trace: list[dict]
    """Monotonic perf counter at preprocess start — used for graph_cpu_ms in workflow summary."""
    workflow_perf_start_ns: int | None

    # GenSQL path (optional subgraph after template_matcher)
    sql_source: str | None
    codegen_attempt: int
    codegen_exhausted: bool
    codegen_proposed_sql: str | None
    codegen_tables_used: list[str]
    codegen_assumption_vi: str | None
    codegen_rationale_vi: str | None
    codegen_feedback_vi: str | None
    codegen_last_error_vi: str | None
    codegen_review_approve: bool | None
    codegen_reviewer_risk: str | None
    codegen_trial_passed: bool | None
    codegen_sql_plan: dict[str, Any] | None
    codegen_candidate_tables: list[str]
    codegen_skip_reason: str | None

    # Export artifacts (CSV) generated for verification
    exports: list[dict[str, Any]]

    # Reviewer agent output
    quality_report: dict[str, Any] | None

    # Proactive follow-up suggestions
    suggestions: list[str]
    suggestion_rationales: list[dict[str, str]]

    # Session continuity + structured UI helpers (agent graph)
    session_digest: dict[str, Any]
    presentation: dict[str, Any]

    # Long-term memory (pgvector); list of nugget dicts surfaced to the client.
    relevant_memories: list[dict[str, Any]]

    # Investigative mode (SQL writer hinting)
    investigative_mode: bool

    # Auto-clamp requested time_range to available DB coverage (prefer answering on real data)
    coverage_time_clamp_applied: bool
