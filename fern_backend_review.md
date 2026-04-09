# 🌿 Nhận Xét Backend: FERN F&B Platform
> **Vai trò:** Chuyên gia kiến trúc phần mềm & kỹ thuật backend  
> **Phạm vi:** Toàn bộ backend — kiến trúc, code quality, DB, bảo mật, ops  
> **Phiên bản:** Spring Boot `3.5.12` · Java `21` · PostgreSQL `16` · Kafka `3.9.1`

---

## 1. 📐 Tổng Quan Kiến Trúc

FERN được xây dựng theo mô hình **Microservices trên Spring Boot**, phục vụ ngành F&B đa chi nhánh. Dự án có **12 service** độc lập, chia thành:

| Nhóm | Services |
|---|---|
| **Platform / Cross-cutting** | `master-node`, `gateway`, `auth-service`, `audit-service` |
| **Operational Core** | `org-service`, `sales-service`, `inventory-service`, `procurement-service`, `product-service` |
| **Business Support** | `hr-service`, `payroll-service`, `finance-service`, `report-service` |

**Nhận xét:** Cấu trúc phân tầng **rất hợp lý** và thể hiện sự hiểu biết sâu về domain F&B. Sự tách biệt giữa core operations và business support là điểm mạnh đáng ghi nhận.

---

## 2. ✅ Điểm Mạnh (Production-Grade Strengths)

### 2.1 · Kiến Trúc Dữ Liệu — Xuất Sắc

Toàn bộ schema nằm trong 1 file `V1__core_schema.sql` (~1800 dòng) với thiết kế **rất kỹ lưỡng**:
- **Closure Table** cho `region` hierarchy — giải pháp chuẩn cho cây phân cấp đệ quy
- **Enum types** được định nghĩa đầy đủ (25+ enum), kiểm soát chặt domain data
- **DB-level constraints** thực thi business rules ngay tại tầng lưu trữ:
  - `chk_outlet_closed_after_opened` — tránh ngày đóng cửa trước ngày mở
  - `check_supplier_invoice_has_receipts` — đảm bảo invoice phải có GR
  - `check_supplier_payment_allocations` — tổng thanh toán không vượt quá invoice
- **Trigger `sync_stock_balance`** — cập nhật tồn kho real-time, atomically

```sql
-- Ví dụ điểm mạnh: check ràng buộc thanh toán ngay tại DB
CREATE OR REPLACE FUNCTION core.check_supplier_payment_allocations()
-- Tổng allocations không được > payment.amount và > invoice.total_amount
```

> [!TIP]
> Việc đặt constraints ở DB layer thay vì chỉ ở application layer là practices cấp senior — bảo vệ dữ liệu kể cả khi có bug ở tầng trên.

### 2.2 · Scope-Based Authorization — Production-Ready

Hệ thống phân quyền theo **outlet scope** được implement nhất quán trên toàn bộ service:

```java
// Pattern được lặp lại chính xác ở MỌI service (SalesService, InventoryService...)
private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || ...) { return ... }
    if (!context.outletIds().contains(requestedOutletId)) {
        throw ServiceException.forbidden("... denied for outlet " + outletId);
    }
    return Set.of(requestedOutletId);
}
```

JWT chứa `scopeRoots` → `ScopeExpansionService` resolve toàn bộ outlets con → Redis version-cache cho hiệu năng. Đây là pattern **cần thiết** cho F&B chain management — ngăn cashier outlet A nhìn dữ liệu outlet B.

### 2.3 · Event-Driven Reliability — Outbox + Inbox Pattern

Luồng `Sales → Inventory` không dùng distributed transaction, thay bằng:

```
[SalesService] → markPaymentDone()
    └─► publish "fern.sales.sale-completed" (Kafka)
         └─► [InventoryEventConsumer]
               └─► IdempotencyGuard.execute(eventId, ...)
                     └─► inventoryService.applySaleCompleted()
```

- **Outbox Pattern**: Event ghi vào local DB trong cùng transaction với business data
- **IdempotencyGuard**: Event consumer bảo vệ khỏi duplicate processing
- **Kafka topic naming**: Nhất quán `fern.{domain}.{event}` — dễ trace và monitor

### 2.4 · Multi-Level Pricing Resolution — Domain Sophistication

`CatalogResolutionService` resolve giá theo thứ tự ưu tiên:
```
OUTLET (0) > REGION (1) > COUNTRY (2) > GLOBAL (3)
```
Phù hợp hoàn toàn với thực tế F&B chain — chi nhánh VIP có thể có giá riêng.

### 2.5 · Audit Trail hoàn chỉnh

`audit-service` bắt 3 loại sự kiện riêng biệt:
- `AuditLogView` — thay đổi data (oldData/newData dạng JsonNode)
- `SecurityEventView` — login/logout/vi phạm bảo mật
- `TraceView` — HTTP request tracing với correlationId, durationMs

