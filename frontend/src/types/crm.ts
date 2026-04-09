export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type VoucherStatus = 'active' | 'used' | 'expired' | 'cancelled';
export type RewardType = 'discount_percent' | 'discount_fixed' | 'free_item' | 'points_multiplier';

export interface CRMCustomer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  memberCode: string;
  loyaltyTier: LoyaltyTier;
  loyaltyPoints: number;
  lifetimePoints: number;
  totalSpend: number;
  visitCount: number;
  averageOrderValue: number;
  lastVisit?: string;
  joinedAt: string;
  outletId?: string;
  outletName?: string;
  tags: string[];
  notes?: string;
}

export interface PurchaseHistory {
  id: string;
  customerId: string;
  orderNumber: string;
  outletName: string;
  date: string;
  items: string[];
  total: number;
  pointsEarned: number;
  pointsRedeemed: number;
}

export interface LoyaltyProgram {
  id: string;
  name: string;
  tiers: TierConfig[];
  pointsPerCurrency: number; // e.g. 1 point per $1
  isActive: boolean;
}

export interface TierConfig {
  tier: LoyaltyTier;
  minPoints: number;
  benefits: string[];
  pointsMultiplier: number;
  color: string;
}

export interface Reward {
  id: string;
  name: string;
  type: RewardType;
  value: number;
  pointsCost: number;
  description: string;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
  redemptionCount: number;
  maxRedemptions?: number;
}

export interface Voucher {
  id: string;
  code: string;
  customerId?: string;
  customerName?: string;
  rewardId: string;
  rewardName: string;
  status: VoucherStatus;
  discountValue: number;
  discountType: 'percent' | 'fixed';
  issuedAt: string;
  expiresAt: string;
  usedAt?: string;
  usedAtOutlet?: string;
}
