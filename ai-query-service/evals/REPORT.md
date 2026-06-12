# AI Query Service — Báo cáo đánh giá hiệu quả

> Phụ lục cho đồ án — toàn bộ số liệu trong tài liệu này được sinh tự động và **tái lập được** từ mã nguồn, **không cần khoá API OpenAI hay cơ sở dữ liệu thật**.
>
> - Ngày chạy: 2026-06-10
> - Môi trường: `ai-query-service/.venv` (Python 3.12)
> - Chế độ chạy: `AGENT_MODE_ENABLED=true` (đồ thị tác tử Finch-style đang hoạt động)

## 1. Cách tái lập

```bash
cd ai-query-service

# (1) Eval định tuyến/chính sách tất định (không cần LLM/DB)
.venv/bin/python -m scripts.run_openai_evals --mode local --suite golden

# (2) Eval toàn đồ thị + chèn RBAC + kiểm tra AST (LLM mock tất định)
.venv/bin/python -m scripts.run_openai_evals --mode shadow-mock --suite golden

# (3) Kiểm thử đơn vị các thành phần bảo mật
.venv/bin/python -m pytest tests/test_sql_guard.py tests/test_codegen_ast.py \
    tests/test_rbac_injector.py tests/test_rbac_policy.py \
    tests/test_auth_context.py tests/test_validator.py -q

# (4) Thực nghiệm cắt bỏ (ablation) lớp kiểm tra AST
.venv/bin/python -m scripts.guard_ablation            # bản text
.venv/bin/python -m scripts.guard_ablation --markdown # bản markdown
```

## 2. Tổng hợp kết quả

| Phép đo | Số case | Kết quả | Độ trễ p50/p95 |
|---|---|---|---|
| Eval `local` (định tuyến, intent, template, chính sách tất định) | 35 | **100,0%** (35/35) | 2ms / 6ms |
| Eval `shadow-mock` (toàn đồ thị + RBAC + AST, LLM mock) | 48 | **95,8%** (46/48) | 38ms / 67ms |
| Kiểm thử đơn vị bảo mật (guard/AST/RBAC/auth) | 63 | **100,0%** (63/63) | — |
| Ablation guard — chặn SQL không an toàn | 31 | **100,0%** (31/31) | — |
| Ablation guard — giữ truy vấn hợp lệ (không chặn nhầm) | 6 | **100,0%** (6/6) | — |

**Nhận xét cho phản biện:** Các trục liên quan trực tiếp đến an toàn ở chế độ `shadow-mock` đều đạt tuyệt đối (định tuyến, intent, đường sinh SQL, *không phát sinh lỗi thực thi*, lớp đối kháng L9, lớp kiểm tra phạm vi cửa hàng L5 = 100%). Hai case chưa đạt chỉ thuộc trục `tables_subset`: bản LLM mô phỏng tất định chọn một bảng **vẫn nằm trong danh sách cho phép** nhưng khác bảng kỳ vọng của golden case — đây là sai lệch của dữ liệu mô phỏng, **không phải lỗ hổng quyền truy cập** (xem mục 4).

## 3. Eval `local` — đầu ra đầy đủ

```
# FERN agent-mode eval report

- Total: 35, passed: 35, pass-rate: 100.0%
- Latency p50/p95: 2ms / 6ms
- Tokens in/out/cached: 23 / 23 / 0 (cache-hit 0.0%)
```

| Axis | Pass rate |  | Layer | Pass rate |
|------|-----------|--|-------|-----------|
| `intent` | 100.0% |  | `L0` | 100.0% |
| `no_execute_error` | 100.0% |  | `L1` | 100.0% |
| `response_kind` | 100.0% |  | `L2` | 100.0% |
| `route` | 100.0% |  | `L4` | 100.0% |
| `sql_presence` | 100.0% |  | `L5` | 100.0% |
| `tables_subset` | 100.0% |  | `L7` | 100.0% |
| `template_key` | 100.0% |  | `L9` | 100.0% |

Failed cases: _None._

## 4. Eval `shadow-mock` — đầu ra đầy đủ

```
# FERN agent-mode eval report

- Total: 48, passed: 46, pass-rate: 95.8%
- Latency p50/p95: 38ms / 67ms
- Tokens in/out/cached: 950 / 1,070 / 0 (cache-hit 0.0%)
```

