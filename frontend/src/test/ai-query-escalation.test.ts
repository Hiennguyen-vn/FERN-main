import { describe, expect, it } from 'vitest';
import { getEscalationInfo } from '@/components/ai-query/AiQueryModule';
import type { AiQueryResponse } from '@/api/ai-query-api';

function meta(summary: Record<string, unknown> | null): AiQueryResponse {
  return {
    answer: '',
    template_key: null,
    confidence: 0,
    row_count: 0,
    citations: [],
    correlation_id: 'c-test',
    latency_ms: 0,
    workflow_summary: summary,
  };
}

describe('AI Query escalation UI helper', () => {
  it('maps follow-up ambiguity escalation to a user-safe message', () => {
    const info = getEscalationInfo(meta({
      escalation_candidate: true,
      escalation_reason: 'still_missing_slots_after_followup',
    }));

    expect(info.candidate).toBe(true);
    expect(info.reason).toContain('thiếu thông tin quan trọng');
  });

  it('does not show escalation badge when backend did not mark a candidate', () => {
    const info = getEscalationInfo(meta({
      escalation_candidate: false,
      escalation_reason: 'still_missing_slots_after_followup',
    }));

    expect(info).toEqual({
      candidate: false,
      reason: 'still_missing_slots_after_followup',
    });
  });

  it('handles missing workflow summary', () => {
    expect(getEscalationInfo(meta(null))).toEqual({ candidate: false, reason: null });
  });
});
