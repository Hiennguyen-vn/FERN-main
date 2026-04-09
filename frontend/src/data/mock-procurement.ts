import type { Supplier, PurchaseOrder, GoodsReceipt } from '@/types/procurement';

export const mockSuppliers: Supplier[] = [
  {
    id: 'sup-01', code: 'SUP-001', name: 'FreshFarm Produce Co.', status: 'active',
    paymentTerms: 'Net 30', taxId: 'TIN-2024-00891', legalName: 'FreshFarm Produce Pte Ltd',
    taxReady: true, contactName: 'David Lim', contactEmail: 'david@freshfarm.sg',
    contactPhone: '+65 6123 4567', address: '12 Pasir Panjang Rd, #03-01, Singapore 118491',
    bankName: 'DBS Bank', bankAccount: '***4821', createdAt: '2024-01-15',
  },
  {
    id: 'sup-02', code: 'SUP-002', name: 'Pacific Seafood Trading', status: 'active',
    paymentTerms: 'Net 14', taxId: 'TIN-2024-01204', legalName: 'Pacific Seafood Trading Pte Ltd',
    taxReady: true, contactName: 'Jenny Tan', contactEmail: 'jenny@pacificseafood.sg',
    contactPhone: '+65 6234 5678', address: '8 Fishery Port Rd, Singapore 619742',
    bankName: 'OCBC Bank', bankAccount: '***7392', createdAt: '2024-02-20',
  },
  {
    id: 'sup-03', code: 'SUP-003', name: 'Artisan Bakery Supplies', status: 'active',
    paymentTerms: 'Net 30', taxReady: false, contactName: 'Michael Chen',
    contactEmail: 'michael@artisanbakery.sg', contactPhone: '+65 6345 6789',
    createdAt: '2024-06-10', notes: 'Tax registration pending',
  },
  {
    id: 'sup-04', code: 'SUP-004', name: 'Golden Beverage Dist.', status: 'inactive',
    paymentTerms: 'Net 45', taxId: 'TIN-2023-00412', legalName: 'Golden Beverage Distribution Pte Ltd',
    taxReady: true, contactName: 'Sarah Ng', contactEmail: 'sarah@goldenbev.sg',
    contactPhone: '+65 6456 7890', createdAt: '2023-11-05',
  },
  {
    id: 'sup-05', code: 'SUP-005', name: 'Metro Dairy Farm', status: 'pending',
    paymentTerms: 'COD', taxReady: false, contactName: 'Ahmad Ibrahim',
    contactEmail: 'ahmad@metrodairy.sg', contactPhone: '+65 6567 8901',
    createdAt: '2026-03-28', notes: 'New supplier — onboarding in progress',
  },
];

export const mockPurchaseOrders: PurchaseOrder[] = [
  {
    id: 'po-01', poNumber: 'PO-2026-0401', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.', createdBy: 'Marcus Rivera',
    createdAt: '2026-04-01T09:00:00', orderDate: '2026-04-01', expectedDelivery: '2026-04-04',
    status: 'completed',
    lines: [
      { id: 'pol-01', itemName: 'Mixed Lettuce', quantity: 10, unit: 'kg', unitPrice: 8.50, lineTotal: 85.00 },
      { id: 'pol-02', itemName: 'Tomatoes', quantity: 15, unit: 'kg', unitPrice: 4.20, lineTotal: 63.00 },
      { id: 'pol-03', itemName: 'Bell Peppers', quantity: 8, unit: 'kg', unitPrice: 6.00, lineTotal: 48.00 },
    ],
    subtotal: 196.00, taxAmount: 15.68, total: 211.68,
    submittedAt: '2026-04-01T09:15:00', approvedAt: '2026-04-01T10:00:00', approvedBy: 'Regional Ops',
    issuedAt: '2026-04-01T10:05:00',
  },
  {
    id: 'po-02', poNumber: 'PO-2026-0402', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    supplierId: 'sup-02', supplierName: 'Pacific Seafood Trading', createdBy: 'Marcus Rivera',
    createdAt: '2026-04-02T08:30:00', orderDate: '2026-04-02', expectedDelivery: '2026-04-05',
    status: 'ordered',
    lines: [
      { id: 'pol-04', itemName: 'Salmon Fillet', quantity: 20, unit: 'kg', unitPrice: 28.00, lineTotal: 560.00 },
      { id: 'pol-05', itemName: 'Prawns (L)', quantity: 10, unit: 'kg', unitPrice: 22.00, lineTotal: 220.00 },
    ],
    subtotal: 780.00, taxAmount: 62.40, total: 842.40,
    submittedAt: '2026-04-02T08:45:00', approvedAt: '2026-04-02T09:30:00', approvedBy: 'Regional Ops',
    issuedAt: '2026-04-02T09:35:00',
  },
  {
    id: 'po-03', poNumber: 'PO-2026-0403', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    supplierId: 'sup-03', supplierName: 'Artisan Bakery Supplies', createdBy: 'Marcus Rivera',
    createdAt: '2026-04-03T10:00:00', orderDate: '2026-04-03', expectedDelivery: '2026-04-06',
    status: 'approved',
    lines: [
      { id: 'pol-06', itemName: 'Pizza Dough (frozen)', quantity: 50, unit: 'pcs', unitPrice: 2.80, lineTotal: 140.00 },
      { id: 'pol-07', itemName: 'Croissant Dough', quantity: 40, unit: 'pcs', unitPrice: 3.20, lineTotal: 128.00 },
      { id: 'pol-08', itemName: 'Sourdough Loaf', quantity: 20, unit: 'pcs', unitPrice: 5.50, lineTotal: 110.00 },
    ],
    subtotal: 378.00, taxAmount: 30.24, total: 408.24,
    submittedAt: '2026-04-03T10:15:00', approvedAt: '2026-04-03T11:00:00', approvedBy: 'Regional Ops',
  },
  {
    id: 'po-04', poNumber: 'PO-2026-0404', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.', createdBy: 'Marcus Rivera',
    createdAt: '2026-04-04T08:00:00', orderDate: '2026-04-04', expectedDelivery: '2026-04-07',
    status: 'draft',
    lines: [
      { id: 'pol-09', itemName: 'Butter', quantity: 10, unit: 'kg', unitPrice: 12.00, lineTotal: 120.00 },
      { id: 'pol-10', itemName: 'Heavy Cream', quantity: 8, unit: 'L', unitPrice: 9.50, lineTotal: 76.00 },
    ],
    subtotal: 196.00, taxAmount: 15.68, total: 211.68,
  },
  {
    id: 'po-05', poNumber: 'PO-2026-0398', outletId: 'outlet-001', outletName: 'Downtown Flagship',
    supplierId: 'sup-02', supplierName: 'Pacific Seafood Trading', createdBy: 'Aisha Patel',
    createdAt: '2026-03-29T09:00:00', orderDate: '2026-03-29', expectedDelivery: '2026-04-01',
    status: 'cancelled', cancelReason: 'Supplier unable to fulfill — stock shortage',
    lines: [
      { id: 'pol-11', itemName: 'Tuna Sashimi Grade', quantity: 5, unit: 'kg', unitPrice: 45.00, lineTotal: 225.00 },
    ],
    subtotal: 225.00, taxAmount: 18.00, total: 243.00,
    submittedAt: '2026-03-29T09:10:00', cancelledAt: '2026-03-30T14:00:00',
  },
];

