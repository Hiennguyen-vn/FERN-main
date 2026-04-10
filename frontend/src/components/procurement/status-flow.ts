function normalizeStatus(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function isAnyOf(status: string | null | undefined, allowed: readonly string[]) {
  return allowed.includes(normalizeStatus(status));
}

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'ordered',
  'partially_received',
  'completed',
  'closed',
  'cancelled',
] as const;

export const GOODS_RECEIPT_STATUSES = [
  'draft',
  'received',
  'posted',
  'cancelled',
] as const;

export const SUPPLIER_INVOICE_STATUSES = [
  'draft',
  'received',
  'matched',
  'approved',
  'posted',
  'disputed',
  'cancelled',
] as const;

export const SUPPLIER_PAYMENT_STATUSES = [
  'pending',
  'posted',
  'cancelled',
  'reversed',
] as const;

export function canApprovePurchaseOrder(status: string | null | undefined) {
  return isAnyOf(status, ['draft', 'submitted']);
}

export function canCreateGoodsReceiptFromPurchaseOrder(status: string | null | undefined) {
  return isAnyOf(status, ['approved', 'ordered', 'partially_received']);
}

export function canApproveGoodsReceipt(status: string | null | undefined) {
  return isAnyOf(status, ['draft']);
}

export function canPostGoodsReceipt(status: string | null | undefined) {
  return isAnyOf(status, ['received']);
}

export function canCreateInvoiceFromGoodsReceipt(status: string | null | undefined) {
  return isAnyOf(status, ['posted']);
}

export function canApproveSupplierInvoice(status: string | null | undefined) {
  return isAnyOf(status, ['draft', 'received', 'matched']);
}

export function canCreatePaymentFromInvoice(status: string | null | undefined) {
  return isAnyOf(status, ['approved', 'posted']);
}

export function canPostSupplierPayment(status: string | null | undefined) {
  return isAnyOf(status, ['pending']);
}

export function canCancelSupplierPayment(status: string | null | undefined) {
  return isAnyOf(status, ['pending']);
}

export function canReverseSupplierPayment(status: string | null | undefined) {
  return isAnyOf(status, ['posted']);
}
