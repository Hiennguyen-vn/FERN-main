import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.audit.events import emit as emit_audit
from app.auth.context import AuthError, parse_auth_headers
from app.config import get_settings
from app.graph.nodes.preprocess import PreprocessError
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    # Lazy: only init what we need at startup; heavy clients are lazy singletons.
    app.state.settings = s

    # Build graph (without checkpointer for initial bring-up; add Sentinel saver in prod)
    try:
        from app.clients.clickhouse import fetch_all_outlet_ids
        from app.graph.builder import build_graph
        app.state.graph = build_graph(all_outlet_ids_provider=fetch_all_outlet_ids)
    except Exception as e:  # noqa: BLE001
        logger.warning("Graph build deferred: %s", e)
        app.state.graph = None

    # Redis for rate limit
    try:
        from app.clients.redis_sentinel import make_redis_client
        app.state.redis = make_redis_client()
    except Exception as e:  # noqa: BLE001
        logger.warning("Redis init deferred: %s", e)
        app.state.redis = None

    yield

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
    return JSONResponse(status_code=429, content={"error_code": "RATE_LIMIT", "message": str(exc)})


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

    try:
        from app.clients.opensearch import get_os_client
        get_os_client().info()
    except Exception as e:  # noqa: BLE001
        warnings.append(f"opensearch: {e}")

    if issues:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "issues": issues, "warnings": warnings},
        )
    return {"status": "ready", "warnings": warnings}


@app.post("/api/v1/ai-query/query", response_model=QueryResponse)
async def query(request: Request, body: QueryRequest) -> QueryResponse:
    s = get_settings()
    auth = parse_auth_headers(dict(request.headers), s.internal_service_token)

    if request.app.state.redis is not None:
        check_and_increment(request.app.state.redis, auth.user_id)

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

    hints = result.get("response_hints")
    if not isinstance(hints, list):
        hints = []

    rk = result.get("response_kind")
    if rk not in ("answer", "clarification", "unsupported", None):
        rk = None
    if rk is None:
        rk = "answer" if result.get("template_key") else "clarification"

    pr_max = int(body.preview_max_rows or 0)
    rows_preview = _rows_preview_from_result(result.get("raw_result"), pr_max)

    si = result.get("intent")
    si_out = si if isinstance(si, str) and si.strip() else None

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
    )
