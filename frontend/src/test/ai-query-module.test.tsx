import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiQueryModule } from '@/components/ai-query/AiQueryModule';
import { aiQueryApi } from '@/api/ai-query-api';
import type { ScopeOption, ShellScope } from '@/types/shell';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

type ShellRuntimeTestDouble = {
  token: string;
  user: { id: string; displayName: string };
  scope: ShellScope;
  availableScopes: ScopeOption[];
};

const shellRuntimeMock = vi.hoisted((): { runtime: ShellRuntimeTestDouble } => ({
  runtime: {
    token: 'test-token',
    user: { id: '1', displayName: 'CS Admin' },
    scope: { level: 'region', regionId: '1001', regionName: 'HCM' },
    availableScopes: [
      {
        id: 'system',
        name: 'All Regions',
        level: 'system',
        children: [
          {
            id: '1001',
            name: 'HCM',
            level: 'region',
            children: [
              { id: '3491811094483714048', name: 'Saigon Central', level: 'outlet' },
              { id: '3491811149961773057', name: 'District 7', level: 'outlet' },
            ],
          },
        ],
      },
    ],
  },
}));

vi.mock('@/hooks/use-shell-runtime', () => ({
  useShellRuntime: () => shellRuntimeMock.runtime,
}));

vi.mock('@/api/ai-query-api', () => ({
  aiQueryApi: {
    ready: vi.fn().mockResolvedValue({ status: 'ok', issues: [] }),
    query: vi.fn(),
    requestReview: vi.fn(),
  },
}));

