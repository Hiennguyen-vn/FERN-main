from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # OpenAI
    openai_api_key: str = "sk-test"
    openai_model: str = "gpt-4.1"
    openai_embedding_model: str = "text-embedding-3-small"

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

    # Internal auth
    internal_service_token: str = "change-me"

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
