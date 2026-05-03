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
  /** 0 omits preview; backend caps at 50. */
  preview_max_rows?: number;
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
}

export interface AiErrorResponse {
  error_code: string;
  message: string;
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
};