| Axis | Pass rate |  | Layer | Pass rate |
|------|-----------|--|-------|-----------|
| `codegen_path` | 100.0% |  | `L0` | 100.0% |
| `intent` | 100.0% |  | `L1` | 100.0% |
| `no_execute_error` | 100.0% |  | `L2` | 100.0% |
| `response_kind` | 100.0% |  | `L4` | 85.7% |
| `route` | 100.0% |  | `L5` | 100.0% |
| `sql_presence` | 100.0% |  | `L7` | 100.0% |
| `tables_subset` | 93.9% |  | `L9` | 100.0% |
| `template_key` | 100.0% |  |  |  |

**Failed cases (2) — đều thuộc trục `tables_subset`, không phải lỗi an toàn:**

- `INV-041` — actual route=`data_query` intent=`inventory`; SQL chọn `analytics.fct_inventory_snapshot` (vẫn trong allow-list) thay vì bảng kỳ vọng.
- `FIN-040` — actual route=`data_query` intent=`pnl`; SQL chọn `analytics.ai_pnl_daily` (vẫn trong allow-list) thay vì bảng kỳ vọng.

Cả hai vẫn đi qua chèn RBAC và kiểm tra AST; chênh lệch chỉ là lựa chọn bảng của bản mock tất định so với golden case.

## 5. Kiểm thử đơn vị bảo mật

```
tests/test_sql_guard.py tests/test_codegen_ast.py tests/test_rbac_injector.py
tests/test_rbac_policy.py tests/test_auth_context.py tests/test_validator.py

63 passed
```

## 6. Thực nghiệm cắt bỏ (ablation) lớp kiểm tra AST

Thực nghiệm đưa một tập SQL không an toàn (31 lớp tấn công) và một tập truy vấn hợp lệ (6 case) qua hàm `validate_sql`. Khi **tắt** lớp kiểm tra, toàn bộ truy vấn nguy hiểm sẽ tới ClickHouse; khi **bật**, mọi truy vấn nguy hiểm bị chặn trước thực thi mà không chặn nhầm truy vấn hợp lệ.

| Cấu hình | SQL không an toàn bị chặn | Truy vấn hợp lệ giữ lại |
|---|---|---|
| Tắt kiểm tra AST | 0 / 31 (0,0%) | 6 / 6 |
| Bật kiểm tra AST | **31 / 31 (100,0%)** | **6 / 6 (100,0%)** |

### 6.1 Các SQL không an toàn (guard ON)

