# 04 — Data Organization: Có Nên Giữ Chung 1 Database?

Câu hỏi: FERN hiện dùng 1 Postgres schema `core` cho 12 service — có nên split database-per-service như microservices best practice? Có ảnh hưởng offline-first POS không?

## Kiến Trúc FERN Hiện Tại

```
┌─────────────────────────────────────────────────┐
│ PostgreSQL master, schema `core`                │
│                                                 │
│ Tables (~100):                                  │
│   outlet, region, product, product_price,       │
│   sale_record, sale_item, payment,              │
│   pos_session, inventory_transaction,           │
│   stock_balance, app_user, role, permission,    │
│   idempotency_keys, publish_version, ...        │
│                                                 │
│ 12 services đều connect cùng JDBC URL          │
│ jdbc:postgresql://localhost:5432/fern          │
└─────────────────────────────────────────────────┘
          ▲                  ▲                  ▲
          │                  │                  │
    sales-service    inventory-service   product-service  ...
```

- Multi-tenant: row-based bằng `outlet_id`.
- Cross-service FK: sale_record → outlet, sale_item → product, inventory_transaction → item ...
- Migration Flyway V1→V18 apply chung 1 DB (thiếu V13).

## 2 Phương Án

### A. Giữ Shared Database (hiện tại)

**Pros**:

- Transaction management đơn giản — multi-table tx không cần saga.
- FK integrity enforce ở DB level.
- Query cross-domain (báo cáo, analytics) không cần federation.
- Deploy/backup/monitor 1 DB duy nhất.
- Team nhỏ vận hành dễ.
- Migration consistency — 1 Flyway sequence.

**Cons**:

- Coupling cao: đổi schema 1 bảng cần cân nhắc 12 service.
- Không scale độc lập per domain.
- 1 service runaway query → impact mọi service.
- Blast radius: sự cố DB = toàn bộ hệ thống down.
- Giới hạn polyglot persistence (ví dụ search → Elasticsearch không tự nhiên).

### B. Database-Per-Service

**Pros**:

- Loose coupling theo microservices best practice.
- Polyglot: mỗi service chọn DB phù hợp.
- Scale independent.
- Fault isolation.

**Cons**:

- Distributed transaction khó: saga pattern, eventual consistency.
- Cross-domain join không còn → BFF/aggregator phải tự join.
- Duplication data (master data replicated qua events).
- Deploy/monitor nhiều DB.
- **Gartner: ~60% microservices migration fail vì poor DB decomposition**.

