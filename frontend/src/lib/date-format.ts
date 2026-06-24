/**
 * Local-timezone date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` returns the **UTC** date — for users in
 * UTC+7 (Vietnam) after 17:00 local time, it returns tomorrow's date and silently
 * pre-fills the wrong day in `<input type="date">` fields.
 *
 * Always use these helpers for date inputs and date-only filters.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in local timezone as `YYYY-MM-DD`. */
export function todayLocalISO(): string {
  return toLocalISODate(new Date());
}

/** Format any Date in local timezone as `YYYY-MM-DD`. */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Current local calendar month as date-only API filters. */
export function currentLocalMonthRange(reference = new Date()): { startDate: string; endDate: string; label: string } {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  return {
    startDate: toLocalISODate(start),
    endDate: toLocalISODate(end),
    label: reference.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}