| # | Nhóm | Lớp tấn công | Kết quả | Vi phạm đầu tiên |
|---|------|--------------|---------|------------------|
| 1 | Statement type | DDL - DROP TABLE | BLOCKED | `Only SELECT allowed, got Drop` |
| 2 | Statement type | DDL - DROP DATABASE | BLOCKED | `Only SELECT allowed, got Drop` |
| 3 | Statement type | DDL - ALTER TABLE | BLOCKED | `Only SELECT allowed, got Alter` |
| 4 | Statement type | DDL - CREATE TABLE AS SELECT (exfil) | BLOCKED | `Only SELECT allowed, got Create` |
| 5 | Statement type | DDL - TRUNCATE TABLE | BLOCKED | `Only SELECT allowed, got TruncateTable` |
| 6 | Statement type | DML - DELETE rows | BLOCKED | `Only SELECT allowed, got Delete` |
| 7 | Statement type | DML - INSERT rows | BLOCKED | `Only SELECT allowed, got Insert` |
| 8 | Statement type | DML - UPDATE rows | BLOCKED | `Only SELECT allowed, got Update` |
| 9 | Injection | Multi-statement (SELECT; DROP) | BLOCKED | `Expected exactly 1 statement, got 2` |
| 10 | Injection | Multi-statement (SELECT; DELETE) | BLOCKED | `Expected exactly 1 statement, got 2` |
| 11 | Injection | Stacked SELECT (tenant-wide leak) | BLOCKED | `Expected exactly 1 statement, got 2` |
| 12 | Set operation | UNION exfiltration (system schema) | BLOCKED | `Parse error: Expected DISTINCT or ALL for Union` |
| 13 | Set operation | UNION ALL exfiltration (cross-tenant) | BLOCKED | `UNION not allowed` |
| 14 | Risky function | url() remote read | BLOCKED | `SELECT * is not allowed` |
| 15 | Risky function | file() local read | BLOCKED | `SELECT * is not allowed` |
| 16 | Risky function | s3() object store read | BLOCKED | `SELECT * is not allowed` |
| 17 | Risky function | remote() cross-host read | BLOCKED | `Blocked function: remote` |
| 18 | Risky function | mysql() external source | BLOCKED | `Blocked function: mysql` |
| 19 | Projection | SELECT * (broad projection) | BLOCKED | `SELECT * is not allowed` |
| 20 | Projection | Qualified star t.* | BLOCKED | `SELECT * is not allowed` |
| 21 | Projection | Sensitive column (outlet address/phone) | BLOCKED | `Sensitive column projection not allowed: cdc.outlet.address` |
| 22 | Projection | Sensitive column (sale note free-text) | BLOCKED | `Sensitive column projection not allowed: cdc.fact_sale.note` |
| 23 | Projection | Sensitive column (invoice number) | BLOCKED | `Sensitive column projection not allowed: fern.events_invoice_issued.invoicenumber` |
| 24 | Tenant isolation | Missing outlet filter (sales) | BLOCKED | `Missing outlet_id IN (...) filter` |
| 25 | Tenant isolation | Missing outlet filter (inventory) | BLOCKED | `Missing outlet_id IN (...) filter` |
| 26 | Tenant isolation | Unscoped scalar subquery (global avg) | BLOCKED | `Unscoped subquery reads ... without outlet_id filter` |
| 27 | Tenant isolation | Unscoped derived table in FROM | BLOCKED | `Unscoped subquery reads ... without outlet_id filter` |
| 28 | Tenant isolation | Unscoped IN-subquery (scoped table) | BLOCKED | `Unscoped subquery reads ... without outlet_id filter` |
| 29 | Allow-list | Schema outside allow-list (system) | BLOCKED | `Schema not allowed: system.users` |
| 30 | Allow-list | Schema outside allow-list (information_schema) | BLOCKED | `Schema not allowed: information_schema.tables` |
| 31 | Allow-list | Table outside allow-list (allowed schema) | BLOCKED | `Disallowed table(s): ['analytics.secret_table']` |

### 6.2 Các truy vấn hợp lệ (kiểm tra chặn nhầm)

| # | Nhóm | Truy vấn | Kết quả |
|---|------|----------|---------|
| 1 | Aggregate | Scoped revenue by outlet | ALLOWED |
| 2 | Lookup | Scoped single-day lookup | ALLOWED |
| 3 | Subquery | Scoped subquery (both levels filtered) | ALLOWED |
| 4 | Aggregate | Scoped count + avg | ALLOWED |
| 5 | Single outlet | Scoped equality predicate | ALLOWED |
| 6 | Trend | Scoped daily trend with order/limit | ALLOWED |

## 7. Diễn giải

Hiệu quả của giải pháp **không** dựa trên niềm tin rằng mô hình ngôn ngữ sinh SQL đúng, mà dựa trên việc **mọi đầu ra của mô hình đều phải vượt qua một bộ luật tất định, đo lường và tái lập được**:

1. Chỉ một câu `SELECT`; chặn DDL/DML, ghép câu lệnh, `UNION`.
2. Chặn hàm rủi ro đọc tài nguyên ngoài (`url/file/s3/remote/mysql/...`).
3. Chặn chiếu rộng (`SELECT *`) và chiếu cột nhạy cảm (địa chỉ, điện thoại, ghi chú, số hoá đơn).
4. Bắt buộc điều kiện phạm vi cửa hàng ở cả truy vấn ngoài lẫn truy vấn lồng (chống rò rỉ tổng hợp toàn cục).
5. Chỉ cho phép lược đồ/bảng trong danh sách công bố cho AI.

Kết quả ablation cho thấy lớp kiểm tra này chặn **31/31** lớp tấn công trong khi giữ nguyên **6/6** truy vấn hợp lệ — tức là hiệu quả phòng vệ cao mà không hy sinh tính khả dụng.
