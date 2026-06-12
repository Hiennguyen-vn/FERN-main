import logging
import time
import uuid
from datetime import datetime, UTC
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.audit.events import emit as emit_audit, emit_review_request
from app.audit.learning import emit_learning_candidate
from app.auth.context import AuthError, parse_auth_headers
from app.config import get_settings
from app.exports import get_artifact, prune_expired
from app.graph.nodes.preprocess import PreprocessError
from app.graph.workflow_summary import build_workflow_steps, build_workflow_summary, compact_trace_for_client
from app.middleware.rate_limit import RateLimitExceeded, check_and_increment

logger = logging.getLogger(__name__)


def _jsonify_preview_value(v: Any) -> Any:
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    from datetime import date, datetime
    from decimal import Decimal

    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return "<binary>"
    if isinstance(v, dict):
        return {str(k): _jsonify_preview_value(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonify_preview_value(x) for x in v[:80]]
    return str(v)


def _rows_preview_from_result(rows: list[dict[str, Any]] | None, max_rows: int) -> list[dict[str, Any]] | None:
    if max_rows <= 0 or not rows:
        return None
    out: list[dict[str, Any]] = []
    for r in rows[:max_rows]:
        out.append({k: _jsonify_preview_value(v) for k, v in r.items()})
    return out or None


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=8000)


class QueryRequest(BaseModel):
    question: str
    session_id: str | None = None
    conversation_turns: list[ConversationTurn] | None = Field(default=None, max_length=8)
    requested_outlet_ids: list[int] | None = Field(default=None, max_length=500)
    preview_max_rows: int | None = Field(
        default=None,
        ge=0,
        le=50,
        description="If set, include up to N result rows (JSON-safe) in the response for tables/exports.",
    )


class QueryResponse(BaseModel):
    answer: str
    template_key: str | None
    confidence: float
    row_count: int
    citations: list[dict[str, Any]]
    correlation_id: str
    latency_ms: int
    response_kind: Literal["answer", "clarification", "unsupported"] | None = None
    response_hints: list[str] | None = None
    rows_preview: list[dict[str, Any]] | None = None
    supervisor_intent: str | None = Field(
        default=None,
        description="Supervisor intent (e.g. export_request); helps clients tune follow-up requests.",
    )
    preview_max_rows: int | None = Field(
        default=None,
        description="Echo of client's preview_max_rows when > 0 — row cap applied to rows_preview.",
    )
    workflow_summary: dict[str, Any] | None = Field(
        default=None,
        description="Compact safe pipeline summary for UI/review tickets.",
    )
    workflow_trace: list[dict[str, Any]] | None = Field(
        default=None,
        description="Sanitized trace tail — same debug gate as workflow_summary.",
    )
    workflow_steps: list[dict[str, str]] = Field(
        default_factory=list,
        description="User-safe stepper for status visibility; never includes SQL or prompts.",
    )
    data_source_context: dict[str, Any] | None = Field(
        default=None,
        description="User-safe business data source/time coverage context; no SQL or prompts.",
    )
    chart_spec: dict[str, Any] | None = Field(
        default=None,
        description="Optional client-side visualization spec for visualization requests.",
    )
    exports: list[dict[str, Any]] | None = Field(
        default=None,
        description="Download artifacts (CSV + optional clean JSON). Each item: artifact_id, format, filename, download_url, row_count, size_bytes, expires_at, sha256.",
    )
    quality_report: dict[str, Any] | None = Field(
        default=None,
        description="Reviewer agent verdict (verdict, issues, confidence, applied_revision).",
    )
    suggestions: list[str] | None = Field(
        default=None,
        description="Proactive follow-up question suggestions for the UI to render as chips.",
    )
    audience: str | None = Field(
        default=None,
        description="Audience profile used by the formatter (analyst | executive).",
    )
    session_digest: dict[str, Any] | None = Field(
        default=None,
        description="Continuity digest: intent summary, timeline bullets, resolved signals.",
    )
    presentation: dict[str, Any] | None = Field(
        default=None,
        description="Structured UI helpers: markdown_table, chart_spec, truncation flags.",
    )
    relevant_memories: list[dict[str, Any]] | None = Field(
        default=None,
        description="Long-term knowledge nuggets (pgvector) similar to the user's current question.",
    )


