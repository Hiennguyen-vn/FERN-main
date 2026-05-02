# Kế Hoạch Triển Khai: ai-query-service — FERN AI Text-to-SQL Sidecar

> Plan da verify voi source code thuc te (khong guess). Tat ca file path:line co the check lai.

---

## 1. Muc Tieu

Python sidecar chay song song voi FERN (Spring Boot ecosystem). Cho phep nhan vien F&B hoi tieng Viet, tra loi du lieu thuc tu ClickHouse, qua Text-to-SQL co kiem soat.

**Vi du:**
- "Doanh thu hom nay outlet Quan 1?"
- "Top 5 mon ban chay tuan nay?"
- "Ton kho nguyen lieu nao sap het?"
- "So sanh doanh thu thang nay vs thang truoc?"

---

## 2. Verified Facts (Tu Source Code)

| Item | Verified Value | Source |
|------|---------------|--------|
| ClickHouse database | `fern` (KHONG phai `default`) | `infra/clickhouse/schema.sql:1` |
| `business_date` san co | YES — `Date` column | `schema.sql:16, 30` (fact_sale, fact_inventory_movement) |
| Event tables outlet column | `outletId` (camelCase, KHAC fact tables `outlet_id`) | `schema.sql:57, 70, 83, 97, 110, 123` |
| Event tables nullable outletId | `events_invoice_approved`, `events_payroll_approved` | `schema.sql:137, 152` |
| ClickHouse migration | KHONG co Flyway, dung `schema.sql` 1 lan + `init.sh` | `infra/clickhouse/init.sh` |
| Gateway forward header outlet | `X-Internal-Outlet-Ids` = CSV string (e.g. "1,2,3") | `GatewayAuthenticationFilter.java:100-118` |
| Service parse | `Set<Long>` qua `parseLongCsv()` | `SpringInternalServiceAuth.java:63` |
| Khac header forward | `X-Internal-User-Id`, `X-Internal-Roles`, `X-Internal-Permissions`, `X-Internal-Session-Id`, `X-Correlation-ID` | `GatewayAuthenticationFilter.java:100-118` |
| OutletScopeContext | Multi-outlet: `setAllowedOutletIds(outlets)` | `RequestAuthenticationFilter.java:132` |
| Internal service auth | `X-Internal-Service` + `X-Internal-Token` headers | `GatewayAuthenticationFilter.java:27-37` |
| Redis Sentinel master | `fern-master` | `infra/redis/sentinel.conf` |
| Redis hosts | `redis`, `redis-replica-1/2`, `redis-sentinel-1/2/3:26379` | `infra/docker-compose.yml:135-180` |
| OpenSearch image | `opensearchproject/opensearch:2.12.0`, profile=`search` | `infra/docker-compose.yml` |
| OpenSearch KNN plugin | KHONG enabled san — can config them | (no knn config found) |
| OpenSearch security | DISABLE_SECURITY_PLUGIN=true (dev) | docker-compose |
| Kafka topic ai-query-audit | CHUA TON TAI — can them vao `init-topics.sh` | `infra/kafka/init-topics.sh:44-64` |
| Audit pattern hien tai | `audit-service` consume 26 domain events → Postgres + OpenSearch | `services/audit-service/.../AuditEventConsumer.java:53-78` |
| RateLimitTier hien tai | DEFAULT, AUTH, SYNC, REPORT, TELEMETRY | `GatewayRoute.java:27-33` |
| Service manifest | Java-only, KHONG nhan Python | `infra/config/services.manifest.sh:1-42` |
| LLM code hien co | KHONG co (greenfield) | grep openai/langchain/anthropic = empty |

---

## 3. Implications cua Verified Facts

### 3.1. Templates phai handle 2 column naming
- `fact_sale.outlet_id` (snake_case)
- `events_*.outletId` (camelCase)
- `events_invoice_approved.outletId` va `events_payroll_approved.outletId` la **Nullable** — phai filter `WHERE outletId IS NOT NULL` truoc khi join

### 3.2. business_date co san — KHONG can transformation logic trong views
Cot `business_date Date` da co o ingestion layer (PostgreSQL → CDC → ClickHouse). Views chi can `SELECT business_date` truc tiep.

