import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiQueryModule } from '@/components/ai-query/AiQueryModule';
import { aiQueryApi } from '@/api/ai-query-api';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock('@/hooks/use-shell-runtime', () => ({
  useShellRuntime: () => ({
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
  }),
}));

vi.mock('@/api/ai-query-api', () => ({
  aiQueryApi: {
    ready: vi.fn().mockResolvedValue({ status: 'ok', issues: [] }),
    query: vi.fn(),
    requestReview: vi.fn(),
  },
}));

describe('AiQueryModule', () => {
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
    expect(screen.getByText('Đặt câu hỏi phân tích')).toBeTruthy();
    expect(screen.getByText('Doanh thu 7 ngày qua theo cửa hàng?')).toBeTruthy();
  });

  it('submits requested outlet ids from the selected region scope', async () => {
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
          requested_outlet_ids: ['3491811094483714048', '3491811149961773057'],
        }),
        'test-token',
      );
    });
  });
});