class ReviewRequestBody(BaseModel):
    correlation_id: str | None = None
    question: str = Field(..., max_length=8000)
    answer: str = Field(..., max_length=12000)
    reason: str | None = Field(default=None, max_length=1000)
    conversation_turns: list[ConversationTurn] | None = Field(default=None, max_length=8)
    rows_preview: list[dict[str, Any]] | None = Field(default=None, max_length=50)
    workflow_summary: dict[str, Any] | None = None


class ReviewRequestResponse(BaseModel):
    review_id: str
    status: Literal["queued"]


def _workflow_debug_requested(request: Request, settings) -> bool:
    if getattr(settings, "workflow_debug_in_response", False):
        return True
    h = (request.headers.get("x-fern-ai-workflow-debug") or "").strip().lower()
    return h in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    # Lazy: only init what we need at startup; heavy clients are lazy singletons.
    app.state.settings = s

    # Redis for rate limit / signed-token jti store
    try:
        from app.clients.redis_sentinel import make_redis_client

        app.state.redis = make_redis_client()
    except Exception as e:  # noqa: BLE001
        logger.warning("Redis init deferred: %s", e)
        app.state.redis = None

    checkpointer = None
    if getattr(s, "langgraph_checkpoint_enabled", False):
        try:
            from app.clients.redis_sentinel import make_langgraph_saver

            checkpointer = make_langgraph_saver()
            logger.info("LangGraph checkpoint enabled (RedisSaver)")
        except Exception as e:  # noqa: BLE001
            logger.warning("LangGraph checkpoint init failed: %s", e)

    # Build graph (checkpointer optional — off by default for backward compatibility)
    try:
        from app.clients.clickhouse import fetch_all_outlet_ids

        if getattr(s, "agent_mode_enabled", False):
            from app.agents import build_agent_graph

            app.state.graph = build_agent_graph(
                all_outlet_ids_provider=fetch_all_outlet_ids,
                checkpointer=checkpointer,
            )
            logger.info("Using Finch-style agent graph (AGENT_MODE_ENABLED=true)")
        else:
            from app.graph.builder import build_graph

            app.state.graph = build_graph(
                all_outlet_ids_provider=fetch_all_outlet_ids,
                checkpointer=checkpointer,
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("Graph build deferred: %s", e)
        app.state.graph = None

    yield

    if checkpointer is not None:
        try:
            close = getattr(checkpointer, "close", None)
            if callable(close):
                close()
        except Exception:
            pass

    # Shutdown
    try:
        from app.clients.kafka import stop_producer
        await stop_producer()
    except Exception:
        pass


app = FastAPI(title="FERN AI Query Service", version="1.0.0", lifespan=lifespan)


@app.exception_handler(AuthError)
async def auth_error_handler(_: Request, exc: AuthError):
    return JSONResponse(status_code=exc.status_code, content={"error_code": "AUTH_ERROR", "message": exc.message})


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(_: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"error_code": "RATE_LIMIT", "message": str(exc)},
        headers={"Retry-After": str(exc.retry_after)},
    )


@app.exception_handler(PreprocessError)
async def preprocess_error_handler(_: Request, exc: PreprocessError):
    return JSONResponse(status_code=422, content={"error_code": "INVALID_QUESTION", "message": str(exc)})


@app.get("/api/v1/ai-query/health")
async def health():
    """Liveness probe — only checks that the process is running."""
    return {"status": "ok"}


@app.get("/api/v1/ai-query/ready")
async def ready(request: Request):
    """
    Readiness probe — checks critical dependencies.
    OpenSearch and Redis are degraded-but-ready: query execution has
    template/ClickHouse fallbacks, and app rate limiting fails open.
    """
    issues: list[str] = []
    warnings: list[str] = []

    if request.app.state.graph is None:
        issues.append("graph not initialized")

    if request.app.state.redis is None:
        warnings.append("redis unavailable (app-level rate limiting disabled)")

    try:
        from app.clients.clickhouse import get_ch_client
        ch = get_ch_client()
        ch.query("SELECT 1")
    except Exception as e:  # noqa: BLE001
        issues.append(f"clickhouse: {e}")

    if get_settings().opensearch_enabled:
        try:
            from app.clients.opensearch import get_os_client
            get_os_client().info()
        except Exception as e:  # noqa: BLE001
            warnings.append(f"opensearch: {e}")

    if get_settings().hr_query_enabled:
        try:
            from app.clients.postgres import execute_readonly
            execute_readonly("SELECT 1 AS ok")
        except Exception as e:  # noqa: BLE001
            warnings.append(f"postgres_hr: {e}")

    if issues:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "issues": issues, "warnings": warnings},
        )
    return {"status": "ready", "warnings": warnings}