### 3.3. ClickHouse migration strategy
- KHONG dung Flyway (Flyway chi cho Postgres)
- Tao file moi `infra/clickhouse/migrations/V001__analytics_views.sql`
- Sua `infra/clickhouse/init.sh` de chay them migrations folder, hoac chay manual lan dau

### 3.4. ai-query-service integration strategy
- Dung **standalone Python service** trong folder `ai-query-service/` (cung level voi `services/`, `gateway/`)
- KHONG register vao `services.manifest.sh` (Java-only)
- Them service vao `infra/docker-compose.yml` (Python container rieng)
- Tao `infra/scripts/start-ai-query-service.sh` neu can run native (khong qua Docker)

### 3.5. Auth headers — pattern chinh xac
```python
# app/auth/context.py
@dataclass
class AuthContext:
    user_id: int                   # X-Internal-User-Id
    session_id: str                # X-Internal-Session-Id
    roles: set[str]                # X-Internal-Roles (CSV → split)
    permissions: set[str]          # X-Internal-Permissions (CSV → split)
    outlet_ids: set[int]           # X-Internal-Outlet-Ids (CSV → split int)
    correlation_id: str            # X-Correlation-ID
    service_name: str              # X-Internal-Service (de verify caller la "gateway")
    internal_token: str            # X-Internal-Token (verify shared secret)
```

Phai validate `X-Internal-Token` voi shared secret de prevent direct call bypass Gateway. Lay `INTERNAL_SERVICE_TOKEN` env var (cung gia tri voi services khac).

### 3.6. Kafka topic moi
Them dong vao `infra/kafka/init-topics.sh`:
```bash
# Audit topic cho ai-query-service
fern.audit.ai-query|6|3|2     # name|partitions|RF|min-isr (critical → RF=3)
```

### 3.7. RateLimitTier moi
Them `AI_QUERY` vao enum. Hien tai REPORT tier la closest match (slow analytical queries). Co the dung tam REPORT, hoac add tier rieng cho LLM cost control.

### 3.8. OpenSearch KNN plugin
Image `opensearchproject/opensearch:2.12.0` da co KNN plugin built-in nhung mac dinh disabled. Can them setting:
```yaml
# docker-compose.yml — opensearch service
environment:
  - "knn.plugin.enabled=true"
```
Hoac dung index setting `index.knn=true` luc tao index.

---

## 4. Tong Quan Kien Truc

```
Client (Web/Mobile)
      │
      ▼
┌─────────────────────────────────┐
│   FERN Gateway (port 8080)      │  Spring Cloud Gateway
│   JWT Validation                │  Forward headers:
│   Rate Limiting (AI_QUERY tier) │    X-Internal-User-Id
│   Route: /api/v1/ai-query       │    X-Internal-Session-Id
└─────────────┬───────────────────┘    X-Internal-Roles (CSV)
              │ HTTP                   X-Internal-Permissions (CSV)
              │                        X-Internal-Outlet-Ids (CSV)
              │                        X-Internal-Service: "gateway"
              │                        X-Internal-Token: <shared secret>
              │                        X-Correlation-ID
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│         ai-query-service  Python 3.12 + FastAPI  port 8093          │
│                                                                     │
│  Middleware chain:                                                  │
│    1. AuthContextMiddleware — parse X-Internal-* headers           │
│       Validate X-Internal-Token == INTERNAL_SERVICE_TOKEN          │
│    2. RateLimitMiddleware — Redis counter, fail-open               │
│    3. CorrelationIdMiddleware — propagate X-Correlation-ID         │
│                                                                     │
│  POST /api/v1/ai-query/query                                        │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   LangGraph StateGraph                       │   │
│  │                                                              │   │
│  │  [1. preprocess] ──── [2. supervisor] ── GPT-4.1            │   │
│  │  [3. entity_resolver] ── OpenSearch ai_aliases + CH fallback│   │
│  │  [4. template_matcher] ── OpenSearch BM25+KNN + GPT-4.1     │   │
│  │  [5. validator] ── Pure Python + TEMPLATE_ROLE_RESTRICTIONS │   │
│  │  [6. rbac_injector] ── NO LLM, inject outlet_id IN (...)    │   │
│  │  [7. sql_guard] ── sqlglot AST                              │   │
│  │  [8. executor] ── ClickHouse (read_only=1)                  │   │
│  │       │ error                                               │   │
│  │       ▼                                                     │   │
│  │  [9. self_correction] ── GPT-4.1 ──► sql_guard (loop)       │   │
│  │  [10. answer_formatter] ── GPT-4.1                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└──────────┬──────────┬──────────────┬─────────────┬─────────────────┘
           │          │              │             │
           ▼          ▼              ▼             ▼
     ClickHouse   OpenSearch      Redis          Kafka
     fern.*       ai_aliases      Sentinel       fern.audit.ai-query
     port 8123    ai_templates    fern-master    (RF=3 critical)
                  knn enabled     (LangGraph
                                   checkpoint)
```

