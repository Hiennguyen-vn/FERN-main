import { salesApi, type PromotionView } from '@/api/sales-api';
import type { AppliedVoucher } from '../hooks/use-pos-cart';

export function computePromotionDiscount(
  promo: PromotionView,
  subtotal: number,
): number {
  const minOrder = Number(promo.minOrderAmount ?? 0);
  if (minOrder > 0 && subtotal < minOrder) return 0;

  let discount = 0;
  const percent = Number(promo.valuePercent ?? 0);
  const amount = Number(promo.valueAmount ?? 0);
  if (percent > 0) {
    discount = Math.round((subtotal * percent) / 100);
  } else if (amount > 0) {
    discount = amount;
  }
  const maxDiscount = Number(promo.maxDiscountAmount ?? 0);
  if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  return Math.min(Math.max(0, discount), subtotal);
}

export async function lookupPromotionVoucher(
  token: string,
  outletId: string,
  code: string,
  subtotal: number,
): Promise<{ voucher: AppliedVoucher } | { error: string }> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: 'Nhập mã giảm giá' };

  const response = await salesApi.promotions(token, {
    outletId,
    status: 'active',
    q: normalized,
    limit: 20,
  });
  const promo = response.items.find(
    (item) => String(item.code ?? '').trim().toUpperCase() === normalized,
  );
  if (!promo) return { error: 'Mã không hợp lệ hoặc đã hết hạn' };

  const discount = computePromotionDiscount(promo, subtotal);
  if (discount <= 0) {
    const minOrder = Number(promo.minOrderAmount ?? 0);
    if (minOrder > 0 && subtotal < minOrder) {
      return { error: `Đơn tối thiểu ${minOrder.toLocaleString('vi-VN')}đ` };
    }
    return { error: 'Mã không áp dụng được cho đơn này' };
  }

  return {
    voucher: {
      code: normalized,
      label: promo.name ?? normalized,
      discount,
      promotionId: promo.id,
    },
  };
}
