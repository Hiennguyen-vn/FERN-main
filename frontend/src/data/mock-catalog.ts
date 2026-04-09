import type { Product, Ingredient, UnitOfMeasure, UnitConversion, Recipe, PricingRule, Promotion, AvailabilityRule } from '@/types/catalog';

export const mockProducts: Product[] = [
  { id: 'prod-01', sku: 'FD-001', name: 'Classic Margherita Pizza', category: 'Pizza', status: 'active', hasRecipe: true, activeRecipeId: 'rcp-01', basePrice: 18.90, taxRate: 8, availableOutlets: 3, totalOutlets: 3, createdAt: '2024-01-10', updatedAt: '2026-03-15' },
  { id: 'prod-02', sku: 'FD-002', name: 'Grilled Salmon Bowl', category: 'Bowls', status: 'active', hasRecipe: true, activeRecipeId: 'rcp-02', basePrice: 24.50, taxRate: 8, availableOutlets: 3, totalOutlets: 3, createdAt: '2024-02-05', updatedAt: '2026-03-20' },
  { id: 'prod-03', sku: 'FD-003', name: 'Caesar Salad', category: 'Salads', status: 'active', hasRecipe: true, basePrice: 14.90, taxRate: 8, availableOutlets: 2, totalOutlets: 3, createdAt: '2024-03-12', updatedAt: '2026-02-28' },
  { id: 'prod-04', sku: 'FD-004', name: 'Truffle Fries', category: 'Sides', status: 'active', hasRecipe: true, basePrice: 12.90, taxRate: 8, availableOutlets: 3, totalOutlets: 3, createdAt: '2024-04-01', updatedAt: '2026-03-01' },
  { id: 'prod-05', sku: 'BV-001', name: 'Iced Latte', category: 'Beverages', status: 'active', hasRecipe: true, basePrice: 6.50, taxRate: 8, availableOutlets: 3, totalOutlets: 3, createdAt: '2024-01-10', updatedAt: '2026-01-15' },
  { id: 'prod-06', sku: 'BV-002', name: 'Fresh Orange Juice', category: 'Beverages', status: 'active', hasRecipe: false, basePrice: 7.90, taxRate: 8, availableOutlets: 3, totalOutlets: 3, createdAt: '2024-02-20', updatedAt: '2026-02-10' },
  { id: 'prod-07', sku: 'FD-005', name: 'Wagyu Burger', category: 'Burgers', status: 'draft', hasRecipe: false, basePrice: 32.00, taxRate: 8, availableOutlets: 0, totalOutlets: 3, createdAt: '2026-03-28', updatedAt: '2026-03-28' },
  { id: 'prod-08', sku: 'FD-006', name: 'Mushroom Soup', category: 'Soups', status: 'discontinued', hasRecipe: true, basePrice: 10.90, taxRate: 8, availableOutlets: 0, totalOutlets: 3, createdAt: '2023-11-05', updatedAt: '2026-01-30' },
];

export const mockIngredients: Ingredient[] = [
  { id: 'ing-01', code: 'ING-001', name: 'Mixed Lettuce', category: 'produce', defaultUnit: 'kg', costPerUnit: 8.50, trackInventory: true, createdAt: '2024-01-10' },
  { id: 'ing-02', code: 'ING-002', name: 'Tomatoes', category: 'produce', defaultUnit: 'kg', costPerUnit: 4.20, trackInventory: true, createdAt: '2024-01-10' },
  { id: 'ing-03', code: 'ING-003', name: 'Salmon Fillet', category: 'protein', defaultUnit: 'kg', costPerUnit: 28.00, trackInventory: true, allergens: ['fish'], createdAt: '2024-02-05' },
  { id: 'ing-04', code: 'ING-004', name: 'Mozzarella Cheese', category: 'dairy', defaultUnit: 'kg', costPerUnit: 15.00, trackInventory: true, allergens: ['dairy'], createdAt: '2024-01-10' },
  { id: 'ing-05', code: 'ING-005', name: 'Pizza Dough (frozen)', category: 'dry-goods', defaultUnit: 'pcs', costPerUnit: 2.80, trackInventory: true, allergens: ['gluten'], createdAt: '2024-01-10' },
  { id: 'ing-06', code: 'ING-006', name: 'Olive Oil (Extra Virgin)', category: 'other', defaultUnit: 'L', costPerUnit: 18.00, trackInventory: true, createdAt: '2024-01-10' },
  { id: 'ing-07', code: 'ING-007', name: 'Basil (Fresh)', category: 'produce', defaultUnit: 'bunch', costPerUnit: 3.50, trackInventory: true, createdAt: '2024-01-10' },
  { id: 'ing-08', code: 'ING-008', name: 'Prawns (L)', category: 'protein', defaultUnit: 'kg', costPerUnit: 22.00, trackInventory: true, allergens: ['shellfish'], createdAt: '2024-02-05' },
  { id: 'ing-09', code: 'ING-009', name: 'Espresso Beans', category: 'beverage', defaultUnit: 'kg', costPerUnit: 32.00, trackInventory: true, createdAt: '2024-01-10' },
  { id: 'ing-10', code: 'ING-010', name: 'Truffle Oil', category: 'spice', defaultUnit: 'ml', costPerUnit: 0.25, trackInventory: true, createdAt: '2024-04-01' },
  { id: 'ing-11', code: 'ING-011', name: 'Russet Potatoes', category: 'produce', defaultUnit: 'kg', costPerUnit: 3.00, trackInventory: true, createdAt: '2024-04-01' },
  { id: 'ing-12', code: 'ING-012', name: 'Heavy Cream', category: 'dairy', defaultUnit: 'L', costPerUnit: 9.50, trackInventory: true, allergens: ['dairy'], createdAt: '2024-01-10' },
];