---

## 5. ClickHouse Analytics Views

**File:** `infra/clickhouse/migrations/V001__analytics_views.sql`

Views (queries chi dung `fern.*` vi do la database name verified):

| View | Source | Mô tả |
|------|--------|--------|
| `analytics.fct_sales_daily` | `fern.fact_sale` | Doanh thu theo ngay + outlet |
| `analytics.fct_sales_by_category` | `fern.fact_sale` JOIN `fern.dim_product` FINAL | Doanh thu theo category |
| `analytics.fct_sales_by_product` | `fern.fact_sale` | Doanh thu theo san pham |
| `analytics.fct_inventory_snapshot` | `fern.fact_inventory_movement` | Ton kho hien tai |
| `analytics.fct_daily_pnl` | `fct_sales_daily` + `events_goods_receipt_posted` + `events_payroll_approved` | P&L theo ngay |
| `analytics.fct_payment_split` | `fern.fact_sale` | Phan tich payment method |

**Critical points:**
- Filter `sale_status != 'CANCELLED'` (vi `fact_sale` co cot `sale_status`)
- Join `dim_product`/`dim_outlet` phai dung `FINAL` (ReplacingMergeTree)
- Event tables nullable outletId: `WHERE outletId IS NOT NULL` truoc khi aggregate
- KHONG can transformation `business_date` — cot da co san

**Apply migration:**
```bash
clickhouse-client --host clickhouse < infra/clickhouse/migrations/V001__analytics_views.sql
```

Hoac sua `infra/clickhouse/init.sh` de auto chay tat ca file `migrations/V*.sql`.

---

## 6. Chi Tiet Tung Node

### Node 1: `preprocess` — Pure Python
- Strip control chars, normalize Unicode NFC
- Max 500 ky tu
- Detect prompt injection patterns
- Detect language: dau tieng Viet → "vi", else "en"

### Node 2: `supervisor` — GPT-4.1
System prompt static (cached). Output structured JSON:
```json
{
  "intent": "revenue|inventory|product_mix|pnl|outlet_compare|trend|unknown",
  "time_range": {"from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD"},
  "raw_entities": {"outlet_names": [...], "product_names": [...], "categories": [...]}
}
```

### Node 3: `entity_resolver` — OpenSearch + ClickHouse fallback
1. Hybrid BM25+KNN tren `ai_aliases`
2. Score >= 0.85 → auto resolve
3. Score < 0.85 → fallback `SELECT outlet_id, name FROM fern.dim_outlet FINAL WHERE lower(name) LIKE lower('%{term}%')`
4. Filter outlet_ids ∈ `auth.outlet_ids`

### Node 4: `template_matcher` — OpenSearch + GPT-4.1
1. Top-3 BM25(weight=2.0) + KNN(weight=1.0) tu `ai_templates`
2. GPT-4.1 chon template + fill params
3. KHONG sinh SQL — chi chon tu 30 templates san co

### Node 5: `validator` — Pure Python (NO LLM)
- Check `template_key` ton tai
- Check du required params
- Date range <= 366 ngay
- `limit` <= 1000
- **TEMPLATE_ROLE_RESTRICTIONS:**

