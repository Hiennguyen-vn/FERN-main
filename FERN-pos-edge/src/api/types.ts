// DTO mirror from FERN backend. Keep in sync with backend SalesDtos + ProductDtos.

export interface MenuCategoryView {
  id: string
  code: string
  name: string
  displayOrder: number
  items: MenuItemView[]
}

export interface MenuItemView {
  id: string
  productId: string
  productCode: string
  productName: string
  productStatus: string
  displayOrder: number
  isActive: boolean
  priceCents?: number
  variants?: ProductVariantView[]
  modifierGroups?: ModifierGroupView[]
}

export interface MenuView {
  id: string
  code: string
  name: string
  description: string | null
  status: string
  scopeType: string | null
  scopeId: string | null
  categories: MenuCategoryView[]
}

export interface ProductVariantView {
  id: string
  code: string
  name: string
  priceModifierType: string
  priceModifierValue: string
  displayOrder: number
  isActive: boolean
}

export interface ModifierOptionView {
  id: string
  code: string
  name: string
  priceAdjustment: string
  displayOrder: number
  isActive: boolean
}

export interface ModifierGroupView {
  id: string
  code: string
  name: string
  selectionType: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  displayOrder: number
  isActive: boolean
  options: ModifierOptionView[]
}

export interface PriceView {
  id: string
  productId: string | null
  outletId: string | null
  priceValue: number
  priceAmount: number
  effectiveFrom: string | null
  effectiveTo: string | null
}

export interface SaleLineRequest {
  productId: string
  variantId?: string
  modifierOptionIds?: string[]
  quantity: string        // BigDecimal as string
  discountAmount?: string
  taxAmount?: string
  note?: string
}

export interface PaymentRequest {
  paymentMethod: string
  amount: string          // BigDecimal as string
  status?: string
  paymentTime?: string
  transactionRef?: string
  note?: string
}

export interface SubmitSaleRequest {
  outletId: string
  posSessionId?: string
  currencyCode: string
  orderType?: string
  note?: string
  items: SaleLineRequest[]
  payment?: PaymentRequest
  clientSaleId?: string
}

export interface SaleView {
  id: string
  outletId: string
  posSessionId: string | null
  status: string
  paymentStatus: string
  currencyCode: string
  orderType?: string
  subtotal: string
  discount: string
  taxAmount: string
  totalAmount: string
  note: string | null
  createdAt: string
  items: SaleLineView[]
  payment: PaymentView | null
}

export interface SaleLineView {
  productId: string
  productCode: string
  productName: string
  quantity: string
  unitPrice: string
  discountAmount: string
  taxAmount: string
  lineTotal: string
  variantId?: string | null
  variantName?: string | null
  note?: string | null
  modifiers?: Array<{
    modifierOptionId: string
    groupCode: string | null
    groupName: string | null
    optionCode: string | null
    optionName: string | null
    priceAddAmount: string
  }>
}

export interface PaymentView {
  saleId: string
  paymentMethod: string
  amount: string
  status: string
  paymentTime: string
  transactionRef: string | null
  note: string | null
}

export interface MarkPaymentDoneRequest {
  paymentMethod: string
  amount: string
  paymentTime?: string
  transactionRef?: string
  note?: string
}

export interface PosSessionView {
  id: string
  outletId: string
  deviceId?: string | null
  registerCode?: string | null
  registerDisplayName?: string | null
  openedByUserId?: string | null
  openedByUsername?: string | null
  status: string
  openedAt: string
  closedAt?: string | null
  businessDate: string
  managerId: string
  cashFloat?: string | null
  closingCash?: string | null
  note?: string | null
}

export interface OpenPosSessionRequest {
  outletId: string
  cashFloat?: string
  takeover?: boolean
}
