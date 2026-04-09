import type { POSSession, SaleOrder, ProductItem, PaymentMethod } from '@/types/pos';

export const mockSessions: POSSession[] = [
  {
    id: 'ses-001', code: 'POS-20260404-001', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    businessDate: '2026-04-04', openedBy: 'Aisha Patel', openedAt: '2026-04-04T08:00:00',
    status: 'open', orderCount: 47, totalRevenue: 3842.50,
    paymentSummary: [
      { method: 'cash', total: 1520.00, count: 18 },
      { method: 'card', total: 1890.50, count: 24 },
      { method: 'e-wallet', total: 432.00, count: 5 },
    ],
  },
  {
    id: 'ses-002', code: 'POS-20260403-001', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    businessDate: '2026-04-03', openedBy: 'Aisha Patel', openedAt: '2026-04-03T08:00:00',
    closedAt: '2026-04-03T22:15:00', reconciledAt: '2026-04-03T22:30:00',
    status: 'reconciled', orderCount: 156, totalRevenue: 12847.80,
    paymentSummary: [
      { method: 'cash', total: 4280.00, count: 52 },
      { method: 'card', total: 7120.80, count: 89 },
      { method: 'e-wallet', total: 1247.00, count: 12 },
      { method: 'voucher', total: 200.00, count: 3 },
    ],
  },
  {
    id: 'ses-003', code: 'POS-20260402-001', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    businessDate: '2026-04-02', openedBy: 'Marcus Rivera', openedAt: '2026-04-02T08:00:00',
    closedAt: '2026-04-02T21:45:00', reconciledAt: '2026-04-02T22:00:00',
    status: 'reconciled', orderCount: 138, totalRevenue: 11290.40,
    paymentSummary: [
      { method: 'cash', total: 3890.00, count: 48 },
      { method: 'card', total: 6200.40, count: 78 },
      { method: 'e-wallet', total: 1200.00, count: 12 },
    ],
  },
  {
    id: 'ses-004', code: 'POS-20260401-001', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    businessDate: '2026-04-01', openedBy: 'Aisha Patel', openedAt: '2026-04-01T08:00:00',
    closedAt: '2026-04-01T22:00:00',
    status: 'closed', orderCount: 142, totalRevenue: 11850.20,
    paymentSummary: [
      { method: 'cash', total: 4100.00, count: 50 },
      { method: 'card', total: 6550.20, count: 82 },
      { method: 'e-wallet', total: 1200.00, count: 10 },
    ],
  },
];

export const mockOrders: SaleOrder[] = [
  {
    id: 'ord-001', orderNumber: 'SO-4821', sessionId: 'ses-001', sessionCode: 'POS-20260404-001',
    outletName: 'Downtown Flagship', createdBy: 'Aisha Patel', createdAt: '2026-04-04T14:32:00',
    status: 'completed', paymentStatus: 'paid',
    lineItems: [
      { id: 'li-1', productId: 'p-1', productName: 'Grilled Salmon Bowl', category: 'Mains', quantity: 1, unitPrice: 18.50, lineTotal: 18.50 },
      { id: 'li-2', productId: 'p-5', productName: 'Caesar Salad', category: 'Starters', quantity: 1, unitPrice: 12.00, lineTotal: 12.00 },
      { id: 'li-3', productId: 'p-9', productName: 'Sparkling Water', category: 'Beverages', quantity: 2, unitPrice: 3.50, lineTotal: 7.00 },
    ],
    subtotal: 37.50, taxAmount: 5.00, total: 42.50,
    payments: [{ id: 'pay-1', method: 'card', amount: 42.50, reference: 'Visa •••4829', capturedAt: '2026-04-04T14:32:00' }],
  },
  {
    id: 'ord-002', orderNumber: 'SO-4822', sessionId: 'ses-001', sessionCode: 'POS-20260404-001',
    outletName: 'Downtown Flagship', createdBy: 'Aisha Patel', createdAt: '2026-04-04T14:45:00',
    status: 'open', paymentStatus: 'unpaid',
    lineItems: [
      { id: 'li-4', productId: 'p-3', productName: 'Margherita Pizza', category: 'Mains', quantity: 2, unitPrice: 16.00, lineTotal: 32.00 },
      { id: 'li-5', productId: 'p-7', productName: 'Garlic Bread', category: 'Sides', quantity: 1, unitPrice: 6.50, lineTotal: 6.50 },
    ],
    subtotal: 38.50, taxAmount: 5.13, total: 43.63,
    promotionCode: 'LUNCH20', promotionDiscount: 7.70,
    payments: [],
  },
  {
    id: 'ord-003', orderNumber: 'SO-4820', sessionId: 'ses-001', sessionCode: 'POS-20260404-001',
    outletName: 'Downtown Flagship', createdBy: 'Aisha Patel', createdAt: '2026-04-04T14:28:00',
    status: 'completed', paymentStatus: 'paid',
    lineItems: [
      { id: 'li-6', productId: 'p-11', productName: 'Espresso', category: 'Beverages', quantity: 1, unitPrice: 4.00, lineTotal: 4.00 },
      { id: 'li-7', productId: 'p-12', productName: 'Croissant', category: 'Bakery', quantity: 2, unitPrice: 4.00, lineTotal: 8.00 },
    ],
    subtotal: 12.00, taxAmount: 0, total: 12.00,
    payments: [{ id: 'pay-2', method: 'cash', amount: 12.00, capturedAt: '2026-04-04T14:28:00' }],
  },
  {
    id: 'ord-004', orderNumber: 'SO-4819', sessionId: 'ses-001', sessionCode: 'POS-20260404-001',
    outletName: 'Downtown Flagship', createdBy: 'Aisha Patel', createdAt: '2026-04-04T14:15:00',
    status: 'cancelled', paymentStatus: 'unpaid', cancelReason: 'Customer changed mind before payment.',
    lineItems: [
      { id: 'li-8', productId: 'p-2', productName: 'Beef Burger', category: 'Mains', quantity: 1, unitPrice: 14.50, lineTotal: 14.50 },
    ],
    subtotal: 14.50, taxAmount: 1.93, total: 16.43,
    payments: [],
  },
];

