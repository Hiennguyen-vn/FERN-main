// POS types aligned to gateway contracts: /pos-sessions/**, /sale-orders/**

export type POSSessionStatus = 'open' | 'closed' | 'reconciled';
export type SaleOrderStatus = 'open' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'cash' | 'card' | 'e-wallet' | 'bank-transfer' | 'voucher';

export interface POSSession {
  id: string;
  code: string;
  outletId: string;
  outletName: string;
  currencyCode?: string;
  businessDate: string;
  openedBy: string;
  openedAt: string;
  closedAt?: string;
  reconciledAt?: string;
  status: POSSessionStatus;
  openingNote?: string;
  orderCount: number;
  totalRevenue: number;
  paymentSummary: { method: PaymentMethod; total: number; count: number }[];
}

export interface OrderLineItem {
  id: string;
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SaleOrder {
  id: string;
  orderNumber: string;
  sessionId: string;
  sessionCode: string;
  backendStatus?: string;
  outletName: string;
  createdBy: string;
  createdAt: string;
  status: SaleOrderStatus;
  paymentStatus: PaymentStatus;
  lineItems: OrderLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  promotionCode?: string;
  promotionDiscount?: number;
  tableNumber?: string;
  cancelReason?: string;
  payments: OrderPayment[];
}

export interface OrderPayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  capturedAt: string;
}

export interface ProductItem {
  id: string;
  name: string;
  category: string;
  price: number;
  sku: string;
  available: boolean;
}

export interface ReconciliationData {
  expectedCash: number;
  actualCash: number;
  expectedCard: number;
  actualCard: number;
  expectedEWallet: number;
  actualEWallet: number;
  expectedBankTransfer: number;
  actualBankTransfer: number;
  expectedVoucher: number;
  actualVoucher: number;
  totalExpected: number;
  totalActual: number;
  discrepancy: number;
  notes: string;
}

/* ── POS Customer & Loyalty ── */

export interface POSCustomer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  memberCode?: string;
  loyaltyTier?: 'bronze' | 'silver' | 'gold' | 'platinum';
  loyaltyPoints: number;
  totalSpend: number;
  visitCount: number;
  lastVisit?: string;
  createdAt: string;
  notes?: string;
}

export interface LoyaltyEvent {
  id: string;
  customerId: string;
  type: 'earn' | 'redeem' | 'adjust' | 'expire';
  points: number;
  description: string;
  orderId?: string;
  orderNumber?: string;
  createdAt: string;
}

/* ── Outlet Today Stats ── */

export interface OutletTodayStats {
  outletId: string;
  businessDate: string;
  ordersToday: number;
  completedSales: number;
  cancelledOrders: number;
  revenueToday: number;
  averageOrderValue: number;
  activeSessionCode?: string;
  activeSessionStatus?: POSSessionStatus;
  topCategory: string;
  peakHour: string;
  hourlyRevenue: { hour: string; revenue: number }[];
}

/* ── Dine-in Tables ── */

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

export interface DineInTable {
  id: string;
  outletId: string;
  name: string;
  capacity: number;
  zone: string;
  status: TableStatus;
  currentOrderId?: string;
  currentOrderNumber?: string;
  reservedBy?: string;
  reservedAt?: string;
  occupiedSince?: string;
  updatedAt: string;
}
