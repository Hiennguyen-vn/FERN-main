/**
 * Currency-aware money rounding for client-side arithmetic.
 *
 * Zero-decimal currencies (VND, JPY, KRW, IDR, ...) round to whole units.
 * Two-decimal currencies (USD, EUR, ...) round to 2 dp.
 * Three-decimal (BHD, KWD, OMR) round to 3 dp.
 *
 * Uses ISO 4217 minor-unit conventions. Default = 2 if currency unknown.
 */

const ZERO_DECIMAL = new Set(['VND', 'JPY', 'KRW', 'IDR', 'CLP', 'PYG', 'RWF', 'UGX', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'TND', 'IQD']);

export function currencyMinorUnits(currencyCode?: string | null): number {
  const code = String(currencyCode ?? '').toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/** Round amount to currency minor-unit precision. */
export function roundMoney(amount: number, currencyCode?: string | null): number {
  if (!Number.isFinite(amount)) return 0;
  const digits = currencyMinorUnits(currencyCode);
  const factor = 10 ** digits;
  return Math.round(amount * factor) / factor;
}
