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

export function lineModifierDelta(line: CartLine): number {
  if (line.modifiers && line.modifiers.length > 0) {
    return line.modifiers.reduce((sum, modifier) => sum + (modifier.priceDelta || 0), 0);
  }
  return (line.sizePriceAdd ?? 0) + line.toppings.reduce((sum, topping) => sum + topping.priceAdd, 0);
}

export function lineUnitPrice(line: CartLine): number {
  return line.basePrice + lineModifierDelta(line);
}