Đây là mức độ audit **enterprise-grade**, thường chỉ thấy trong phần mềm thương mại lớn.

### 2.6 · Business Date Concept — F&B Domain Fit

Hệ thống sử dụng `business_date` song song với timestamp thực — điều này cực kỳ quan trọng cho F&B vì ca làm việc có thể qua đêm (23h → 2h sáng vẫn là cùng một ngày kinh doanh).

### 2.7 · Infrastructure chuẩn

`docker-compose.yml` tích hợp:
- **PostgreSQL Primary + Replica** — HA cho production, `report-service` đọc từ replica
- **Redis** — caching scope expansion
- **Kafka KRaft** (không cần ZooKeeper)
- **Prometheus + Grafana** — monitoring đầy đủ
- **Flyway** — database versioning

---

## 3. ⚠️ Điểm Yếu & Rủi Ro Kỹ Thuật

### 3.1 · Mixed Package Namespace — `com.dorabets` vs `com.fern`

> [!WARNING]
> Đây là vấn đề **nghiêm trọng nhất** về kỹ thuật.

```java
// Trong InventoryService.java — lớp production code
import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.events.inventory.StockLowThresholdEvent;
```

Code mix **3 namespace khác nhau** (`com.dorabets`, `com.natsu`, `com.fern`). Đây cho thấy phần lớn `common` libraries đến từ các repo/artifact bên ngoài không thuộc dự án này — gây rủi ro về:
- **Dependency lock-in**: Không kiểm soát được source code của dependencies mấu chốt
- **Version hell**: Khi cần update, toàn bộ service bị ảnh hưởng
- **Onboarding friction**: Developer mới không rõ code nào là "của mình"

### 3.2 · Kafka Error Handling — Không Có Dead Letter Queue

```java
// InventoryEventConsumer.java
} catch (Exception ex) {
    throw new IllegalStateException("Failed to process fern.sales.sale-completed", ex);
}
```

Khi gặp lỗi, consumer **re-throw exception** dưới dạng `IllegalStateException`. Điều này khiến Kafka consumer **bị block vô thời hạn** — một malformed event có thể **treo toàn bộ inventory processing**. Hệ thống cần:
- `@RetryableTopic` với backoff policy
- Dead Letter Topic (`fern.sales.sale-completed.DLT`)
- Alert khi DLT có message

### 3.3 · In-Memory Filtering trong Catalog Resolution

Đã được ghi nhận trong KI nhưng vẫn chưa fix: `resolveMenu()` load **toàn bộ** `ProductOutletAvailability` records rồi filter in-memory. Với menu 500+ SKU × nhiều outlet → performance sẽ suy giảm nghiêm trọng.

### 3.4 · Test Coverage Rất Thấp — 20/110 = ~18%

```
Tổng file Java trong services: 110
File Test: 20 (~18%)
```

Không có test nào cho:
- `InventoryService` (chỉ có `InventoryEventConsumerTest`)
- `SalesRepository` (critical path)
- Tích hợp giữa POS → Inventory reservation

> [!CAUTION]
> 18% test coverage cho một hệ thống xử lý giao dịch tài chính là **không đủ an toàn** cho production.

### 3.5 · Không Có API Versioning

```java
// Trong controller
@GetMapping("/outlets/{outletId}/stock-balances")
```

Chưa có versioning (`/v1/`, `/v2/`). Khi client cần update mà API thay đổi, sẽ không có backward compatibility.

### 3.6 · Report Service — Chỉ Có 4 Endpoint Cơ Bản

`ReportService.java` chỉ có:
- `salesSummary` 
- `expenseSummary`
- `inventoryMovementSummary`
- `lowStock`

Không có: daily P&L, top-selling items, staff performance, shift revenue, cross-outlet comparison. Đây là gap lớn cho một hệ thống F&B management.

### 3.7 · Thiếu Circuit Breaker

Giao tiếp service-to-service dùng HTTP REST thuần, không có Resilience4j / Hystrix. Nếu `org-service` down → tất cả service cần check permission sẽ bị cascade failure.

### 3.8 · Một POS Session Duy Nhất Mỗi Outlet

DB constraint `UNIQUE(outlet_id, business_date)` trên `pos_session` ngăn nhiều quầy thanh toán mở đồng thời trong cùng một outlet — không thực tế với F&B lớn.

---

## 4. 🏗️ Đánh Giá Theo Từng Tầng

### Tầng API Design
| Tiêu chí | Đánh giá |
|---|---|
| RESTful naming | ✅ Chuẩn (`/outlets/{id}/stock-balances`) |
| Phân trang | ✅ `PagedResult` với limit/offset |
| API versioning | ❌ Không có |
| Error format | ✅ `ServiceException` chuẩn hóa |
| Idempotency | ✅ Idempotency-Key header |

