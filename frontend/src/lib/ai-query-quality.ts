/** Shape from ai-query-service reviewer (issues may also be plain strings). */

export type AiQualityVerdictNormalized = 'approve' | 'minor_revision' | 'major_revision';

export function normalizeOneQualityIssue(x: unknown): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (typeof o.note_vi === 'string' && o.note_vi.trim()) return o.note_vi.trim();
    if (typeof o.note === 'string' && o.note.trim()) return o.note.trim();
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    const kind = typeof o.kind === 'string' ? o.kind : '';
    const sev = typeof o.severity === 'string' ? o.severity : '';
    if (kind || sev) return [sev, kind].filter(Boolean).join(' · ');
    try {
      return JSON.stringify(x);
    } catch {
      return '';
    }
  }
  try {
    return String(x);
  } catch {
    return '';
  }
}

export function normalizeQualityIssueLines(issues: unknown): string[] {
  if (issues == null) return [];
  if (Array.isArray(issues)) {
    return issues.map(normalizeOneQualityIssue).filter(Boolean);
  }
  if (typeof issues === 'object') {
    return Object.values(issues as Record<string, unknown>)
      .map(normalizeOneQualityIssue)
      .filter(Boolean);
  }
  return [normalizeOneQualityIssue(issues)].filter(Boolean);
}

export function qualityIssuesTitle(issues: unknown): string | undefined {
  const lines = normalizeQualityIssueLines(issues);
  return lines.length > 0 ? lines.join('; ') : undefined;
}

export function normalizeQualityVerdict(v: unknown): AiQualityVerdictNormalized {
  if (typeof v !== 'string') return 'approve';
  const s = v.toLowerCase().trim();
  if (s === 'minor_revision' || s === 'major_revision' || s === 'approve') return s;
  return 'approve';
}
