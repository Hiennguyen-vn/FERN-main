// Catalog types aligned to gateway contracts

export type ProductStatus = 'active' | 'inactive' | 'draft' | 'discontinued';
export type IngredientCategory = 'produce' | 'protein' | 'dairy' | 'dry-goods' | 'beverage' | 'spice' | 'other';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  status: ProductStatus;
  hasRecipe: boolean;
  activeRecipeId?: string;
  basePrice: number;
  taxRate: number;
  availableOutlets: number;
  totalOutlets: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  id: string;
  code: string;
  name: string;
  category: IngredientCategory;
  defaultUnit: string;
  costPerUnit: number;
  trackInventory: boolean;
  allergens?: string[];
  createdAt: string;
}

export interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  type: 'weight' | 'volume' | 'count' | 'length';
  baseUnit: boolean;
}

export interface UnitConversion {
  id: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
}

export interface RecipeLine {
  id: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
  lineCost: number;
  notes?: string;
}

export interface Recipe {
  id: string;
  productId: string;
  productName: string;
  version: number;
  status: 'active' | 'draft' | 'archived';
  effectiveFrom: string;
  effectiveTo?: string;
  lines: RecipeLine[];
  totalCost: number;
  yield: number;
  yieldUnit: string;
  costPerServing: number;
  createdBy: string;
  createdAt: string;
}

export interface PricingRule {
  id: string;
  productId: string;
  productName: string;
  outletId: string;
  outletName: string;
  basePrice: number;
  effectiveFrom: string;
  effectiveTo?: string;
  taxRate: number;
  taxInclusive: boolean;
}

export interface Promotion {
  id: string;
  code: string;
  name: string;
  type: 'percentage' | 'fixed' | 'bogo';
  value: number;
  appliesTo: 'all' | 'category' | 'product';
  targetId?: string;
  targetName?: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: 'active' | 'scheduled' | 'expired' | 'disabled';
  outletScope: 'all' | 'specific';
  outlets?: string[];
}

export interface AvailabilityRule {
  id: string;
  productId: string;
  productName: string;
  outletId: string;
  outletName: string;
  available: boolean;
  reason?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
