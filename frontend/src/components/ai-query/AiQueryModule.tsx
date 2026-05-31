import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  BrainCircuit, Send, AlertTriangle, CheckCircle2, Clock, Zap, Database,
  ChevronDown, ChevronUp, Loader2, RotateCcw, Download, FileText,
  Sparkles, ShieldCheck, TrendingUp, User2, Eye, EyeOff,
  BrainCog, FileJson, History, BarChart2, Table2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { aiQueryApi } from '@/api/ai-query-api';
import type {
  AiConversationTurn, AiDataSourceContext, AiExportArtifact,
  AiKnowledgeNugget, AiMessage, AiQualityReport, AiQueryResponse,
  AiServiceReadiness, AiWorkflowStep,
} from '@/api/ai-query-api';
import { isApiError } from '@/api/client';
import { useShellRuntime } from '@/hooks/use-shell-runtime';
import type { ScopeOption } from '@/types/shell';
import {
  normalizeQualityIssueLines,
  normalizeQualityVerdict,
  qualityIssuesTitle,
} from '@/lib/ai-query-quality';

const AI_QUERY_PREVIEW_MAX_ROWS_DEFAULT = 25;
const AI_QUERY_PREVIEW_MAX_ROWS_EXPORT = 50;

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
    'xuất', 'xuat', 'export', 'csv', 'excel', '.xlsx', 'spreadsheet',
    'tải về', 'tải file', 'tai ve', 'tai file', 'download',
    'đính kèm', 'dinh kem', 'file báo cáo', 'file bao cao', 'google sheet',
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

// ─── Sample questions ─────────────────────────────────────────────────────────

const SAMPLE_QUESTIONS = [
  { icon: TrendingUp, label: 'Doanh thu 7 ngày qua theo cửa hàng?' },
  { icon: Sparkles, label: 'Top 10 sản phẩm bán chạy nhất tháng này?' },
  { icon: AlertTriangle, label: 'Outlet nào đang có doanh thu yếu nhất?' },
  { icon: Clock, label: 'Giờ cao điểm bán hàng trong tuần là lúc nào?' },
  { icon: User2, label: 'Nhân viên nào đi làm nhiều nhất năm nay?' },
];

const PENDING_WORKFLOW_STEPS: AiWorkflowStep[] = [
  { key: 'analyze',  label: 'Phân tích câu hỏi',         status: 'done' },
  { key: 'metadata', label: 'Tra cứu metadata',           status: 'done' },
  { key: 'plan',     label: 'Lập kế hoạch truy vấn',      status: 'done' },
  { key: 'security', label: 'Áp dụng quyền RBAC',         status: 'done' },
  { key: 'execute',  label: 'Chạy truy vấn',              status: 'done' },
  { key: 'format',   label: 'Định dạng câu trả lời',      status: 'done' },
  { key: 'review',   label: 'Rà soát trả lời',            status: 'done' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPreviewCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsvCell(cell: string): string {
  if (/[,"\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

function collectPreviewColumns(rows: Record<string, unknown>[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row ?? {})) {
      if (!seen.has(k)) { seen.add(k); ordered.push(k); }
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

function collectDescendantOutletIds(nodes: ScopeOption[] | undefined, bucket: string[]): void {
  for (const node of nodes ?? []) {
    if (node.level === 'outlet') {
      const outletId = String(node.id ?? '').trim();
      if (/^\d+$/.test(outletId) && !bucket.includes(outletId)) bucket.push(outletId);
    }
    if (node.children?.length) collectDescendantOutletIds(node.children, bucket);
  }
}

function resolveRequestedOutletIds(
  scope: { level: 'system' | 'region' | 'outlet'; outletId?: string; regionId?: string },
  scopeTree: ScopeOption[] = [],
): string[] | undefined {
  if (scope.level === 'system') return undefined;
  if (scope.level === 'outlet') {
    const outletId = String(scope.outletId ?? '').trim();
    return /^\d+$/.test(outletId) ? [outletId] : undefined;
  }
  if (scope.level !== 'region' || !scope.regionId) return undefined;

  const stack = [...scopeTree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.level === 'region' && String(node.id) === String(scope.regionId)) {
      const outletIds: string[] = [];
      collectDescendantOutletIds(node.children, outletIds);
      return outletIds.length > 0 ? outletIds : undefined;
    }
    if (node.children?.length) stack.push(...node.children);
  }
  return undefined;
}

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

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReadinessIndicator({ readiness, checking }: { readiness: AiServiceReadiness | null | undefined; checking: boolean }) {
  if (checking) return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>Đang kiểm tra...</span>
    </div>
  );
  if (readiness === undefined) return null;
  if (readiness === null) return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AlertTriangle className="h-3 w-3 text-amber-500" />
      <span>Không thể kết nối AI service</span>
    </div>
  );
  if (readiness.status === 'degraded') {
    const hint = readiness.issues?.[0] ?? 'dependencies unhealthy';
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 max-w-[220px]" title={readiness.issues?.join('\n')}>
        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
        <span className="line-clamp-2">Chưa sẵn sàng: {hint}</span>
      </div>
    );
  }
  if (readiness.status === 'ok' || readiness.status === 'ready') return (
    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      <span>Sẵn sàng</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      <span>Đang khởi động...</span>
    </div>
  );
}

function AudienceBadge({ audience }: { audience?: string | null }) {
  if (!audience) return null;
  const isExec = audience === 'executive';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border',
      isExec
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/60'
        : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-800/60',
    )}>
      {isExec ? <Sparkles className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />}
      {isExec ? 'Executive' : 'Analyst'}
    </span>
  );
}

