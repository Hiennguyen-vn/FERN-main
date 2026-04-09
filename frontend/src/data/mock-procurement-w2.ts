import type { SupplierInvoice, SupplierPayment } from '@/types/procurement';

export const mockInvoices: SupplierInvoice[] = [
  {
    id: 'inv-01', invoiceNumber: 'INV-2026-0041', supplierInvoiceRef: 'FF-8821',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.',
    poId: 'po-01', poNumber: 'PO-2026-0401', grId: 'gr-01', grNumber: 'GR-0284',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    invoiceDate: '2026-04-04', dueDate: '2026-05-04', status: 'pending_review',
    subtotal: 192.00, taxAmount: 15.36, total: 207.36,
    lines: [
      { id: 'il-01', itemName: 'Mixed Lettuce', unit: 'kg', grQty: 10, invoicedQty: 10, unitPrice: 8.50, lineTotal: 85.00, variance: 0 },
      { id: 'il-02', itemName: 'Tomatoes', unit: 'kg', grQty: 14, invoicedQty: 14, unitPrice: 4.20, lineTotal: 58.80, variance: 0 },
      { id: 'il-03', itemName: 'Bell Peppers', unit: 'kg', grQty: 8, invoicedQty: 8, unitPrice: 6.05, lineTotal: 48.40, variance: 0.40 },
    ],
    createdAt: '2026-04-04T14:00:00',
  },
  {
    id: 'inv-02', invoiceNumber: 'INV-2026-0042', supplierInvoiceRef: 'PS-3302',
    supplierId: 'sup-02', supplierName: 'Pacific Seafood Trading',
    poId: 'po-02', poNumber: 'PO-2026-0402', grId: 'gr-03', grNumber: 'GR-0285',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    invoiceDate: '2026-04-05', dueDate: '2026-04-19', status: 'disputed',
    subtotal: 810.00, taxAmount: 64.80, total: 874.80,
    lines: [
      { id: 'il-04', itemName: 'Salmon Fillet', unit: 'kg', grQty: 20, invoicedQty: 22, unitPrice: 28.00, lineTotal: 616.00, variance: 56.00 },
      { id: 'il-05', itemName: 'Prawns (L)', unit: 'kg', grQty: 10, invoicedQty: 10, unitPrice: 22.00, lineTotal: 220.00, variance: 0 },
    ],
    disputeReason: 'Salmon invoiced qty (22 kg) exceeds goods receipt qty (20 kg). Supplier claims 2 kg delivered earlier — no matching GR found.',
    createdAt: '2026-04-05T10:00:00',
  },
  {
    id: 'inv-03', invoiceNumber: 'INV-2026-0038', supplierInvoiceRef: 'FF-8799',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.',
    poId: 'po-01', poNumber: 'PO-2026-0401', grId: 'gr-02', grNumber: 'GR-0283',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    invoiceDate: '2026-04-02', dueDate: '2026-05-02', status: 'approved',
    subtotal: 120.00, taxAmount: 9.60, total: 129.60,
    lines: [
      { id: 'il-06', itemName: 'Sparkling Water', unit: 'bottles', grQty: 48, invoicedQty: 48, unitPrice: 2.50, lineTotal: 120.00, variance: 0 },
    ],
    reviewedBy: 'Sarah Ng', reviewedAt: '2026-04-03T09:00:00',
    createdAt: '2026-04-02T11:00:00',
  },
  {
    id: 'inv-04', invoiceNumber: 'INV-2026-0035', supplierInvoiceRef: 'AB-1122',
    supplierId: 'sup-03', supplierName: 'Artisan Bakery Supplies',
    poId: 'po-03', poNumber: 'PO-2026-0403', grId: 'gr-01', grNumber: 'GR-0284',
    outletId: 'outlet-001', outletName: 'Downtown Flagship',
    invoiceDate: '2026-03-30', dueDate: '2026-04-29', status: 'paid',
    subtotal: 378.00, taxAmount: 30.24, total: 408.24,
    lines: [
      { id: 'il-07', itemName: 'Pizza Dough (frozen)', unit: 'pcs', grQty: 50, invoicedQty: 50, unitPrice: 2.80, lineTotal: 140.00, variance: 0 },
      { id: 'il-08', itemName: 'Croissant Dough', unit: 'pcs', grQty: 40, invoicedQty: 40, unitPrice: 3.20, lineTotal: 128.00, variance: 0 },
      { id: 'il-09', itemName: 'Sourdough Loaf', unit: 'pcs', grQty: 20, invoicedQty: 20, unitPrice: 5.50, lineTotal: 110.00, variance: 0 },
    ],
    reviewedBy: 'Sarah Ng', reviewedAt: '2026-03-31T14:00:00',
    createdAt: '2026-03-30T08:00:00',
  },
];