describe('AiQueryModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellRuntimeMock.runtime.scope = { level: 'region', regionId: '1001', regionName: 'HCM' };
    vi.mocked(aiQueryApi.ready).mockResolvedValue({ status: 'ok', issues: [] });
  });

  it('renders shell and empty-state copy', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <AiQueryModule />
        </QueryClientProvider>,
      );
    });
    expect(screen.getByText('Insight Desk')).toBeTruthy();
    expect(screen.getByText('Phạm vi AI:')).toBeTruthy();
    expect(screen.getByText('HCM · tất cả cửa hàng')).toBeTruthy();
    expect(screen.getByText('Đặt câu hỏi phân tích')).toBeTruthy();
    expect(screen.getByText('Doanh thu 7 ngày qua theo cửa hàng?')).toBeTruthy();
  });

  it('does not submit outlet ids for a selected region scope', async () => {
    vi.mocked(aiQueryApi.query).mockResolvedValueOnce({
      answer: 'ok',
      template_key: 'T22_outlet_rank',
      confidence: 0.96,
      row_count: 1,
      citations: [],
      correlation_id: 'corr-1',
      latency_ms: 12,
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <AiQueryModule />
        </QueryClientProvider>,
      );
    });

    const textarea = screen.getByPlaceholderText('Đặt câu hỏi về doanh thu, tồn kho, sản phẩm, nhân sự... (Enter để gửi)');
    fireEvent.change(textarea, { target: { value: 'Outlet nào có doanh thu yếu nhất?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(aiQueryApi.query).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'Outlet nào có doanh thu yếu nhất?',
        }),
        'test-token',
      );
      expect(vi.mocked(aiQueryApi.query).mock.calls[0]?.[0]).not.toHaveProperty('requested_outlet_ids');
    });
  });

  it('warns and submits only the selected outlet id for all-outlet wording in outlet scope', async () => {
    shellRuntimeMock.runtime.scope = {
      level: 'outlet',
      regionId: '1001',
      regionName: 'HCM',
      outletId: '3491811094483714048',
      outletName: 'Saigon Central',
    };
    vi.mocked(aiQueryApi.query).mockResolvedValueOnce({
      answer: 'ok',
      template_key: null,
      confidence: 0.95,
      row_count: 1,
      citations: [],
      correlation_id: 'corr-outlet',
      latency_ms: 12,
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <AiQueryModule />
        </QueryClientProvider>,
      );
    });

    expect(screen.getByText('Saigon Central')).toBeTruthy();

    const question = 'doanh thu của tất cả cửa hàng hôm nay';
    const textarea = screen.getByPlaceholderText('Đặt câu hỏi về doanh thu, tồn kho, sản phẩm, nhân sự... (Enter để gửi)');
    fireEvent.change(textarea, { target: { value: question } });

    expect(screen.getByText(/Bạn đang ở phạm vi/)).toBeTruthy();
    expect(screen.getByText(/Nếu muốn so sánh nhiều cửa hàng/)).toBeTruthy();

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(aiQueryApi.query).toHaveBeenCalledWith(
        expect.objectContaining({
          question,
          requested_outlet_ids: ['3491811094483714048'],
        }),
        'test-token',
      );
    });
  });

  it('renders markdown tables in assistant answers as a separate table block', async () => {
    vi.mocked(aiQueryApi.query).mockResolvedValueOnce({
      answer: [
        'Tổng quan:',
        '',
        '| # | Cửa hàng | Doanh thu (đ) |',
        '|---|----------|---------------|',
        '| 1 | Outlet VN-HCM-5 | 2.772.000 |',
        '| 2 | Outlet VN-DN-1 | 1.930.500 |',
        '',
        '_Nguồn: analytics.ai_product_daily_',
      ].join('\n'),
      template_key: null,
      confidence: 0.95,
      row_count: 2,
      citations: [],
      correlation_id: 'corr-table',
      latency_ms: 20,
      response_kind: 'answer',
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <AiQueryModule />
        </QueryClientProvider>,
      );
    });

    const textarea = screen.getByPlaceholderText('Đặt câu hỏi về doanh thu, tồn kho, sản phẩm, nhân sự... (Enter để gửi)');
    fireEvent.change(textarea, { target: { value: 'doanh thu Com Tam Bi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    const table = await screen.findByRole('table', { name: 'Bảng trong câu trả lời' });
    expect(table).toBeTruthy();
    expect(screen.getByText('Outlet VN-HCM-5')).toBeTruthy();
    expect(screen.getByText('2.772.000')).toBeTruthy();
    expect(screen.queryByText('|---|----------|---------------|')).toBeNull();
  });

  it('renders query cache information when workflow summary exposes cache metadata', async () => {
    vi.mocked(aiQueryApi.query).mockResolvedValueOnce({
      answer: 'Doanh thu tháng này là 123.000 đ.',
      template_key: 'T32_period_revenue_summary',
      confidence: 0.91,
      row_count: 1,
      citations: [],
      correlation_id: 'corr-cache',
      latency_ms: 18,
      response_kind: 'answer',
      workflow_summary: {
        llm_used: false,
        template_cache: {
          used: true,
          source: 'verified_query_llm_unavailable',
          confidence: 0.91,
        },
        verified_query: {
          template_key: 'T32_period_revenue_summary',
          metric_ids: ['net_revenue', 'txn_count'],
        },
      },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <AiQueryModule />
        </QueryClientProvider>,
      );
    });

    const textarea = screen.getByPlaceholderText('Đặt câu hỏi về doanh thu, tồn kho, sản phẩm, nhân sự... (Enter để gửi)');
    fireEvent.change(textarea, { target: { value: 'doanh thu tháng này' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    const cacheButton = await screen.findByText('Cache truy vấn');
    expect(cacheButton).toBeTruthy();
    expect(screen.getByText('Đã dùng')).toBeTruthy();

    fireEvent.click(cacheButton);

    expect(screen.getByText('Verified query khi LLM không khả dụng')).toBeTruthy();
    expect(screen.getByText('T32_period_revenue_summary')).toBeTruthy();
    expect(screen.getByText('net_revenue, txn_count')).toBeTruthy();
    expect(screen.getAllByText('91%').length).toBeGreaterThan(0);
  });
});
