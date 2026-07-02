/** Shape from the AIA-gent reviewer (issues may also be plain strings). */

export type AiQualityVerdictNormalized = 'approve' | 'minor_revision' | 'major_revision';

function sanitizeQualityIssueText(text: string): string {
  return text
    .replace(/\bDRAFT_ANSWER\b|\bDRAFT\b/gi, 'Câu trả lời')
    .replace(/\banswer_facts\b/gi, 'dữ liệu kiểm tra')
    .replace(/\bpreview_includes_all_rows\b/gi, 'kết quả đã đủ dòng')
    .replace(/\bpreview_rows\b/gi, 'bảng kết quả')
    .replace(/\bsource_context\b/gi, 'ngữ cảnh nguồn dữ liệu')
    .replace(/\brow_count\b/gi, 'số dòng')
    .replace(/\btemplate_key\b/gi, 'loại báo cáo')
    .replace(/\bpipeline\b/gi, 'luồng xử lý')
    .replace(/\bSQL\b/g, 'truy vấn')
    .replace(/\bprompt\b/gi, 'ngữ cảnh xử lý')
    .trim();
}

export function normalizeOneQualityIssue(x: unknown): string {
  let text = '';
  if (x == null) return '';
  if (typeof x === 'string') text = x;
  else if (typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (typeof o.note_vi === 'string' && o.note_vi.trim()) text = o.note_vi.trim();
    else if (typeof o.note === 'string' && o.note.trim()) text = o.note.trim();
    else if (typeof o.message === 'string' && o.message.trim()) text = o.message.trim();
    else {
      const kind = typeof o.kind === 'string' ? o.kind : '';
      const sev = typeof o.severity === 'string' ? o.severity : '';
      if (kind || sev) text = [sev, kind].filter(Boolean).join(' · ');
      else {
        try {
          text = JSON.stringify(x);
        } catch {
          text = '';
        }
      }
    }
  } else {
    try {
      text = String(x);
    } catch {
      text = '';
    }
  }
  return sanitizeQualityIssueText(text);
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
