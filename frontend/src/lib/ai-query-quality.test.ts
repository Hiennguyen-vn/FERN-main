import { describe, expect, it } from 'vitest';
import {
  normalizeQualityIssueLines,
  normalizeQualityVerdict,
  qualityIssuesTitle,
} from '@/lib/ai-query-quality';

describe('ai-query-quality', () => {
  it('normalizes reviewer issue objects to plain strings', () => {
    const issues = [
      { severity: 'high', kind: 'number_mismatch', note_vi: 'Số A khác preview' },
      { severity: 'low', kind: 'tone', note_vi: 'Nên tránh leak nội bộ' },
    ];
    expect(normalizeQualityIssueLines(issues)).toEqual([
      'Số A khác preview',
      'Nên tránh leak nội bộ',
    ]);
    expect(qualityIssuesTitle(issues)).toBe(
      'Số A khác preview; Nên tránh leak nội bộ',
    );
  });

  it('accepts legacy string[] issues', () => {
    expect(normalizeQualityIssueLines(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('falls back for note-less objects', () => {
    expect(normalizeQualityIssueLines([{ kind: 'leak', severity: 'medium' }])).toEqual([
      'medium · leak',
    ]);
  });

  it('normalizes verdict safely', () => {
    expect(normalizeQualityVerdict('MAJOR_REVISION')).toBe('major_revision');
    expect(normalizeQualityVerdict('major_revision')).toBe('major_revision');
    expect(normalizeQualityVerdict({})).toBe('approve');
    expect(normalizeQualityVerdict('not_a_verdict')).toBe('approve');
  });
});