export const mockProducts: ProductItem[] = [
  { id: 'p-1', name: 'Grilled Salmon Bowl', category: 'Mains', price: 18.50, sku: 'MAIN-001', available: true },
  { id: 'p-2', name: 'Beef Burger', category: 'Mains', price: 14.50, sku: 'MAIN-002', available: true },
  { id: 'p-3', name: 'Margherita Pizza', category: 'Mains', price: 16.00, sku: 'MAIN-003', available: true },
  { id: 'p-4', name: 'Chicken Wrap', category: 'Mains', price: 12.50, sku: 'MAIN-004', available: true },
  { id: 'p-5', name: 'Caesar Salad', category: 'Starters', price: 12.00, sku: 'STAR-001', available: true },
  { id: 'p-6', name: 'Soup of the Day', category: 'Starters', price: 8.50, sku: 'STAR-002', available: true },
  { id: 'p-7', name: 'Garlic Bread', category: 'Sides', price: 6.50, sku: 'SIDE-001', available: true },
  { id: 'p-8', name: 'French Fries', category: 'Sides', price: 5.50, sku: 'SIDE-002', available: true },
  { id: 'p-9', name: 'Sparkling Water', category: 'Beverages', price: 3.50, sku: 'BEV-001', available: true },
  { id: 'p-10', name: 'Fresh Orange Juice', category: 'Beverages', price: 5.00, sku: 'BEV-002', available: true },
  { id: 'p-11', name: 'Espresso', category: 'Beverages', price: 4.00, sku: 'BEV-003', available: true },
  { id: 'p-12', name: 'Croissant', category: 'Bakery', price: 4.00, sku: 'BAK-001', available: true },
  { id: 'p-13', name: 'Chocolate Cake', category: 'Desserts', price: 9.50, sku: 'DES-001', available: true },
  { id: 'p-14', name: 'Tiramisu', category: 'Desserts', price: 10.00, sku: 'DES-002', available: false },
  { id: 'p-15', name: 'Latte', category: 'Beverages', price: 5.50, sku: 'BEV-004', available: true },
  { id: 'p-16', name: 'Club Sandwich', category: 'Mains', price: 13.00, sku: 'MAIN-005', available: true },
];

export const PRODUCT_CATEGORIES = ['All', 'Mains', 'Starters', 'Sides', 'Beverages', 'Bakery', 'Desserts'];

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  'cash': 'Cash',
  'card': 'Card',
  'e-wallet': 'E-Wallet',
  'bank-transfer': 'Bank Transfer',
  'voucher': 'Voucher',
};
