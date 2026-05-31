import { apiRequest, isApiError } from '@/api/client';

// ─── Request / Response types ───────────────────────────────────────────────

/** Last few turns sent to ai-query-service for lightweight follow-ups (same session). */
export interface AiConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiQueryRequest {
  question: string;
  session_id?: string;
  conversation_turns?: AiConversationTurn[];
  requested_outlet_ids?: string[];
  /** 0 omits preview; backend caps at 50. */
  preview_max_rows?: number;
}

export interface AiWorkflowStep {
  key: string;
  label: string;
  status: 'done' | 'skipped' | 'failed' | string;
}

export interface AiChartSpec {
  type: string;
  title?: string;
  x?: string;
  y?: string;
  row_count?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface AiDataSourceContext {
  primary_dataset?: string | null;
  source_system?: string | null;
  storage?: string | null;
  time_column?: string | null;
  time_semantics?: string | null;
  requested_range?: Record<string, unknown> | null;
  available_range?: Record<string, unknown> | null;
  actual_data_range?: Record<string, unknown> | null;
  coverage_status?: string | null;
  freshness_as_of?: string | null;
  caveats?: string[];
  selected_data_sources?: Record<string, unknown>[];
}

export interface AiExportArtifact {
  artifact_id: string;
  /** "csv" | "json" — same download route, different Content-Type */
  format?: string | null;
  filename: string;
  row_count: number;
  size_bytes?: number | null;
  download_url: string;
  /** ISO-8601 expiry time */
  expires_at?: string | null;
  truncated?: boolean | null;
}

export type AiQualityVerdict = 'approve' | 'minor_revision' | 'major_revision';

/** Reviewer returns structured issues (see ai-query-service reviewer schema). */
export interface AiReviewerIssue {
  severity?: string;
  kind?: string;
  note_vi?: string;
  [key: string]: unknown;
}

export interface AiQualityReport {
  verdict?: AiQualityVerdict | string | null;
  issues?: (string | AiReviewerIssue)[] | null;
  confidence?: number | null;
  revised?: boolean | null;
  applied_revision?: boolean | null;
}

export interface AiQueryResponse {
  answer: string;
  template_key: string | null;
  confidence: number;
  row_count: number;
  citations: AiCitation[];
  correlation_id: string;
  latency_ms: number;
  /** answer | clarification | unsupported — from service Phase-1 UX signals */
  response_kind?: 'answer' | 'clarification' | 'unsupported';
  response_hints?: string[];
  /** JSON-safe row slice when preview_max_rows was sent (see ai-query-service). */
  rows_preview?: Record<string, unknown>[] | null;
  /** Supervisor routing intent (mirrors ClickHouse/graph state). */
  supervisor_intent?: string | null;
  /** Echo of sent preview_max_rows when greater than zero. */
  preview_max_rows?: number | null;
  workflow_steps?: AiWorkflowStep[];
  data_source_context?: AiDataSourceContext | null;
  chart_spec?: AiChartSpec | null;
  workflow_summary?: Record<string, unknown> | null;
  workflow_trace?: Record<string, unknown>[] | null;
  /** CSV export artifacts generated for this query */
  exports?: AiExportArtifact[] | null;
  /** Self-review verdict from the reviewer agent */
  quality_report?: AiQualityReport | null;
  /** Proactive follow-up suggestions */
  suggestions?: string[] | null;
  /** Detected audience: "executive" | "analyst" */
  audience?: string | null;
  /** Last-turn continuity: intent summary, timeline markdown, resolved signals */
  session_digest?: Record<string, unknown> | null;
  /** Markdown preview table + optional chart_spec for clients */
  presentation?: Record<string, unknown> | null;
  /** Long-term agent memory hits (pgvector). Each item: topic, summary_vi, intent, similarity, … */
  relevant_memories?: AiKnowledgeNugget[] | null;
}

export interface AiKnowledgeNugget {
  topic: string;
  summary_vi: string;
  intent?: string | null;
  template_key?: string | null;
  time_range?: { from_date?: string | null; to_date?: string | null } | null;
  similarity?: number | null;
  last_seen_at?: string | null;
  hit_count?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface AiCitation {
  row_count?: number;
  template?: string | null;
  [key: string]: unknown;
}

export interface AiServiceReadiness {
  /** Healthy: FastAPI returns `"ready"` (200). Legacy / probes may use `"ok"`. */
  status: 'ok' | 'ready' | 'degraded';
  issues?: string[];
  warnings?: string[];
}

export interface AiErrorResponse {
  error_code: string;
  message: string;
}

export interface AiReviewRequest {
  correlation_id?: string | null;
  question: string;
  answer: string;
  reason?: string | null;
  conversation_turns?: AiConversationTurn[];
  rows_preview?: Record<string, unknown>[] | null;
  workflow_summary?: Record<string, unknown> | null;
}

export interface AiReviewResponse {
  review_id: string;
  status: 'queued';
}

// ─── Chat history types (client-side only) ──────────────────────────────────

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: Date;
  metadata?: AiQueryResponse;
}

// ─── API client ─────────────────────────────────────────────────────────────

export const aiQueryApi = {
  /**
   * Check readiness of the AI query service (all dependencies healthy).
   * Returns null if the service is unreachable.
   */
  async ready(token?: string | null): Promise<AiServiceReadiness | null> {
    try {
      return await apiRequest<AiServiceReadiness>('/api/v1/ai-query/ready', { token });
    } catch (e) {
      // 503 + JSON body from ai-query-service means degraded, not network failure
      if (isApiError(e) && e.status === 503 && e.details && typeof e.details === 'object') {
        const d = e.details as Record<string, unknown>;
        if (d.status === 'degraded') {
          return {
            status: 'degraded',
            issues: Array.isArray(d.issues)
              ? (d.issues as unknown[]).map((x) => String(x))
              : undefined,
          };
        }
      }
      return null;
    }
  },

  /**
   * Submit a natural-language question to the AI query service.
   * Throws ApiError on 4xx / 5xx responses.
   */
  async query(request: AiQueryRequest, token?: string | null): Promise<AiQueryResponse> {
    return apiRequest<AiQueryResponse>('/api/v1/ai-query/query', {
      method: 'POST',
      token,
      body: request,
    });
  },

  async requestReview(request: AiReviewRequest, token?: string | null): Promise<AiReviewResponse> {
    return apiRequest<AiReviewResponse>('/api/v1/ai-query/review-request', {
      method: 'POST',
      token,
      body: request,
    });
  },
};
