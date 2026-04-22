# Plan: Revamp `fern_docs-2/` SRS to match current FERN source

## Context

`fern_docs-2/` holds Vietnamese SRS-style use-case docs for 9 ERP modules. Current state:

- 14 use-case files across 9 modules, but **3 modules empty** (IAM, Audit & Traceability, Tham chiếu & Tổ chức — README stubs only).
- Folder/file names use underscore-encoded Vietnamese (`S_n_ph_m__C_ng_th_c_____nh_gi_`) instead of proper UTF-8 — hard to navigate, bad diffing.
- Existing UCs have quality gaps: vague preconditions, missing error flows, sequence diagrams that don't match narrative, no data-dictionary for entities, no actor/permission matrix, no inter-module flows.

Meanwhile the codebase is **far ahead** of the docs:

- Backend: 9 services (`auth`, `audit`, `org`, `product`, `inventory`, `procurement`, `sales`, `hr`, `finance`, `payroll`) — all fully implemented with controllers, entities, Flyway migrations.
- Frontend: 13 domain modules under `frontend/src/components/` matching the 9 backend services, mostly write-enabled.

**Goal:** rewrite `fern_docs-2/` so SRS reflects the *actual implemented system*, is easy to maintain, and fills the missing modules. Treat docs as living source-of-truth for PM/QA/new engineers.

**Out of scope:** translating frontend UI (no i18n yet — noted but deferred).

---

## Guiding principles

1. **Source-first:** each UC must cite concrete controller path + endpoint + table names it describes. No invented flows.
2. **Plain UTF-8 filenames** in Vietnamese, kebab-case with dashes — e.g. `mo-phien-pos.md`. Keep README.md per module.
3. **Consistent template** for every use case (see §Template).
4. **Add missing cross-cutting artifacts:** actor/permission matrix, glossary/data dictionary, state machines.
5. Incremental commits — one module per batch so review stays tractable.

---

## Phase 0 — Scaffolding (prep)

Files to create at `fern_docs-2/`:

- `GLOSSARY.md` — domain terms (Outlet, Region, POS Session, GR, Recipe, Payroll Period, etc.) with backend entity reference.
- `ACTORS.md` — actor/role matrix sourced from `services/auth-service` role + permission seeds (see `db/migrations` files `V*role*.sql` and `V*permission*.sql`).
- `TEMPLATE.md` — canonical UC template (see §Template below).
- Rewrite top-level `README.md` with correct UTF-8 links + short architecture blurb + link to `docs/erp-microservices-architecture.md`.

Rename folders to UTF-8 (use `git mv`):

```
Audit___Traceability     → audit-traceability
B_n_h_ng___POS           → ban-hang-pos
IAM                      → iam
Kho_t_i_outlet           → kho-outlet
Nh_n_s____Ch_m_c_ng      → nhan-su-cham-cong
S_n_ph_m__C_ng_th_c_____nh_gi_  → san-pham-cong-thuc-dinh-gia
T_i_ch_nh___L__ng        → tai-chinh-luong
Tham_chi_u___T__ch_c     → tham-chieu-to-chuc
Thu_mua                  → thu-mua
```

(Update top README links accordingly.)

---

## Template (`TEMPLATE.md`)

```markdown
# UC-<MODULE>-<NNN>: <Tên Use Case>

**Module:** ...
**Mô tả ngắn:** ...
**Phiên bản SRS:** 1.0  | **Source code tham chiếu:** `services/<svc>/...`, `frontend/src/components/<domain>/...`

## 1. Actors & quyền
| Actor | Role code | Permission cần thiết |
|---|---|---|
| ... | ... | ... |

## 2. Điều kiện
- **Tiền điều kiện:**
- **Hậu điều kiện thành công:**
- **Hậu điều kiện thất bại:**

## 3. Thực thể dữ liệu
| Entity | Bảng DB | Service |
|---|---|---|
| ... | ... | ... |

## 4. API endpoints liên quan
| Method | Path | Controller |
|---|---|---|
| POST | /api/v1/... | `XxxController#yyy` |

## 5. Luồng chính (MAIN)
1. ...

