import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { BrainCircuit, Send, AlertTriangle, CheckCircle2, Clock, Zap, Database, ChevronDown, ChevronUp, Loader2, RotateCcw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/auth/use-auth';
import { aiQueryApi } from '@/api/ai-query-api';
import type { AiConversationTurn, AiMessage, AiQueryResponse, AiServiceReadiness } from '@/api/ai-query-api';
import { isApiError } from '@/api/client';

/** Default preview slice for normal analytical questions (server caps at 50). */
const AI_QUERY_PREVIEW_MAX_ROWS_DEFAULT = 25;
/** Larger preview when the user is exporting or refining an export-thread reply. */
const AI_QUERY_PREVIEW_MAX_ROWS_EXPORT = 50;

/** Up to 3 prior Q&A pairs for supervisor / matcher context (current question sent separately). */
function buildConversationTurns(messages: AiMessage[]): AiConversationTurn[] {
  return messages
    .filter((m): m is AiMessage & { role: 'user' | 'assistant' } =>
      m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 8000),
    }));
}

function isExportLikeQuestion(question: string): boolean {
  const s = question.toLowerCase().normalize('NFC').trim();
  if (!s) return false;
  const needles = [
    'xuất',
    'xuat',
    'export',
    'csv',
    'excel',
    '.xlsx',
    'spreadsheet',
    'tải về',
    'tải file',
    'tai ve',
    'tai file',
    'download',
    'đính kèm',
    'dinh kem',
    'file báo cáo',
    'file bao cao',
    'google sheet',
  ];
  return needles.some((x) => s.includes(x));
}

function inferPreviewMaxRows(question: string, messages: AiMessage[]): number {
  if (isExportLikeQuestion(question)) return AI_QUERY_PREVIEW_MAX_ROWS_EXPORT;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.metadata?.supervisor_intent === 'export_request') {
      return AI_QUERY_PREVIEW_MAX_ROWS_EXPORT;
    }
  }
  return AI_QUERY_PREVIEW_MAX_ROWS_DEFAULT;
}

// ─── Sample questions ────────────────────────────────────────────────────────

const SAMPLE_QUESTIONS = [
  'Doanh thu 7 ngày qua theo cửa hàng?',
  'Top 10 sản phẩm bán chạy nhất tháng này?',
  'Tỷ lệ hủy đơn hàng theo outlet?',
  'Giờ cao điểm bán hàng trong tuần?',
  'Phân tích discount theo danh mục sản phẩm?',
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function ReadinessIndicator({
  readiness,
  checking,
}: {
  readiness: AiServiceReadiness | null | undefined;
  checking: boolean;
}) {
  if (checking) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Đang kiểm tra...</span>
      </div>
    );
  }
  if (readiness === undefined) {
    return null;
  }
  if (readiness === null) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3 w-3 text-amber-500" />
        <span>Không thể kết nối AI service</span>
      </div>
    );
  }
  if (readiness.status === 'degraded') {
    const hint = readiness.issues?.[0] ?? 'dependencies unhealthy';
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 max-w-[220px]"
        title={readiness.issues?.join('\n')}
      >
        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
        <span className="line-clamp-2">Chưa sẵn sàng: {hint}</span>
      </div>
    );
  }
  if (readiness.status === 'ok' || readiness.status === 'ready') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        <span>AI service sẵn sàng</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      <span>AI service đang khởi động...</span>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums text-muted-foreground w-9 text-right">{pct}%</span>
    </div>
  );
}

function formatPreviewCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsvCell(cell: string): string {
  if (/[,"\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function collectPreviewColumns(rows: Record<string, unknown>[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        ordered.push(k);
      }
    }
  }
  return ordered;
}

function buildPreviewCsv(rows: Record<string, unknown>[]): string {
  const columns = collectPreviewColumns(rows);
  const header = columns.map((c) => escapeCsvCell(c)).join(',');
  const lines = rows.map((row) =>
    columns.map((col) => escapeCsvCell(formatPreviewCell(row[col]))).join(','),
  );
  return [header, ...lines].join('\r\n');
}

