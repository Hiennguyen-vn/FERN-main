# UC-ORG-005: Cấu hình dịch vụ & rollout (control plane)

**Module:** Tham chiếu & Tổ chức (control plane)
**Mô tả ngắn:** Quản lý `service_instance`, `service_config_profile`, `service_rollout` qua master-node.
**Phiên bản SRS:** 1.0
**Source code tham chiếu:**

- Backend: `services/master-node`
- DB: `V3__service_control_plane_and_idempotency.sql`

## 1. Actors & quyền

| Actor | Role |
|-------|------|
| Superadmin | `superadmin` |
| DevOps | (role riêng nếu có) |

## 2. Thực thể dữ liệu

| Entity | Bảng |
|--------|------|
| Service Instance | `service_instance` |
| Config Profile | `service_config_profile` |
| Rollout | `service_rollout` |

## 3. Luồng chính (MAIN)

1. Tạo config profile mới với version.
2. Attach rollout cho service + scope (percent, region).
3. Master-node propagate config về service instance khi heartbeat.

## 4. Quy tắc nghiệp vụ

- **BR-1** — Rollout percent 0..100.
- **BR-2** — Rollback = activate profile version cũ.
- **BR-3** — Không ghi đè config đang ACTIVE trong phiên rollout chưa hoàn.

## 5. Ghi chú

- Endpoint cụ thể thuộc master-node (xác nhận khi tích hợp).
- Audit: `org.service_rollout.*`.
