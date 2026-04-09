import type { POSCustomer, LoyaltyEvent, OutletTodayStats, DineInTable } from '@/types/pos';

export const mockCustomers: POSCustomer[] = [
  {
    id: 'cust-001', name: 'Sarah Chen', phone: '+65 9123 4567', email: 'sarah.chen@email.com',
    memberCode: 'MBR-20240089', loyaltyTier: 'gold', loyaltyPoints: 2840, totalSpend: 4520.00,
    visitCount: 67, lastVisit: '2026-04-03', createdAt: '2024-06-15',
  },
  {
    id: 'cust-002', name: 'James Wong', phone: '+65 8234 5678', email: 'james.w@email.com',
    memberCode: 'MBR-20240142', loyaltyTier: 'silver', loyaltyPoints: 1120, totalSpend: 1890.00,
    visitCount: 28, lastVisit: '2026-04-04', createdAt: '2024-09-20',
  },
  {
    id: 'cust-003', name: 'Maria Santos', phone: '+65 9345 6789',
    memberCode: 'MBR-20250031', loyaltyTier: 'bronze', loyaltyPoints: 340, totalSpend: 620.00,
    visitCount: 9, lastVisit: '2026-03-28', createdAt: '2025-01-10',
  },
  {
    id: 'cust-004', name: 'Ahmad Razak', phone: '+65 8456 7890', email: 'ahmad.r@business.com',
    memberCode: 'MBR-20240201', loyaltyTier: 'platinum', loyaltyPoints: 5620, totalSpend: 9840.00,
    visitCount: 142, lastVisit: '2026-04-04', createdAt: '2024-03-01',
    notes: 'Corporate account — prefers Table 8, no shellfish',
  },
  {
    id: 'cust-005', name: 'Lisa Park', phone: '+65 9567 8901',
    loyaltyPoints: 0, totalSpend: 42.50, visitCount: 1, lastVisit: '2026-04-04',
    createdAt: '2026-04-04',
  },
];

export const mockLoyaltyEvents: LoyaltyEvent[] = [
  { id: 'le-1', customerId: 'cust-001', type: 'earn', points: 85, description: 'Purchase — SO-4821', orderId: 'ord-001', orderNumber: 'SO-4821', createdAt: '2026-04-04T14:32:00' },
  { id: 'le-2', customerId: 'cust-001', type: 'redeem', points: -200, description: 'Voucher redemption — $10 off', createdAt: '2026-04-02T12:15:00' },
  { id: 'le-3', customerId: 'cust-001', type: 'earn', points: 120, description: 'Purchase — SO-4790', orderNumber: 'SO-4790', createdAt: '2026-04-01T19:45:00' },
  { id: 'le-4', customerId: 'cust-001', type: 'earn', points: 65, description: 'Purchase — SO-4762', orderNumber: 'SO-4762', createdAt: '2026-03-30T13:20:00' },
  { id: 'le-5', customerId: 'cust-001', type: 'adjust', points: 500, description: 'Birthday bonus — Gold tier reward', createdAt: '2026-03-15T00:00:00' },
  { id: 'le-6', customerId: 'cust-001', type: 'expire', points: -50, description: 'Points expiry — 90-day policy', createdAt: '2026-03-01T00:00:00' },
  { id: 'le-7', customerId: 'cust-002', type: 'earn', points: 43, description: 'Purchase — SO-4822', orderNumber: 'SO-4822', createdAt: '2026-04-04T14:45:00' },
  { id: 'le-8', customerId: 'cust-004', type: 'earn', points: 156, description: 'Purchase — SO-4818', orderNumber: 'SO-4818', createdAt: '2026-04-04T12:30:00' },
];

export const mockOutletStats: OutletTodayStats = {
  outletId: 'outlet-001', businessDate: '2026-04-04',
  ordersToday: 47, completedSales: 42, cancelledOrders: 2, revenueToday: 3842.50,
  averageOrderValue: 91.49, activeSessionCode: 'POS-20260404-001', activeSessionStatus: 'open',
  topCategory: 'Mains', peakHour: '12:00–13:00',
  hourlyRevenue: [
    { hour: '08:00', revenue: 180 }, { hour: '09:00', revenue: 340 }, { hour: '10:00', revenue: 280 },
    { hour: '11:00', revenue: 420 }, { hour: '12:00', revenue: 680 }, { hour: '13:00', revenue: 590 },
    { hour: '14:00', revenue: 410 }, { hour: '15:00', revenue: 220 }, { hour: '16:00', revenue: 180 },
    { hour: '17:00', revenue: 310 }, { hour: '18:00', revenue: 232.50 },
  ],
};