## 6. Luồng thay thế / lỗi (ALT / EXC)
- **ALT-1 ...**
- **EXC-1 ...** → mã lỗi, HTTP status

## 7. Quy tắc nghiệp vụ
- BR-1 ...

## 8. State machine (nếu có)
```mermaid
stateDiagram-v2
```

## 9. Sequence diagram
```mermaid
sequenceDiagram
```

## 10. Ghi chú & dependency liên module
- ...
```

---

## Phase 1 — Fix-up modules đã có UC

### 1.1 Bán hàng & POS (`ban-hang-pos/`)
Source: `services/sales-service` + `frontend/src/components/pos/`.

- Rewrite existing `mo-phien-pos.md` — fix sequence diagram (currently `System->>Outlet Manager` for "Đăng nhập", wrong direction).
- **Add:**
  - `tao-don-hang-pos.md` — `SalesController` POST `/api/v1/sales/orders`.
  - `thanh-toan-don-pos.md` — payment capture, multi-method (`payment` table).
  - `huy-don-pos.md` — cancel flow.
  - `dong-phien-pos.md` — reconcile + close.
  - `dat-hang-qua-qr.md` — public QR table ordering (`PublicPosController`, route `/order/:tableToken`).

### 1.2 Thu mua (`thu-mua/`)
Source: `services/procurement-service`.

- Rewrite `ghi-nhan-hang-nhap-gr.md` — define over-receipt threshold, damage flow, link to invoice.
- **Add:**
  - `tao-don-mua-po.md` — `PurchaseOrderController` draft→approved→posted.
  - `quan-ly-nha-cung-cap.md` — `SupplierController`.
  - `hoa-don-ncc.md` — `SupplierInvoiceController` (three-way match PO/GR/Invoice).

### 1.3 Kho tại outlet (`kho-outlet/`)
- Rewrite `kiem-ke-kho-outlet.md` — partial count, multi-user, reconcile stage (`stock_count_session`, `stock_count_line`).
- Rewrite `dieu-chinh-kho.md` — enumerate reason codes (read from `InventoryAdjustment` enum), approval threshold.
- **Add:** `xem-ton-kho.md` (read-only balances), `chuyen-kho-giua-outlet.md` nếu transfer flow có trong code (cần verify).

### 1.4 Sản phẩm, Công thức, Định giá (`san-pham-cong-thuc-dinh-gia/`)
- Rewrite 3 UCs hiện có.
- **Add:** `xuat-ban-menu.md` — `PublishController` (`publish_version`, `publish_item`, channel/daypart).

### 1.5 Nhân sự & Chấm công (`nhan-su-cham-cong/`)
- Fix 3 UCs (add error flows, OT/late).
- **Add:** `ho-so-nhan-vien.md`, `xem-ca-lam-viec.md` (workforce live view).

### 1.6 Tài chính & Lương (`tai-chinh-luong/`)
- Rewrite `thanh-toan-ncc.md` — link to procurement GR/Invoice state.
- **Add:**
  - `chay-bang-luong.md` — `PayrollController` period → timesheet → slip.
  - `dong-ky-tai-chinh.md` — period close (`FinanceModule` "Close" tab).
  - `bao-cao-pnl.md` — P&L report.
  - `quan-ly-chi-phi-van-hanh.md` — `expense_operating/other/payroll/inventory_purchase`.

---

## Phase 2 — Điền 3 module rỗng

### 2.1 IAM (`iam/`)
Source: `services/auth-service` + `frontend/src/components/iam/`.

UCs to write:
- `dang-nhap.md` — JWT + session (`AuthController#login`, `auth_session`).
- `quan-ly-nguoi-dung.md` — CRUD user.
- `phan-quyen-vai-tro.md` — role ↔ permission.
- `gan-scope-outlet-vung.md` — user scope assignment.
- `ghi-de-quyen.md` — permission override (`user_permission`).
- `quan-ly-phien.md` — session browser, force logout.

### 2.2 Audit & Traceability (`audit-traceability/`)
Source: `services/audit-service` + `common/event-schemas`.

