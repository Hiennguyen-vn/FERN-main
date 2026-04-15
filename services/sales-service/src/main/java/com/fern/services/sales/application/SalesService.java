package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.sales.PaymentCapturedEvent;
import com.fern.events.sales.SaleCompletedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class SalesService {

  private final SalesRepository salesRepository;
  private final TypedKafkaEventPublisher kafkaEventPublisher;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;

  public SalesService(
      SalesRepository salesRepository,
      TypedKafkaEventPublisher kafkaEventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock
  ) {
    this.salesRepository = salesRepository;
    this.kafkaEventPublisher = kafkaEventPublisher;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
  }

  public SalesDtos.PosSessionView openPosSession(SalesDtos.OpenPosSessionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireSalesWrite(context);
    return salesRepository.openPosSession(request);
  }

  public SalesDtos.PosSessionView closePosSession(long sessionId, SalesDtos.ClosePosSessionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireSalesWrite(context);
    return salesRepository.closePosSession(sessionId, request == null ? null : request.note());
  }

  public SalesDtos.PosSessionReconciliationView reconcilePosSession(
      long sessionId,
      SalesDtos.ReconcilePosSessionRequest request
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.PosSessionView session = salesRepository.findPosSession(sessionId)
        .orElseThrow(() -> ServiceException.notFound("POS session not found: " + sessionId));
    requireSalesWriteForOutlet(context, session.outletId());
    SalesDtos.ReconcilePosSessionRequest normalizedRequest =
        request == null ? new SalesDtos.ReconcilePosSessionRequest(List.of(), null) : request;
    return salesRepository.reconcilePosSession(sessionId, normalizedRequest, context.userId());
  }

  public SalesDtos.SaleView submitSale(SalesDtos.SubmitSaleRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireSalesWrite(context);
    if (request.payment() != null) {
      throw ServiceException.badRequest("Payment is captured with mark-payment-done after order approval");
    }
    return salesRepository.submitSale(request);
  }

  public SalesDtos.SaleView getSale(long saleId) {
    SalesDtos.SaleView sale = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireSalesRead(sale.outletId());
    return sale;
  }

  public PagedResult<SalesDtos.SaleListItemView> listSales(
      Long outletId,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      String paymentStatus,
      Boolean publicOrderOnly,
      Long posSessionId,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return salesRepository.listSales(
        resolveReadableOutletIds(outletId),
        startDate,
        endDate,
        status,
        paymentStatus,
        publicOrderOnly,
        posSessionId,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public List<SalesDtos.OrderingTableLinkView> listOrderingTables(Long outletId, String status) {
    return salesRepository.listOrderingTables(
        resolveWritableOutletIds(outletId),
        status
    );
  }

  public SalesDtos.OrderingTableDetailView getOrderingTable(String tableToken) {
    SalesDtos.OrderingTableDetailView table = salesRepository.findOrderingTableByToken(tableToken)
        .orElseThrow(() -> ServiceException.notFound("Ordering table not found: " + tableToken));
    requireSalesRead(table.outletId());
    return table;
  }

  public SalesDtos.OrderingTableDetailView createOrderingTable(SalesDtos.CreateOrderingTableRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireSalesWriteForOutlet(context, request.outletId());
    return salesRepository.createOrderingTable(request);
  }

  public SalesDtos.OrderingTableDetailView updateOrderingTable(
      String tableToken,
      SalesDtos.UpdateOrderingTableRequest request
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.OrderingTableDetailView table = salesRepository.findOrderingTableByToken(tableToken)
        .orElseThrow(() -> ServiceException.notFound("Ordering table not found: " + tableToken));
    requireSalesWriteForOutlet(context, table.outletId());
    return salesRepository.updateOrderingTable(tableToken, request);
  }

  public SalesDtos.SaleView approveSale(long saleId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireSalesWriteForOutlet(context, existing.outletId());
    return salesRepository.approveSale(saleId, context.userId());
  }

  public SalesDtos.SaleView confirmSale(long saleId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireSalesWriteForOutlet(context, existing.outletId());
    if (existing.publicOrderToken() == null || existing.orderingTableCode() == null) {
      throw ServiceException.conflict("Only customer-submitted table orders can be approved from this route");
    }
    return salesRepository.approveSale(saleId, context.userId());
  }

  public SalesDtos.SaleView markPaymentDone(long saleId, SalesDtos.MarkPaymentDoneRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireSalesWriteForOutlet(context, existing.outletId());
    SalesDtos.SaleView paid = salesRepository.markPaymentDone(saleId, request);
    publishSaleCompletedEvents(paid);
    return paid;
  }

  public SalesDtos.SaleView cancelSale(long saleId, SalesDtos.CancelSaleRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireSalesWriteForOutlet(context, existing.outletId());
    return salesRepository.cancelSale(saleId, request == null ? null : request.reason(), context.userId());
  }

  public PagedResult<SalesDtos.PosSessionListItemView> listPosSessions(
      Long outletId,
      LocalDate businessDate,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      Long managerId,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return salesRepository.listPosSessions(
        resolveReadableOutletIds(outletId),
        businessDate,
        startDate,
        endDate,
        status,
        managerId,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public SalesDtos.PosSessionView getPosSession(long sessionId) {
    SalesDtos.PosSessionView session = salesRepository.findPosSession(sessionId)
        .orElseThrow(() -> ServiceException.notFound("POS session not found: " + sessionId));
    requireSalesRead(session.outletId());
    return session;
  }

  public SalesDtos.OutletStatsView getOutletStats(long outletId, LocalDate onDate) {
    requireSalesRead(outletId);
    LocalDate businessDate = onDate == null ? LocalDate.now(clock) : onDate;
    return salesRepository.getOutletStats(outletId, businessDate);
  }

  public PagedResult<SalesDtos.PromotionView> listPromotions(
      Long outletId,
      String status,
      Instant effectiveAt,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return salesRepository.listPromotions(
        resolveReadableOutletIds(outletId),
        status,
        effectiveAt,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public SalesDtos.PromotionView getPromotion(long promotionId) {
    SalesDtos.PromotionView promotion = salesRepository.findPromotion(promotionId)
        .orElseThrow(() -> ServiceException.notFound("Promotion not found: " + promotionId));
    requirePromotionRead(promotion.outletIds());
    return promotion;
  }

  public SalesDtos.PromotionView createPromotion(SalesDtos.CreatePromotionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requirePromotionWrite(context, request.outletIds());
    return salesRepository.createPromotion(request);
  }

  public SalesDtos.PromotionView updatePromotion(long promotionId, SalesDtos.UpdatePromotionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.PromotionView existing = salesRepository.findPromotion(promotionId)
        .orElseThrow(() -> ServiceException.notFound("Promotion not found: " + promotionId));
    requirePromotionWrite(context, existing.outletIds());
    if (request.outletIds() != null) {
      requirePromotionWrite(context, request.outletIds());
    }
    return salesRepository.updatePromotion(promotionId, request);
  }

  public SalesDtos.PromotionView deactivatePromotion(long promotionId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.PromotionView existing = salesRepository.findPromotion(promotionId)
        .orElseThrow(() -> ServiceException.notFound("Promotion not found: " + promotionId));
    requirePromotionWrite(context, existing.outletIds());
    if ("inactive".equalsIgnoreCase(existing.status())) {
      return existing;
    }
    if (!"active".equalsIgnoreCase(existing.status()) && !"draft".equalsIgnoreCase(existing.status())) {
      throw ServiceException.conflict("Only active or draft promotions can be deactivated");
    }
    return salesRepository.updatePromotionStatus(promotionId, "inactive");
  }

  private void requireSalesWrite(RequestUserContext context) {
    if (authorizationPolicyService.canWriteSales(context)) {
      return;
    }
    throw ServiceException.forbidden("Sales permission is required");
  }

  private void requireSalesWriteForOutlet(RequestUserContext context, long outletId) {
    if (authorizationPolicyService.canWriteSalesForOutlet(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Sales write access denied for outlet " + outletId);
  }

  private void requirePromotionWrite(RequestUserContext context, Set<Long> requestedOutletIds) {
    if (context.internalService()) {
      return;
    }
    context.requireUserId();
    Set<Long> scopedOutlets = requestedOutletIds == null ? Set.of() : Set.copyOf(new LinkedHashSet<>(requestedOutletIds));
    if (scopedOutlets.isEmpty()) {
      throw ServiceException.forbidden("Scoped sales users must provide outletIds for promotions");
    }
    for (Long outletId : scopedOutlets) {
      if (!authorizationPolicyService.canWriteSalesForOutlet(context, outletId)) {
        throw ServiceException.forbidden("Sales promotion write access denied for one or more requested outlets");
      }
    }
  }

  private void requireSalesRead(long outletId) {
    resolveReadableOutletIds(outletId);
  }

  private Set<Long> resolveWritableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    context.requireUserId();
    if (!authorizationPolicyService.canWriteSales(context)) {
      throw ServiceException.forbidden("Sales permission is required");
    }
    Set<Long> allWritable = authorizationPolicyService.resolveSalesReadableOutletIds(context);
    if (allWritable != null && allWritable.isEmpty()) {
      throw ServiceException.forbidden("Sales write access requires outlet scope");
    }
    if (requestedOutletId != null) {
      if (!authorizationPolicyService.canWriteSalesForOutlet(context, requestedOutletId)) {
        throw ServiceException.forbidden("Sales write access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return allWritable;
  }

  private void requirePromotionRead(Set<Long> outletIds) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
    }
    context.requireUserId();
    if (outletIds == null || outletIds.isEmpty()) {
      throw ServiceException.forbidden("Sales promotion read access requires outlet scope");
    }
    Set<Long> readable = authorizationPolicyService.resolveSalesReadableOutletIds(context);
    if (readable == null) {
      return;
    }
    boolean allowed = outletIds.stream().anyMatch(readable::contains);
    if (!allowed) {
      throw ServiceException.forbidden("Sales promotion read access denied for the current outlet scope");
    }
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> readable = authorizationPolicyService.resolveSalesReadableOutletIds(context);
    if (readable == null) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    if (readable.isEmpty()) {
      throw ServiceException.forbidden("Sales read access requires outlet scope");
    }
    if (requestedOutletId != null) {
      if (!readable.contains(requestedOutletId)) {
        throw ServiceException.forbidden("Sales read access denied for outlet " + requestedOutletId);
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

  private void publishSaleCompletedEvents(SalesDtos.SaleView sale) {
    long saleId = Long.parseLong(sale.id());
    kafkaEventPublisher.publish(
        "fern.sales.sale-completed",
        sale.id(),
        "sales.sale.completed",
        new SaleCompletedEvent(
            saleId,
            sale.outletId(),
            sale.createdAt().atZone(java.time.ZoneOffset.UTC).toLocalDate(),
            sale.currencyCode(),
            sale.items().stream()
                .map(item -> new SaleCompletedLineItem(
                    item.productId(),
                    item.quantity(),
                    item.unitPrice(),
                    item.discountAmount(),
                    item.taxAmount(),
                    item.lineTotal()
                ))
                .toList(),
            sale.subtotal(),
            sale.discount(),
            sale.taxAmount(),
            sale.totalAmount(),
            clock.instant()
        )
    );
    if (sale.payment() != null && "success".equalsIgnoreCase(sale.payment().status())) {
      kafkaEventPublisher.publish(
          "fern.sales.payment-captured",
          sale.id(),
          "sales.payment.captured",
          new PaymentCapturedEvent(
              saleId,
              sale.payment().paymentMethod(),
              sale.payment().amount(),
              sale.currencyCode(),
              sale.payment().paymentTime(),
              sale.payment().transactionRef()
          )
      );
    }
  }
}
