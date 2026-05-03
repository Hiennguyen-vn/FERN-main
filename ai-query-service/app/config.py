import os

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
    openai_user_agent: str = "FERN-ai-query-service/0.1"
    openai_model: str = "gpt-4.1"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embeddings_enabled: bool = True

    # ClickHouse
    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_db: str = "fern"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    # OpenSearch
    opensearch_url: str = "http://opensearch:9200"
    opensearch_aliases_index: str = "ai_aliases"
    opensearch_templates_index: str = "ai_templates"

    # Redis Sentinel
    redis_sentinel_hosts: str = "redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379"
    redis_sentinel_master: str = "fern-master"

    # Kafka
    kafka_bootstrap: str = "kafka:29092,kafka-2:29092,kafka-3:29092"
    kafka_audit_topic: str = "fern.audit.ai-query"

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

    # Service
    service_port: int = 8093
    log_level: str = "INFO"

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


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
