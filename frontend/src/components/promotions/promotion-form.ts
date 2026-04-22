import type { CreatePromotionPayload } from '@/api/fern-api';

export interface PromotionFormValues {
  name: string;
  promoType: string;
  valueAmount: string;
  valuePercent: string;
  minOrderAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
}

function toOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

export function createDefaultPromotionFormValues(now = new Date()): PromotionFormValues {
  return {
    name: '',
    promoType: 'percentage',
    valueAmount: '',
    valuePercent: '10',
    minOrderAmount: '',
    effectiveFrom: now.toISOString().slice(0, 16),
    effectiveTo: '',
  };
}

export function buildCreatePromotionPayload(
  form: PromotionFormValues,
  selectedOutletIds: string[],
): CreatePromotionPayload {
  return {
    name: form.name.trim(),
    promoType: form.promoType,
    valueAmount: toOptionalNumber(form.valueAmount),
    valuePercent: toOptionalNumber(form.valuePercent),
    minOrderAmount: toOptionalNumber(form.minOrderAmount),
    maxDiscountAmount: null,
    effectiveFrom: new Date(form.effectiveFrom).toISOString(),
    effectiveTo: form.effectiveTo ? new Date(form.effectiveTo).toISOString() : null,
    // Keep 64-bit ids as strings to avoid JS precision loss for bigint-safe outlet ids.
    outletIds: selectedOutletIds.map((id) => String(id).trim()).filter(Boolean),
  };
}
