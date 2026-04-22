import type { PromotionView } from '@/api/fern-api';

function toMoney(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizePromotionType(type: unknown): 'percentage' | 'fixed_amount' | 'unsupported' {
  const normalized = String(type ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'percentage':
    case 'percent':
    case 'discount_percent':
      return 'percentage';
    case 'fixed_amount':
    case 'fixed':
    case 'amount':
    case 'discount_fixed':
      return 'fixed_amount';
    default:
      return 'unsupported';
  }
}

export function calculatePromotionDiscount(
  subtotal: number,
  promotion?: PromotionView | null,
): number {
  const safeSubtotal = toMoney(subtotal);
  if (!promotion || safeSubtotal <= 0) return 0;

  const minOrderAmount = toMoney(promotion.minOrderAmount);
  if (minOrderAmount > 0 && safeSubtotal < minOrderAmount) {
    return 0;
  }

  let discount = 0;
  switch (normalizePromotionType(promotion.promoType)) {
    case 'percentage':
      discount = safeSubtotal * (toMoney(promotion.valuePercent) / 100);
      break;
    case 'fixed_amount':
      discount = toMoney(promotion.valueAmount);
      break;
    default:
      return 0;
  }

  const maxDiscountAmount = toMoney(promotion.maxDiscountAmount);
  if (maxDiscountAmount > 0) {
    discount = Math.min(discount, maxDiscountAmount);
  }

  return Math.min(toMoney(discount), safeSubtotal);
}