export const mockPayments: SupplierPayment[] = [
  {
    id: 'pay-01', paymentNumber: 'PAY-2026-0018',
    supplierId: 'sup-03', supplierName: 'Artisan Bakery Supplies',
    invoiceIds: ['inv-04'], invoiceNumbers: ['INV-2026-0035'],
    totalAmount: 408.24, method: 'bank_transfer', bankRef: 'DBS-TXN-9982341',
    paymentDate: '2026-04-02', status: 'processed',
    preparedBy: 'Jenny Tan', reviewedBy: 'Sarah Ng', reviewedAt: '2026-04-02T10:00:00', processedAt: '2026-04-02T14:00:00',
    createdAt: '2026-04-01T16:00:00',
  },
  {
    id: 'pay-02', paymentNumber: 'PAY-2026-0019',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.',
    invoiceIds: ['inv-03'], invoiceNumbers: ['INV-2026-0038'],
    totalAmount: 129.60, method: 'bank_transfer', bankRef: 'DBS-TXN-9982455',
    paymentDate: '2026-04-04', status: 'pending_review',
    preparedBy: 'Jenny Tan',
    createdAt: '2026-04-04T09:00:00',
  },
  {
    id: 'pay-03', paymentNumber: 'PAY-2026-0020',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.',
    invoiceIds: ['inv-01'], invoiceNumbers: ['INV-2026-0041'],
    totalAmount: 207.36, method: 'cheque', chequeNumber: 'CHQ-004821',
    paymentDate: '2026-04-06', status: 'approved',
    preparedBy: 'Jenny Tan', reviewedBy: 'Sarah Ng', reviewedAt: '2026-04-05T11:00:00',
    notes: 'Cheque to be dispatched with next delivery',
    createdAt: '2026-04-05T08:00:00',
  },
  {
    id: 'pay-04', paymentNumber: 'PAY-2026-0017',
    supplierId: 'sup-02', supplierName: 'Pacific Seafood Trading',
    invoiceIds: ['inv-02'], invoiceNumbers: ['INV-2026-0042'],
    totalAmount: 874.80, method: 'bank_transfer',
    paymentDate: '2026-04-05', status: 'rejected',
    preparedBy: 'Jenny Tan', reviewedBy: 'Sarah Ng', reviewedAt: '2026-04-05T09:00:00',
    rejectionReason: 'Invoice INV-2026-0042 is currently under dispute — cannot process payment until resolved.',
    createdAt: '2026-04-04T15:00:00',
  },
];

export const INVOICE_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  pending_review: { label: 'Pending Review', class: 'bg-warning/10 text-warning' },
  approved: { label: 'Approved', class: 'bg-success/10 text-success' },
  disputed: { label: 'Disputed', class: 'bg-destructive/10 text-destructive' },
  paid: { label: 'Paid', class: 'bg-primary/10 text-primary' },
  cancelled: { label: 'Cancelled', class: 'bg-muted text-muted-foreground' },
};

export const PAYMENT_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  pending_review: { label: 'Pending Review', class: 'bg-warning/10 text-warning' },
  approved: { label: 'Approved', class: 'bg-success/10 text-success' },
  processed: { label: 'Processed', class: 'bg-primary/10 text-primary' },
  rejected: { label: 'Rejected', class: 'bg-destructive/10 text-destructive' },
};

export const PAYMENT_METHOD_CONFIG: Record<string, { label: string; class: string }> = {
  bank_transfer: { label: 'Bank Transfer', class: 'bg-info/10 text-info' },
  cheque: { label: 'Cheque', class: 'bg-muted text-muted-foreground' },
  cash: { label: 'Cash', class: 'bg-warning/10 text-warning' },
};
