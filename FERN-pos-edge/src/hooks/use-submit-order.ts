import { useState } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { clearCart } from '@/store/cart.slice'
import { clearPersistedCart } from '@/hooks/use-cart-persist'
import { salesApi } from '@/api/sales-api'
import type { SaleView } from '@/api/types'
import { generateId } from '@/id/snowflake'
import { db } from '@/db/schema'
import { nextStatus, type OrderStatus } from '@/store/order-fsm'
import { evaluateRiskLimits } from '@/store/risk-limits'
import { useSyncStatus } from '@/hooks/use-sync-status'

type SubmitPhase = 'idle' | 'submitting' | 'approving' | 'paying' | 'done' | 'error'

function buildIdemKey(deviceId: string | null, clientSaleId: string, endpoint: 'submit' | 'approve' | 'pay'): string {
  return `pos:${deviceId ?? 'unpaired'}:${clientSaleId}:${endpoint}`
}

async function upsertPending(
  clientSaleId: string,
  endpoint: 'submit' | 'approve' | 'pay',
  idemKey: string,
  payload: unknown,
): Promise<void> {
  const existing = await db.pendingSubmit.get(clientSaleId)
  if (existing && existing.endpoint === endpoint) {
    await db.pendingSubmit.update(clientSaleId, { attempts: existing.attempts + 1 })
    return
  }
  await db.pendingSubmit.put({
    client_sale_id: clientSaleId,
    idem_key: idemKey,
    endpoint,
    payload_json: JSON.stringify(payload),
    created_at_device: Date.now(),
    attempts: 1,
    last_error: null,
  })
}

async function clearPending(clientSaleId: string): Promise<void> {
  await db.pendingSubmit.delete(clientSaleId)
}

function assertServerStatus(serverStatus: string, expected: OrderStatus, event: string): void {
  // Server is authoritative. If it disagrees with our locally-computed FSM step we abort
  // rather than silently advance — the cart-side state machine should never lag behind reality.
  if (serverStatus !== expected) {
    throw new Error(`Server returned status "${serverStatus}" after ${event}, expected "${expected}"`)
  }
}

async function recordError(clientSaleId: string, msg: string): Promise<void> {
  const existing = await db.pendingSubmit.get(clientSaleId)
  if (existing) {
    await db.pendingSubmit.update(clientSaleId, { last_error: msg })
  }
}

export function useSubmitOrder() {
  const dispatch = useAppDispatch()
  const cart = useAppSelector(s => s.cart)
  const auth = useAppSelector(s => s.auth)
  const session = useAppSelector(s => s.session)
  const syncStatus = useSyncStatus()
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [completedSale, setCompletedSale] = useState<SaleView | null>(null)

  async function submitOrder(cashAmountPaid: number) {
    if (!auth.outletId || cart.items.length === 0) return
    // Defense in depth: UI disables the submit button when limits breach, but a manual
    // call (devtools / hotkey) could bypass that. Re-check here before allocating IDs.
    const risk = evaluateRiskLimits({
      pendingCount: syncStatus.offlineRisk.pendingSaleCount,
      pendingTotalCents: syncStatus.offlineRisk.pendingSaleTotalCents,
      offlineMinutes: syncStatus.offlineRisk.offlineMinutes,
      pendingInventoryMovementCount: syncStatus.inventoryMovements.pending + syncStatus.inventoryMovements.syncing,
      inventoryNeedsReviewCount: syncStatus.inventoryMovements.needsReview,
      failedOutboxCount: syncStatus.outboxFailed,
    })
    if (risk.blocked) {
      setError(risk.reason ?? 'Vượt ngưỡng ngoại tuyến')
      setPhase('error')
      return
    }
    setPhase('submitting')
    setError(null)

    const clientSaleId = generateId()
    const deviceId = session.deviceId
    const submitKey = buildIdemKey(deviceId, clientSaleId, 'submit')
    const approveKey = buildIdemKey(deviceId, clientSaleId, 'approve')
    const payKey = buildIdemKey(deviceId, clientSaleId, 'pay')

    const submitBody = {
      outletId: auth.outletId,
      posSessionId: session.current?.id,
      currencyCode: 'VND',
      orderType: 'pos',
      note: cart.note || undefined,
      clientSaleId,
      items: cart.items.map(i => ({
        productId: i.product_id,
        variantId: i.variant_id ?? undefined,
        modifierOptionIds: i.modifier_option_ids ?? [],
        quantity: i.qty,
        discountAmount: (i.discount_cents / 100).toFixed(2),
        note: i.note ?? undefined,
      })),
    }

    try {
      let serverStatus: OrderStatus = 'draft'
      await upsertPending(clientSaleId, 'submit', submitKey, submitBody)
      const { data: submitted } = await salesApi.submitSale(submitBody, submitKey)
      serverStatus = nextStatus(serverStatus, 'submit')
      assertServerStatus(submitted.status, serverStatus, 'submit')
      const saleId = submitted.id

      setPhase('approving')
      await upsertPending(clientSaleId, 'approve', approveKey, { saleId })
      const { data: approved } = await salesApi.approveSale(saleId, approveKey)
      serverStatus = nextStatus(serverStatus, 'approve')
      assertServerStatus(approved.status, serverStatus, 'approve')
      const amountDue = Number.parseFloat(approved.totalAmount)
      if (!Number.isFinite(amountDue)) {
        throw new Error('Không xác định được tổng thanh toán cuối cùng')
      }
      if (cashAmountPaid < amountDue) {
        throw new Error(`Khách đưa chưa đủ. Cần ${amountDue.toFixed(0)} VND.`)
      }

      setPhase('paying')
      const payBody = {
        paymentMethod: 'cash',
        amount: amountDue.toFixed(2),
        transactionRef: cashAmountPaid > amountDue
          ? `change:${(cashAmountPaid - amountDue).toFixed(0)}`
          : undefined,
      }
      await upsertPending(clientSaleId, 'pay', payKey, { saleId, ...payBody })
      const { data: paid } = await salesApi.markPaymentDone(saleId, payBody, payKey)
      serverStatus = nextStatus(serverStatus, 'pay')
      assertServerStatus(paid.status, serverStatus, 'pay')

      await clearPending(clientSaleId)
      setCompletedSale(paid)
      setPhase('done')
      dispatch(clearCart())
      clearPersistedCart()
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? 'Lỗi tạo đơn hàng'
      // 4xx = client mistake (bad input, forbidden outlet, conflict). Retry won't help —
      // drop the pending row so cart state isn't pinned to a broken submit.
      // 5xx / network error = transient. Keep the pending row + idem key so a manual retry
      // hits the same server-side cache and can't dup the order.
      const isRetryable = status == null || status >= 500
      if (isRetryable) {
        await recordError(clientSaleId, msg)
      } else {
        await clearPending(clientSaleId)
      }
      setError(isRetryable ? `${msg} (có thể thử lại)` : msg)
      setPhase('error')
    }
  }

  function reset() {
    setPhase('idle')
    setError(null)
    setCompletedSale(null)
  }

  return { phase, error, completedSale, submitOrder, reset }
}