```python
# app/rbac/policy.py
TEMPLATE_ROLE_RESTRICTIONS: dict[str, set[str]] = {
    "T24_daily_pnl_summary":      {"CFO", "ADMIN", "AREA_MANAGER"},
    "T25_expense_breakdown":      {"CFO", "ADMIN", "AREA_MANAGER"},
    "T26_goods_receipt_summary":  {"CFO", "ADMIN", "AREA_MANAGER"},
    "T27_payroll_cost_by_outlet": {"CFO", "ADMIN"},  # payroll = chi CFO/ADMIN
}

def check_template_access(template_key: str, roles: set[str]) -> bool:
    allowed = TEMPLATE_ROLE_RESTRICTIONS.get(template_key)
    return allowed is None or bool(roles & allowed)
```

### Node 6: `rbac_injector` — NO LLM, CRITICAL SECURITY
```python
def inject_rbac(state: GraphState) -> GraphState:
    auth = state["auth"]
    requested = state["resolved_entities"].get("outlet_ids", [])

    # CFO/ADMIN scope = all outlets (lay tu DB, khong hard-code)
    if {"CFO", "ADMIN"} & auth.roles:
        all_outlets = fetch_all_outlet_ids_from_clickhouse()
        allowed = list(set(requested) & all_outlets) if requested else list(all_outlets)
    else:
        # Intersection voi auth scope
        if requested:
            allowed = [x for x in requested if x in auth.outlet_ids]
        else:
            allowed = list(auth.outlet_ids)

    # Type assertion — bao ve Jinja2
    assert all(isinstance(x, int) for x in allowed)
    assert len(allowed) > 0, "No allowed outlets — refuse query"

    state["allowed_outlet_ids"] = allowed
    state["final_sql"] = render_template(state["template_key"], allowed, **state["template_params"])
    return state
```

### Node 7: `sql_guard` — sqlglot AST
1. Chi SELECT (reject INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE)
2. Tables ∈ whitelist `{"analytics", "fern"}` (KHONG `default.*`)
3. Reject functions: `system`, `file`, `url`, `remote`, `cluster`, `jdbc`, `odbc`, `executable`
4. WHERE phai chua `outlet_id IN (...)` hoac `outletId IN (...)` o top-level
5. Reject UNION

### Node 8: `executor` — clickhouse-connect HTTP
```python
settings = {
    "max_execution_time": 30,
    "max_memory_usage": 2_000_000_000,
    "max_result_rows": 1000,
    "read_only": 1,
}
```

### Node 9: `self_correction` — GPT-4.1
- Chi neu `correction_attempts < 2`
- Sua syntax error, KHONG thay doi WHERE clause
- **Edge:** `self_correction → sql_guard → executor` (KHONG di thang executor)

```
executor  ──(error, attempts < 2)──►  self_correction
self_correction ──────────────────►  sql_guard
sql_guard  ──(pass)──►  executor
executor  ──(success | attempts >= 2)──►  answer_formatter
```

### Node 10: `answer_formatter` — GPT-4.1
Format chuan tieng Viet:
```
Doanh thu thuan outlet Quan 1 hom nay (02/05/2026):
**45,230,000 d** (234 don hang)

_Du lieu tinh den: 2026-05-02 14:30:07_
```

---

## 7. Danh Sach 30 SQL Templates

Tat ca dung Jinja2, **bat buoc** co `WHERE outlet_id IN ({{ outlet_ids | join(',') }})` (hoac `outletId` cho event tables).

### Revenue (10)
T01_daily_revenue, T02_revenue_by_outlet, T03_revenue_by_category, T04_top_products, T05_revenue_trend_7d, T06_revenue_trend_30d, T07_revenue_comparison_yoy, T08_revenue_by_payment_method, T09_avg_basket_size, T10_transaction_count

### Inventory (5)
T11_inventory_current_stock, T12_inventory_low_stock, T13_inventory_movement_summary, T14_inventory_consumption_rate, T15_inventory_reorder_alerts

### Product (5)
T16_product_sales_mix, T17_category_contribution, T18_product_rank_by_outlet, T19_slow_moving_products, T20_product_discount_analysis

