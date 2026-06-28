import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PosOrderGate } from '@/routes/pos-order/guards/PosOrderGate';

const mockUseAuth = vi.fn();
const mockUseActiveOutlet = vi.fn();

vi.mock('@/auth/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/routes/pos-order/hooks/use-active-outlet', () => ({
  useActiveOutlet: () => mockUseActiveOutlet(),
}));

vi.mock('@/routes/pos-order/PosOrderPage', () => ({
  default: () => <div data-testid="pos-order-page">POS Order</div>,
}));

function renderGate() {
  return render(
    <MemoryRouter>
      <PosOrderGate />
    </MemoryRouter>,
  );
}

describe('PosOrderGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading while auth is initializing', () => {
    mockUseAuth.mockReturnValue({ session: null, loading: true });
    mockUseActiveOutlet.mockReturnValue({ isLoading: false, outletId: '1' });

    renderGate();
    expect(screen.getByText('Đang khởi tạo phiên...')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to login', () => {
    mockUseAuth.mockReturnValue({ session: null, loading: false });
    mockUseActiveOutlet.mockReturnValue({ isLoading: false, outletId: '1' });

    renderGate();
    expect(screen.queryByTestId('pos-order-page')).toBeNull();
  });

  it('shows forbidden view when outlet access is denied', () => {
    mockUseAuth.mockReturnValue({ session: { accessToken: 'token' }, loading: false });
    mockUseActiveOutlet.mockReturnValue({
      isLoading: false,
      outletId: null,
      errorMessage: 'Bạn không có quyền truy cập outlet này.',
    });

    renderGate();
    expect(screen.getByText('Bạn không có quyền truy cập outlet này.')).toBeInTheDocument();
  });

  it('renders cashier page when auth and outlet are valid', () => {
    mockUseAuth.mockReturnValue({ session: { accessToken: 'token' }, loading: false });
    mockUseActiveOutlet.mockReturnValue({
      isLoading: false,
      outletId: '42',
      outletName: 'Outlet A',
      currencyCode: 'VND',
      outlets: [],
      setOutletId: vi.fn(),
    });

    renderGate();
    expect(screen.getByTestId('pos-order-page')).toBeInTheDocument();
  });
});
