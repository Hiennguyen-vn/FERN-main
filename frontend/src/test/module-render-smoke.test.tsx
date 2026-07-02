import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LazyRoute } from '@/App';
import { AiQueryModule } from '@/components/ai-query/AiQueryModule';
import { IAMModule } from '@/components/iam/IAMModule';
import { ProcurementModule } from '@/components/procurement/ProcurementModule';
import { WorkforceModule } from '@/components/workforce/WorkforceModule';

vi.mock('@/hooks/use-shell-runtime', () => ({
  useShellRuntime: () => ({
    token: 'test-token',
    scope: {
      level: 'outlet',
      regionId: '100',
      regionName: 'Ho Chi Minh',
      outletId: '10',
      outletName: 'HCM District 1',
    },
    user: {
      id: '1',
      displayName: 'System Admin',
      email: 'admin@test.local',
      persona: 'admin',
      avatarInitials: 'SA',
    },
  }),
}));

vi.mock('@/auth/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    session: {
      accessToken: 'test-token',
      rolesByOutlet: { '10': ['superadmin'] },
      permissionsByOutlet: { '10': ['auth.user.write', 'auth.role.write'] },
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

function stubFetch() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString());
    let payload: unknown = [];
    if (url.includes('/hierarchy')) {
      payload = {
        regions: [{ id: '100', code: 'VN-HCM', name: 'Ho Chi Minh' }],
        outlets: [{ id: '10', code: 'HCM-D1', name: 'HCM District 1', regionId: '100', status: 'active' }],
      };
    } else if (url.includes('/users') || url.includes('/audit') || url.includes('/sessions')) {
      payload = { items: [], limit: 25, offset: 0, totalCount: 0, hasNextPage: false };
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe('module render smoke', () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wraps lazy routes with a module-level error boundary', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): ReactElement {
      throw new Error('render failed');
    }

    render(<LazyRoute><Boom /></LazyRoute>);

    expect(screen.getByText('Module unavailable')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('renders IAM, Workforce, Procurement, and AI Query module shells', async () => {
    stubFetch();

    let view = render(<IAMModule />);
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Effective Access').length).toBeGreaterThan(0);
    view.unmount();

    view = render(<WorkforceModule />);
    expect(screen.getAllByText('Daily Board').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Attendance').length).toBeGreaterThan(0);
    view.unmount();

    render(<ProcurementModule />);
    await waitFor(() => {
      expect(screen.getAllByText('Suppliers').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Purchase Orders').length).toBeGreaterThan(0);
    });

    view = renderWithQueryClient(<AiQueryModule />);
    await waitFor(() => {
      expect(screen.getByText('Insight Desk')).toBeInTheDocument();
      expect(screen.getByText('Đặt câu hỏi phân tích')).toBeInTheDocument();
    });
    view.unmount();
  });
});
