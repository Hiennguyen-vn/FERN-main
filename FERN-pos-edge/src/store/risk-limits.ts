/**
 * Pure offline-risk evaluator.
 *
 * Hard guardrails that prevent submit when the device drifts too far from central:
 * too many unsynced orders, too much unsynced cash, or too long since the last
 * successful upstream pull. Pilot is cash-only so card/PSP risk is moot, but cash
 * accumulation on a stuck device is still real liability.
 *
 * Pure module — no Dexie / Redux access. Caller hands in current metrics + config and
 * gets back a verdict. Easy unit-testable; reuse from submit hook + UI selectors.
 */

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxOrders: 20,
  maxTotalCents: 20_000_000,  // 200,000 VND aggregated
  maxHours: 4,
  maxInventoryMovements: 50,
}

export type RiskConfig = {
  maxOrders: number
  maxTotalCents: number
  maxHours: number
  maxInventoryMovements: number
}

export type RiskInput = {
  pendingCount: number | null | undefined
  pendingTotalCents: number | null | undefined
  offlineMinutes: number | null | undefined
  pendingInventoryMovementCount?: number | null
  inventoryNeedsReviewCount?: number | null
  failedOutboxCount?: number | null
}

export type RiskCode = 'orders' | 'total' | 'duration' | 'inventory_movements' | 'inventory_review' | 'outbox_failed'

export type RiskVerdict = {
  blocked: boolean
  code: RiskCode | null
  reason: string | null
}

export function evaluateRiskLimits(input: RiskInput, config: RiskConfig = DEFAULT_RISK_CONFIG): RiskVerdict {
  const count = input.pendingCount ?? 0
  const total = input.pendingTotalCents ?? 0
  const minutes = input.offlineMinutes ?? 0
  const pendingInventory = input.pendingInventoryMovementCount ?? 0
  const inventoryNeedsReview = input.inventoryNeedsReviewCount ?? 0
  const failedOutbox = input.failedOutboxCount ?? 0

  if (failedOutbox > 0) {
    return {
      blocked: true,
      code: 'outbox_failed',
      reason: `Có ${failedOutbox} event sync đang lỗi. Mở Sync Center để retry hoặc xử lý trước khi bán tiếp.`,
    }
  }
  if (inventoryNeedsReview > 0) {
    return {
      blocked: true,
      code: 'inventory_review',
      reason: `Có ${inventoryNeedsReview} movement tồn kho cần xử lý trong Sync Center trước khi tiếp tục bán.`,
    }
  }
  if (pendingInventory > config.maxInventoryMovements) {
    return {
      blocked: true,
      code: 'inventory_movements',
      reason: `Quá nhiều movement tồn kho chưa đồng bộ (${pendingInventory}/${config.maxInventoryMovements}). Cần đồng bộ trước khi bán tiếp.`,
    }
  }
  if (count > config.maxOrders) {
    return {
      blocked: true,
      code: 'orders',
      reason: `Quá nhiều đơn chưa đồng bộ (${count}/${config.maxOrders}). Cần kết nối mạng để đồng bộ trước khi tạo đơn mới.`,
    }
  }
  if (total > config.maxTotalCents) {
    return {
      blocked: true,
      code: 'total',
      reason: `Tổng tiền chưa đồng bộ vượt ngưỡng (${formatVND(total)}/${formatVND(config.maxTotalCents)}). Cần kết nối mạng để đồng bộ.`,
    }
  }
  if (minutes > config.maxHours * 60) {
    const h = Math.floor(minutes / 60)
    return {
      blocked: true,
      code: 'duration',
      reason: `Đã ngoại tuyến ${h} giờ (giới hạn ${config.maxHours} giờ). Cần kết nối mạng để tiếp tục bán.`,
    }
  }
  return { blocked: false, code: null, reason: null }
}

function formatVND(cents: number): string {
  // 1 VND = 1 cent in this codebase (no fractional currency).
  return `${cents.toLocaleString('vi-VN')} VND`
}