@app.post("/api/v1/ai-query/query", response_model=QueryResponse)
async def query(request: Request, body: QueryRequest) -> QueryResponse:
    s = get_settings()
    redis_client = getattr(request.app.state, "redis", None)
    auth = parse_auth_headers(
        dict(request.headers),
        s.internal_service_token,
        redis_client=redis_client,
    )

    check_and_increment(redis_client, auth.user_id)

    graph = request.app.state.graph
    if graph is None:
        return JSONResponse(status_code=503, content={"error_code": "NOT_READY", "message": "Graph not initialized"})

    turns: list[dict[str, str]] = []
    if body.conversation_turns:
        turns = [{"role": t.role, "content": t.content} for t in body.conversation_turns]

    initial_state = {
        "raw_question": body.question,
        "auth": auth,
        "conversation_turns": turns,
        "scope_outlet_ids": list(body.requested_outlet_ids or []),
        "correction_attempts": 0,
        "trace": [],
    }

    t0 = time.time()
    config = {"configurable": {"thread_id": f"user:{auth.user_id}"}}
    try:
        result = await graph.ainvoke(initial_state, config=config)
    except PreprocessError:
        raise
    except Exception as e:
        logger.exception("Graph execution error for user %s: %s", auth.user_id, type(e).__name__)
        return JSONResponse(status_code=503, content={"error_code": "GRAPH_ERROR", "message": "Query processing failed"})
    latency_ms = int((time.time() - t0) * 1000)

    # Audit (best-effort)
    try:
        await emit_audit(result)
    except Exception as e:  # noqa: BLE001
        logger.warning("Audit emit failed: %s", e)

    try:
        await emit_learning_candidate(result)
    except Exception as e:  # noqa: BLE001
        logger.warning("Learning staging emit failed: %s", e)

    hints = result.get("response_hints")
    if not isinstance(hints, list):
        hints = []

    rk = result.get("response_kind")
    if rk not in ("answer", "clarification", "unsupported", None):
        rk = None
    if rk is None:
        # Infer from graph state: only call it an "answer" when a template
        # ran successfully (template_key present) AND execution did not fail.
        execution_ok = not result.get("execution_error")
        has_template = bool(result.get("template_key"))
        rk = "answer" if (has_template and execution_ok) else "clarification"

    pr_max = int(body.preview_max_rows or 0)
    rows_preview = _rows_preview_from_result(result.get("raw_result"), pr_max)

    si = result.get("intent")
    si_out = si if isinstance(si, str) and si.strip() else None

    ns = result.get("workflow_perf_start_ns")
    gcpu = None
    if isinstance(ns, int) and ns > 0:
        gcpu = int((time.perf_counter_ns() - ns) / 1_000_000)
    wf_summary = build_workflow_summary(result, graph_cpu_ms=gcpu)
    wf_trace = None
    if _workflow_debug_requested(request, s):
        wf_trace = compact_trace_for_client(result.get("trace") or [])
    wf_steps = build_workflow_steps(result)

    raw_exports = result.get("exports") or []
    exports_out: list[dict[str, Any]] | None = None
    if isinstance(raw_exports, list) and raw_exports:
        exports_out = []
        for art in raw_exports:
            if not isinstance(art, dict) or not art.get("artifact_id"):
                continue
            entry = dict(art)
            entry["download_url"] = f"/api/v1/ai-query/exports/{art['artifact_id']}"
            exports_out.append(entry)
        if not exports_out:
            exports_out = None

    qr = result.get("quality_report") if isinstance(result.get("quality_report"), dict) else None
    sugg = result.get("suggestions")
    if not isinstance(sugg, list) or not sugg:
        sugg = None
    audience = result.get("audience") if isinstance(result.get("audience"), str) else None

    return QueryResponse(
        answer=result.get("answer_text", ""),
        template_key=result.get("template_key"),
        confidence=float(result.get("template_confidence", 0.0)),
        row_count=len(result.get("raw_result") or []),
        citations=result.get("citations") or [],
        correlation_id=auth.correlation_id,
        latency_ms=latency_ms,
        response_kind=rk,
        response_hints=hints or None,
        rows_preview=rows_preview,
        supervisor_intent=si_out,
        preview_max_rows=pr_max if pr_max > 0 else None,
        workflow_summary=wf_summary,
        workflow_trace=wf_trace,
        workflow_steps=wf_steps,
        data_source_context=result.get("data_source_context"),
        chart_spec=result.get("chart_spec"),
        exports=exports_out,
        quality_report=qr,
        suggestions=sugg,
        audience=audience,
        session_digest=result.get("session_digest") if isinstance(result.get("session_digest"), dict) else None,
        presentation=result.get("presentation") if isinstance(result.get("presentation"), dict) else None,
        relevant_memories=(
            result.get("relevant_memories")
            if isinstance(result.get("relevant_memories"), list) and result.get("relevant_memories")
            else None
        ),
    )


