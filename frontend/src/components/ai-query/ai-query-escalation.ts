import type { AiQueryResponse } from '@/api/ai-query-api';

export function getEscalationInfo(meta?: AiQueryResponse | null): { candidate: boolean; reason: string | null } {
  const summary = meta?.workflow_summary;
  if (!summary || typeof summary !== 'object') return { candidate: false, reason: null };
  const candidate = summary['escalation_candidate'] === true;
  const rawReason = typeof summary['escalation_reason'] === 'string' ? summary['escalation_reason'] : null;
  if (!candidate) return { candidate: false, reason: rawReason };
  switch (rawReason) {
    case 'still_missing_slots_after_followup':
      return { candidate: true, reason: 'Câu hỏi vẫn còn thiếu thông tin quan trọng sau lượt hỏi tiếp theo.' };
    case 'no_safe_supported_route':
      return { candidate: true, reason: 'Backend chưa tìm được tuyến xử lý an toàn cho yêu cầu này.' };
    default:
      return { candidate: true, reason: rawReason ?? 'Cần kiểm tra thêm trước khi dùng cho quyết định quan trọng.' };
  }
}