export const mockGoodsReceipts: GoodsReceipt[] = [
  {
    id: 'gr-01', grNumber: 'GR-0284', poId: 'po-01', poNumber: 'PO-2026-0401',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', receivedBy: 'Marcus Rivera',
    receiptDate: '2026-04-04', status: 'posted', postedAt: '2026-04-04T13:50:00',
    lines: [
      { id: 'grl-01', itemName: 'Mixed Lettuce', unit: 'kg', orderedQty: 10, previouslyReceived: 0, receivingNow: 10, damagedQty: 0, variance: 0 },
      { id: 'grl-02', itemName: 'Tomatoes', unit: 'kg', orderedQty: 15, previouslyReceived: 0, receivingNow: 14, damagedQty: 1, variance: -1, notes: '1 kg damaged in transit' },
      { id: 'grl-03', itemName: 'Bell Peppers', unit: 'kg', orderedQty: 8, previouslyReceived: 0, receivingNow: 8, damagedQty: 0, variance: 0 },
    ],
  },
  {
    id: 'gr-02', grNumber: 'GR-0283', poId: 'po-01', poNumber: 'PO-2026-0401',
    supplierId: 'sup-01', supplierName: 'FreshFarm Produce Co.',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', receivedBy: 'Marcus Rivera',
    receiptDate: '2026-04-04', status: 'posted', postedAt: '2026-04-04T10:05:00',
    lines: [
      { id: 'grl-04', itemName: 'Sparkling Water', unit: 'bottles', orderedQty: 48, previouslyReceived: 0, receivingNow: 48, damagedQty: 0, variance: 0 },
    ],
    notes: 'Beverage delivery — separate from produce',
  },
  {
    id: 'gr-03', grNumber: 'GR-0285', poId: 'po-02', poNumber: 'PO-2026-0402',
    supplierId: 'sup-02', supplierName: 'Pacific Seafood Trading',
    outletId: 'outlet-001', outletName: 'Downtown Flagship', receivedBy: 'Marcus Rivera',
    receiptDate: '2026-04-05', status: 'draft',
    lines: [
      { id: 'grl-05', itemName: 'Salmon Fillet', unit: 'kg', orderedQty: 20, previouslyReceived: 0, receivingNow: 0, damagedQty: 0, variance: 0 },
      { id: 'grl-06', itemName: 'Prawns (L)', unit: 'kg', orderedQty: 10, previouslyReceived: 0, receivingNow: 0, damagedQty: 0, variance: 0 },
    ],
  },
];

export const PO_STATUS_STEPS = ['draft', 'submitted', 'approved', 'ordered', 'partially_received', 'completed', 'closed'] as const;

export const PO_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Submitted', class: 'bg-info/10 text-info' },
  approved: { label: 'Approved', class: 'bg-success/10 text-success' },
  ordered: { label: 'Ordered', class: 'bg-primary/10 text-primary' },
  partially_received: { label: 'Partial', class: 'bg-warning/10 text-warning' },
  completed: { label: 'Completed', class: 'bg-success/10 text-success' },
  closed: { label: 'Closed', class: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', class: 'bg-destructive/10 text-destructive' },
};

export const GR_STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  draft: { label: 'Draft', class: 'bg-muted text-muted-foreground' },
  received: { label: 'Received', class: 'bg-info/10 text-info' },
  posted: { label: 'Posted', class: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelled', class: 'bg-destructive/10 text-destructive' },
};