### Tầng Application (Business Logic)
| Tiêu chí | Đánh giá |
|---|---|
| Layered Architecture | ✅ `api / application / infrastructure` |
| Dependency Injection | ✅ Constructor injection (không dùng `@Autowired`) |
| Clock injection | ✅ `Clock clock` — testable |
| Transaction management | ✅ `@Transactional` đúng chỗ |

### Tầng Database
| Tiêu chí | Đánh giá |
|---|---|
| Schema versioning | ✅ Flyway |
| Index strategy | ✅ Có index cho FK, search columns |
| Constraint enforcement | ✅ DB-level triggers & check constraints |
| Multi-schema | ✅ `core` schema + cô lập tốt |
| Stored procedures | ✅ `apply_stock_delta()` dùng UPSERT |

### Tầng Messaging (Kafka)
| Tiêu chí | Đánh giá |
|---|---|
| Topic naming | ✅ `fern.{domain}.{event}` |
| Event schema | ✅ `EventEnvelope<T>` wrapper |
| Idempotency | ✅ `IdempotencyGuard` |
| DLQ / Retry | ❌ Không có |
| Schema registry | ❌ Không có (dùng raw JSON) |

### Tầng Bảo Mật
| Tiêu chí | Đánh giá |
|---|---|
| JWT Authentication | ✅ |
| Scope-based Authorization | ✅ Outlet-level |
| Service-to-service auth | ✅ `INTERNAL_SERVICE_TOKEN` |
| Rate limiting | ❓ Không rõ (ở gateway) |
| Input validation | ⚠️ Cần kiểm tra thêm |

---

## 5. 📊 Tóm Tắt Điểm Số

| Tiêu Chí | Điểm | Ghi Chú |
|---|---|---|
| **Kiến trúc tổng thể** | 8.5/10 | Microservices đúng granularity |
| **Database design** | 9/10 | Schema design rất mature |
| **Security model** | 8/10 | Scope-based auth tốt |
| **Event-driven design** | 7.5/10 | Có Outbox/Inbox, thiếu DLQ |
| **Code quality** | 7/10 | Clean, nhưng namespace hỗn độn |
| **Test coverage** | 3/10 | 18% — quá thấp |
| **Observability** | 8/10 | Prometheus + Audit trail đầy đủ |
| **Production readiness** | 6.5/10 | Missing: DLQ, circuit breaker, API versioning |
| **📦 Tổng điểm** | **7.2/10** | Nền tảng tốt, cần hoàn thiện thêm |

---

## 6. 🛣️ Roadmap Cải Thiện (Ưu tiên cao → thấp)

### 🔴 Ưu tiên 1 — Blocking Issues
1. **Dead Letter Queue** cho tất cả Kafka consumer (tránh consumer bị treo)
2. **Test coverage lên ≥60%** — tập trung vào `SalesService`, `InventoryService`
3. **Thống nhất namespace** — migrate `com.dorabets.*` → `com.fern.common.*`

### 🟡 Ưu tiên 2 — Production Hardening
4. **Circuit Breaker** (Resilience4j) cho HTTP service-to-service calls
5. **API Versioning** `/v1/` prefix
6. **Fix in-memory catalog filtering** → push filter xuống SQL query

### 🟢 Ưu tiên 3 — Business Completeness
7. **Multi-terminal POS** — thay `UNIQUE(outlet_id, business_date)` bằng `UNIQUE(outlet_id, terminal_id, business_date)`
8. **Report Service** — thêm P&L, top products, shift analytics
9. **Inter-branch stock transfer**
10. **Promotion engine** — thay thế discount hardcode = 0

---

## 7. 💬 Kết Luận Tổng Quan

**FERN là một dự án được thiết kế với tư duy kiến trúc tốt**, vượt xa mức "tutorial project" thông thường. Tác giả hiểu rõ F&B domain, áp dụng các pattern tiên tiến (Outbox, Idempotency, Scope-based Auth, Closure Table) mà nhiều team lâu năm còn không implement được.

**Điểm nổi bật nhất**: Database schema design + scope-based authorization là 2 thứ khó làm đúng nhất trong hệ thống F&B multi-outlet, và FERN làm tốt cả hai.

**Điểm cần chú ý nhất**: Hệ thống xử lý tiền nhưng test coverage chỉ ~18% và thiếu DLQ — đây là rủi ro không thể chấp nhận trong môi trường production. Priority #1 phải là hardening reliability layer.

> Nhìn tổng thể, đây là backbone của một sản phẩm **có thể thương mại hóa được**, cần khoảng 2–3 sprint bổ sung để đạt production readiness thực sự.
