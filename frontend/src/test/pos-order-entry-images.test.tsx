import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderEntry } from '@/components/pos/OrderEntry';

vi.mock('@/hooks/use-shell-runtime', () => ({
  useShellRuntime: () => ({
    token: 'test-token',
    scope: {
      level: 'outlet',
      regionId: '100',
      regionName: 'Ho Chi Minh',
      outletId: '10',
      outletName: 'VN-HCM Outlet 1',
    },
    availableScopes: [],
    user: {
      id: '1',
      displayName: 'Cashier',
      email: 'cashier@test.local',
      persona: 'cashier',
      avatarInitials: 'CA',
    },
  }),
}));

vi.mock('@/api/fern-api', () => ({
  productApi: {
    products: vi.fn().mockResolvedValue([
      {
        id: '5000',
        code: 'LATTE',
        name: 'Cafe Latte',
        categoryCode: 'beverage',
        status: 'active',
        imageUrl: 'https://images.example.com/latte.jpg',
      },
    ]),
    prices: vi.fn().mockResolvedValue([
      { productId: '5000', outletId: '10', currencyCode: 'VND', priceValue: 45000, priceAmount: 45000 },
    ]),
  },
  salesApi: {},
}));

vi.mock('@/api/fnb-api', () => ({
  fnbApi: {
    getProductModifierGroups: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/api/crm-api', () => ({
  crmApi: {
    customers: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

describe('OrderEntry product images', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders seeded product images in POS product cards', async () => {
    render(
      <OrderEntry
        sessionCode="POS-20260703-001"
        outletName="VN-HCM Outlet 1"
        cashierName="Cashier"
        currencyCode="VND"
        onBack={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Cafe Latte')).toBeInTheDocument();
    });

    const image = screen.getByRole('img', { name: 'Cafe Latte' });
    expect(image).toHaveAttribute('src', 'https://images.example.com/latte.jpg');
  });
});
