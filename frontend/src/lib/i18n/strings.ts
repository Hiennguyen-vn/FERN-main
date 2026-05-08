/**
 * Lightweight string registry for customer-facing UI surfaces (POS, public order).
 * Internal admin screens stay English-only for now.
 *
 * Usage:
 *   import { t } from '@/lib/i18n';
 *   t('pos.cart.empty')
 *
 * Adding a key:
 * 1. Add to STRINGS map below with both `vi` and `en` entries.
 * 2. Reference via t('namespace.key') at the call site.
 *
 * Locale resolution (LocaleProvider): URL ?lang= → localStorage → outlet locale → 'vi'.
 */

export type Locale = 'vi' | 'en';

export const STRINGS: Record<string, Record<Locale, string>> = {
  // POS — Order Entry
  'pos.cart.empty': { vi: 'Chưa có món', en: 'No items added' },
  'pos.cart.empty.hint': { vi: 'Chọn món để thêm vào order', en: 'Tap a product to add it to the order' },
  'pos.cart.title': { vi: 'Đơn hiện tại', en: 'Current Order' },
  'pos.cart.items': { vi: 'món', en: 'items' },
  'pos.cart.subtotal': { vi: 'Tạm tính', en: 'Subtotal' },
  'pos.cart.tax': { vi: 'Thuế', en: 'Tax' },
  'pos.cart.discount': { vi: 'Giảm giá', en: 'Discount' },
  'pos.cart.total': { vi: 'Tổng', en: 'Total' },
  'pos.cart.checkout': { vi: 'Thanh toán', en: 'Proceed to Payment' },
  'pos.cart.checkout.severe': { vi: 'Có dị ứng nghiêm trọng — kiểm tra lại', en: 'Severe allergy detected — review' },
  'pos.search.products': { vi: 'Tìm món…', en: 'Search products…' },
  'pos.promo.placeholder': { vi: 'Mã khuyến mãi', en: 'Promo code' },
  'pos.promo.apply': { vi: 'Áp dụng', en: 'Apply' },
  'pos.product.unavailable': { vi: "86'd / hết hàng", en: "86'd / out of stock" },
  'pos.customer.add': { vi: 'Khách', en: 'Customer' },
  'pos.customer.search': { vi: 'Tìm khách theo tên hoặc số điện thoại…', en: 'Search customer by name or phone…' },
  'pos.customer.allergies.suffix': { vi: 'dị ứng', en: 'allergies' },
  'pos.allergy.warning': { vi: '⚠ Cảnh báo dị ứng', en: '⚠ Allergy warning' },

  // POS — Cancel Order
  'pos.cancel.title': { vi: 'Hủy đơn', en: 'Cancel Order' },
  'pos.cancel.reason': { vi: 'Lý do hủy', en: 'Cancellation reason' },
  'pos.cancel.note': { vi: 'Ghi chú thêm (tùy chọn)', en: 'Additional note (optional)' },
  'pos.cancel.manager_pin': { vi: 'PIN manager', en: 'Manager PIN' },
  'pos.cancel.confirm': { vi: 'Hủy order', en: 'Cancel Order' },
  'pos.cancel.cannot': { vi: 'Không thể hủy đơn này', en: 'Cannot cancel this order' },

  // POS — Payment
  'pos.payment.title': { vi: 'Thanh toán', en: 'Capture Payment' },
  'pos.payment.tip': { vi: 'Tiền tip', en: 'Tip' },
  'pos.payment.tip.none': { vi: 'Không tip', en: 'No tip' },
  'pos.payment.tip.custom': { vi: 'Số tiền tip tùy chỉnh', en: 'Custom tip amount' },
  'pos.payment.service_charge': { vi: 'Phụ thu dịch vụ', en: 'Service charge' },
  'pos.payment.service_charge.none': { vi: 'Không thu', en: 'None' },
  'pos.payment.split.title': { vi: 'Chia khoản thanh toán', en: 'Payment splits' },
  'pos.payment.split.add': { vi: 'Thêm', en: 'Add' },
  'pos.payment.split.balance': { vi: 'Cân đối', en: 'Balance' },
  'pos.payment.summary': { vi: 'Tổng kết đơn', en: 'Order Summary' },
  'pos.payment.complete': { vi: 'Hoàn tất thanh toán', en: 'Complete Payment' },
  'pos.payment.confirm': { vi: 'Xác nhận', en: 'Confirm' },
  'pos.payment.confirm.title': { vi: 'Xác nhận thanh toán', en: 'Confirm payment' },
  'pos.payment.confirm.note': { vi: 'Hành động này không thể hoàn tác.', en: 'This action cannot be undone.' },
  'pos.payment.failed': { vi: 'Thanh toán thất bại', en: 'Payment failed' },

  // POS — Tables
  'pos.tables.section': { vi: 'Khu', en: 'Section' },
  'pos.tables.count_suffix': { vi: 'bàn', en: 'tables' },

  // Common
  'common.cancel': { vi: 'Hủy', en: 'Cancel' },
  'common.confirm': { vi: 'Xác nhận', en: 'Confirm' },
  'common.back': { vi: 'Quay lại', en: 'Back' },
  'common.close': { vi: 'Đóng', en: 'Close' },
  'common.save': { vi: 'Lưu', en: 'Save' },
  'common.loading': { vi: 'Đang tải…', en: 'Loading…' },
  'common.empty': { vi: 'Không có dữ liệu', en: 'No data' },
  'common.error': { vi: 'Đã xảy ra lỗi', en: 'Something went wrong' },
};

let currentLocale: Locale = (() => {
  if (typeof window === 'undefined') return 'vi';
  const storage = window.localStorage;
  const fromStorage = typeof storage?.getItem === 'function' ? storage.getItem('fern.locale') : null;
  if (fromStorage === 'vi' || fromStorage === 'en') return fromStorage;
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (fromUrl === 'vi' || fromUrl === 'en') return fromUrl;
  return 'vi';
})();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
  if (typeof window !== 'undefined') {
    const storage = window.localStorage;
    if (typeof storage?.setItem === 'function') {
      storage.setItem('fern.locale', locale);
    }
  }
}

/**
 * Translate a key to the current locale. Falls back to the key itself when missing —
 * this is intentional so missing-translation bugs surface in QA but don't break UX.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let raw = entry ? entry[currentLocale] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      raw = raw.replace(`{${k}}`, String(v));
    }
  }
  return raw;
}
