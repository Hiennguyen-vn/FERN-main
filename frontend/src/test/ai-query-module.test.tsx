import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiQueryModule } from '@/components/ai-query/AiQueryModule';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock('@/auth/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    session: {
      accessToken: 'test-token',
      user: { id: '1', displayName: 'CS Admin', roles: ['region_manager'] },
    },
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
});