### Outlet/Operations (5)
T21_outlet_performance, T22_outlet_rank, T23_peak_hour_analysis, T28_payment_capture_analysis, T30_sale_cancellation_rate

### P&L / Finance (4) — restricted
T24_daily_pnl_summary, T25_expense_breakdown, T26_goods_receipt_summary, T27_payroll_cost_by_outlet

### Stock Events (1)
T29_stock_low_events

---

## 8. Cau Truc Thu Muc

```
ai-query-service/                       ← cung level voi services/, gateway/, infra/
├── PLAN.md                             ← file nay
├── README.md
├── Dockerfile
├── pyproject.toml
├── .env.example
│
├── app/
│   ├── __init__.py
│   ├── main.py                         # FastAPI lifespan, register middleware + routes
│   ├── config.py                       # pydantic-settings
│   │
│   ├── auth/
│   │   ├── __init__.py
│   │   └── context.py                  # AuthContext + parse X-Internal-* headers
│   │                                   # Verify X-Internal-Token shared secret
│   │
│   ├── middleware/
│   │   ├── __init__.py
│   │   ├── auth.py                     # AuthContextMiddleware
│   │   ├── rate_limit.py               # Redis counter, fail-open
│   │   └── correlation.py              # X-Correlation-ID propagation
│   │
│   ├── graph/
│   │   ├── __init__.py
│   │   ├── state.py                    # GraphState TypedDict
│   │   ├── builder.py                  # StateGraph + edges (incl. self_correction loop)
│   │   └── nodes/
│   │       ├── __init__.py
│   │       ├── preprocess.py
│   │       ├── supervisor.py
│   │       ├── entity_resolver.py
│   │       ├── template_matcher.py
│   │       ├── validator.py
│   │       ├── rbac_injector.py        # CRITICAL — NO LLM
│   │       ├── sql_guard.py
│   │       ├── executor.py
│   │       ├── self_correction.py
│   │       └── answer_formatter.py
│   │
│   ├── clients/
│   │   ├── __init__.py
│   │   ├── clickhouse.py               # clickhouse-connect HTTP (port 8123)
│   │   ├── opensearch.py               # hybrid search helpers
│   │   ├── kafka.py                    # aiokafka producer (fern.audit.ai-query)
│   │   └── redis_sentinel.py           # Sentinel master discovery → RedisSaver
│   │
│   ├── llm/
│   │   ├── __init__.py
│   │   └── openai_client.py            # AsyncOpenAI singleton, gpt-4.1 + text-embedding-3-small
│   │
│   ├── templates/
│   │   ├── __init__.py
│   │   ├── registry.py                 # Load + Jinja2 render
│   │   └── sql/                        # 30 .sql files (Jinja2)
│   │       ├── T01_daily_revenue.sql
│   │       ├── ... (30 files)
│   │       └── T30_sale_cancellation_rate.sql
│   │
│   ├── rbac/
│   │   ├── __init__.py
│   │   └── policy.py                   # TEMPLATE_ROLE_RESTRICTIONS
│   │
│   ├── guard/
│   │   ├── __init__.py
│   │   └── sql_ast.py                  # sqlglot AST validation
│   │
│   └── audit/
│       ├── __init__.py
│       └── events.py                   # AiQueryAuditEvent → Kafka fern.audit.ai-query
│
├── knowledge/
│   ├── aliases.yaml                    # Static: categories + metrics (KHONG outlets)
│   └── metrics.yaml                    # 30 template descriptions de seed
│
├── scripts/
│   ├── opensearch_setup.py             # Tao indices ai_aliases + ai_templates
│   ├── seed_knowledge_catalog.py       # YAML + dim_outlet → embed → bulk index
│   └── opensearch/
│       ├── ai_aliases_index.json       # Index mapping (knn enabled)
│       └── ai_templates_index.json
│
└── tests/
    ├── conftest.py
    ├── test_auth_context.py
    ├── test_rbac_injector.py
    ├── test_sql_guard.py
    ├── test_template_registry.py
    ├── test_validator_role_restriction.py
    ├── test_graph_preprocess.py
    └── test_graph_integration.py       # Mock LLM + ClickHouse
```

