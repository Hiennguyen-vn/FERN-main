// Procurement types aligned to gateway contracts

export type SupplierStatus = 'active' | 'inactive' | 'pending';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  status: SupplierStatus;
  paymentTerms: string;
  taxId?: string;
  legalName?: string;
  taxReady: boolean;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  createdAt: string;
  notes?: string;
}

export type POStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'ordered'
  | 'partially_received'
  | 'completed'
  | 'closed'
  | 'cancelled';

export interface POLineItem {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  outletId: string;
  outletName: string;
  supplierId: string;
  supplierName: string;
  createdBy: string;
  createdAt: string;
  orderDate: string;
  expectedDelivery: string;
  status: POStatus;
  lines: POLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  issuedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  notes?: string;
}

export type GRStatus = 'draft' | 'received' | 'posted' | 'cancelled';

export interface GRLineItem {
  id: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  previouslyReceived: number;
  receivingNow: number;
  damagedQty: number;
  variance: number;
  notes?: string;
}

export interface GoodsReceipt {
  id: string;
  grNumber: string;
  poId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  outletId: string;
  outletName: string;
  receivedBy: string;
  receiptDate: string;
  status: GRStatus;
  lines: GRLineItem[];
  postedAt?: string;
  cancelledAt?: string;
  notes?: string;
}

// ── Wave 2: Invoices ──

export type InvoiceStatus = 'pending_review' | 'approved' | 'disputed' | 'paid' | 'cancelled';

export interface InvoiceLineItem {
  id: string;
  itemName: string;
  unit: string;
  grQty: number;
  invoicedQty: number;
  unitPrice: number;
  lineTotal: number;
  variance: number;
}

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  supplierInvoiceRef: string;
  supplierId: string;
  supplierName: string;
  poId: string;
  poNumber: string;
  grId: string;
  grNumber: string;
  outletId: string;
  outletName: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotal: number;
  taxAmount: number;
  total: number;
  lines: InvoiceLineItem[];
  reviewedBy?: string;
  reviewedAt?: string;
  disputeReason?: string;
  notes?: string;
  createdAt: string;
}

// ── Wave 2: Payments ──

export type PaymentStatus = 'pending_review' | 'approved' | 'processed' | 'rejected';
export type PaymentMethod = 'bank_transfer' | 'cheque' | 'cash';

export interface SupplierPayment {
  id: string;
  paymentNumber: string;
  supplierId: string;
  supplierName: string;
  invoiceIds: string[];
  invoiceNumbers: string[];
  totalAmount: number;
  method: PaymentMethod;
  bankRef?: string;
  chequeNumber?: string;
  paymentDate: string;
  status: PaymentStatus;
  preparedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  processedAt?: string;
  rejectionReason?: string;
  notes?: string;
  createdAt: string;
}
