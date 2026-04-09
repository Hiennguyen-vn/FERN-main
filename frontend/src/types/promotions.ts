export type PromotionType = 'combo' | 'discount_percent' | 'discount_fixed' | 'bogo' | 'happy_hour' | 'bundle' | 'free_item';
export type PromotionStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired';
export type PromotionScope = 'all' | 'region' | 'outlet';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface Promotion {
  id: string;
  name: string;
  code: string;
  type: PromotionType;
  status: PromotionStatus;
  description: string;
  // Discount config
  discountValue: number;
  discountType: 'percent' | 'fixed';
  minOrderValue?: number;
  maxDiscount?: number;
  // Scope
  scope: PromotionScope;
  appliedOutlets: string[];
  appliedRegions: string[];
  // Schedule
  startDate: string;
  endDate: string;
  activeDays: DayOfWeek[];
  startTime?: string; // e.g. "14:00" for happy hour
  endTime?: string;
  // Limits
  maxUsage?: number;
  usageCount: number;
  maxPerCustomer?: number;
  // Items
  applicableCategories: string[];
  applicableItems: string[];
  // Metrics
  totalRevenue: number;
  totalDiscount: number;
  ordersUsed: number;
  createdAt: string;
  createdBy: string;
}

export interface PromotionPerformance {
  promotionId: string;
  date: string;
  ordersUsed: number;
  revenue: number;
  discountGiven: number;
  averageOrderValue: number;
}
