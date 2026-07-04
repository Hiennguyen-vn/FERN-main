import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PublicOrderPage from '@/pages/PublicOrderPage';

function renderPublicOrder(entry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[entry]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/order/:tableToken" element={<PublicOrderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tablePayload = {
  tableToken: 'tbl_hcm1_u7k29q',
  tableCode: 'T1',
  tableName: 'Table 1',
  status: 'active',
  outletCode: 'VN-HCM-001',
  outletName: 'Saigon Central Outlet',
  currencyCode: 'VND',
  timezoneName: 'Asia/Ho_Chi_Minh',
  businessDate: '2026-04-11',
};

const latteMenuItem = {
  productId: '5000',
  code: 'LATTE',
  name: 'Cafe Latte',
  categoryCode: 'beverage',
  description: 'Steamed milk and espresso',
  imageUrl: null,
  priceValue: 65000,
  currencyCode: 'VND',
};

function stubPublicOrderFetch(options?: {
  onCreateOrder?: (init?: RequestInit) => Response | Promise<Response>;
}) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString());
    if (url.includes('/api/v1/sales/public/tables/tbl_hcm1_u7k29q/menu')) {
      return Promise.resolve(new Response(JSON.stringify([latteMenuItem]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (url.includes('/api/v1/sales/public/tables/tbl_hcm1_u7k29q/orders/ord_public_123')) {
      return Promise.resolve(new Response(JSON.stringify({
        orderToken: 'ord_public_123',
        tableCode: 'T1',
        tableName: 'Table 1',
        outletCode: 'VN-HCM-001',
        outletName: 'Saigon Central Outlet',
        currencyCode: 'VND',
        orderStatus: 'order_created',
        paymentStatus: 'pending',
        totalAmount: 65000,
        note: null,
        createdAt: '2026-04-11T12:34:00Z',
        items: [{
          productId: '5000',
          productCode: 'LATTE',
          productName: 'Cafe Latte',
          quantity: 1,
          unitPrice: 65000,
          lineTotal: 65000,
          note: null,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (url.includes('/api/v1/sales/public/tables/tbl_hcm1_u7k29q/orders') && init?.method === 'POST') {
      const response = options?.onCreateOrder?.(init) ?? new Response(JSON.stringify({
        orderToken: 'ord_public_123',
        tableCode: 'T1',
        tableName: 'Table 1',
        outletCode: 'VN-HCM-001',
        outletName: 'Saigon Central Outlet',
        currencyCode: 'VND',
        orderStatus: 'order_created',
        paymentStatus: 'pending',
        totalAmount: 65000,
        note: null,
        createdAt: '2026-04-11T12:34:00Z',
        items: [{
          productId: '5000',
          productCode: 'LATTE',
          productName: 'Cafe Latte',
          quantity: 1,
          unitPrice: 65000,
          lineTotal: 65000,
          note: null,
        }],
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
      return Promise.resolve(response);
    }
    if (url.includes('/api/v1/sales/public/tables/tbl_hcm1_u7k29q')) {
      return Promise.resolve(new Response(JSON.stringify(tablePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

describe('PublicOrderPage', () => {
  afterEach(() => {
    try {
      window.sessionStorage?.clear?.();
    } catch {
      // jsdom storage can be reconfigured by the runner environment.
    }
    try {
      window.localStorage?.clear?.();
    } catch {
      // jsdom storage can be reconfigured by the runner environment.
    }
    vi.unstubAllGlobals();
  });

  it('renders the public menu shell from backend truth', async () => {
    vi.stubGlobal('fetch', stubPublicOrderFetch());

    renderPublicOrder('/order/tbl_hcm1_u7k29q');

    expect((await screen.findAllByText(/Saigon Central Outlet/i)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Cafe Latte/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick add Cafe Latte/i })).toBeInTheDocument();
    expect(screen.getByText(/Pay at counter/i)).toBeInTheDocument();
  });

  it('resumes a submitted receipt from the order query parameter', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString());
      if (url.includes('/api/v1/sales/public/tables/tbl_hcm1_u7k29q/orders/ord_public_123')) {
        return Promise.resolve(new Response(JSON.stringify({
          orderToken: 'ord_public_123',
          tableCode: 'T1',
          tableName: 'Table 1',
          outletCode: 'VN-HCM-001',
          outletName: 'Saigon Central Outlet',
          currencyCode: 'VND',
          orderStatus: 'order_created',
          paymentStatus: 'pending',
          totalAmount: 130000,
          note: 'No sugar',
          createdAt: '2026-04-11T12:34:00Z',
          items: [{
            productId: '5000',
            productCode: 'LATTE',
            productName: 'Cafe Latte',
            quantity: 2,
            unitPrice: 65000,
            lineTotal: 130000,
            note: 'Less ice',
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (url.includes('/api/v1/sales/public/tables/tbl_hcm1_u7k29q')) {
        return Promise.resolve(new Response(JSON.stringify(tablePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPublicOrder('/order/tbl_hcm1_u7k29q?order=ord_public_123');

    expect(await screen.findByText(/Order received by the kitchen/i)).toBeInTheDocument();
    expect(screen.getByText(/Cafe Latte/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Refresh/i }).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it('submits a public order and switches into receipt mode on success', async () => {
    vi.stubGlobal('fetch', stubPublicOrderFetch());

    renderPublicOrder('/order/tbl_hcm1_u7k29q');

    fireEvent.click(await screen.findByRole('button', { name: /Quick add Cafe Latte/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send order/i }));

    expect(await screen.findByText(/Order received by the kitchen/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Refresh/i }).length).toBeGreaterThan(0);
  });

  it('submits from the mobile cart sheet when viewport is narrow', async () => {
    vi.stubGlobal('fetch', stubPublicOrderFetch());
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });

    renderPublicOrder('/order/tbl_hcm1_u7k29q');

    fireEvent.click(await screen.findByRole('button', { name: /Quick add Cafe Latte/i }));
    fireEvent.click(screen.getByRole('button', { name: /View order, 1 item/i }));

    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Send order/i }));

    expect(await screen.findByText(/Order received by the kitchen/i)).toBeInTheDocument();
  });
});
