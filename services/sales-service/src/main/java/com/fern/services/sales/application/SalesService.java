package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.cache.JacksonCacheSerializer;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.dorabets.idempotency.IdempotencyGuard;
import com.dorabets.idempotency.model.IdempotencyResult;
import com.dorabets.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.model.cache.RedisClientAdapter;
import com.natsu.common.model.cache.TieredCache;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class SalesService {

  static final String IDEMPOTENCY_SERVICE = "sales-service:create-order";

  private final SalesRepository salesRepository;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final IdempotencyGuard idempotencyGuard;
  private final ObjectMapper objectMapper;
  private final TieredCache<List<SalesDtos.MonthlyRevenueRow>> monthlyRevenueCache;

  @Autowired
  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper,
      RedisClientAdapter redisClientAdapter
  ) {
    this.salesRepository = salesRepository;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
    this.idempotencyGuard = idempotencyGuard;
    this.objectMapper = objectMapper;
    this.monthlyRevenueCache = redisClientAdapter == null
        ? null
        : TieredCache.<List<SalesDtos.MonthlyRevenueRow>>builder("fern-sales-monthly-revenue")
            .localMaxSize(1_000)
            .localTtl(Duration.ofMinutes(1))
            .redisTtl(Duration.ofMinutes(10))
            .redisClient(redisClientAdapter)
            .serializer(new JacksonCacheSerializer<>(
                objectMapper,
                new TypeReference<List<SalesDtos.MonthlyRevenueRow>>() { }
            ))
            .build();
  }

  // Backward-compatible overload for tests without idempotency/cache wiring.
  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock
  ) {
    this(salesRepository, authorizationPolicyService, clock, null, new ObjectMapper(), null);
  }

  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper
  ) {
    this(salesRepository, authorizationPolicyService, clock, idempotencyGuard, objectMapper, null);
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
    return submitSale(null, request);
  }

  public SalesDtos.SaleView submitSale(String idempotencyKey, SalesDtos.SubmitSaleRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireSalesWrite(context);
    if (request.payment() != null) {
      throw ServiceException.badRequest("Payment is captured with mark-payment-done after order approval");
    }
    if (idempotencyKey == null || idempotencyKey.isBlank()) {
      return salesRepository.submitSale(request);
    }
    String normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    String requestBody = serializeForHash(request);
    IdempotencyResult result = idempotencyGuard.execute(
        IDEMPOTENCY_SERVICE,
        normalizedKey,
        requestBody,
        TtlPolicy.BET,
        () -> {
          SalesDtos.SaleView view = salesRepository.submitSale(request);
          return IdempotencyResult.created(serializeResponse(view), view.id());
        }
    );
    return deserializeResponse(result.responseBody());
  }

  private static String normalizeIdempotencyKey(String raw) {
    String trimmed = raw.trim();
    try {
      return UUID.fromString(trimmed).toString();
    } catch (IllegalArgumentException ex) {
      throw ServiceException.badRequest("Idempotency-Key must be a UUID");
    }
  }

  private String serializeForHash(SalesDtos.SubmitSaleRequest request) {
    try {
      return objectMapper.writeValueAsString(request);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException("Failed to serialize submit request for idempotency hash", ex);
    }
  }

  private String serializeResponse(SalesDtos.SaleView view) {
    try {
      return objectMapper.writeValueAsString(view);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException("Failed to serialize sale response for idempotency cache", ex);
    }
  }

  private SalesDtos.SaleView deserializeResponse(String body) {
    try {
      return objectMapper.readValue(body, SalesDtos.SaleView.class);
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to deserialize cached sale response", ex);
    }
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

  public List<SalesDtos.MonthlyRevenueRow> monthlyRevenue(Long outletId, LocalDate startDate, LocalDate endDate) {
    Set<Long> readable = resolveReadableOutletIds(outletId);
    String cacheKey = buildMonthlyCacheKey(readable, outletId, startDate, endDate);
    if (cacheKey == null) {
      return salesRepository.monthlyRevenue(readable, startDate, endDate);
    }
    return monthlyRevenueCache.getOrCompute(
        cacheKey,
        () -> salesRepository.monthlyRevenue(readable, startDate, endDate),
        Duration.ofMinutes(10)
    );
  }

  public void evictMonthlyRevenueCache() {
    if (monthlyRevenueCache != null) monthlyRevenueCache.clearLocal();
  }

  public List<SalesDtos.DailyRevenueRow> dailyRevenue(Long outletId, LocalDate startDate, LocalDate endDate) {
    Set<Long> readable = resolveReadableOutletIds(outletId);
    return salesRepository.dailyRevenue(readable, startDate, endDate);
  }

  private String buildMonthlyCacheKey(Set<Long> readable, Long outletId, LocalDate startDate, LocalDate endDate) {
    if (monthlyRevenueCache == null) return null;
    StringBuilder sb = new StringBuilder();
    if (readable == null) {
      sb.append("scope:all");
    } else {
      sb.append("scope:").append(readable.stream().sorted().map(Object::toString).reduce((a, b) -> a + "," + b).orElse("none"));
    }
    sb.append("|outlet:").append(outletId == null ? "any" : outletId);
    sb.append("|start:").append(startDate == null ? "" : startDate);
    sb.append("|end:").append(endDate == null ? "" : endDate);
    return sb.toString();
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
    evictMonthlyRevenueCache();
    return paid;
  }

  public SalesDtos.SaleView cancelSale(long saleId, SalesDtos.CancelSaleRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireSalesWriteForOutlet(context, existing.outletId());
    SalesDtos.SaleView cancelled = salesRepository.cancelSale(saleId, request == null ? null : request.reason(), context.userId());
    evictMonthlyRevenueCache();
    return cancelled;
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

  // Events now appended to outbox inside SalesRepository.markPaymentDone transaction.
  // OutboxRelay publishes to Kafka asynchronously — no direct publish here.
}