function QualityBadge({ report }: { report?: AiQualityReport | null }) {
  if (!report) return null;
  const verdict = normalizeQualityVerdict(report.verdict);
  const issuesTitle = qualityIssuesTitle(report.issues);
  if (verdict === 'approve') return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/60">
      <ShieldCheck className="h-2.5 w-2.5" />
      Đã kiểm duyệt
    </span>
  );
  if (verdict === 'minor_revision') return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-800/60" title={issuesTitle}>
      <ShieldCheck className="h-2.5 w-2.5" />
      Đã chỉnh sửa nhỏ
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800/60" title={issuesTitle}>
      <ShieldCheck className="h-2.5 w-2.5" />
      Đã chỉnh sửa lại
    </span>
  );
}

function ProvenanceBanner({ caveats }: { caveats?: string[] | null }) {
  if (!caveats?.length) return null;
  return (
    <div className="mb-2 rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-[12px] leading-snug text-foreground">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning-foreground mb-1">Phạm vi dữ liệu</p>
      <ul className="space-y-1 list-none m-0 p-0">
        {caveats.slice(0, 4).map((c, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-warning shrink-0" aria-hidden>·</span>
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkflowPipeline({ steps, pending = false }: { steps?: AiWorkflowStep[] | null; pending?: boolean }) {
  const items = steps && steps.length > 0 ? steps : PENDING_WORKFLOW_STEPS;
  const skippedSteps = items.filter((s) => s.status === 'skipped');
  return (
    <div className="mt-3 border-l-2 border-border pl-3">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Luồng xử lý</span>
        {skippedSteps.length > 0 && (
          <span className="text-[10px] text-muted-foreground/80">· {skippedSteps.length} bước bỏ qua</span>
        )}
      </div>
      <ol className="m-0 p-0 list-none flex flex-col gap-1">
        {items.map((step, idx) => {
          const isPendingStep = pending && idx === items.findIndex((s) => s.status !== 'done');
          const status = isPendingStep ? 'pending' : step.status;
          const done = status === 'done';
          const failed = status === 'failed';
          const skipped = status === 'skipped';
          return (
            <li
              key={`${step.key}-${idx}`}
              className={cn(
                'flex items-center gap-2 text-[11px] rounded px-1.5 py-0.5',
                failed && 'text-red-800 bg-red-50/80 dark:text-red-200 dark:bg-red-950/40',
                done && !failed && 'text-success',
                skipped && 'text-muted-foreground/60 line-through',
                !done && !failed && !skipped && 'text-muted-foreground',
              )}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 bg-muted text-muted-foreground border border-border">
                {isPendingStep ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : failed ? <AlertTriangle className="h-2.5 w-2.5" />
                  : done ? <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                  : String(idx + 1)}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ExportsPanel({ exports, baseUrl }: { exports?: AiExportArtifact[] | null; baseUrl?: string }) {
  if (!exports || exports.length === 0) return null;
  return (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Download className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Xuất dữ liệu</span>
      </div>
      {exports.map((artifact) => {
        const isJson = (artifact.format ?? '').toLowerCase() === 'json';
        const url = artifact.download_url.startsWith('http')
          ? artifact.download_url
          : `${baseUrl ?? ''}${artifact.download_url}`;
        const expiresLabel = artifact.expires_at
          ? `Hết hạn ${new Date(artifact.expires_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
          : 'Hết hạn 24h';
        return (
          <div
            key={artifact.artifact_id}
            className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className={cn(
              'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
              isJson
                ? 'bg-violet-50 dark:bg-violet-950/40'
                : 'bg-emerald-50 dark:bg-emerald-950/40',
            )}>
              {isJson
                ? <FileJson className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                : <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{artifact.filename}</p>
              <p className="text-[10px] text-muted-foreground">
                <span className={cn(
                  'inline-flex items-center rounded px-1 py-0 mr-1 font-mono',
                  isJson
                    ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
                )}>
                  {isJson ? 'JSON' : 'CSV'}
                </span>
                {artifact.row_count.toLocaleString('vi-VN')} dòng
                {artifact.size_bytes ? ` · ${formatFileSize(artifact.size_bytes)}` : ''}
                {artifact.truncated ? ' · đã rút gọn' : ''}
                {' · '}{expiresLabel}
              </p>
            </div>
            <a
              href={url}
              download={artifact.filename}
              className={cn(
                'flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                isJson
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700',
              )}
            >
              <Download className="h-3 w-3" />
              {isJson ? 'Tải JSON' : 'Tải CSV'}
            </a>
          </div>
        );
      })}
    </div>
  );
}

// ─── Memory & Presentation panels ────────────────────────────────────────────

function MemoriesPanel({ memories }: { memories?: AiKnowledgeNugget[] | null }) {
  const [open, setOpen] = useState(false);
  if (!memories || memories.length === 0) return null;
  return (
    <div className="mt-2.5 border rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-violet-50/60 hover:bg-violet-50 dark:bg-violet-950/20 dark:hover:bg-violet-950/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <BrainCog className="h-3 w-3 text-violet-500" />
          <span className="text-[10px] font-medium text-violet-700 dark:text-violet-300 uppercase tracking-wide">
            Trí nhớ liên quan ({memories.length})
          </span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="divide-y divide-border/50">
          {memories.map((m, i) => (
            <div key={i} className="px-3 py-2 bg-background/60">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] leading-snug text-foreground/90">{m.summary_vi}</p>
                  {m.time_range?.from_date && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      <History className="h-2.5 w-2.5 inline mr-0.5" />
                      {m.time_range.from_date} → {m.time_range.to_date ?? '…'}
                    </p>
                  )}
                </div>
                {m.similarity != null && (
                  <span className="shrink-0 text-[10px] font-mono text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 rounded px-1">
                    {Math.round(m.similarity * 100)}%
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {m.intent && (
                  <span className="text-[9px] rounded-full px-1.5 py-0 bg-muted text-muted-foreground border">{m.intent}</span>
                )}
                {m.template_key && (
                  <span className="text-[9px] rounded-full px-1.5 py-0 bg-muted text-muted-foreground border font-mono">{m.template_key}</span>
                )}
                {m.hit_count != null && m.hit_count > 1 && (
                  <span className="text-[9px] rounded-full px-1.5 py-0 bg-muted text-muted-foreground border">{m.hit_count} lần</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChartSpecDataset { label?: string; data: number[] }
interface ChartSpec {
  type?: string;
  data?: { labels?: string[]; datasets?: ChartSpecDataset[] };
}

function TrendChart({ spec }: { spec?: ChartSpec | null }) {
  const [open, setOpen] = useState(false);
  if (!spec?.data?.labels?.length || !spec.data.datasets?.length) return null;
  const labels = spec.data.labels;
  const datasets = spec.data.datasets;
  const chartData = labels.map((label, i) => {
    const entry: Record<string, unknown> = { label };
    datasets.forEach((ds) => {
      entry[ds.label ?? 'value'] = ds.data[i] ?? 0;
    });
    return entry;
  });
  const dataKeys = datasets.map((ds) => ds.label ?? 'value');
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="mt-2.5 border rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-indigo-50/60 hover:bg-indigo-50 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <BarChart2 className="h-3 w-3 text-indigo-500" />
          <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Biểu đồ xu hướng</span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="p-3 bg-background/80">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => {
                  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                  return String(v);
                }}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  color: 'hsl(var(--popover-foreground))',
                }}
                formatter={(value: number, name: string) => [
                  value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }),
                  name,
                ]}
              />
              {dataKeys.map((key, ki) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[ki % colors.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: colors[ki % colors.length] }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 justify-center mt-1">
            {dataKeys.map((key, ki) => (
              <div key={key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-4 h-0.5 rounded-full inline-block" style={{ backgroundColor: colors[ki % colors.length] }} />
                {key}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function parseMdTable(md: string): { columns: string[]; rows: string[][] } | null {
  const lines = md.trim().split('\n').filter(Boolean);
  if (lines.length < 3) return null;
  const parseRow = (line: string) =>
    line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
  const columns = parseRow(lines[0]);
  if (!columns.length) return null;
  const rows = lines.slice(2).map(parseRow).filter(r => r.length > 0);
  return { columns, rows };
}

function PresentationPanel({ presentation }: { presentation?: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!presentation) return null;
  const md = presentation.markdown_table as string | undefined;
  if (!md) return null;
  const parsed = parseMdTable(md);
  if (!parsed) return null;
  const truncated = presentation.table_truncated as boolean | undefined;
  const fullCount = presentation.full_row_count as number | undefined;

  return (
    <div className="mt-2.5 border rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-sky-50/60 hover:bg-sky-50 dark:bg-sky-950/20 dark:hover:bg-sky-950/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Table2 className="h-3 w-3 text-sky-500" />
          <span className="text-[10px] font-medium text-sky-700 dark:text-sky-300 uppercase tracking-wide">
            Bảng dữ liệu{truncated && fullCount ? ` (${parsed.rows.length}/${fullCount} dòng)` : ` (${parsed.rows.length} dòng)`}
          </span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="max-h-[300px] overflow-auto bg-background/80">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead className="sticky top-0 bg-muted/90 shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
              <tr>
                {parsed.columns.map((col) => (
                  <th key={col} className="text-left whitespace-nowrap px-2.5 py-1.5 font-semibold">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((row, ri) => (
                <tr key={ri} className="even:bg-muted/20 hover:bg-muted/40 transition-colors">
                  {parsed.columns.map((_, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 border-t border-muted/30 max-w-[180px] truncate" title={row[ci] ?? ''}>
                      {row[ci] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && (
            <p className="text-[10px] text-muted-foreground px-3 py-1.5 border-t">
              … đã rút gọn, xem đầy đủ trong file CSV
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionsPanel({ suggestions, onSelect }: { suggestions?: string[] | null; onSelect: (q: string) => void }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles className="h-3 w-3 text-violet-500" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Câu hỏi tiếp theo</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(q)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-foreground/80',
              'bg-background hover:bg-violet-50 hover:text-violet-700 hover:border-violet-300',
              'dark:hover:bg-violet-950/30 dark:hover:text-violet-300 dark:hover:border-violet-700',
              'transition-colors cursor-pointer',
            )}
          >
            <span>{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RowsPreviewTable({ rows, previewCap }: { rows: Record<string, unknown>[]; previewCap?: number | null }) {
  const [collapsed, setCollapsed] = useState(true);
  const columns = useMemo(() => collectPreviewColumns(rows), [rows]);

  const downloadCsv = useCallback(() => {
    const body = `\uFEFF${buildPreviewCsv(rows)}`;
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `fern-ai-preview-${ts}.csv`;
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
    <div className="mt-2.5 border rounded-xl overflow-hidden text-xs bg-background shadow-sm">
      {/* Use div + role=button to avoid nested-button HTML violation */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(v => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5">
          <Database className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground">
            Dữ liệu thực tế ({rows.length} / {capLabel} dòng)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadCsv(); }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] bg-background border hover:bg-muted/60 transition-colors"
          >
            <Download className="h-2.5 w-2.5" />
            CSV
          </button>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </div>
      {!collapsed && (
        <div className="max-h-[min(40vh,300px)] overflow-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead className="sticky top-0 z-[1] bg-muted/90 shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="text-left whitespace-nowrap px-2.5 py-1.5 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="even:bg-muted/20 hover:bg-muted/40 transition-colors">
                  {columns.map((col) => {
                    const cell = formatPreviewCell(row[col]);
                    return (
                      <td key={col} className="px-2.5 py-1.5 align-top border-t border-muted/30 max-w-[200px] truncate" title={cell}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TechDetailsPanel({ meta }: { meta: AiQueryResponse }) {
  const [open, setOpen] = useState(false);
  const source: AiDataSourceContext | null | undefined = meta.data_source_context;
  const escalation = getEscalationInfo(meta);
  const availableMin = source?.available_range?.['min_date'];
  const availableMax = source?.available_range?.['max_date'];
  const requestedFrom = source?.requested_range?.['from_date'];
  const requestedTo = source?.requested_range?.['to_date'];
  const availableText = availableMin || availableMax
    ? `${String(availableMin ?? '—')} → ${String(availableMax ?? '—')}` : '—';
  const requestedText = requestedFrom || requestedTo
    ? `${String(requestedFrom ?? '—')} → ${String(requestedTo ?? '—')}` : '—';
  const reviewIssueLines = useMemo(
    () => normalizeQualityIssueLines(meta.quality_report?.issues),
    [meta.quality_report?.issues],
  );

  return (
    <div className="mt-2 border rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {open ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : <Eye className="h-3 w-3 text-muted-foreground" />}
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Thông tin kỹ thuật</span>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2 bg-muted/10">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div>
              <span className="text-muted-foreground text-[10px]">Template</span>
              <p className="font-mono text-[11px] mt-0.5">{meta.template_key ?? '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-[10px]">Rows</span>
              <p className="font-mono text-[11px] mt-0.5">{meta.row_count}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-[10px]">Confidence</span>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', meta.confidence >= 0.8 ? 'bg-emerald-500' : meta.confidence >= 0.6 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${Math.round(meta.confidence * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono w-8 text-right">{Math.round(meta.confidence * 100)}%</span>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground text-[10px]">Latency</span>
              <p className="font-mono text-[11px] mt-0.5">{meta.latency_ms} ms</p>
            </div>
            {meta.supervisor_intent && (
              <div className="col-span-2">
                <span className="text-muted-foreground text-[10px]">Intent</span>
                <p className="font-mono text-[11px] mt-0.5">{meta.supervisor_intent}</p>
              </div>
            )}
            {escalation.candidate && (
              <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50/80 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300">
                  ⚠ {escalation.reason ?? 'Cần gửi kiểm tra lại để xác minh thêm.'}
                </p>
              </div>
            )}
            {source && (
              <div className="col-span-2 rounded-md border bg-background/60 p-2 space-y-1">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Database className="h-3 w-3" />
                  <span className="text-[10px] font-medium">Nguồn dữ liệu</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <span className="text-muted-foreground">Dataset</span>
                  <span className="font-mono break-all">{source.primary_dataset ?? '—'}</span>
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-mono">{availableText}</span>
                  <span className="text-muted-foreground">Requested</span>
                  <span className="font-mono">{requestedText}</span>
                  <span className="text-muted-foreground">Coverage</span>
                  <span className="font-mono">{source.coverage_status ?? '—'}</span>
                </div>
                {source.caveats && source.caveats.length > 0 && (
                  <div className="space-y-0.5 mt-1">
                    {source.caveats.slice(0, 2).map((caveat, idx) => (
                      <p key={idx} className="text-[10px] text-amber-700 dark:text-amber-300 leading-snug">⚠ {caveat}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {reviewIssueLines.length > 0 && (
              <div className="col-span-2">
                <span className="text-muted-foreground text-[10px]">Review issues</span>
                <ul className="mt-0.5 space-y-0.5">
                  {reviewIssueLines.map((line, idx) => (
                    <li key={idx} className="text-[10px] font-mono text-muted-foreground/80">· {line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <span className="text-muted-foreground text-[10px]">Correlation ID</span>
            <p className="font-mono text-[10px] mt-0.5 break-all text-muted-foreground/60">{meta.correlation_id}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function FormattedMessageContent({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return (
    <div className="whitespace-pre-wrap break-words space-y-0.5">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        const isFootnote = trimmed.length > 2 && trimmed.startsWith('_') && trimmed.endsWith('_');
        if (!line) return <div key={idx} className="h-2" aria-hidden />;
        return (
          <div
            key={idx}
            className={cn(
              line.startsWith('- ') || /^\d+\.\s/.test(line) ? 'pl-3' : undefined,
              isFootnote ? 'text-xs italic text-muted-foreground/70 mt-2' : undefined,
            )}
          >
            {renderInlineMarkdown(isFootnote ? trimmed.slice(1, -1) : line)}
          </div>
        );
      })}
    </div>
  );
}

function ChatBubble({
  message,
  onReview,
  reviewId,
  reviewPending,
  onSuggestionSelect,
}: {
  message: AiMessage;
  onReview?: (message: AiMessage) => void;
  reviewId?: string;
  reviewPending?: boolean;
  onSuggestionSelect?: (q: string) => void;
}) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';
  const meta = message.metadata;
  const escalation = getEscalationInfo(meta);

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold',
        isUser
          ? 'bg-primary text-primary-foreground'
          : isError
          ? 'bg-red-100 text-red-600 border border-red-200 dark:bg-red-950/50 dark:border-red-900/60'
          : 'bg-sidebar text-sidebar-primary border border-sidebar-border',
      )}>
        {isUser ? 'U' : isError ? '!' : <BrainCircuit className="h-4 w-4" />}
      </div>

      {/* Content area */}
      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>

        {/* Role label + badges */}
        {!isUser && !isError && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">Phân tích · FERN</span>
            {meta?.audience && <AudienceBadge audience={meta.audience} />}
            {meta?.quality_report && <QualityBadge report={meta.quality_report} />}
            {meta?.response_kind === 'clarification' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-warning/35 text-warning-foreground bg-warning/10">
                Cần làm rõ
              </Badge>
            )}
          </div>
        )}

        {meta?.data_source_context?.caveats && meta.data_source_context.caveats.length > 0 && (
          <div className="w-full max-w-[min(100%,42rem)]">
            <ProvenanceBanner caveats={meta.data_source_context.caveats} />
          </div>
        )}

        {/* Main bubble */}
        <div className={cn(
          'rounded-sm px-4 py-3.5 text-sm leading-relaxed max-w-[min(100%,42rem)] shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tl-xl rounded-tr-md rounded-br-xl rounded-bl-xl'
            : isError
            ? 'bg-red-50/90 text-red-800 border border-red-200/80 dark:bg-red-950/35 dark:text-red-100 dark:border-red-900/50'
            : 'bg-card text-card-foreground border border-border rounded-tl-md rounded-tr-xl rounded-br-xl rounded-bl-xl',
        )}>
          <FormattedMessageContent content={message.content} />
        </div>

        {/* Below-bubble rich panels (assistant only) */}
        {!isUser && !isError && meta && (
          <div className="w-full mt-1 space-y-0">

            {/* Workflow pipeline */}
            {meta.workflow_steps && meta.workflow_steps.length > 0 && (
              <WorkflowPipeline steps={meta.workflow_steps} />
            )}

            {/* Export artifacts (CSV + JSON) */}
            {meta.exports && meta.exports.length > 0 && (
              <ExportsPanel exports={meta.exports} />
            )}

            {/* Backend-rendered markdown preview table */}
            {meta.presentation && !meta.rows_preview?.length && (
              <PresentationPanel presentation={meta.presentation as Record<string, unknown>} />
            )}

            {/* Trend / sparkline chart from chart_spec */}
            {(meta.chart_spec ?? (meta.presentation as Record<string, unknown> | null | undefined)?.chart_spec) && (
              <TrendChart
                spec={(meta.chart_spec ?? (meta.presentation as Record<string, unknown>).chart_spec) as ChartSpec}
              />
            )}

            {/* Data preview table — collapsible (raw rows; shown if available) */}
            {meta.rows_preview && meta.rows_preview.length > 0 && (
              <RowsPreviewTable rows={meta.rows_preview} previewCap={meta.preview_max_rows} />
            )}

            {/* Long-term memory hits */}
            {meta.relevant_memories && meta.relevant_memories.length > 0 && (
              <MemoriesPanel memories={meta.relevant_memories as AiKnowledgeNugget[]} />
            )}

            {/* Suggestions */}
            {onSuggestionSelect && meta.suggestions && meta.suggestions.length > 0 && (
              <SuggestionsPanel suggestions={meta.suggestions} onSelect={onSuggestionSelect} />
            )}

            {/* Action row */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {escalation.candidate && (
                <div className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Cần kiểm tra thêm</span>
                </div>
              )}
              {onReview && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2"
                  disabled={reviewPending || Boolean(reviewId)}
                  onClick={() => onReview(message)}
                >
                  {reviewPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ShieldCheck className="h-2.5 w-2.5" />}
                  {reviewId ? 'Đã gửi kiểm tra' : 'Kiểm tra lại'}
                </Button>
              )}
              {reviewId && <span className="text-[10px] text-muted-foreground/60 font-mono">{reviewId.slice(0, 8)}</span>}
            </div>

            {/* Technical details (collapsible) */}
            <TechDetailsPanel meta={meta} />
          </div>
        )}

        <p className={cn('text-[10px] text-muted-foreground/50 mt-1 px-1', isUser && 'text-right')}>
          {message.timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 max-w-3xl mx-auto">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sidebar text-sidebar-primary border border-sidebar-border flex items-center justify-center">
        <BrainCircuit className="h-4 w-4 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0 max-w-[42rem]">
        <div className="mb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">Phân tích · FERN</span>
        </div>
        <div className="bg-card border border-border rounded-tl-md rounded-tr-xl rounded-br-xl rounded-bl-xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="font-medium">Đang đọc câu hỏi và truy vấn dữ liệu…</span>
          </div>
          <WorkflowPipeline steps={PENDING_WORKFLOW_STEPS.map((s, i) => ({ ...s, status: i < 2 ? 'done' : 'skipped' }))} pending />
        </div>
      </div>
    </div>
  );
}

// ─── Main module ──────────────────────────────────────────────────────────────

export function AiQueryModule() {
  const { token, scope, availableScopes } = useShellRuntime();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [reviewIds, setReviewIds] = useState<Record<string, string>>({});
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestedOutletIds = useMemo(
    () => resolveRequestedOutletIds(scope, availableScopes ?? []),
    [availableScopes, scope],
  );

  const { data: readiness, isLoading: checkingReady, refetch: recheckReady } = useQuery({
    queryKey: ['ai-query', 'ready'],
    queryFn: () => aiQueryApi.ready(token),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const isHealthy = readiness?.status === 'ok' || readiness?.status === 'ready';
  const showServiceWarning = !checkingReady && readiness !== undefined && !isHealthy;

  const reviewMutation = useMutation({
    mutationFn: (payload: { message: AiMessage; question: string }) =>
      aiQueryApi.requestReview(
        {
          correlation_id: payload.message.metadata?.correlation_id,
          question: payload.question,
          answer: payload.message.content,
          reason: 'Người dùng yêu cầu kiểm tra lại số liệu/câu trả lời.',
          conversation_turns: buildConversationTurns(messages),
          rows_preview: payload.message.metadata?.rows_preview ?? null,
          workflow_summary: payload.message.metadata?.workflow_summary ?? null,
        },
        token,
      ),
    onMutate: ({ message }) => { setReviewPendingId(message.id); },
    onSuccess: (data, { message }) => {
      setReviewIds((prev) => ({ ...prev, [message.id]: data.review_id }));
    },
    onError: (error) => {
      const errMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: 'error',
        content: isApiError(error) ? error.message : 'Không gửi được yêu cầu kiểm tra lại. Vui lòng thử lại.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    },
    onSettled: () => { setReviewPendingId(null); },
  });

  const { mutate: submit, isPending } = useMutation({
    mutationFn: (payload: {
      question: string;
      conversation_turns: AiConversationTurn[];
      preview_max_rows: number;
      requested_outlet_ids?: string[];
    }) =>
      aiQueryApi.query(
        {
          question: payload.question,
          preview_max_rows: payload.preview_max_rows,
          ...(payload.requested_outlet_ids?.length
            ? { requested_outlet_ids: payload.requested_outlet_ids }
            : {}),
          ...(payload.conversation_turns.length > 0 ? { conversation_turns: payload.conversation_turns } : {}),
        },
        token,
      ),
    onMutate: ({ question }) => {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'user',
        content: question,
        timestamp: new Date(),
      }]);
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        metadata: data,
      }]);
    },
    onError: (error) => {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'error',
        content: isApiError(error) ? error.message : 'Có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại.',
        timestamp: new Date(),
      }]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPending]);

  const doSubmit = useCallback((q: string) => {
    if (!q.trim() || isPending) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    submit({
      question: q.trim(),
      conversation_turns: buildConversationTurns(messages),
      preview_max_rows: inferPreviewMaxRows(q, messages),
      requested_outlet_ids: requestedOutletIds,
    });
  }, [isPending, messages, requestedOutletIds, submit]);

  const handleSubmit = useCallback(() => doSubmit(input), [doSubmit, input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }, [handleSubmit]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const questionForAssistantMessage = useCallback((messageId: string): string => {
    const idx = messages.findIndex((m) => m.id === messageId);
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return '';
  }, [messages]);

  const handleReview = useCallback((message: AiMessage) => {
    if (!message.metadata || reviewIds[message.id]) return;
    reviewMutation.mutate({
      message,
      question: questionForAssistantMessage(message.id) || message.content.slice(0, 500),
    });
  }, [questionForAssistantMessage, reviewIds, reviewMutation]);

  const latestAssistantMeta = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.metadata) return m.metadata;
    }
    return null;
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background text-foreground font-sans">

      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-6 py-4 bg-card/90 backdrop-blur-md">
        <div className="flex items-center justify-between max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-lg bg-sidebar flex items-center justify-center shadow-md border border-sidebar-border">
              <BrainCircuit className="h-5 w-5 text-sidebar-primary" />
              {isHealthy && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-card" />
              )}
            </div>
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h1 className="text-lg font-semibold tracking-tight text-foreground">Insight Desk</h1>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium border-border text-muted-foreground bg-muted/50">
                  Agent
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Trả lời từ dữ liệu vận hành — có trích dẫn phạm vi</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ReadinessIndicator readiness={readiness} checking={checkingReady} />

            {latestAssistantMeta && (
              <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground border-l border-border pl-3">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {latestAssistantMeta.latency_ms} ms
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {Math.round(latestAssistantMeta.confidence * 100)}%
                </span>
              </div>
            )}

            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted">
                <RotateCcw className="h-3 w-3" />
                Xóa
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-8 space-y-8 max-w-5xl mx-auto w-full">

        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center py-16 select-none">
            <div className="w-20 h-20 rounded-2xl bg-sidebar flex items-center justify-center mb-6 shadow-lg border border-sidebar-border">
              <BrainCircuit className="h-10 w-10 text-sidebar-primary" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground mb-2 text-center">Đặt câu hỏi phân tích</h2>
            <p className="text-sm text-muted-foreground max-w-md text-center mb-10 leading-relaxed">
              Agent đọc dữ liệu ClickHouse/Postgres trong phạm vi quyền của bạn. Khi kỳ hỏi chưa có snapshot mới, hệ thống tự dùng cửa sổ lịch sử gần nhất và ghi rõ phạm vi.
            </p>
            <div className="w-full max-w-lg space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.18em] mb-4 text-center">Gợi ý</p>
              {SAMPLE_QUESTIONS.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  onClick={() => { setInput(label); textareaRef.current?.focus(); }}
                  className={cn(
                    'w-full flex items-center gap-3 text-left px-4 py-3 rounded-lg border border-border',
                    'bg-card hover:bg-muted/60 hover:border-primary/30',
                    'text-sm text-foreground transition-all shadow-sm',
                  )}
                >
                  <Icon className="h-4 w-4 text-primary flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="max-w-3xl mx-auto w-full">
            <ChatBubble
            key={msg.id}
            message={msg}
            onReview={handleReview}
            reviewId={reviewIds[msg.id]}
            reviewPending={reviewPendingId === msg.id}
            onSuggestionSelect={doSubmit}
            />
          </div>
        ))}

        {isPending && (
          <div className="max-w-3xl mx-auto w-full">
            <TypingIndicator />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Service warning */}
      {showServiceWarning && (
        <div className="flex-shrink-0 mx-6 mb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-400 flex-1">
              {readiness?.status === 'degraded'
                ? 'AI service chưa đủ dependency (ClickHouse / OpenSearch / graph). Câu hỏi có thể thất bại.'
                : readiness === null
                ? 'Không kết nối được tới AI service qua gateway.'
                : 'AI service đang khởi động, câu hỏi có thể thất bại.'}
            </span>
            <button onClick={() => recheckReady()} className="text-xs underline text-amber-600 dark:text-amber-400 hover:no-underline shrink-0">
              Kiểm tra lại
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border px-4 sm:px-6 py-4 bg-card/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto w-full flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Đặt câu hỏi về doanh thu, tồn kho, sản phẩm, nhân sự... (Enter để gửi)"
              rows={1}
              disabled={isPending}
              className={cn(
                'w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'placeholder:text-muted-foreground',
                'min-h-[48px] max-h-[160px] overflow-y-auto shadow-inner',
              )}
              style={{ height: 'auto' }}
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isPending}
            size="icon"
            className={cn(
              'h-12 w-12 rounded-lg flex-shrink-0 transition-all shadow-md',
              'bg-primary hover:bg-primary/90 text-primary-foreground',
              'disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none',
            )}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center max-w-5xl mx-auto">
          Kết quả dựa trên dữ liệu có trong hệ thống; khi kỳ hỏi vượt snapshot, phạm vi được thu hẹp tự động và hiển thị ở trên cùng tin nhắn.
        </p>
      </div>
    </div>
  );
}
