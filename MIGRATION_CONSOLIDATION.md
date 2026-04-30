# Migration Consolidation Analysis

**Tổng:** 60 migrations (V1-V60). Nhiều migration nhỏ là patch/fix lẫn nhau — có thể gộp khi rebase baseline.

## Nguyên tắc

**Không gộp migration đã apply trên prod** — checksum mismatch sẽ break Flyway. Chỉ áp dụng:

1. **Squash baseline** — khi rebuild dev/staging từ scratch, gộp V1-V60 thành V1__baseline_squash.sql duy nhất. Đặt `flyway.baselineVersion=1` cho prod đã chạy.
2. **Future migrations** — hợp nhất các change cùng feature vào 1 file thay vì rải rắc.

## Nhóm có thể gộp (dev squash)

### Nhóm 1: Outbox lifecycle (5 file → 1)

| File | Nội dung |
|---|---|
| V19 | CREATE TABLE outbox_event + 3 partition 2026-05..07 |
| V30 | DLQ view + replay function |
| V35 | ADD COLUMN dlq_status |
| V43 | Bootstrap thêm partition 2026-04 + 08-12 |
| V44 | ALTER dlq_status check constraint |

→ **V19_outbox.sql** (gộp tất cả). Tiết kiệm 4 file, 1 migration step.

### Nhóm 2: Partman + partition (4 file → 1)

| File | Nội dung |
|---|---|
| V23 | pg_partman_setup |
| V24 | partition_sales |
| V25 | partition_inventory |
| V26 | partition_audit |
| V26_5 | pg_partman_setup (duplicate?) |
| V34 | partman_default_table_flag |

→ **V23_partitioning.sql**. V26_5 là **fixup version** — dấu hiệu rebase baseline cần thiết. Gộp loại bỏ.

### Nhóm 3: Stock-in + trigger restore (4 file → 1)

| File | Nội dung |
|---|---|
| V8  | fix_stock_balance_delta_guard |
| V10 | simulator_cleanup_stock_sync_guard |
| V45 | stock_in_simple_enum |
| V46 | offline_stock_in_movement |
| V47 | restore_inventory_stock_balance_trigger |
| V48 | offline_waste_movement |

→ **V8_stock_movement.sql**. V47 "restore trigger" = sign of churn — trigger được drop rồi add lại nhiều lần. Indicator V1 trigger should have been right initially.

### Nhóm 4: POS session lifecycle (3 file → 1)

| File | Nội dung |
|---|---|
| V11 | pos_session_reconciliation |
| V36 | pos_oversell_flag |
| V49 | pos_session_multi_terminal (relax UNIQUE) |

→ **V11_pos_session_full.sql**.

### Nhóm 5: Catalog + governance (4 file → 1)

| File | Nội dung |
|---|---|
| V14 | catalog_menu_channel_daypart |
| V15 | catalog_publish_and_audit |
| V16 | product_variants_modifiers |
| V18 | region_manager_catalog_governance |

→ **V14_catalog_full.sql**.

### Nhóm 6: Promotion (2 file → 1)

| File | Nội dung |
|---|---|
| V50 | promotion_bxgy_rule |
| V51 | promotion_combo_subsidy_rules |

→ **V50_promotion_rules.sql**.

### Nhóm 7: Idempotency + processed events (2 file → 1)

| File | Nội dung |
|---|---|
| V28 | idempotency_offline_extensions |
| V29 | processed_events |

→ **V28_idempotency_full.sql**.

### Nhóm 8: Sprint 1-3 (sprints này tự thân — đã apply, KHÔNG gộp)

V54-V60 nên giữ riêng vì:
- Mỗi V là 1 P0 feature riêng — dễ debug + revert
- Đã được apply lên DB demo + tests reference theo version
- Kích thước hợp lý

## Migration "smell" cần fix tận gốc

| Migration | Vấn đề | Fix root cause |
|---|---|---|
| V26_5 | Suffix `_5` = retroactive fix, vi phạm Flyway monotonic | Squash → V23 |
| V42 | `ADD CONSTRAINT PRIMARY KEY` không idempotent → block partial-state DB | Dùng `DO $$ IF NOT EXISTS` |
| V47 | "restore trigger" lặp lại V8 → trigger bị drop rồi add lại | Fix V1 trigger gốc |
| V52 | "restore_public_order_columns_after_partition" → V24 partition đã drop columns | Fix V24 partition logic |

## Đề xuất

**Giai đoạn pre-production (trước go-live store đầu tiên):**

1. **Squash baseline V1-V60 → V1_baseline.sql** (~3000 dòng). Áp dụng schema-dump qua `pg_dump --schema-only --no-privileges --no-owner`. Test bằng `flyway baseline -baselineVersion=1`.
2. **Sửa các smell** (V26_5, V42 idempotent, V47 root cause).
3. **Tài liệu hóa baseline date** trong `db/migrations/README.md`.
4. **Tests:** chạy lại 168 tests trên squashed baseline để verify không lỗi.

**Sau go-live:**

- Không squash. Mỗi sprint thêm V61, V62... mới.
- Áp dụng quy ước: 1 feature = 1 migration. Đặt tên `V{n}__{module}_{description}.sql`.
- Cứ 6 tháng đánh giá lại có nên rebase baseline không (sau >100 migrations).

## Tóm tắt số học

- **Hiện tại:** 60 migrations (54 trước Sprint 1-3 + 6 mới + V60)
- **Nếu squash dev:** ~ 30 migrations (giảm 50%)
  - 1 baseline (V1)
  - 7 sprint-specific (V54-V60)
  - Phần còn lại = patches sau go-live
- **Time to apply fresh:** 1.5s hiện tại → ~0.4s sau squash (1 large script vs 60 small)

## Risk consolidation

- ⚠️ **Checksum mismatch** với DB đang apply V40 (production-like). Cần `baseline + repair` flow.
- ⚠️ **Lost commit history** — squash che mờ ai sửa gì khi nào. Mitigate: archive `db/migrations/.archived/` chứa file gốc.
- ⚠️ **Test fixtures** có thể giả sử trạng thái trung gian (V20, V30...) — kiểm tra `TestFixtures.seedBaseline` không phụ thuộc into-flight migrations.

## Khuyến nghị

**KHÔNG gộp ngay.** Sprint 1-3 vừa apply, DB demo OK. Squash baseline = công việc 1-2 ngày, nên làm khi:

1. Sau khi Sprint 4-6 xong (channel + payment + pilot)
2. Trước khi rollout store đầu tiên (sạch baseline cho tất cả prod store)
3. Đồng thời với chuyển sang Helm/Terraform (paired infrastructure refresh)
