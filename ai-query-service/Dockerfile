FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
    "fastapi>=0.115" "uvicorn[standard]>=0.29" "pydantic>=2.7" "pydantic-settings>=2.2" \
    "openai>=1.30" "langgraph>=0.2" "langgraph-checkpoint-redis>=0.1" \
    "clickhouse-connect>=0.7" "psycopg[binary]>=3.2" "opensearch-py>=2.5" "redis>=5.0" "aiokafka>=0.11" \
    "sqlglot>=23" "jinja2>=3.1" "pyyaml>=6.0" "httpx>=0.27" "structlog>=24.1"

COPY app ./app
COPY knowledge ./knowledge
COPY scripts ./scripts

EXPOSE 8093

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8093/api/v1/ai-query/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8093"]
