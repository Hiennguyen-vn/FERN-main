package com.fern.services.procurement.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.procurement.GoodsReceiptPostedLineItem;
import com.fern.services.procurement.api.ProcurementDtos;
import com.fern.services.procurement.infrastructure.ProcurementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class GoodsReceiptService {

  private final ProcurementRepository procurementRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final TypedKafkaEventPublisher eventPublisher;
  private final Clock clock;

  public GoodsReceiptService(
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

  public ProcurementDtos.GoodsReceiptView createGoodsReceipt(ProcurementDtos.CreateGoodsReceiptRequest request) {
    ProcurementDtos.PurchaseOrderView purchaseOrder = procurementRepository.findPurchaseOrder(request.poId())
        .orElseThrow(() -> ServiceException.notFound("Purchase order not found: " + request.poId()));
    requireProcurementWrite(purchaseOrder.outletId());
    return procurementRepository.createGoodsReceipt(
        idGenerator.generateId(),
        request,
        RequestUserContextHolder.get().userId()
    );
  }

  public ProcurementDtos.GoodsReceiptView getGoodsReceipt(long receiptId) {
    ProcurementDtos.GoodsReceiptView receipt = procurementRepository.findGoodsReceipt(receiptId)
        .orElseThrow(() -> ServiceException.notFound("Goods receipt not found: " + receiptId));
    ProcurementDtos.PurchaseOrderView purchaseOrder = procurementRepository.findPurchaseOrder(receipt.poId())
        .orElseThrow(() -> ServiceException.notFound("Purchase order not found for goods receipt: " + receipt.poId()));
    requireProcurementRead(purchaseOrder.outletId());
    return receipt;
  }

  public PagedResult<ProcurementDtos.GoodsReceiptListItemView> listGoodsReceipts(
      Long outletId,
      Long poId,
      String status,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return procurementRepository.listGoodsReceipts(
        resolveReadableOutletIds(outletId),
        poId,
        status,
        startDate,
        endDate,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public ProcurementDtos.GoodsReceiptView approveGoodsReceipt(long receiptId) {
    ProcurementDtos.GoodsReceiptView receipt = procurementRepository.findGoodsReceipt(receiptId)
        .orElseThrow(() -> ServiceException.notFound("Goods receipt not found: " + receiptId));
    ProcurementDtos.PurchaseOrderView purchaseOrder = procurementRepository.findPurchaseOrder(receipt.poId())
        .orElseThrow(() -> ServiceException.notFound("Purchase order not found for goods receipt: " + receipt.poId()));
    requireProcurementWrite(purchaseOrder.outletId());
    return procurementRepository.approveGoodsReceipt(receiptId, RequestUserContextHolder.get().userId());
  }

  public GoodsReceiptPostedEvent postGoodsReceipt(long receiptId) {
    ProcurementDtos.GoodsReceiptView existingReceipt = procurementRepository.findGoodsReceipt(receiptId)
        .orElseThrow(() -> ServiceException.notFound("Goods receipt not found: " + receiptId));
    ProcurementDtos.PurchaseOrderView purchaseOrder = procurementRepository.findPurchaseOrder(existingReceipt.poId())
        .orElseThrow(() -> ServiceException.notFound(
            "Purchase order not found for goods receipt: " + existingReceipt.poId()));
    requireProcurementWrite(purchaseOrder.outletId());
    ProcurementDtos.GoodsReceiptView receipt = procurementRepository.postGoodsReceipt(receiptId);
    GoodsReceiptPostedEvent event = new GoodsReceiptPostedEvent(
        receipt.id(),
        receipt.poId(),
        purchaseOrder.supplierId(),
        purchaseOrder.outletId(),
        receipt.businessDate(),
        receipt.currencyCode(),
        receipt.items().stream()
            .map(item -> new GoodsReceiptPostedLineItem(
                item.itemId(),
                item.uomCode(),
                item.qtyReceived(),
                item.unitCost(),
                item.lineTotal()
            ))
            .toList(),
        receipt.totalPrice(),
        clock.instant()
    );
    eventPublisher.publish(
        "fern.procurement.goods-receipt-posted",
        Long.toString(receipt.id()),
        "procurement.goods-receipt-posted",
        event
    );
    return event;
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