function RowsPreviewTable({
  rows,
  previewCap,
}: {
  rows: Record<string, unknown>[];
  /** Max rows requested for this preview (shown in caption). */
  previewCap?: number | null;
}) {
  const columns = useMemo(() => collectPreviewColumns(rows), [rows]);

  const downloadCsv = useCallback(() => {
    const body = `\uFEFF${buildPreviewCsv(rows)}`;
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `fern-ai-query-preview-${ts}.csv`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [rows]);

  const capLabel = previewCap ?? AI_QUERY_PREVIEW_MAX_ROWS_DEFAULT;

  return (
    <div className="mt-3 border rounded-lg overflow-hidden text-xs bg-background/80 max-w-full">
      <div className="px-3 py-1.5 bg-muted/50 border-b flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Dữ liệu (preview · tối đa {capLabel} dòng)
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[10px] gap-1 shrink-0"
          onClick={downloadCsv}
        >
          <Download className="h-3 w-3" aria-hidden />
          Tải CSV
        </Button>
      </div>
      <div className="max-h-[min(40vh,320px)] overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 z-[1] bg-muted/95 shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
            <tr>
              {columns.map((col) => (
                <th key={col} className="text-left whitespace-nowrap px-2 py-1.5 font-semibold align-bottom">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="even:bg-muted/25">
                {columns.map((col) => {
                  const cell = formatPreviewCell(row[col]);
                  return (
                    <td
                      key={col}
                      className="px-2 py-1.5 align-top border-t border-muted/50 max-w-[220px] truncate"
                      title={cell}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetaPanel({ meta }: { meta: AiQueryResponse }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border rounded-md overflow-hidden text-xs">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors"
      >
        <span className="font-medium text-muted-foreground tracking-wide uppercase text-[10px]">Debug Info</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2 bg-muted/20">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div>
              <span className="text-muted-foreground">Template</span>
              <p className="font-mono mt-0.5">{meta.template_key ?? '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Rows</span>
              <p className="font-mono mt-0.5">{meta.row_count}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Confidence</span>
              <div className="mt-1">
                <ConfidenceBar value={meta.confidence} />
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Latency</span>
              <p className="font-mono mt-0.5">{meta.latency_ms} ms</p>
            </div>
            {meta.response_kind && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Response kind</span>
                <p className="font-mono mt-0.5">{meta.response_kind}</p>
              </div>
            )}
            {meta.response_hints && meta.response_hints.length > 0 && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Hints</span>
                <p className="font-mono text-[10px] mt-0.5">{meta.response_hints.join(' · ')}</p>
              </div>
            )}
            {meta.supervisor_intent != null && meta.supervisor_intent !== '' && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Supervisor intent</span>
                <p className="font-mono mt-0.5">{meta.supervisor_intent}</p>
              </div>
            )}
            {meta.preview_max_rows != null && meta.preview_max_rows > 0 && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Preview rows requested</span>
                <p className="font-mono mt-0.5">{meta.preview_max_rows}</p>
              </div>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Correlation ID</span>
            <p className="font-mono text-[10px] mt-0.5 break-all text-muted-foreground/70">{meta.correlation_id}</p>
          </div>
          {meta.citations.length > 0 && (
            <div>
              <span className="text-muted-foreground">Citations</span>
              <pre className="mt-0.5 text-[10px] font-mono bg-muted/50 rounded p-1.5 overflow-x-auto">
                {JSON.stringify(meta.citations, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold',
        isUser
          ? 'bg-primary text-primary-foreground'
          : isError
          ? 'bg-destructive/10 text-destructive'
          : 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      )}>
        {isUser ? 'U' : isError ? '!' : <BrainCircuit className="h-3.5 w-3.5" />}
      </div>

      {/* Content */}
      <div className={cn('flex-1 max-w-[85%]', isUser && 'flex flex-col items-end')}>
        <div className={cn(
          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : isError
            ? 'bg-destructive/8 text-destructive border border-destructive/20 rounded-tl-sm'
            : 'bg-muted/60 text-foreground rounded-tl-sm',
        )}>
          {message.content}
        </div>

        {/* Structured row preview when API returns rows_preview */}
        {!isUser &&
          message.metadata?.rows_preview &&
          message.metadata.rows_preview.length > 0 && (
            <div className="w-full max-w-[min(100%,42rem)]">
              <RowsPreviewTable
                rows={message.metadata.rows_preview}
                previewCap={message.metadata.preview_max_rows}
              />
            </div>
          )}

        {/* Metadata for assistant messages */}
        {message.metadata && !isError && (
          <div className="w-full mt-1">
            <MetaPanel meta={message.metadata} />
          </div>
        )}

        <p className={cn('text-[10px] text-muted-foreground/60 mt-1 px-1', isUser && 'text-right')}>
          {message.timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center">
        <BrainCircuit className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 animate-pulse" />
      </div>
      <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main module ─────────────────────────────────────────────────────────────

export function AiQueryModule() {
  const { session } = useAuth();
  const token = session?.accessToken;

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Readiness check
  const { data: readiness, isLoading: checkingReady, refetch: recheckReady } = useQuery({
    queryKey: ['ai-query', 'ready'],
    queryFn: () => aiQueryApi.ready(token),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const isHealthy =
    readiness?.status === 'ok' || readiness?.status === 'ready';

  const showServiceWarning =
    !checkingReady && readiness !== undefined && !isHealthy;

  // Submit mutation
  const { mutate: submit, isPending } = useMutation({
    mutationFn: (payload: {
      question: string;
      conversation_turns: AiConversationTurn[];
      preview_max_rows: number;
    }) =>
      aiQueryApi.query(
        {
          question: payload.question,
          preview_max_rows: payload.preview_max_rows,
          ...(payload.conversation_turns.length > 0
            ? { conversation_turns: payload.conversation_turns }
            : {}),
        },
        token,
      ),
    onMutate: ({ question }) => {
      const userMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: question,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMsg]);
    },
    onSuccess: (data) => {
      const assistantMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        metadata: data,
      };
      setMessages(prev => [...prev, assistantMsg]);
    },
    onError: (error) => {
      const errMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: isApiError(error)
          ? error.message
          : 'Có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPending]);

  const handleSubmit = useCallback(() => {
    const q = input.trim();
    if (!q || isPending) return;
    setInput('');
    const turns = buildConversationTurns(messages);
    submit({
      question: q,
      conversation_turns: turns,
      preview_max_rows: inferPreviewMaxRows(q, messages),
    });
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isPending, messages, submit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const useSample = (q: string) => {
    setInput(q);
    textareaRef.current?.focus();
  };

  const clearChat = () => setMessages([]);

  /** Metrics in the header refer to the latest assistant turn only (not older bubbles). */
  const latestTurn = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.metadata) {
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === 'user') {
            return { userQuestion: messages[j].content, meta: m.metadata };
          }
        }
        return { userQuestion: undefined as string | undefined, meta: m.metadata };
      }
    }
    return null;
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <BrainCircuit className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">AI Analyst</h1>
              <p className="text-xs text-muted-foreground">Hỏi bất kỳ câu hỏi nào về dữ liệu kinh doanh</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ReadinessIndicator readiness={readiness} checking={checkingReady} />
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearChat} className="h-7 text-xs gap-1.5">
                <RotateCcw className="h-3 w-3" />
                Xóa
              </Button>
            )}
          </div>
        </div>

        {/* Stats strip — chỉ mô tả lượt trả lời mới nhất (không áp dụng cho bubble cũ phía trên). */}
        {messages.length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Database className="h-3 w-3 flex-shrink-0" />
                <span>{messages.filter(m => m.role === 'user').length} câu hỏi trong phiên</span>
              </div>
              {latestTurn?.meta && (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    <span>{latestTurn.meta.latency_ms} ms</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Zap className="h-3 w-3 flex-shrink-0" />
                    <span>{Math.round(latestTurn.meta.confidence * 100)}% confidence</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="text-muted-foreground/80">Template</span>
                    <span className="font-mono text-[11px]">{latestTurn.meta.template_key ?? '—'}</span>
                  </div>
                </>
              )}
            </div>
            {latestTurn?.userQuestion && (
              <p className="text-[11px] text-muted-foreground/80 line-clamp-2">
                <span className="font-medium text-muted-foreground">Trả lời mới nhất cho: </span>
                “{latestTurn.userQuestion}”
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/60">
              Template / latency / confidence ở đây chỉ khớp với tin nhắn AI cuối cùng; mở “Debug Info” trên từng bubble để đối chiếu.
            </p>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12 select-none">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
              <BrainCircuit className="h-8 w-8 text-violet-500/60" />
            </div>
            <h2 className="text-base font-semibold text-foreground/70 mb-1">Hỏi về dữ liệu kinh doanh</h2>
            <p className="text-sm text-muted-foreground max-w-xs mb-8">
              AI sẽ phân tích và trả lời dựa trên dữ liệu real-time từ ClickHouse
            </p>

            {/* Sample questions */}
            <div className="w-full max-w-md space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Gợi ý câu hỏi</p>
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => useSample(q)}
                  className="w-full text-left px-4 py-2.5 rounded-xl border bg-background hover:bg-muted/50 text-sm text-foreground/80 hover:text-foreground transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {isPending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Service warning banner */}
      {showServiceWarning && (
        <div className="flex-shrink-0 mx-6 mb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {readiness?.status === 'degraded'
                ? 'AI service chưa đủ dependency (ClickHouse / OpenSearch / graph). Câu hỏi có thể thất bại.'
                : readiness === null
                  ? 'Không kết nối được tới AI service qua gateway.'
                  : 'AI service đang khởi động, câu hỏi có thể thất bại.'}
            </span>
            <button onClick={() => recheckReady()} className="ml-auto text-xs underline text-amber-600 dark:text-amber-400 hover:no-underline">
              Kiểm tra lại
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="flex-shrink-0 border-t px-6 py-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Đặt câu hỏi về doanh thu, tồn kho, nhân viên... (Enter để gửi)"
              rows={1}
              disabled={isPending}
              className={cn(
                'w-full resize-none rounded-xl border bg-background px-4 py-3 text-sm leading-relaxed',
                'focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'placeholder:text-muted-foreground/50',
                'min-h-[44px] max-h-[160px] overflow-y-auto',
              )}
              style={{ height: 'auto' }}
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isPending}
            size="icon"
            className={cn(
              'h-11 w-11 rounded-xl flex-shrink-0 transition-all',
              'bg-violet-600 hover:bg-violet-700 text-white',
              'disabled:bg-muted disabled:text-muted-foreground',
            )}
          >
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />
            }
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
          AI có thể mắc lỗi — luôn kiểm chứng số liệu quan trọng
        </p>
      </div>
    </div>
  );
}
