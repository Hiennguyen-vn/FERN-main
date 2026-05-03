import { http } from './http'
import type {
  SubmitSaleRequest,
  SaleView,
  MarkPaymentDoneRequest,
  PosSessionView,
  OpenPosSessionRequest,
} from './types'

function idemHeaders(key?: string) {
  return key ? { headers: { 'Idempotency-Key': key } } : undefined
}

export const salesApi = {
  openSession: (body: OpenPosSessionRequest) =>
    http.post<PosSessionView>('/sales/pos-sessions', body),

  closeSession: (sessionId: string, body?: { closingCash?: string; note?: string }) =>
    http.post<PosSessionView>(`/sales/pos-sessions/${sessionId}/close`, body ?? {}),

  submitSale: (body: SubmitSaleRequest, idempotencyKey?: string) =>
    http.post<SaleView>('/sales/orders', body, idemHeaders(idempotencyKey)),

  approveSale: (saleId: string, idempotencyKey?: string) =>
    http.post<SaleView>(`/sales/orders/${saleId}/approve`, undefined, idemHeaders(idempotencyKey)),

  markPaymentDone: (saleId: string, body: MarkPaymentDoneRequest, idempotencyKey?: string) =>
    http.post<SaleView>(`/sales/orders/${saleId}/mark-payment-done`, body, idemHeaders(idempotencyKey)),

  cancelSale: (saleId: string, reason?: string) =>
    http.post<SaleView>(`/sales/orders/${saleId}/cancel`, { reason }),
}