Refs: [microservices.io Database per Service](https://microservices.io/patterns/data/database-per-service.html) · [microservices.io Shared Database](https://microservices.io/patterns/data/shared-database.html) · [Monolith to Microservices Ch.4](https://www.oreilly.com/library/view/monolith-to-microservices/9781492047834/ch04.html)

## So Sánh Với Big Players

| System | Approach | Match FERN? |
|---|---|---|
| **SAP S/4HANA** | Single HANA in-memory DB, shared-nothing cluster scale | FERN cùng pattern, khác là Postgres thay vì HANA |
| **Oracle NetSuite** | Single cloud DB, multi-location row-based, POS ghi trực tiếp | FERN giống, nhưng NetSuite không offline-first |
| **Odoo** | Single DB, multi-company row-based (`company_id`), POS IndexedDB offline | **Match nhất** — FERN cùng mô hình |
| **Microsoft D365 Commerce** | HQ DB + Channel DB + Offline DB per store (CDX sync) | FERN scope 1 POS → 2-tier đủ, không cần 3 |
| **Shopify** | Cloud DB, POS local cache | Match shared DB approach |
| **Toast** | Cloud + local hub per outlet | Multi-terminal mới cần hub |

**Kết luận industry**: Single shared database + row-based multi-tenant là pattern chiếm đa số cho retail/F&B backend. Microservices DB split không phải điều kiện bắt buộc.

## Khuyến Nghị Cho FERN

### Giữ shared database. Không split.

Lý do:

1. **Team size & scale**: chưa có dấu hiệu cần split (no blast radius incident, no independent scaling pressure).
2. **Cross-service FK còn nhiều**: split sẽ phá vỡ nhiều FK, cần saga + eventual consistency — effort lớn không đổi proportional benefit.
3. **Offline-first KHÔNG yêu cầu split**: POS offline chỉ cần local store + outbox + central endpoint — shared DB central vẫn phục vụ được.
4. **Gartner warning**: rủi ro fail cao, FERN ở giai đoạn product-market-fit, không nên gánh.
5. **SAP/NetSuite/Odoo** — các ERP trưởng thành cũng single DB.

### Cải tiến trong khung shared database

1. **Logical domain boundary qua schema / prefix table**:
   - Hiện tất cả ở `core.*`. Có thể chia schema `sales.*`, `inventory.*`, `catalog.*`, `auth.*`, `org.*` — cùng 1 DB nhưng logical boundary rõ.
   - Flyway hỗ trợ multi-schema.
   - Migration mới split dần khi edit, không big bang.
   - Lợi ích: dễ visualize ownership, dễ future split nếu có lý do.

2. **Read replica cho report-service**:
   - Streaming replica Postgres cho analytic query nặng.
   - Config `spring.datasource.replica.*` chỉ dùng trong report-service.
   - Không split data, chỉ tách đường đọc.

3. **Per-service pool size**:
   - Hiện default pool=16 đồng đều 12 service → 192 max connection.
   - Sales hot → 32, audit/report → 8, others → 16.
   - Config env-override per service.

4. **Outbox pattern trong shared DB**:
   - Bảng `core.outbox_event` chia sẻ, mỗi service ghi phần của mình.
   - Relay worker chạy riêng, publish Kafka.
   - Không cần split DB để đạt event reliability.

5. **RLS (Row-Level Security) per outlet**:
   - Postgres RLS enforce `outlet_id` filter ở DB level.
   - Lớp bảo vệ thứ 2 ngoài application filter.
   - Giảm risk bug dev quên WHERE clause.

### Khi Nào Mới Split?

Trigger conditions:

- 1 service traffic >10× các service khác → cần scale DB riêng.
- Regulatory requirement tách data (ví dụ auth service lưu EU GDPR riêng).
- Incident lớn blast-radius toàn hệ thống → cần fault domain.
- Team size >30 engineer → ownership conflict cao.
- Polyglot thật sự cần (product search → Elasticsearch, graph relationship → Neo4j).

Hiện không điều kiện nào thoả → **giữ shared**.

## Data Layout Đề Xuất Cho Offline-First POS

```
┌─────────────────────────────────────────────────┐
│ Central Postgres (shared, unchanged)            │
│                                                 │
│ Existing tables + new:                          │
│   core.outbox_event      ← NEW  (V19)           │
│   core.device_registry   ← NEW  (V20)           │
│   payment.state column   ← NEW  (V21)           │
│   core.sync_state        ← NEW  (optional)      │
└─────────────────────────────────────────────────┘
                    │
                    │ REST /sync/push, /sync/pull
                    │
┌─────────────────────────────────────────────────┐
│ Browser POS (IndexedDB via Dexie)               │
│                                                 │
│ ObjectStores:                                   │
│   catalog             (product snapshot)        │
│   prices              (product_price per outlet)│
│   outbox              (pending events)          │
│   pendingOrders       (sale snapshot local)     │
│   sessions            (pos_session cache)       │
│   meta                (cursors, worker_id, ...) │
└─────────────────────────────────────────────────┘
```

**Nguyên tắc**:

- Central giữ nguyên source of truth relational.
- POS local = subset cache + write queue.
- Sync protocol HTTP JSON, không replicate DB → DB.
- Không xài logical replication Postgres → IndexedDB (khác engine).

## Đánh Giá Rủi Ro Giữ Shared DB

| Risk | Mức | Mitigation |
|---|---|---|
| Blast radius incident | Medium | Monitoring + replica failover |
| Schema coupling | Low-Medium | Schema split logical (core→sales/inv/...) từng phần |
| Scaling pressure | Low now | Read replica + partition table khi cần |
| Regulatory | Low | Review khi expand quốc tế |

## Kết Luận

**Giữ shared database**. Cải tiến logical boundary + outbox + read replica đủ đáp ứng offline-first + scale pilot. Đừng split DB vì "microservices phải thế" — đó là premature optimization với rủi ro cao.

## Action Items

| # | Action | Priority |
|---|---|---|
| 1 | Giữ single DB, không split | ✓ |
| 2 | Thêm outbox table `core.outbox_event` (V19) | P0 |
| 3 | Thêm device_registry (V20) | P0 |
| 4 | Fill V13 migration gap | P0 |
| 5 | Read replica cho report-service | P1 |
| 6 | Per-service pool size | P1 |
| 7 | Schema logical split (core → sales/inv/catalog/...) từng bảng khi edit | P2 (long-term) |
| 8 | RLS outlet isolation | P2 |
| 9 | Partition table theo time (sale_record, inventory_transaction) | P3 (khi volume lớn) |
