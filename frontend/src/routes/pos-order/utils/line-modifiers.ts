import type { CartLine } from '../hooks/use-pos-cart';

/**
 * Build human-readable subtitle for KOT/Receipt that prefers structured `modifiers[]`
 * (new modifier-group taxonomy) and falls back to legacy size/sugar/ice/toppings fields.
 */
export function buildLineSubtitle(line: CartLine): string {
  if (line.modifiers && line.modifiers.length > 0) {
    return line.modifiers
      .map((m) => `${m.groupName}: ${m.optionLabel}${m.priceDelta ? ` (${m.priceDelta > 0 ? '+' : ''}${m.priceDelta.toLocaleString('vi-VN')})` : ''}`)
      .join(' · ');
  }
  return [
    line.size && `Size ${line.size}`,
    line.sugar !== undefined && `Đường ${line.sugar}%`,
    line.ice !== undefined && `Đá ${line.ice}%`,
    ...line.toppings.map((t) => `+${t.name}`),
  ]
    .filter(Boolean)
    .join(' · ');
}
