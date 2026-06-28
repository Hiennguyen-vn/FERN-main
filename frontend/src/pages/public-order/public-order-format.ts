export function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatPublicCurrency(value: unknown, currency = 'VND') {
  const code = String(currency || 'VND').toUpperCase();
  return new Intl.NumberFormat(code === 'VND' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: code === 'VND' ? 0 : 2,
    maximumFractionDigits: code === 'VND' ? 0 : 2,
  }).format(toNumber(value));
}

export function formatPublicDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatPublicDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function productDisplayName(item: { name?: string | null; code?: string | null; productId?: string | null }) {
  return String(item.name || item.code || item.productId || 'Món');
}

export function productInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