export const mockTables: DineInTable[] = [
  { id: 'tbl-01', outletId: 'outlet-001', name: 'T1', capacity: 2, zone: 'Indoor', status: 'occupied', currentOrderId: 'ord-002', currentOrderNumber: 'SO-4822', occupiedSince: '2026-04-04T14:40:00', updatedAt: '2026-04-04T14:40:00' },
  { id: 'tbl-02', outletId: 'outlet-001', name: 'T2', capacity: 4, zone: 'Indoor', status: 'available', updatedAt: '2026-04-04T14:20:00' },
  { id: 'tbl-03', outletId: 'outlet-001', name: 'T3', capacity: 4, zone: 'Indoor', status: 'cleaning', updatedAt: '2026-04-04T14:35:00' },
  { id: 'tbl-04', outletId: 'outlet-001', name: 'T4', capacity: 6, zone: 'Indoor', status: 'reserved', reservedBy: 'Ahmad Razak', reservedAt: '2026-04-04T18:30:00', updatedAt: '2026-04-04T10:00:00' },
  { id: 'tbl-05', outletId: 'outlet-001', name: 'T5', capacity: 2, zone: 'Indoor', status: 'available', updatedAt: '2026-04-04T13:50:00' },
  { id: 'tbl-06', outletId: 'outlet-001', name: 'T6', capacity: 8, zone: 'Indoor', status: 'occupied', currentOrderId: 'ord-003', currentOrderNumber: 'SO-4820', occupiedSince: '2026-04-04T14:25:00', updatedAt: '2026-04-04T14:25:00' },
  { id: 'tbl-07', outletId: 'outlet-001', name: 'P1', capacity: 4, zone: 'Patio', status: 'available', updatedAt: '2026-04-04T12:00:00' },
  { id: 'tbl-08', outletId: 'outlet-001', name: 'P2', capacity: 6, zone: 'Patio', status: 'occupied', currentOrderId: 'ord-001', currentOrderNumber: 'SO-4821', occupiedSince: '2026-04-04T14:30:00', updatedAt: '2026-04-04T14:30:00' },
  { id: 'tbl-09', outletId: 'outlet-001', name: 'P3', capacity: 2, zone: 'Patio', status: 'available', updatedAt: '2026-04-04T11:30:00' },
  { id: 'tbl-10', outletId: 'outlet-001', name: 'VIP-1', capacity: 10, zone: 'VIP', status: 'reserved', reservedBy: 'Corporate Event', reservedAt: '2026-04-04T19:00:00', updatedAt: '2026-04-04T09:00:00' },
  { id: 'tbl-11', outletId: 'outlet-001', name: 'VIP-2', capacity: 8, zone: 'VIP', status: 'available', updatedAt: '2026-04-04T10:00:00' },
  { id: 'tbl-12', outletId: 'outlet-001', name: 'B1', capacity: 4, zone: 'Bar', status: 'occupied', currentOrderNumber: 'SO-4823', occupiedSince: '2026-04-04T14:50:00', updatedAt: '2026-04-04T14:50:00' },
];

export const TABLE_ZONES = ['All', 'Indoor', 'Patio', 'VIP', 'Bar'];

export const LOYALTY_TIER_CONFIG: Record<string, { label: string; color: string; minPoints: number }> = {
  bronze: { label: 'Bronze', color: 'text-amber-700 bg-amber-50 border-amber-200', minPoints: 0 },
  silver: { label: 'Silver', color: 'text-slate-600 bg-slate-50 border-slate-200', minPoints: 500 },
  gold: { label: 'Gold', color: 'text-yellow-700 bg-yellow-50 border-yellow-200', minPoints: 2000 },
  platinum: { label: 'Platinum', color: 'text-purple-700 bg-purple-50 border-purple-200', minPoints: 5000 },
};