**Files NGOAI `ai-query-service/` can tao/sua:**

| File | Thay doi |
|------|----------|
| `infra/clickhouse/migrations/V001__analytics_views.sql` | Tao moi (folder moi) |
| `infra/clickhouse/init.sh` | Sua: chay them `migrations/V*.sql` sau schema.sql |
| `infra/docker-compose.yml` | Them `ai-query-service` container + `knn.plugin.enabled=true` cho opensearch |
| `infra/kafka/init-topics.sh` | Them `fern.audit.ai-query\|6\|3\|2` (RF=3 critical) |
| `gateway/.../GatewayRoute.java` | Them `AI_QUERY` vao `RateLimitTier` enum |
| `gateway/.../GatewayRouteCatalog.java` | Them route `/api/v1/ai-query` → port 8093 |
| `gateway/src/test/resources/route-catalog.snapshot.txt` | Them dong sorted: `/api/v1/ai-query\|ai-query-service\|USER\|AI_QUERY` |
| `infra/env/services.env.example` | Them `AI_QUERY_SERVICE_URL=http://ai-query-service:8093` |

---

## 9. Knowledge Catalog Format

### `knowledge/aliases.yaml`

```yaml
# outlets: KHONG dinh nghia o day.
# Outlets seed dong tu fern.dim_outlet boi scripts/seed_knowledge_catalog.py
# Ly do: outlets thay doi → hard-code se le data.

categories:
  - alias_vi: ["tra sua", "milk tea", "bubble tea", "tran chau"]
    canonical_type: category
    canonical_id: 1
    canonical_name: "Tra sua"

metrics:
  - alias_vi: ["doanh thu", "revenue"]
    canonical_type: metric
    canonical_id: null
    canonical_name: "net_revenue"
```

### `generate_outlet_aliases()` — full spec

```python
import re
import unicodedata

def strip_accents(s: str) -> str:
    """'Quận' → 'quan'"""
    nfkd = unicodedata.normalize("NFKD", s)
    ascii_s = "".join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_s.replace("đ", "d").replace("Đ", "D")

def generate_outlet_aliases(name: str) -> list[str]:
    """
    Input:  "Outlet Quận 1 - Nguyễn Trãi"
    Output: ["outlet quan 1 - nguyen trai", "q1", "quan 1",
             "outlet q1", "chi nhanh q1", "nguyen trai",
             "quan 1 - nguyen trai"]
    """
    name_ascii = strip_accents(name).lower().strip()
    aliases = [name_ascii]

    # "Quan N" → "QN"
    if m := re.search(r"quan\s+(\d+)", name_ascii):
        n = m.group(1)
        aliases.extend([f"q{n}", f"quan {n}", f"outlet q{n}",
                        f"chi nhanh q{n}", f"chi nhanh quan {n}"])

    # Tach sau " - "
    if " - " in name_ascii:
        aliases.extend(p.strip() for p in name_ascii.split(" - "))

    # Bo prefix
    for prefix in ("outlet ", "chi nhanh "):
        if name_ascii.startswith(prefix):
            aliases.append(name_ascii[len(prefix):])

    # Dedup giu order
    seen = set()
    return [a for a in aliases if not (a in seen or seen.add(a))]
```

### Embedding model
**`text-embedding-3-small`** (1536 dims) cho CA HAI indexes. Khong dung sentence-transformers (~2GB).

---

## 10. Redis Sentinel Workaround

```python
# app/clients/redis_sentinel.py
from redis.sentinel import Sentinel
from langgraph.checkpoint.redis import RedisSaver

def make_sentinel_saver(sentinel_hosts: list[tuple[str, int]], master_name: str = "fern-master") -> RedisSaver:
    sentinel = Sentinel(sentinel_hosts, socket_timeout=0.5)
    host, port = sentinel.discover_master(master_name)
    return RedisSaver.from_conn_string(f"redis://{host}:{port}")
```

Hosts: `[("redis-sentinel-1", 26379), ("redis-sentinel-2", 26379), ("redis-sentinel-3", 26379)]`. Master: `fern-master`.

