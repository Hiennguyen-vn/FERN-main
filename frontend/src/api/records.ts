export type ApiRecord = Record<string, unknown>;

export function asRecord(value: unknown): ApiRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as ApiRecord;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asId(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.trim() ? text : null;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function asNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function asStringArray(value: unknown): string[] {
  return asArray(value).map((item) => String(item));
}

export function asRecordArray(value: unknown): ApiRecord[] {
  return asArray(value)
    .map((item) => asRecord(item))
    .filter((item): item is ApiRecord => item !== null);
}

export function asDateOnly(value: unknown): string | null {
  const raw = asNullableString(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function asIsoDateTime(value: unknown): string | null {
  const raw = asNullableString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

