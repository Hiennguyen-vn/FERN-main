import type { PublicMenuItemView } from '@/api/fern-api';
import type { PublicOrderCartDraft } from '@/lib/public-order';
import { cn } from '@/lib/utils';

export function productName(item: Pick<PublicMenuItemView, 'name' | 'code' | 'productId'>) {
  return String(item.name || item.code || item.productId || 'Menu item');
}

export function productInitials(item: Pick<PublicMenuItemView, 'name' | 'code' | 'productId'>) {
  return productName(item).slice(0, 2).toUpperCase();
}

export function statusBadgeClass(status: string | null | undefined) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('approved') || normalized.includes('done') || normalized === 'paid') {
    return 'border-[hsl(var(--pos-success)/0.35)] bg-[hsl(var(--pos-success-soft))] text-[hsl(152_60%_28%)]';
  }
  if (normalized.includes('pending') || normalized.includes('created')) {
    return 'border-[hsl(var(--pos-accent)/0.25)] bg-[hsl(var(--pos-accent-soft))] text-[hsl(var(--pos-accent))]';
  }
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('failed')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function findCartLine(draft: PublicOrderCartDraft, productId: string) {
  return draft.items.find((item) => item.productId === productId) ?? null;
}

export function cartLineSelectedClass(selected: boolean) {
  return cn(
    selected && 'border-[hsl(var(--pos-accent)/0.45)] bg-[hsl(var(--pos-accent-soft))]',
    !selected && 'border-slate-200 bg-white',
  );
}
