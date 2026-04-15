package com.fern.services.procurement.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.procurement.InvoiceApprovedEvent;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class SupplierInvoiceService {

  private final ProcurementRepository procurementRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final TypedKafkaEventPublisher eventPublisher;
  private final Clock clock;

  public SupplierInvoiceService(
      ProcurementRepository procurementRepository,
      SnowflakeIdGenerator idGenerator,
      AuthorizationPolicyService authorizationPolicyService,
      TypedKafkaEventPublisher eventPublisher,
      Clock clock
  ) {
    this.procurementRepository = procurementRepository;
    this.idGenerator = idGenerator;
    this.authorizationPolicyService = authorizationPolicyService;
    this.eventPublisher = eventPublisher;
    this.clock = clock;
  }

  public ProcurementDtos.SupplierInvoiceView createInvoice(ProcurementDtos.CreateSupplierInvoiceRequest request) {
    long outletId = resolveOutletId(request.linkedReceiptIds().getFirst());
    requireProcurementWrite(outletId);
    return procurementRepository.createSupplierInvoice(
        idGenerator.generateId(),
        request,
        RequestUserContextHolder.get().userId()
    );
  }

  public ProcurementDtos.SupplierInvoiceView getInvoice(long invoiceId) {
    ProcurementDtos.SupplierInvoiceView view = procurementRepository.findSupplierInvoice(invoiceId)
        .orElseThrow(() -> ServiceException.notFound("Supplier invoice not found: " + invoiceId));
    requireProcurementRead(resolveOutletId(view.linkedReceiptIds().getFirst()));
    return view;
  }

  public PagedResult<ProcurementDtos.SupplierInvoiceListItemView> listInvoices(
      Long outletId,
      Long supplierId,
      String status,
      LocalDate invoiceDateFrom,
      LocalDate invoiceDateTo,
      LocalDate dueDateTo,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return procurementRepository.listSupplierInvoices(
        resolveReadableOutletIds(outletId),
        supplierId,
        status,
        invoiceDateFrom,
        invoiceDateTo,
        dueDateTo,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public InvoiceApprovedEvent approveInvoice(long invoiceId) {
    ProcurementDtos.SupplierInvoiceView existing = procurementRepository.findSupplierInvoice(invoiceId)
        .orElseThrow(() -> ServiceException.notFound("Supplier invoice not found: " + invoiceId));
    long outletId = resolveOutletId(existing.linkedReceiptIds().getFirst());
    requireProcurementWrite(outletId);
    ProcurementDtos.SupplierInvoiceView view = procurementRepository.approveSupplierInvoice(
        invoiceId,
        RequestUserContextHolder.get().userId()
    );
    InvoiceApprovedEvent event = new InvoiceApprovedEvent(
        view.id(),
        view.supplierId(),
        view.invoiceDate(),
        view.currencyCode(),
        view.totalAmount(),
        view.linkedReceiptIds(),
        view.approvedAt() == null ? clock.instant() : view.approvedAt()
    );
    eventPublisher.publish(
        "fern.procurement.invoice-approved",
        Long.toString(view.id()),
        "procurement.invoice-approved",
        event
    );
    return event;
  }

  private long resolveOutletId(long receiptId) {
    ProcurementDtos.GoodsReceiptView receipt = procurementRepository.findGoodsReceipt(receiptId)
        .orElseThrow(() -> ServiceException.notFound("Goods receipt not found: " + receiptId));
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