export const mockUnits: UnitOfMeasure[] = [
  { id: 'u-01', code: 'kg', name: 'Kilogram', type: 'weight', baseUnit: true },
  { id: 'u-02', code: 'g', name: 'Gram', type: 'weight', baseUnit: false },
  { id: 'u-03', code: 'L', name: 'Litre', type: 'volume', baseUnit: true },
  { id: 'u-04', code: 'ml', name: 'Millilitre', type: 'volume', baseUnit: false },
  { id: 'u-05', code: 'pcs', name: 'Pieces', type: 'count', baseUnit: true },
  { id: 'u-06', code: 'bunch', name: 'Bunch', type: 'count', baseUnit: false },
  { id: 'u-07', code: 'bottles', name: 'Bottles', type: 'count', baseUnit: false },
];

export const mockConversions: UnitConversion[] = [
  { id: 'cv-01', fromUnit: 'kg', toUnit: 'g', factor: 1000 },
  { id: 'cv-02', fromUnit: 'L', toUnit: 'ml', factor: 1000 },
  { id: 'cv-03', fromUnit: 'g', toUnit: 'kg', factor: 0.001 },
  { id: 'cv-04', fromUnit: 'ml', toUnit: 'L', factor: 0.001 },
];

export const mockRecipes: Recipe[] = [
  {
    id: 'rcp-01', productId: 'prod-01', productName: 'Classic Margherita Pizza', version: 3, status: 'active',
    effectiveFrom: '2026-03-01', lines: [
      { id: 'rl-01', ingredientId: 'ing-05', ingredientName: 'Pizza Dough (frozen)', quantity: 1, unit: 'pcs', costPerUnit: 2.80, lineCost: 2.80 },
      { id: 'rl-02', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', quantity: 0.15, unit: 'kg', costPerUnit: 15.00, lineCost: 2.25 },
      { id: 'rl-03', ingredientId: 'ing-02', ingredientName: 'Tomatoes', quantity: 0.12, unit: 'kg', costPerUnit: 4.20, lineCost: 0.50 },
      { id: 'rl-04', ingredientId: 'ing-06', ingredientName: 'Olive Oil (Extra Virgin)', quantity: 0.02, unit: 'L', costPerUnit: 18.00, lineCost: 0.36 },
      { id: 'rl-05', ingredientId: 'ing-07', ingredientName: 'Basil (Fresh)', quantity: 0.5, unit: 'bunch', costPerUnit: 3.50, lineCost: 1.75 },
    ],
    totalCost: 7.66, yield: 1, yieldUnit: 'pizza', costPerServing: 7.66, createdBy: 'Chef Lim', createdAt: '2026-02-28',
  },
  {
    id: 'rcp-02', productId: 'prod-02', productName: 'Grilled Salmon Bowl', version: 2, status: 'active',
    effectiveFrom: '2026-02-15', lines: [
      { id: 'rl-06', ingredientId: 'ing-03', ingredientName: 'Salmon Fillet', quantity: 0.18, unit: 'kg', costPerUnit: 28.00, lineCost: 5.04 },
      { id: 'rl-07', ingredientId: 'ing-01', ingredientName: 'Mixed Lettuce', quantity: 0.08, unit: 'kg', costPerUnit: 8.50, lineCost: 0.68 },
      { id: 'rl-08', ingredientId: 'ing-02', ingredientName: 'Tomatoes', quantity: 0.06, unit: 'kg', costPerUnit: 4.20, lineCost: 0.25 },
      { id: 'rl-09', ingredientId: 'ing-06', ingredientName: 'Olive Oil (Extra Virgin)', quantity: 0.01, unit: 'L', costPerUnit: 18.00, lineCost: 0.18 },
    ],
    totalCost: 6.15, yield: 1, yieldUnit: 'bowl', costPerServing: 6.15, createdBy: 'Chef Lim', createdAt: '2026-02-10',
  },
  {
    id: 'rcp-03', productId: 'prod-01', productName: 'Classic Margherita Pizza', version: 2, status: 'archived',
    effectiveFrom: '2025-06-01', effectiveTo: '2026-02-28', lines: [
      { id: 'rl-10', ingredientId: 'ing-05', ingredientName: 'Pizza Dough (frozen)', quantity: 1, unit: 'pcs', costPerUnit: 2.50, lineCost: 2.50 },
      { id: 'rl-11', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', quantity: 0.12, unit: 'kg', costPerUnit: 14.00, lineCost: 1.68 },
      { id: 'rl-12', ingredientId: 'ing-02', ingredientName: 'Tomatoes', quantity: 0.10, unit: 'kg', costPerUnit: 3.80, lineCost: 0.38 },
    ],
    totalCost: 4.56, yield: 1, yieldUnit: 'pizza', costPerServing: 4.56, createdBy: 'Chef Lim', createdAt: '2025-05-28',
  },
  {
    id: 'rcp-04', productId: 'prod-04', productName: 'Truffle Fries', version: 1, status: 'active',
    effectiveFrom: '2026-01-15', lines: [
      { id: 'rl-13', ingredientId: 'ing-11', ingredientName: 'Russet Potatoes', quantity: 0.25, unit: 'kg', costPerUnit: 3.00, lineCost: 0.75 },
      { id: 'rl-14', ingredientId: 'ing-10', ingredientName: 'Truffle Oil', quantity: 15, unit: 'ml', costPerUnit: 0.25, lineCost: 3.75 },
      { id: 'rl-15', ingredientId: 'ing-06', ingredientName: 'Olive Oil (Extra Virgin)', quantity: 0.05, unit: 'L', costPerUnit: 18.00, lineCost: 0.90 },
    ],
    totalCost: 5.40, yield: 1, yieldUnit: 'portion', costPerServing: 5.40, createdBy: 'Chef Lim', createdAt: '2026-01-10',
  },
  {
    id: 'rcp-05', productId: 'prod-01', productName: 'Classic Margherita Pizza', version: 4, status: 'draft',
    effectiveFrom: '2026-05-01', lines: [
      { id: 'rl-16', ingredientId: 'ing-05', ingredientName: 'Pizza Dough (frozen)', quantity: 1, unit: 'pcs', costPerUnit: 3.00, lineCost: 3.00 },
      { id: 'rl-17', ingredientId: 'ing-04', ingredientName: 'Mozzarella Cheese', quantity: 0.18, unit: 'kg', costPerUnit: 15.00, lineCost: 2.70 },
      { id: 'rl-18', ingredientId: 'ing-02', ingredientName: 'Tomatoes', quantity: 0.14, unit: 'kg', costPerUnit: 4.50, lineCost: 0.63 },
      { id: 'rl-19', ingredientId: 'ing-06', ingredientName: 'Olive Oil (Extra Virgin)', quantity: 0.02, unit: 'L', costPerUnit: 18.00, lineCost: 0.36 },
      { id: 'rl-20', ingredientId: 'ing-07', ingredientName: 'Basil (Fresh)', quantity: 0.5, unit: 'bunch', costPerUnit: 3.50, lineCost: 1.75 },
    ],
    totalCost: 8.44, yield: 1, yieldUnit: 'pizza', costPerServing: 8.44, createdBy: 'Chef Tan', createdAt: '2026-03-30',
  },
];

export const mockPricingRules: PricingRule[] = [
  { id: 'pr-01', productId: 'prod-01', productName: 'Classic Margherita Pizza', outletId: 'outlet-001', outletName: 'Downtown Flagship', basePrice: 18.90, effectiveFrom: '2026-01-01', taxRate: 8, taxInclusive: true },
  { id: 'pr-02', productId: 'prod-01', productName: 'Classic Margherita Pizza', outletId: 'outlet-002', outletName: 'Marina Bay', basePrice: 19.90, effectiveFrom: '2026-01-01', taxRate: 8, taxInclusive: true },
  { id: 'pr-03', productId: 'prod-02', productName: 'Grilled Salmon Bowl', outletId: 'outlet-001', outletName: 'Downtown Flagship', basePrice: 24.50, effectiveFrom: '2026-01-01', taxRate: 8, taxInclusive: true },
  { id: 'pr-04', productId: 'prod-02', productName: 'Grilled Salmon Bowl', outletId: 'outlet-002', outletName: 'Marina Bay', basePrice: 25.50, effectiveFrom: '2026-01-01', taxRate: 8, taxInclusive: true },
  { id: 'pr-05', productId: 'prod-05', productName: 'Iced Latte', outletId: 'outlet-001', outletName: 'Downtown Flagship', basePrice: 6.50, effectiveFrom: '2026-01-01', taxRate: 8, taxInclusive: true },
  { id: 'pr-06', productId: 'prod-07', productName: 'Wagyu Burger', outletId: 'outlet-001', outletName: 'Downtown Flagship', basePrice: 32.00, effectiveFrom: '2026-04-15', taxRate: 8, taxInclusive: true },
];

export const mockPromotions: Promotion[] = [
  { id: 'promo-01', code: 'LUNCH20', name: 'Lunch 20% Off', type: 'percentage', value: 20, appliesTo: 'all', effectiveFrom: '2026-04-01', effectiveTo: '2026-04-30', status: 'active', outletScope: 'all' },
  { id: 'promo-02', code: 'NEWPIZZA', name: 'New Pizza $3 Off', type: 'fixed', value: 3, appliesTo: 'category', targetId: 'pizza', targetName: 'Pizza', effectiveFrom: '2026-04-01', effectiveTo: '2026-04-15', status: 'active', outletScope: 'specific', outlets: ['outlet-001'] },
  { id: 'promo-03', code: 'BOGO-LATTE', name: 'Buy 1 Get 1 Latte', type: 'bogo', value: 100, appliesTo: 'product', targetId: 'prod-05', targetName: 'Iced Latte', effectiveFrom: '2026-05-01', effectiveTo: '2026-05-31', status: 'scheduled', outletScope: 'all' },
  { id: 'promo-04', code: 'MARCH10', name: 'March Madness 10%', type: 'percentage', value: 10, appliesTo: 'all', effectiveFrom: '2026-03-01', effectiveTo: '2026-03-31', status: 'expired', outletScope: 'all' },
];

export const mockAvailability: AvailabilityRule[] = [
  { id: 'av-01', productId: 'prod-03', productName: 'Caesar Salad', outletId: 'outlet-003', outletName: 'Orchard Central', available: false, reason: 'Seasonal ingredient shortage', effectiveFrom: '2026-03-20' },
  { id: 'av-02', productId: 'prod-07', productName: 'Wagyu Burger', outletId: 'outlet-001', outletName: 'Downtown Flagship', available: false, reason: 'Product in draft — not launched', effectiveFrom: '2026-03-28' },
];

export const PRODUCT_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  active: { label: 'Active', class: 'bg-success/10 text-success' },
  inactive: { label: 'Inactive', class: 'bg-muted text-muted-foreground' },
  draft: { label: 'Draft', class: 'bg-warning/10 text-warning' },
  discontinued: { label: 'Discontinued', class: 'bg-destructive/10 text-destructive' },
};

export const INGREDIENT_CATEGORY_CONFIG: Record<string, { label: string; class: string }> = {
  produce: { label: 'Produce', class: 'bg-success/10 text-success' },
  protein: { label: 'Protein', class: 'bg-destructive/10 text-destructive' },
  dairy: { label: 'Dairy', class: 'bg-info/10 text-info' },
  'dry-goods': { label: 'Dry Goods', class: 'bg-warning/10 text-warning' },
  beverage: { label: 'Beverage', class: 'bg-primary/10 text-primary' },
  spice: { label: 'Spice', class: 'bg-accent text-accent-foreground' },
  other: { label: 'Other', class: 'bg-muted text-muted-foreground' },
};