---

## 11. Docker Integration

Sua `infra/docker-compose.yml`, them service:

```yaml
services:
  ai-query-service:
    build:
      context: ../ai-query-service
      dockerfile: Dockerfile
    container_name: ai-query-service
    ports:
      - "8093:8093"
    environment:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      CLICKHOUSE_HOST: clickhouse
      CLICKHOUSE_PORT: 8123
      CLICKHOUSE_DB: fern
      OPENSEARCH_URL: http://opensearch:9200
      REDIS_SENTINEL_HOSTS: redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379
      REDIS_SENTINEL_MASTER: fern-master
      KAFKA_BOOTSTRAP: kafka:29092,kafka-2:29092,kafka-3:29092
      KAFKA_AUDIT_TOPIC: fern.audit.ai-query
      INTERNAL_SERVICE_TOKEN: ${INTERNAL_SERVICE_TOKEN}
    depends_on:
      - clickhouse
      - opensearch
      - redis-sentinel-1
      - kafka
    profiles: ["ai"]    # Optional service, kich hoat: docker compose --profile ai up
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8093/api/v1/ai-query/health"]
      interval: 15s

  opensearch:
    # ... existing config ...
    environment:
      # Them dong nay:
      - knn.plugin.enabled=true
```

---

## 12. Gateway Integration

### `GatewayRoute.java`
```java
public enum RateLimitTier {
    DEFAULT, AUTH, SYNC, REPORT, TELEMETRY, AI_QUERY  // them
}
```

### `GatewayRouteCatalog.java`
```java
String aiQueryUrl = env("AI_QUERY_SERVICE_URL", "http://localhost:8093");
// trong List.of():
new GatewayRoute("/api/v1/ai-query", "ai-query-service", aiQueryUrl,
                 RouteClass.USER, RateLimitTier.AI_QUERY),
```

### `route-catalog.snapshot.txt`
Them dong (sorted):
```
/api/v1/ai-query|ai-query-service|USER|AI_QUERY
```

### Gateway forward shared secret
ai-query-service verify `X-Internal-Token` == `INTERNAL_SERVICE_TOKEN` (cung gia tri voi services khac). Gateway tu dong inject token nay khi forward — KHONG can sua Gateway.

---

## 13. Kafka Topic Moi

Them vao `infra/kafka/init-topics.sh:44-64`:

```bash
# AI Query audit (critical — RF=3, min-isr=2)
fern.audit.ai-query|6|3|2
```

Audit event schema:
```python
@dataclass
class AiQueryAuditEvent:
    event_id: str           # UUID
    timestamp: str          # ISO-8601
    user_id: int
    session_id: str
    correlation_id: str
    outlet_ids: list[int]
    roles: list[str]
    raw_question_truncated: str   # max 500 chars (PII safety)
    intent: str
    template_key: str | None
    sql_sanitized: str            # strip literals: "WHERE outlet_id IN (?) AND business_date = ?"
    sql_hash: str                 # SHA-256
    execution_ms: int
    row_count: int
    correction_attempts: int
    outcome: str                  # success | guard_blocked | validation_error | role_denied | execution_failed
```

---

## 14. Thu Tu Trien Khai

