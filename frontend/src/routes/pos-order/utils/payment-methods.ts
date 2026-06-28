/** Backend `payment_method_enum` values accepted by sales-service. */
export const BACKEND_PAYMENT_METHODS = [
  'cash',
  'card',
  'ewallet',
  'bank_transfer',
  'voucher',
] as const;

export type BackendPaymentMethod = (typeof BACKEND_PAYMENT_METHODS)[number];

export const UI_TO_BACKEND_PAYMENT_METHOD = {
  cash: 'cash',
  card: 'card',
  qr: 'ewallet',
  voucher: 'voucher',
} as const satisfies Record<'cash' | 'card' | 'qr' | 'voucher', BackendPaymentMethod>;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tiền mặt',
  card: 'Thẻ',
  ewallet: 'QR / Ví',
  bank_transfer: 'Chuyển khoản',
  voucher: 'Voucher',
  cheque: 'Séc',
  // Legacy aliases stored before normalization
  qr_code: 'QR / Ví',
  qr: 'QR / Ví',
  'e-wallet': 'Ví điện tử',
  'bank-transfer': 'Chuyển khoản',
};

/** Normalize any stored/UI alias to a backend reconcile key. */
export function normalizePaymentMethod(method: string | null | undefined): BackendPaymentMethod {
  const raw = String(method ?? 'cash').trim().toLowerCase().replace(/-/g, '_');
  switch (raw) {
    case 'cash':
      return 'cash';
    case 'card':
      return 'card';
    case 'ewallet':
    case 'e_wallet':
    case 'qr_code':
    case 'qr':
      return 'ewallet';
    case 'bank_transfer':
    case 'banktransfer':
      return 'bank_transfer';
    case 'voucher':
      return 'voucher';
  }
  return 'cash';
}

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? PAYMENT_METHOD_LABELS[normalizePaymentMethod(method)] ?? method;
}

/** Resolve payment method from list/detail sale payloads. */
export function resolveSalePaymentMethod(order: {
  payment?: { paymentMethod?: string | null } | null;
  paymentMethod?: string | null;
}): BackendPaymentMethod {
  return normalizePaymentMethod(order.payment?.paymentMethod ?? order.paymentMethod);
}