- `xem-nhat-ky-audit.md` — `AuditReadController`, filter by actor/entity/action.
- `su-kien-bao-mat.md` — unauthorized attempts.
- `truy-vet-request.md` — request trace view.
- `ghi-audit-log-he-thong.md` — system-side write flow (`AuditController`, `catalog_audit_log`).

### 2.3 Tham chiếu & Tổ chức (`tham-chieu-to-chuc/`)
Source: `services/org-service` + `frontend/src/components/org/`.

- `quan-ly-vung.md` — Region hierarchy CRUD.
- `quan-ly-outlet.md` — Outlet CRUD + lifecycle (active/inactive/closed/archived).
- `cau-hinh-tien-te-ty-gia.md` — currency + `exchange_rate`.
- `cau-hinh-thue.md` — tax setup.
- `cau-hinh-dich-vu.md` — `service_instance`, `service_config_profile`, `service_rollout` (control plane, master-node).

---

## Phase 3 — Cross-cutting artifacts

- `GLOSSARY.md` — từ điển Việt–Anh (Outlet/Cửa hàng, Region/Vùng, GR/Phiếu nhập, etc.) + mapping entity→bảng.
- `ACTORS.md` — ma trận 1 actor × module, mỗi ô = danh sách permission. Source từ seed SQL.
- `INTER-MODULE-FLOWS.md` — các luồng chéo:
  - GR approved → SupplierInvoice demand → Payment.
  - Sales order posted → InventoryTransaction → StockBalance.
  - Shift worked → Timesheet → Payroll → FinanceExpense.
  - Product price change → active publish_version.
- `STATE-MACHINES.md` — diagram PO, GR, Invoice, Payment, POS Session, Payroll Period, Outlet status.

---

## Phase 4 — Verification

- Manual review mỗi UC khi merge: Grep code path references tồn tại (controller tên, table name).
- `ls fern_docs-2/` — tên folder/file đều UTF-8 sạch, không còn underscore-encoded.
- Đi bộ qua frontend bằng browser với checklist từ mỗi UC — flow khớp, không claim chức năng không tồn tại.
- Sanity: `rg -n "TODO|FIXME" fern_docs-2/` rỗng khi hoàn tất.

---

## Critical files để tham chiếu khi viết

Backend controllers (mapping):
- [services/sales-service/...SalesController.java](services/sales-service/)
- [services/procurement-service/...PurchaseOrderController.java](services/procurement-service/)
- [services/inventory-service/...InventoryController.java](services/inventory-service/)
- [services/product-service/...ProductController.java](services/product-service/), `PublishController.java`
- [services/hr-service/...HrController.java](services/hr-service/)
- [services/finance-service/...FinanceController.java](services/finance-service/)
- [services/payroll-service/...PayrollController.java](services/payroll-service/)
- [services/auth-service/...AuthController.java](services/auth-service/)
- [services/audit-service/...AuditReadController.java](services/audit-service/)
- [services/org-service/...OrgController.java](services/org-service/)

Frontend modules: `frontend/src/components/<domain>/*Module.tsx`
API clients: `frontend/src/api/*-api.ts`
DB truth: `db/migrations/V*.sql` + `db/docs/data-dictionary.md`
Existing OpenAPI: `docs/openapi/frontend-surface.json`

---

## Execution order (batches, one PR per batch)

1. **Phase 0 scaffold** — rename folders, add TEMPLATE/GLOSSARY/ACTORS skeletons, rewrite root README.
2. **Phase 1.1 POS** — 1 old + 5 new UCs.
3. **Phase 1.2 Procurement** — 1 old + 3 new.
4. **Phase 1.3 Inventory** — 2 old + 1–2 new.
5. **Phase 1.4 Product** — 3 old + 1 new.
6. **Phase 1.5 HR** — 3 old + 2 new.
7. **Phase 1.6 Finance/Payroll** — 1 old + 4 new.
8. **Phase 2.1 IAM** — 6 UCs.
9. **Phase 2.2 Audit** — 4 UCs.
10. **Phase 2.3 Org/Reference** — 5 UCs.
11. **Phase 3** — cross-cutting docs + state-machines.
12. **Phase 4** — verification pass.
