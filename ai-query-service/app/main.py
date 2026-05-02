import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.audit.events import emit as emit_audit
from app.auth.context import AuthError, parse_auth_headers
from app.config import get_settings
from app.middleware.rate_limit import RateLimitExceeded, check_and_increment

logger = logging.getLogger(__name__)


class QueryRequest(BaseModel):
    question: str
    session_id: str | None = None


class QueryResponse(BaseModel):
    answer: str
    template_key: str | None
    confidence: float
    row_count: int
    citations: list[dict[str, Any]]
    correlation_id: str
    latency_ms: int


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


@app.get("/api/v1/ai-query/health")
async def health():
    return {"status": "ok"}


@app.post("/api/v1/ai-query/query", response_model=QueryResponse)
async def query(request: Request, body: QueryRequest) -> QueryResponse:
    s = get_settings()
    auth = parse_auth_headers(dict(request.headers), s.internal_service_token)

    if request.app.state.redis is not None:
        check_and_increment(request.app.state.redis, auth.user_id)

    graph = request.app.state.graph
    if graph is None:
        return JSONResponse(status_code=503, content={"error_code": "NOT_READY", "message": "Graph not initialized"})

    initial_state = {
        "raw_question": body.question,
        "auth": auth,
        "correction_attempts": 0,
        "trace": [],
    }

    t0 = time.time()
    config = {"configurable": {"thread_id": f"user:{auth.user_id}"}}
    result = await graph.ainvoke(initial_state, config=config)
    latency_ms = int((time.time() - t0) * 1000)

    # Audit (best-effort)
    try:
        await emit_audit(result)
    except Exception as e:  # noqa: BLE001
        logger.warning("Audit emit failed: %s", e)

    return QueryResponse(
        answer=result.get("answer_text", ""),
        template_key=result.get("template_key"),
        confidence=float(result.get("template_confidence", 0.0)),
        row_count=len(result.get("raw_result") or []),
        citations=result.get("citations") or [],
        correlation_id=auth.correlation_id,
        latency_ms=latency_ms,
    )
