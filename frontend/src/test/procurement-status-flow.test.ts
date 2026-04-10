import { describe, expect, it } from 'vitest';
import {
  canApproveGoodsReceipt,
  canApprovePurchaseOrder,
  canApproveSupplierInvoice,
  canCreateGoodsReceiptFromPurchaseOrder,
  canCreateInvoiceFromGoodsReceipt,
  canCreatePaymentFromInvoice,
  canPostGoodsReceipt,
  canPostSupplierPayment,
  canReverseSupplierPayment,
} from '@/components/procurement/status-flow';

describe('procurement status flow', () => {
  it('allows purchase order approval only in pre-approval states', () => {
    expect(canApprovePurchaseOrder('draft')).toBe(true);
    expect(canApprovePurchaseOrder('submitted')).toBe(true);
    expect(canApprovePurchaseOrder('ordered')).toBe(false);
  });

  it('allows goods receipt creation only for receivable purchase orders', () => {
    expect(canCreateGoodsReceiptFromPurchaseOrder('approved')).toBe(true);
    expect(canCreateGoodsReceiptFromPurchaseOrder('partially_received')).toBe(true);
    expect(canCreateGoodsReceiptFromPurchaseOrder('draft')).toBe(false);
  });

  it('enforces the goods receipt approval and posting sequence', () => {
    expect(canApproveGoodsReceipt('draft')).toBe(true);
    expect(canPostGoodsReceipt('draft')).toBe(false);
    expect(canPostGoodsReceipt('received')).toBe(true);
  });

  it('keeps invoice approval and payment creation on backend-supported states', () => {
    expect(canCreateInvoiceFromGoodsReceipt('posted')).toBe(true);
    expect(canCreateInvoiceFromGoodsReceipt('received')).toBe(false);
    expect(canApproveSupplierInvoice('matched')).toBe(true);
    expect(canApproveSupplierInvoice('posted')).toBe(false);
    expect(canCreatePaymentFromInvoice('approved')).toBe(true);
    expect(canCreatePaymentFromInvoice('draft')).toBe(false);
  });

  it('only allows reversing a payment after posting', () => {
    expect(canPostSupplierPayment('pending')).toBe(true);
    expect(canPostSupplierPayment('posted')).toBe(false);
    expect(canReverseSupplierPayment('posted')).toBe(true);
    expect(canReverseSupplierPayment('pending')).toBe(false);
  });
});
