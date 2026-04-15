package com.fern.services.procurement.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Instant;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class SupplierPaymentService {

  private final ProcurementRepository procurementRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;

  public SupplierPaymentService(
      ProcurementRepository procurementRepository,
      SnowflakeIdGenerator idGenerator,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.procurementRepository = procurementRepository;
    this.idGenerator = idGenerator;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  public ProcurementDtos.SupplierPaymentView createPayment(ProcurementDtos.CreateSupplierPaymentRequest request) {
    long outletId = resolveOutletId(request.allocations().getFirst().invoiceId());
    requireProcurementWrite(outletId);
    return procurementRepository.createSupplierPayment(
        idGenerator.generateId(),
        request,
        RequestUserContextHolder.get().userId()
    );
  }

  public ProcurementDtos.SupplierPaymentView getPayment(long paymentId) {
    ProcurementDtos.SupplierPaymentView payment = procurementRepository.findSupplierPayment(paymentId)
        .orElseThrow(() -> ServiceException.notFound("Supplier payment not found: " + paymentId));
    if (payment.allocations().isEmpty()) {
      throw ServiceException.notFound("Supplier payment has no allocations: " + paymentId);
    }
    requireProcurementRead(resolveOutletId(payment.allocations().getFirst().invoiceId()));
    return payment;
  }

  public PagedResult<ProcurementDtos.SupplierPaymentListItemView> listPayments(
      Long outletId,
      Long supplierId,
      String status,
      Instant startTime,
      Instant endTime,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return procurementRepository.listSupplierPayments(
        resolveReadableOutletIds(outletId),
        supplierId,
        status,
        startTime,
        endTime,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public ProcurementDtos.SupplierPaymentView postPayment(long paymentId) {
    ProcurementDtos.SupplierPaymentView payment = procurementRepository.findSupplierPayment(paymentId)
        .orElseThrow(() -> ServiceException.notFound("Supplier payment not found: " + paymentId));
    requireProcurementWrite(resolveOutletId(payment.allocations().getFirst().invoiceId()));
    return procurementRepository.updateSupplierPaymentStatus(paymentId, "posted");
  }

  public ProcurementDtos.SupplierPaymentView cancelPayment(long paymentId) {
    ProcurementDtos.SupplierPaymentView payment = procurementRepository.findSupplierPayment(paymentId)
        .orElseThrow(() -> ServiceException.notFound("Supplier payment not found: " + paymentId));
    requireProcurementWrite(resolveOutletId(payment.allocations().getFirst().invoiceId()));
    return procurementRepository.updateSupplierPaymentStatus(paymentId, "cancelled");
  }

  public ProcurementDtos.SupplierPaymentView reversePayment(long paymentId) {
    ProcurementDtos.SupplierPaymentView payment = procurementRepository.findSupplierPayment(paymentId)
        .orElseThrow(() -> ServiceException.notFound("Supplier payment not found: " + paymentId));
    requireProcurementWrite(resolveOutletId(payment.allocations().getFirst().invoiceId()));
    return procurementRepository.updateSupplierPaymentStatus(paymentId, "reversed");
  }

  private long resolveOutletId(long invoiceId) {
    ProcurementDtos.SupplierInvoiceView invoice = procurementRepository.findSupplierInvoice(invoiceId)
        .orElseThrow(() -> ServiceException.notFound("Supplier invoice not found: " + invoiceId));
    ProcurementDtos.GoodsReceiptView receipt = procurementRepository.findGoodsReceipt(invoice.linkedReceiptIds().getFirst())
        .orElseThrow(() -> ServiceException.notFound("Goods receipt not found for invoice " + invoiceId));
    ProcurementDtos.PurchaseOrderView purchaseOrder = procurementRepository.findPurchaseOrder(receipt.poId())
        .orElseThrow(() -> ServiceException.notFound("Purchase order not found: " + receipt.poId()));
    return purchaseOrder.outletId();
  }

  private void requireProcurementWrite(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canWriteProcurement(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Procurement write access is required for outlet " + outletId);
  }

  private void requireProcurementRead(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canReadProcurement(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Procurement read access denied for outlet " + outletId);
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> readable = authorizationPolicyService.resolveProcurementReadableOutletIds(context);
    if (readable == null) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    if (requestedOutletId != null) {
      if (!readable.contains(requestedOutletId)) {
        throw ServiceException.forbidden("Procurement read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return readable;
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 100);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
