# AI Query Service - Technical Review Response

This note cross-checks the architecture review comments against the current
source code. It is intended as a defense-preparation document: keep the strong
claims, but correct details that do not match the implementation.

## 1. Entry Layer And Internal Authentication

**Review claim:** API Gateway is the system boundary, injects `X-Internal-*`
headers, and FastAPI verifies them. Requiring `outlet_ids` helps tenant
isolation from the beginning.

**Verdict:** Correct.

Current code verifies:

- `X-Internal-Token` must match the configured internal secret.
- `X-Internal-Service` must be exactly `gateway`.
- `X-Internal-User-Id` must exist and be an integer.
- `X-Internal-Outlet-Ids` must be non-empty.

Important correction: the current `X-Internal-Token` is **not time-based**. It is
a static shared secret compared using `hmac.compare_digest`. Therefore, the
replay-risk wording should not say "replay within the token validity window".
The real risk is stronger and simpler: if the static secret leaks, requests can
be replayed until the secret is rotated.

Recommended thesis wording:

> The internal token is currently a shared secret verified with timing-safe
> comparison. This prevents timing oracle attacks, but the token is still a
> long-lived credential. A production hardening step is to replace or wrap it
> with a signed short-lived token containing a nonce or `jti`, and to reject
> reused identifiers through Redis.

## 2. Rate Limiting

**Review claim:** Redis Lua is correct for atomic counters, but fail-open can
cause abuse or cost spikes when Redis is down.

**Verdict:** Correct.

The implementation uses a Redis Lua script for `INCR` + `EXPIRE`, which avoids a
race condition where a counter could be incremented without a TTL. The design is
fail-open: Redis connection, timeout, or Redis errors are logged and the request
continues.

There is also a second fail-open path: if Redis initialization fails at service
startup, `app.state.redis` is set to `None`, and the endpoint skips rate-limit
checking for that request path.

Recommended thesis wording:

> The current rate limiter favors availability over cost protection. This is
> acceptable for prototype and internal deployment, but a production deployment
> should add a gateway-level circuit breaker or local fallback quota so that a
> Redis outage does not remove all throttling for LLM-backed requests.

## 3. LangGraph Orchestration

**Review claim:** LangGraph orchestration is a strong design point because it
creates a visible audit trail and keeps SQL generation behind deterministic
control points.

**Verdict:** Correct.

The active graph is the Finch-style agent graph (`AGENT_MODE_ENABLED=true`),
not the older legacy graph. It routes requests through:

`preprocess -> kb_retriever -> supervisor_agent -> entity_resolver -> data_coverage`

and then to one of:

- `template_path`
- `sql_writer_agent`
- `hr_query`
- `doc_reader`
- `social_reply`
- `answer_formatter` for clarification or unsupported requests

Important correction: the current startup path compiles the graph **without a
checkpointer**. There is RedisSaver wiring available, but the active graph is
stateless per request unless a checkpointer is explicitly supplied.

Open point to acknowledge:

- checkpoint TTL is not configured in the active path;
- there is no explicit per-node LangGraph timeout;
- graph-level exceptions are caught and returned as a 503-style service error;
- database execution has its own ClickHouse limits, but LLM node timeouts depend
on the OpenAI-compatible client settings.

Recommended thesis wording:

> The graph already provides step-level traceability through the state and audit
> event, but checkpoint persistence and per-node timeout policy remain production
> hardening items. The current deployment path runs without a graph checkpointer,
> so checkpoint TTL is not part of the active runtime behavior.

## 4. SQL Guard And RBAC

**Review claim:** RBAC via AST guard is much stronger than regex and prevents
comment/whitespace bypasses.

**Verdict:** Correct, with one wording adjustment.

RBAC injection and AST validation are related but distinct:

- `inject_outlet_filter` programmatically inserts `outlet_id IN (...)`.
- `validate_sql_phase1` checks pre-RBAC structure and allow-listed tables.
- `validate_sql` checks the post-RBAC SQL for single `SELECT`, no DDL/DML, no
  `UNION`, allowed schemas/tables, blocked functions, no `SELECT *`, no
  sensitive projected columns, and outlet scoping in nested subqueries.

Recommended thesis wording:

> Tenant isolation is not delegated to the LLM. The program computes the allowed
> outlet set from the authenticated context, injects the outlet predicate, and
> then validates the resulting SQL through an AST-based guard. This is stronger
> than regex-based filtering because the SQL is parsed structurally before
> execution.

## 5. Data Layer

**Review claim:** ClickHouse read-only mode, row/time limits, OpenSearch hybrid
BM25+kNN, and PostgreSQL read-only HR path are appropriate.

**Verdict:** Correct.

Details to keep precise:

- ClickHouse client enforces `readonly=1`, `max_execution_time`, and
  `max_result_rows`.
- OpenSearch hybrid search combines BM25-style `match` clauses with `knn` when
  embeddings are provided. Without embeddings, it degrades to keyword search.
- PostgreSQL is used for a narrow read path such as HR/outlet context, not as a
  free-form LLM SQL target.

## 6. LLM Provider Availability

**Review claim:** Single OpenAI-compatible provider is the biggest SPOF; no
fallback or retry logic is visible.

**Verdict:** Half correct.

Current code has SDK-level retry through `openai_max_retries`. However, it does
not have multi-provider fallback, model failover, or route-level degradation
when the configured provider is down.

Recommended thesis wording:

> The service supports an OpenAI-compatible endpoint and SDK retry, but currently
> does not implement provider fallback. In production, the SQL writer and
> supervisor agents should support a secondary provider/model or a degraded mode
> that falls back to verified templates and clarification responses.

## 7. Audit And CDC

**Review claim:** Redacting PII before publishing Kafka, hashing SQL literals,
and selective Debezium CDC are good practices.

**Verdict:** Correct, with a caveat.

Audit events:

- redact phone, email, and CCCD patterns in the raw question;
- sanitize SQL literals;
- hash SQL;
- store row count and metadata, not raw result rows.

Caveat: PII redaction is regex-based and conservative. It does not guarantee
masking of all names, addresses, or free-text sensitive content.

Recommended thesis wording:

> Audit logging is designed as metadata logging, not result logging. The current
> implementation masks common PII patterns and stores sanitized/hash SQL, but the
> redaction layer should be treated as best-effort and can be improved with a
> stronger PII classifier if the system handles broader free-text inputs.

## 8. Priority Improvements

The three strongest production hardening items are:

1. Add LLM provider fallback or a degraded mode that disables free SQL
   generation and relies on verified templates/clarifications.
2. Review the fail-open rate-limit policy and add gateway/local circuit breaker
   protection for Redis outages.
3. Replace the static internal shared secret with short-lived signed tokens,
   nonce or `jti` replay protection, and explicit rotation policy.

These are useful to present as "future work" rather than current weaknesses that
invalidate the design. The core architecture is already defensible because the
LLM is not trusted with raw database access; it operates behind deterministic
RBAC injection, AST validation, execution limits, and audit logging.