@app.get("/api/v1/ai-query/exports/{artifact_id}")
async def download_export(artifact_id: str, request: Request):
    """Authenticated artifact download — CSV or JSON; verifies caller owns the artifact and TTL is alive."""
    s = get_settings()
    auth = parse_auth_headers(
        dict(request.headers),
        s.internal_service_token,
        redis_client=getattr(request.app.state, "redis", None),
    )

    # Best-effort cleanup; cheap and bounded.
    try:
        prune_expired()
    except Exception as e:  # noqa: BLE001
        logger.debug("Export cleanup error (ignored): %s", e)

    artifact = get_artifact(artifact_id)
    if artifact is None:
        return JSONResponse(status_code=404, content={"error_code": "NOT_FOUND", "message": "Artifact not found or expired"})
    if artifact.is_expired():
        return JSONResponse(status_code=410, content={"error_code": "EXPIRED", "message": "Artifact has expired"})
    if artifact.user_id != auth.user_id:
        # No leak — same code as not-found to prevent enumeration.
        return JSONResponse(status_code=404, content={"error_code": "NOT_FOUND", "message": "Artifact not found or expired"})

    if not artifact.path.exists():
        return JSONResponse(status_code=410, content={"error_code": "EXPIRED", "message": "Artifact file no longer available"})

    fmt = (artifact.format or "csv").lower()
    media_type = (
        "application/json; charset=utf-8"
        if fmt == "json"
        else "text/csv; charset=utf-8"
    )

    return FileResponse(
        path=str(artifact.path),
        filename=artifact.filename,
        media_type=media_type,
        headers={"X-Artifact-SHA256": artifact.sha256, "X-Artifact-Rows": str(artifact.row_count)},
    )


@app.post("/api/v1/ai-query/review-request", response_model=ReviewRequestResponse)
async def review_request(request: Request, body: ReviewRequestBody) -> ReviewRequestResponse:
    s = get_settings()
    auth = parse_auth_headers(
        dict(request.headers),
        s.internal_service_token,
        redis_client=getattr(request.app.state, "redis", None),
    )
    review_id = str(uuid.uuid4())
    rows = body.rows_preview or []
    sanitized_rows = rows[:50]
    event = {
        "event_id": review_id,
        "event_type": "ai_query_review_requested",
        "schema_version": 1,
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "user_id": auth.user_id,
        "session_id": auth.session_id,
        "correlation_id": body.correlation_id or auth.correlation_id,
        "roles": sorted(auth.roles),
        "outlet_ids": sorted(auth.outlet_ids),
        "question": body.question[:8000],
        "answer": body.answer[:12000],
        "reason": (body.reason or "")[:1000],
        "conversation_turns": [t.model_dump() for t in (body.conversation_turns or [])],
        "rows_preview": [_jsonify_preview_value(r) for r in sanitized_rows],
        "workflow_summary": body.workflow_summary or {},
    }
    try:
        await emit_review_request(event)
    except Exception as e:  # noqa: BLE001
        logger.warning("Review request audit emit failed: %s", e)
    return ReviewRequestResponse(review_id=review_id, status="queued")