| Buoc | File(s) | Test ngay |
|------|---------|-----------|
| 1 | `pyproject.toml`, `app/config.py`, `.env.example` | `python -c "from app.config import Settings; print(Settings())"` |
| 2 | `app/auth/context.py` (parse + verify token) | `pytest tests/test_auth_context.py` |
| 3 | `app/middleware/auth.py` + `correlation.py` | unit test |
| 4 | `app/guard/sql_ast.py` + `app/graph/nodes/sql_guard.py` | `pytest tests/test_sql_guard.py` |
| 5 | `app/templates/registry.py` + 30 .sql files | `pytest tests/test_template_registry.py` |
| 6 | `app/rbac/policy.py` (incl. TEMPLATE_ROLE_RESTRICTIONS) | `pytest tests/test_validator_role_restriction.py` |
| 7 | `app/graph/nodes/rbac_injector.py` | `pytest tests/test_rbac_injector.py` |
| 8 | `app/graph/state.py` | type check |
| 9 | `app/llm/openai_client.py` | manual test |
| 10 | `app/clients/clickhouse.py` | integration |
| 11 | `app/clients/opensearch.py` | integration |
| 12 | `app/clients/redis_sentinel.py` | integration |
| 13 | `app/middleware/rate_limit.py` (fail-open) | unit test mock Redis |
| 14 | `app/clients/kafka.py` | integration |
| 15 | `app/graph/nodes/preprocess.py` | `pytest tests/test_graph_preprocess.py` |
| 16-21 | Cac node con lai (supervisor, entity_resolver, template_matcher, validator, executor, self_correction, answer_formatter) | unit + manual |
| 22 | `app/graph/builder.py` (incl. self_correction → sql_guard edge) | `pytest tests/test_graph_integration.py` |
| 23 | `app/audit/events.py` | integration Kafka |
| 24 | `app/main.py` | `uvicorn app.main:app --reload` |
| 25 | `infra/clickhouse/migrations/V001__analytics_views.sql` | `clickhouse-client < V001...sql` |
| 26 | `knowledge/aliases.yaml` + `metrics.yaml` | manual review |
| 27 | `scripts/opensearch_setup.py` (knn enabled) | run script |
| 28 | `scripts/seed_knowledge_catalog.py` (gen outlet aliases tu DB) | run script |
| 29 | `Dockerfile` | `docker build` |
| 30 | Sua `infra/docker-compose.yml` (them service + knn.plugin.enabled) | `docker compose --profile ai up` |
| 31 | Sua `infra/kafka/init-topics.sh` (them fern.audit.ai-query) | re-run init-topics |
| 32 | Gateway Java changes (3 files) | `mvn -pl gateway test -Dtest=GatewayRouteCatalogSnapshotTest` |
| 33 | Sua `infra/env/services.env.example` | manual review |

---

## 15. Quy Tac Bao Mat Bat Buoc

1. `outlet_id IN (...)` chi tu `auth.outlet_ids` header — khong bao gio tu LLM
2. `sql_guard` verify outlet filter ton tai TRUOC khi execute
3. `rbac_injector` assert `list[int]` truoc khi pass vao Jinja2
4. `rbac_injector` assert `len(allowed) > 0` — refuse query neu empty scope
5. SQL templates query chi `analytics.*` hoac `fern.*` — sql_guard whitelist
6. Audit log:
   - `sql_sanitized` (strip literals) de debug
   - `sql_hash` SHA-256 de integrity check
   - KHONG luu raw SQL
7. Input sanitization: detect prompt injection, limit 500 ky tu
8. ClickHouse `read_only=1` — defense in depth
9. Template-level RBAC (validator Node 5): T24/T25/T26 = CFO+ADMIN+AREA_MANAGER, T27 = chi CFO+ADMIN
10. Service-level rate limit (Redis counter): 20/min, 200/hour per user
    - **Fail open** khi Redis down: log warning + cho qua. Ly do: rate limit best-effort, khong block toan service vi Sentinel failover. Gateway con co rate limit lop ngoai.
11. Verify `X-Internal-Token` shared secret — prevent direct call bypass Gateway
12. KHONG log raw question chua PII — truncate 500 chars + mask khi co pattern email/phone

---

## 16. Verification Checklist

- [ ] Tat ca SQL templates dung `fern.*` hoac `analytics.*` — KHONG dung `default.*`
- [ ] Templates voi event tables xu ly `outletId` Nullable: `WHERE outletId IS NOT NULL`
- [ ] Header parsing dung `Set<Long>` pattern (CSV → split → int)
- [ ] `X-Internal-Token` validate o middleware
- [ ] OpenSearch index tao voi `index.knn=true`
- [ ] Kafka topic `fern.audit.ai-query` register voi RF=3 (critical)
- [ ] Gateway snapshot test pass sau khi them route
- [ ] Redis Sentinel discovery work voi master name `fern-master`
- [ ] ClickHouse migration apply qua init.sh hoac manual (KHONG qua Flyway)
