from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_ENVIRONMENTS = frozenset({"development", "dev", "test", "local"})

_UNSAFE_OPENAI_DEFAULTS = frozenset({"sk-test", "sk-placeholder", ""})
_UNSAFE_TOKEN_DEFAULTS = frozenset({"change-me", "secret", "dev-secret", ""})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # OpenAI — no default; must be supplied via env / Vault
    openai_api_key: str = "sk-test"
    openai_base_url: str = ""
    openai_api_mode: str = "chat"
    openai_responses_previous_response_id_enabled: bool = True
    openai_user_agent: str = "FERN-ai-query-service/0.1"
    openai_model: str = "gpt-4.1"
    openai_model_supervisor: str = ""
    openai_model_sql_planner: str = ""
    openai_model_sql_generator: str = ""
    openai_model_reviewer: str = ""
    openai_model_formatter: str = ""
    openai_model_doc_reader: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embeddings_enabled: bool = True
    openai_timeout_seconds: float = 120.0
    openai_max_retries: int = 2

    # Secondary LLM provider for cross-provider failover. When the primary
    # provider is unavailable (connection/timeout/5xx/rate-limit) the LLM
    # client transparently retries the same request on this provider.
    # Leave base_url AND api_key empty to disable failover.
    openai_fallback_base_url: str = ""
    openai_fallback_api_key: str = ""
    openai_fallback_model: str = ""

    # Rate limit behaviour when Redis is unavailable:
    #   fail_open       — allow requests (legacy default for dev)
    #   local_fallback  — enforce per-process counters (recommended for prod)
    #   fail_closed     — reject with 429
    rate_limit_redis_unavailable_policy: str = "fail_open"

    # Internal auth mode:
    #   static — shared secret only (legacy)
    #   signed — short-lived HMAC token with jti replay protection
    #   both   — accept signed JWT-shaped tokens OR static secret
    internal_auth_mode: str = "static"
    internal_token_signing_key: str = ""
    # Optional key id for the active signing key (embedded in token header).
    internal_token_signing_key_id: str = "primary"
    # Optional verification key ring: "kid1:key1,kid2:key2". Supports rotation
    # without downtime; if empty we verify with the active signing key only.
    internal_token_verify_keys: str = ""
    internal_token_ttl_seconds: int = 60
    internal_token_issuer: str = "gateway"
    # When Redis is down during jti check: fail_closed (reject) or fail_open (allow).
    internal_token_replay_redis_policy: str = "fail_closed"

    # LangGraph checkpoint (optional — off by default for backward compatibility).
    langgraph_checkpoint_enabled: bool = False
    langgraph_checkpoint_ttl_minutes: int = 60

    # Per-node wall-clock budget for the agent graph. When a node (e.g. a hung
    # LLM call) exceeds this, the graph degrades gracefully instead of hanging
    # the whole request. 0 disables the guard (recommended for environments
    # that rely on the long-running multi-turn SQL Writer loop + LLM failover,
    # where the OpenAI SDK timeout already bounds individual calls).
    llm_node_timeout_seconds: float = 0.0

    # ClickHouse
    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_db: str = "fern"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    # Postgres read replica — used only by controlled HR query lane, never by GenSQL.
    postgres_host: str = "postgres-replica"
    postgres_port: int = 5432
    postgres_db: str = "fern"
    postgres_user: str = "fern"
    postgres_password: str = "fern"
    postgres_statement_timeout_seconds: int = 10

    # OpenSearch
    opensearch_enabled: bool = True
    opensearch_url: str = "http://opensearch:9200"
    opensearch_aliases_index: str = "ai_aliases"
    opensearch_templates_index: str = "ai_templates"
    """Embeddings over exported ClickHouse catalog summaries (see scripts/export_catalog_snapshot.py)."""
    opensearch_catalog_index: str = "ai_catalog"
    """Semantic metadata docs: metric definitions, table policy, value aliases."""
    opensearch_metadata_index: str = "ai_metadata"

    # Redis Sentinel
    redis_sentinel_hosts: str = "redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379"
    redis_sentinel_master: str = "fern-master"

    # Kafka
    kafka_bootstrap: str = "kafka:29092,kafka-2:29092,kafka-3:29092"
    kafka_audit_topic: str = "fern.audit.ai-query"
    """Staging topic for successful-query fingerprints (promotion rules live in downstream consumers)."""
    kafka_learning_topic: str = "fern.ai-query.learning.staging"
    learning_staging_emit_enabled: bool = False

    # Internal auth — no default; must be supplied via env / Vault
    internal_service_token: str = "change-me"

    # Runtime environment — used to gate secret validation
    environment: str = "development"

    # Limits
    max_question_length: int = 500
    max_rows_per_query: int = 1000
    query_timeout_seconds: int = 30
    max_correction_attempts: int = 2
    rate_limit_per_minute: int = 20
    rate_limit_per_hour: int = 200

    # LangGraph — optional reasoning / SQL coherence LLM hops (latency vs quality)
    query_reasoning_enabled: bool = True
    sql_logical_check_enabled: bool = True
    deterministic_supervisor_enabled: bool = True
    template_fast_path_enabled: bool = True

    # Optional ClickHouse catalog hints for matcher/reasoner (extra latency when enabled)
    catalog_digest_enabled: bool = False
    catalog_digest_max_tables: int = 2
    catalog_digest_max_columns_per_table: int = 40
    catalog_digest_max_chars: int = 2800
    metadata_context_enabled: bool = True
    metadata_context_max_hits: int = 5
    metadata_context_max_chars: int = 2600
    """When true, planner/metadata prompts may see fallback facts/event tables for harder scenarios within the allow-list."""
    agent_extended_dataset_access_enabled: bool = True
    agent_extended_dataset_max_tables: int = 10
    learned_scenario_matching_enabled: bool = True
    learned_scenario_match_min_score: float = 0.78
    runtime_catalog_cache_seconds: int = 60

    # GenSQL orchestrator (experimental): LLM proposes SELECT → AST phase1 → RBAC inject → guard → reviewer → trial → execute
    codegen_sql_enabled: bool = False
    """off | low_confidence | no_template_or_low_confidence | always_try — see ARCHI.md §13.1."""
    codegen_route_mode: str = "off"
    codegen_confidence_threshold: float = 0.55
    max_codegen_attempts: int = 2
    max_codegen_trial_rows: int = 50
    max_codegen_trial_timeout_seconds: int = 10
    codegen_review_enabled: bool = True
    codegen_sql_plan_enabled: bool = True
    codegen_max_outer_limit: int = 1000

    # Controlled HR lane (static allowlisted Postgres queries + RBAC)
    hr_query_enabled: bool = True
    hr_query_max_rows: int = 50

    # Finch-style simplified agent graph (Supervisor + SQL Writer + tools).
    # When true, /query routes through app.agents.* instead of the legacy
    # 21-node LangGraph. Allows side-by-side validation against the golden
    # eval suite before retiring the legacy pipeline.
    agent_mode_enabled: bool = False

    # SQL Writer Agent: how many parallel candidate runs to vote between.
    # 1 = single shot (cheapest); 2 = self-consistency (≈2× cost, +EM).
    # The voter prefers (validated_and_executed > validated_only > raw),
    # tie-broken by non-empty rows.
    sql_writer_self_consistency_n: int = 1

    service_port: int = 8093
    log_level: str = "INFO"
    app_timezone: str = "Asia/Ho_Chi_Minh"
    """Include workflow_summary / workflow_trace on POST /query without requiring a debug header."""
    workflow_debug_in_response: bool = False

    # CSV exports (data verification artifacts)
    exports_enabled: bool = True
    exports_storage_dir: str = "/var/lib/fern/exports"
    exports_max_rows: int = 50000
    exports_ttl_hours: int = 24
    """When true, also write a clean JSON Lines-free export beside CSV (same TTL, separate artifact)."""
    exports_json_enabled: bool = True

    # Session UX: digest + presentation (markdown preview table, inferred chart_spec)
    session_enricher_enabled: bool = True

    # Answer formatter: how many result rows to embed verbatim in LLM JSON (rankings must list all of these).
    answer_facts_max_rows: int = 250
    # Reviewer sees this many rows to verify numbering; must cover typical top-N product lists.
    reviewer_answer_facts_max_rows: int = 120

    # Reviewer agent (post-answer quality guard)
    reviewer_agent_enabled: bool = True
    reviewer_max_tokens: int = 2800

    # Executive persona / proactive UX
    executive_persona_enabled: bool = True
    followup_suggestions_enabled: bool = True
    followup_max_suggestions: int = 3

    # Investigative mode (multi-step analysis for open-ended exec questions)
    investigative_mode_enabled: bool = True

    # Long-term agent memory (pgvector). Retriever runs before supervisor;
    # summarizer writes back after a successful answer. Both fail-open.
    agent_kb_enabled: bool = False
    agent_kb_top_k: int = 3
    agent_kb_min_similarity: float = 0.78
    agent_kb_max_summary_chars: int = 600
    agent_kb_max_per_user: int = 200
    agent_kb_embed_dim: int = 1536
    agent_kb_table: str = "ai.agent_knowledge_base"

    @model_validator(mode="after")
    def _reject_unsafe_secrets_in_production(self) -> "Settings":
        """
        Fail fast if production-critical secrets are still at their placeholder defaults.
        This prevents a misconfigured deployment from silently running with known-bad credentials.
        Skipped in dev/test environments so local bring-up stays simple.
        """
        env = self.environment.lower().strip()
        if env in _DEV_ENVIRONMENTS:
            return self

        errors: list[str] = []
        if self.openai_api_key in _UNSAFE_OPENAI_DEFAULTS:
            errors.append("OPENAI_API_KEY is not configured (found unsafe default)")
        if self.internal_service_token in _UNSAFE_TOKEN_DEFAULTS:
            errors.append("INTERNAL_SERVICE_TOKEN is not configured (found unsafe default)")

        if errors:
            raise ValueError(
                f"Production secrets are missing — refusing to start: {'; '.join(errors)}. "
                "Set ENVIRONMENT=development to bypass in non-production environments."
            )
        return self

    @model_validator(mode="after")
    def _validate_openai_api_mode(self) -> "Settings":
        mode = self.openai_api_mode.lower().strip()
        if mode not in {"chat", "responses"}:
            raise ValueError("OPENAI_API_MODE must be either 'chat' or 'responses'")
        self.openai_api_mode = mode
        self.openai_base_url = self.openai_base_url.rstrip("/")
        return self

    @model_validator(mode="after")
    def _validate_rate_limit_policy(self) -> "Settings":
        policy = self.rate_limit_redis_unavailable_policy.lower().strip()
        if policy not in {"fail_open", "local_fallback", "fail_closed"}:
            raise ValueError(
                "RATE_LIMIT_REDIS_UNAVAILABLE_POLICY must be "
                "'fail_open', 'local_fallback', or 'fail_closed'"
            )
        self.rate_limit_redis_unavailable_policy = policy
        return self

    @model_validator(mode="after")
    def _validate_internal_auth_mode(self) -> "Settings":
        mode = self.internal_auth_mode.lower().strip()
        if mode not in {"static", "signed", "both"}:
            raise ValueError("INTERNAL_AUTH_MODE must be 'static', 'signed', or 'both'")
        self.internal_auth_mode = mode
        replay = self.internal_token_replay_redis_policy.lower().strip()
        if replay not in {"fail_open", "fail_closed"}:
            raise ValueError("INTERNAL_TOKEN_REPLAY_REDIS_POLICY must be 'fail_open' or 'fail_closed'")
        self.internal_token_replay_redis_policy = replay
        return self

    @model_validator(mode="after")
    def _validate_codegen_route_mode(self) -> "Settings":
        mode = self.codegen_route_mode.lower().strip()
        if mode not in {"off", "low_confidence", "no_template_or_low_confidence", "always_try"}:
            raise ValueError(
                "CODEGEN_ROUTE_MODE must be 'off', 'low_confidence', "
                "'no_template_or_low_confidence', or 'always_try'"
            )
        self.codegen_route_mode = mode
        return self

    @property
    def is_production(self) -> bool:
        return self.environment.lower().strip() not in _DEV_ENVIRONMENTS

    @property
    def sentinel_host_tuples(self) -> list[tuple[str, int]]:
        result = []
        for entry in self.redis_sentinel_hosts.split(","):
            host, _, port = entry.strip().partition(":")
            result.append((host, int(port or 26379)))
        return result

    @property
    def kafka_brokers_list(self) -> list[str]:
        return [b.strip() for b in self.kafka_bootstrap.split(",") if b.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton Settings instance.

    Thread-safe via lru_cache. In tests, call ``get_settings.cache_clear()``
    before patching environment variables to force re-instantiation.
    """
    return Settings()
