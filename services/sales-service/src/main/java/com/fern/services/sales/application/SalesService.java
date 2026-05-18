package com.fern.services.sales.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.cache.JacksonCacheSerializer;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.common.idempotency.IdempotencyGuard;
import com.fern.common.idempotency.model.IdempotencyResult;
import com.fern.common.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.model.cache.RedisClientAdapter;
import com.fern.common.model.cache.TieredCache;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesPromotionRepository;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.time.Clock;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class SalesService {

  private static final Logger log = LoggerFactory.getLogger(SalesService.class);

  static final String IDEMPOTENCY_SERVICE = "sales-service:create-order";

  private final SalesRepository salesRepository;
  private final SalesPromotionRepository promotionRepository;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final IdempotencyGuard idempotencyGuard;
  private final ObjectMapper objectMapper;
  private final TieredCache<List<SalesDtos.MonthlyRevenueRow>> monthlyRevenueCache;
  private final PosMetrics posMetrics;
  private boolean reservationEnabled;

  @org.springframework.beans.factory.annotation.Value("${sales.reservation.enabled:false}")
  public void setReservationEnabled(boolean enabled) {
    this.reservationEnabled = enabled;
  }

  /**
   * Fail-fast guard: reject startup if someone flips sales.reservation.enabled=true before
   * W0.3 BomResolver is implemented. productId != itemId (core.item), so enabling the flag
   * without a resolver would silently corrupt inventory reservations on every sale submission.
   */
  @jakarta.annotation.PostConstruct
  void validateReservationConfig() {
    if (reservationEnabled) {
      throw new IllegalStateException(
          "sales.reservation.enabled=true is not safe: BOM resolver (W0.3) is not yet implemented. "
          + "productId cannot be used as itemId for stock reservation — this would corrupt inventory. "
          + "Keep sales.reservation.enabled=false until a BomResolver bean is wired and validated.");
    }
  }

  // Optional — wired only in production-context. Tests/legacy ctors leave it null.
  @org.springframework.beans.factory.annotation.Autowired(required = false)
  private LoyaltyService loyaltyService;

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  private PromotionEngine promotionEngine;

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  private com.fern.services.sales.application.kitchen.KitchenTicketService kitchenTicketService;

  @org.springframework.beans.factory.annotation.Value("${promotion.engine.enabled:true}")
  private boolean promotionEngineEnabled;

  @Autowired
  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper,
      RedisClientAdapter redisClientAdapter,
      PosMetrics posMetrics,
      SalesPromotionRepository promotionRepository
  ) {
    this.salesRepository = salesRepository;
    this.promotionRepository = promotionRepository;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
    this.idempotencyGuard = idempotencyGuard;
    this.objectMapper = objectMapper;
    this.posMetrics = posMetrics;
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
    this(salesRepository, authorizationPolicyService, clock, null, new ObjectMapper(), null, null, null);
  }

  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      SalesPromotionRepository promotionRepository
  ) {
    this(salesRepository, authorizationPolicyService, clock, null, new ObjectMapper(), null, null, promotionRepository);
  }

  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper
  ) {
    this(salesRepository, authorizationPolicyService, clock, idempotencyGuard, objectMapper, null, null, null);
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
    return submitSale(idempotencyKey, null, request);
  }

  public SalesDtos.SaleView submitSale(String idempotencyKey, Long deviceId, SalesDtos.SubmitSaleRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireOrderSubmissionAccess(context, request.outletId());
    if (request.payment() != null) {
      throw ServiceException.badRequest("Payment is captured with mark-payment-done after order approval");
    }
    SalesDtos.SubmitSaleRequest enrichedRequest = applyPromotions(request);
    SalesDtos.SaleView view;
    if (idempotencyKey == null || idempotencyKey.isBlank()) {
      view = salesRepository.submitSale(enrichedRequest);
    } else {
      String normalizedKey = normalizeIdempotencyKey(idempotencyKey);
      String namespace = buildIdempotencyNamespace(context.deviceId(), request.outletId());
      // Hash from the original client request (pre-promotion enrichment) so that promotion
      // changes between retries do not alter the hash and silently bypass idempotency.
      String requestBody = serializeForHash(request);
      IdempotencyResult result = idempotencyGuard.execute(
          namespace,
          normalizedKey,
          requestBody,
          TtlPolicy.BET,
          () -> {
            SalesDtos.SaleView created = salesRepository.submitSale(enrichedRequest);
            return IdempotencyResult.created(serializeResponse(created), created.id());
          }
      );
      view = deserializeResponse(result.responseBody());
    }
    reserveStockIfEnabled(view, enrichedRequest);
    return view;
  }

  private SalesDtos.SubmitSaleRequest applyPromotions(SalesDtos.SubmitSaleRequest request) {
    if (!promotionEngineEnabled || promotionEngine == null) return request;
    if (request.items() == null || request.items().isEmpty()) return request;
    java.util.Set<Long> productIds = request.items().stream()
        .map(SalesDtos.SaleLineRequest::productId)
        .collect(java.util.stream.Collectors.toSet());
    java.time.LocalDate businessDate = clock.instant().atZone(java.time.ZoneOffset.UTC).toLocalDate();
    java.util.Map<Long, java.math.BigDecimal> priceByProduct;
    try {
      priceByProduct = salesRepository.resolveUnitPrices(productIds, request.outletId(), businessDate);
    } catch (RuntimeException e) {
      log.warn("promotion price lookup failed: {}", e.getMessage());
      return request;
    }
    java.util.List<PromotionEngine.CartLine> cart = new java.util.ArrayList<>();
    for (SalesDtos.SaleLineRequest line : request.items()) {
      java.math.BigDecimal price = priceByProduct.get(line.productId());
      if (price == null) return request;
      cart.add(new PromotionEngine.CartLine(line.productId(), line.quantity(), price));
    }
    PromotionEngine.Allocation allocation;
    try {
      allocation = promotionEngine.evaluateForCart(request.outletId(), cart);
    } catch (RuntimeException e) {
      log.warn("promotion engine evaluation failed for outlet {}: {}", request.outletId(), e.getMessage());
      return request;
    }
    if (allocation == null || allocation.promotionId() == null
        || allocation.totalDiscount().signum() <= 0) {
      return request;
    }
    java.util.Map<Long, java.math.BigDecimal> discountByProduct = new java.util.HashMap<>();
    for (PromotionEngine.LineDiscount ld : allocation.lineDiscounts()) {
      discountByProduct.merge(ld.productId(), ld.discountAmount(), java.math.BigDecimal::add);
    }
    java.util.List<SalesDtos.SaleLineRequest> enriched = new java.util.ArrayList<>(request.items().size());
    for (SalesDtos.SaleLineRequest line : request.items()) {
      java.math.BigDecimal extraDiscount = discountByProduct.getOrDefault(line.productId(), java.math.BigDecimal.ZERO);
      java.math.BigDecimal merged = (line.discountAmount() == null
          ? java.math.BigDecimal.ZERO
          : line.discountAmount()).add(extraDiscount);
      java.util.Set<Long> mergedPromos = new java.util.LinkedHashSet<>();
      if (line.promotionIds() != null) mergedPromos.addAll(line.promotionIds());
      mergedPromos.add(allocation.promotionId());
      enriched.add(new SalesDtos.SaleLineRequest(
          line.productId(), line.quantity(), merged, line.taxAmount(), line.note(),
          mergedPromos, line.variantId(), line.variantName(), line.modifierOptionIds()
      ));
    }
    return new SalesDtos.SubmitSaleRequest(
        request.outletId(), request.posSessionId(), request.currencyCode(),
        request.orderType(), request.note(), enriched, request.payment()
    );
  }

  private void reserveStockIfEnabled(SalesDtos.SaleView view, SalesDtos.SubmitSaleRequest request) {
    if (!reservationEnabled) return;
    // validateReservationConfig() blocks startup if reservationEnabled=true, so this path
    // should never be reached in a correctly configured deployment. Throw defensively to
    // prevent silent inventory corruption if the @PostConstruct guard is somehow bypassed.
    throw new IllegalStateException(
        "BOM resolver (W0.3) not implemented — productId cannot be used as itemId. "
        + "sale=" + view.id() + " outlet=" + request.outletId()
        + " — set sales.reservation.enabled=false.");
  }

  private static String buildIdempotencyNamespace(Long deviceId, long outletId) {
    String device = deviceId == null ? "nodev" : deviceId.toString();
    return IDEMPOTENCY_SERVICE + ":outlet:" + outletId + ":device:" + device;
  }

  private void requireOrderSubmissionAccess(RequestUserContext context, long outletId) {
    if (context != null && context.isDeviceContext()) {
      if (!java.util.Objects.equals(context.deviceOutletId(), outletId)) {
        throw ServiceException.forbidden("Device is not registered for outlet " + outletId);
      }
      return;
    }
    requireSalesWriteForOutlet(context, outletId);
  }

  private void requireTerminalOrderMutationAccess(RequestUserContext context, long outletId) {
    if (context != null && context.isDeviceContext()) {
      if (!java.util.Objects.equals(context.deviceOutletId(), outletId)) {
        throw ServiceException.forbidden("Device is not registered for outlet " + outletId);
      }
      return;
    }
    requireSalesWriteForOutlet(context, outletId);
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

  public void attachCustomer(long saleId, Long customerId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireTerminalOrderMutationAccess(context, existing.outletId());
    salesRepository.linkCustomerToSale(saleId, customerId);
  }

  public void attachOrderingTable(long saleId, Long tableId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireTerminalOrderMutationAccess(context, existing.outletId());
    salesRepository.linkOrderingTableToSale(saleId, tableId);
  }

  public SalesDtos.SaleView approveSale(long saleId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireTerminalOrderMutationAccess(context, existing.outletId());
    SalesDtos.SaleView approved = salesRepository.approveSale(saleId, context.userId());
    try {
      autoEarnLoyalty(saleId);
    } catch (RuntimeException e) {
      log.warn("loyalty auto-earn failed for sale {}: {}", saleId, e.getMessage());
    }
    emitKitchenTicket(saleId);
    return approved;
  }

  public SalesDtos.SaleView confirmSale(long saleId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireTerminalOrderMutationAccess(context, existing.outletId());
    if (existing.publicOrderToken() == null || existing.orderingTableCode() == null) {
      throw ServiceException.conflict("Only customer-submitted table orders can be approved from this route");
    }
    SalesDtos.SaleView approved = salesRepository.approveSale(saleId, context.userId());
    emitKitchenTicket(saleId);
    return approved;
  }

  private void emitKitchenTicket(long saleId) {
    if (kitchenTicketService == null) return;
    try {
      kitchenTicketService.createFromSale(saleId);
    } catch (RuntimeException e) {
      log.warn("kitchen ticket emission failed for sale {}: {}", saleId, e.getMessage());
    }
  }

  public SalesDtos.SaleView markPaymentDone(long saleId, SalesDtos.MarkPaymentDoneRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireTerminalOrderMutationAccess(context, existing.outletId());
    SalesDtos.SaleView paid = salesRepository.markPaymentDone(saleId, request);
    evictMonthlyRevenueCache();
    if (posMetrics != null && existing.createdAt() != null) {
      long elapsedNanos = Duration.between(existing.createdAt(), clock.instant()).toNanos();
      posMetrics.orderCompletionTimer().record(elapsedNanos, java.util.concurrent.TimeUnit.NANOSECONDS);
    }
    return paid;
  }

  public SalesDtos.SaleView cancelSale(long saleId, SalesDtos.CancelSaleRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.SaleView existing = salesRepository.findSale(saleId)
        .orElseThrow(() -> ServiceException.notFound("Sale not found: " + saleId));
    requireTerminalOrderMutationAccess(context, existing.outletId());
    String reason       = request == null ? null : request.reason();
    String reasonCode   = request == null ? null : request.reasonCode();
    Long managerUserId  = request == null ? null : request.managerUserId();
    String voidNote     = request == null ? null : request.voidNote();
    SalesDtos.SaleView cancelled = salesRepository.cancelSale(
        saleId, reason, reasonCode, managerUserId, voidNote, context.userId());
    evictMonthlyRevenueCache();
    return cancelled;
  }

  public java.util.List<SalesDtos.VoidReasonView> listVoidReasons() {
    return salesRepository.listVoidReasons();
  }

  // Alias used by sync push handler — voids an offline-submitted sale.
  // Delegates to cancelSale; authorization bypassed for internal sync path.
  public void voidSaleFromSync(long saleId, String reason) {
    salesRepository.cancelSale(saleId, reason, null);
    evictMonthlyRevenueCache();
  }

  // ── Sync push handlers (W4) ───────────────────────────────────────────────
  // All methods below bypass RequestUserContext authorization because
  // they are called from the internal sync path (device → server reconcile).

  public SalesDtos.SaleView submitSaleFromSync(java.util.Map<String, Object> payload) {
    long outletId = toLong(payloadValue(payload, "outlet_id", "outletId"));
    Object posSessionValue = payloadValue(payload, "pos_session_id", "posSessionId");
    Long posSessionId = posSessionValue != null ? toLong(posSessionValue) : null;
    String currencyCode = toStr(payloadValue(payload, "currency_code", "currencyCode"), "VND");
    String orderType = normalizeSyncOrderType(toStr(payloadValue(payload, "order_type", "orderType"), "dine_in"));
    String note = toStr(payload.get("note"), null);
    Object saleIdValue = payloadValue(payload, "sale_id", "saleId");
    Long overrideSaleId = saleIdValue != null ? toLong(saleIdValue) : null;

    @SuppressWarnings("unchecked")
    java.util.List<java.util.Map<String, Object>> rawItems =
        (java.util.List<java.util.Map<String, Object>>) payload.get("items");
    if (rawItems == null || rawItems.isEmpty()) {
      throw new IllegalArgumentException("items must not be empty");
    }
    if (posSessionId == null) {
      throw ServiceException.conflict("Cashier sync events must include pos_session_id");
    }
    java.util.List<SalesDtos.SaleLineRequest> lines = rawItems.stream().map(item -> {
      long productId = toLong(payloadValue(item, "product_id", "productId"));
      java.math.BigDecimal qty = toBigDecimal(item.getOrDefault("quantity", 1));
      Object discountValue = payloadValue(item, "discount_amount", "discountAmount");
      java.math.BigDecimal discount = discountValue != null ? toBigDecimal(discountValue) : null;
      Object taxValue = payloadValue(item, "tax_amount", "taxAmount");
      java.math.BigDecimal tax = taxValue != null ? toBigDecimal(taxValue) : null;
      String itemNote = toStr(item.get("note"), null);
      Object variantIdValue = payloadValue(item, "variant_id", "variantId");
      Long variantId = variantIdValue != null ? toLong(variantIdValue) : null;
      String variantName = toStr(payloadValue(item, "variant_name", "variantName"), null);
      @SuppressWarnings("unchecked")
      java.util.List<Object> rawModifierOptionIds =
          (java.util.List<Object>) java.util.Objects.requireNonNullElse(
              payloadValue(item, "modifier_option_ids", "modifierOptionIds"),
              java.util.List.of());
      java.util.Set<Long> modifierOptionIds = rawModifierOptionIds.stream()
          .map(SalesService::toLong)
          .collect(java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new));
      return new SalesDtos.SaleLineRequest(
          productId, qty, discount, tax, itemNote, null, variantId, variantName,
          modifierOptionIds.isEmpty() ? null : java.util.Set.copyOf(modifierOptionIds)
      );
    }).toList();

    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        outletId, posSessionId, currencyCode, orderType, note, lines, null
    );
    if (overrideSaleId != null) {
      SalesDtos.SaleView existing = salesRepository.findSale(overrideSaleId).orElse(null);
      if (existing != null) {
        validateExistingSaleMatchesSyncPayload(existing, request, overrideSaleId);
        return existing;
      }
    }
    return salesRepository.submitSale(request, overrideSaleId);
  }

  private static void validateExistingSaleMatchesSyncPayload(
      SalesDtos.SaleView existing,
      SalesDtos.SubmitSaleRequest incoming,
      long saleId
  ) {
    if (existing.outletId() != incoming.outletId()) {
      throwDuplicateSaleConflict(saleId, "outlet_id");
    }
    if (!java.util.Objects.equals(existing.posSessionId(), incoming.posSessionId() == null ? null : String.valueOf(incoming.posSessionId()))) {
      throwDuplicateSaleConflict(saleId, "pos_session_id");
    }
    if (!java.util.Objects.equals(normalizeSyncOrderType(existing.orderType()), normalizeSyncOrderType(incoming.orderType()))) {
      throwDuplicateSaleConflict(saleId, "order_type");
    }
    if (!java.util.Objects.equals(existing.note(), incoming.note())) {
      throwDuplicateSaleConflict(saleId, "note");
    }
    List<SalesDtos.SaleLineView> existingItems = existing.items() == null ? List.of() : existing.items();
    List<SalesDtos.SaleLineRequest> incomingItems = incoming.items() == null ? List.of() : incoming.items();
    if (existingItems.size() != incomingItems.size()) {
      throwDuplicateSaleConflict(saleId, "items");
    }
    for (int i = 0; i < incomingItems.size(); i++) {
      SalesDtos.SaleLineView oldLine = existingItems.get(i);
      SalesDtos.SaleLineRequest newLine = incomingItems.get(i);
      if (oldLine.productId() != newLine.productId()) {
        throwDuplicateSaleConflict(saleId, "items.product_id");
      }
      if (compareDecimal(oldLine.quantity(), newLine.quantity()) != 0) {
        throwDuplicateSaleConflict(saleId, "items.quantity");
      }
      if (compareDecimal(oldLine.discountAmount(), defaultZero(newLine.discountAmount())) != 0) {
        throwDuplicateSaleConflict(saleId, "items.discount_amount");
      }
      if (compareDecimal(oldLine.taxAmount(), defaultZero(newLine.taxAmount())) != 0) {
        throwDuplicateSaleConflict(saleId, "items.tax_amount");
      }
      if (!java.util.Objects.equals(oldLine.note(), newLine.note())) {
        throwDuplicateSaleConflict(saleId, "items.note");
      }
      if (!java.util.Objects.equals(oldLine.variantId(), newLine.variantId())) {
        throwDuplicateSaleConflict(saleId, "items.variant_id");
      }
      if (!java.util.Objects.equals(oldLine.variantName(), newLine.variantName())) {
        throwDuplicateSaleConflict(saleId, "items.variant_name");
      }
      if (!existingModifierIds(oldLine).equals(newLine.modifierOptionIds() == null ? Set.of() : newLine.modifierOptionIds())) {
        throwDuplicateSaleConflict(saleId, "items.modifier_option_ids");
      }
    }
  }

  private static Set<Long> existingModifierIds(SalesDtos.SaleLineView line) {
    if (line.modifiers() == null || line.modifiers().isEmpty()) {
      return Set.of();
    }
    return line.modifiers().stream()
        .map(SalesDtos.SaleLineModifierView::modifierOptionId)
        .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
  }

  private static BigDecimal defaultZero(BigDecimal value) {
    return value == null ? BigDecimal.ZERO : value;
  }

  private static int compareDecimal(BigDecimal left, BigDecimal right) {
    return defaultZero(left).compareTo(defaultZero(right));
  }

  private static void throwDuplicateSaleConflict(long saleId, String field) {
    throw ServiceException.conflict("Duplicate sale id with different payload: " + saleId + " field=" + field);
  }

  private static String normalizeSyncOrderType(String orderType) {
    if (orderType == null || orderType.isBlank() || "pos".equalsIgnoreCase(orderType)) {
      return "dine_in";
    }
    String normalized = orderType.trim().toLowerCase(java.util.Locale.ROOT).replace('-', '_');
    return switch (normalized) {
      case "take_away", "takeout", "take_out" -> "takeaway";
      default -> normalized;
    };
  }

  public SalesDtos.SaleView approveSaleFromSync(java.util.Map<String, Object> payload) {
    long saleId = toLong(payloadValue(payload, "sale_id", "saleId"));
    Object actorUserIdValue = payloadValue(payload, "actor_user_id", "actorUserId");
    Long actorUserId = actorUserIdValue != null ? toLong(actorUserIdValue) : null;

    // Idempotent on retry: if sale already advanced past 'open', return current state instead of throwing 409.
    SalesDtos.SaleView existing = salesRepository.findSale(saleId).orElse(null);
    if (existing != null) {
      String s = existing.status();
      if ("order_approved".equalsIgnoreCase(s)
          || "payment_done".equalsIgnoreCase(s)
          || "completed".equalsIgnoreCase(s)
          || "cancelled".equalsIgnoreCase(s)) {
        return existing;
      }
    }

    // Sync path = customer already paid offline. Allow oversell so central books match the
    // physical sale; oversell_flag + sale_oversell_line capture the discrepancy for review.
    SalesDtos.SaleView approved = salesRepository.approveSale(saleId, actorUserId, true);

    // Detect legacy/stale prices submitted from offline edge: flag drift, retain unit_price as paid.
    try {
      int flagged = salesRepository.markPriceDrift(saleId);
      if (flagged > 0 && posMetrics != null) {
        posMetrics.recordPriceDriftDetected(approved.outletId(), flagged);
      }
    } catch (RuntimeException e) {
      log.warn("price drift detection failed for sale {}: {}", saleId, e.getMessage());
    }

    // Loyalty auto-earn: if sale linked to a customer, credit floor(total/10000) points.
    try {
      autoEarnLoyalty(saleId);
    } catch (RuntimeException e) {
      log.warn("loyalty auto-earn (sync) failed for sale {}: {}", saleId, e.getMessage());
    }

    emitKitchenTicket(saleId);

    // Persist manager override audit if edge attached one (manager unlocked the oversell at POS).
    @SuppressWarnings("unchecked")
    java.util.Map<String, Object> override =
        (java.util.Map<String, Object>) payload.get("manager_override");
    if (override != null && salesRepository.isSaleOversell(saleId)) {
      Long managerUserId = override.containsKey("manager_user_id") && override.get("manager_user_id") != null
          ? toLong(override.get("manager_user_id")) : null;
      String pinHash = toStr(override.get("manager_pin_hash"), null);
      String reason  = toStr(override.get("reason"), "oversell_offline");
      Object deviceIdValue = payloadValue(override, "device_id", "deviceId");
      Long deviceId = deviceIdValue != null ? toLong(deviceIdValue) : null;
      String payloadJson;
      try {
        payloadJson = objectMapper.writeValueAsString(override);
      } catch (Exception e) {
        payloadJson = null;
      }
      salesRepository.recordManagerOverride(
          approved.outletId(), saleId, "oversell",
          managerUserId, pinHash, reason, deviceId, payloadJson);
    }
    return approved;
  }

  public SalesDtos.SaleView capturePaymentFromSync(java.util.Map<String, Object> payload) {
    long saleId = toLong(payloadValue(payload, "sale_id", "saleId"));
    java.math.BigDecimal amount = toBigDecimal(payload.get("amount"));
    String paymentMethod = toStr(payloadValue(payload, "payment_method", "paymentMethod"), "cash");
    String transactionRef = toStr(payloadValue(payload, "transaction_ref", "transactionRef"), null);
    String clientOccurredAt = toStr(payloadValue(payload, "client_occurred_at", "clientOccurredAt"), null);
    Object deviceIdValue = payloadValue(payload, "device_id", "deviceId");
    Long deviceId = deviceIdValue != null ? toLong(deviceIdValue) : null;
    java.time.Instant serverReceived = clock.instant();
    java.time.Instant paymentTime = resolvePaymentTime(clientOccurredAt, serverReceived);

    // Idempotent on retry: if payment already captured, return current view.
    SalesDtos.SaleView existing = salesRepository.findSale(saleId).orElse(null);
    if (existing != null) {
      String s = existing.status();
      if ("payment_done".equalsIgnoreCase(s) || "completed".equalsIgnoreCase(s)) {
        validateExistingPaymentMatchesSyncPayload(existing, amount, paymentMethod, saleId);
        return existing;
      }
      if ("cancelled".equalsIgnoreCase(s)) {
        throw com.fern.common.middleware.ServiceException.conflict(
            "Sale was cancelled before payment sync arrived: " + saleId);
      }
    }

    SalesDtos.MarkPaymentDoneRequest request = new SalesDtos.MarkPaymentDoneRequest(
        paymentMethod, amount, paymentTime, transactionRef, null
    );
    SalesDtos.SaleView paid = salesRepository.markPaymentDone(saleId, request, deviceId, paymentTime, true);
    evictMonthlyRevenueCache();
    return paid;
  }

  private static void validateExistingPaymentMatchesSyncPayload(
      SalesDtos.SaleView existing,
      BigDecimal amount,
      String paymentMethod,
      long saleId
  ) {
    SalesDtos.PaymentView payment = existing.payment();
    if (payment == null) {
      throw ServiceException.conflict("Duplicate payment without existing payment detail: " + saleId);
    }
    if (compareDecimal(payment.amount(), amount) != 0) {
      throw ServiceException.conflict("Duplicate payment with different amount: " + saleId);
    }
    if (!java.util.Objects.equals(
        normalizePaymentMethodForCompare(payment.paymentMethod()),
        normalizePaymentMethodForCompare(paymentMethod))) {
      throw ServiceException.conflict("Duplicate payment with different method: " + saleId);
    }
  }

  private static String normalizePaymentMethodForCompare(String paymentMethod) {
    if (paymentMethod == null) {
      return "";
    }
    return paymentMethod.trim().toLowerCase(java.util.Locale.ROOT).replace('-', '_').replace(' ', '_');
  }

  public void refundSaleFromSync(long saleId, java.math.BigDecimal amount, String reason) {
    SalesDtos.SaleView existing = salesRepository.findSale(saleId).orElse(null);
    if (existing == null) {
      return; // idempotent — already gone
    }
    String status = existing.status();
    if ("submitted".equalsIgnoreCase(status) || "approved".equalsIgnoreCase(status)) {
      salesRepository.cancelSale(saleId, reason, null);
      evictMonthlyRevenueCache();
    }
    // If already cancelled/completed accept silently (MVP: log and move on)
  }

  public SalesDtos.PosSessionView openPosSessionFromSync(java.util.Map<String, Object> payload) {
    long outletId = toLong(payloadValue(payload, "outlet_id", "outletId"));
    long managerUserId = toLong(payloadValue(payload, "manager_user_id", "managerUserId"));
    String currencyCode = toStr(payloadValue(payload, "currency_code", "currencyCode"), "VND");
    String businessDateStr = toStr(payloadValue(payload, "business_date", "businessDate"), null);
    java.time.LocalDate businessDate = businessDateStr != null
        ? java.time.LocalDate.parse(businessDateStr) : java.time.LocalDate.now(clock);
    Object sessionIdValue = payloadValue(payload, "session_id", "sessionId");
    Long overrideSessionId = sessionIdValue != null ? toLong(sessionIdValue) : null;
    Object deviceIdValue = payloadValue(payload, "device_id", "deviceId");
    Long deviceId = deviceIdValue != null ? toLong(deviceIdValue) : null;
    String registerCode = toStr(payloadValue(payload, "register_code", "registerCode"), null);
    String openedByUsername = toStr(payloadValue(payload, "opened_by_username", "openedByUsername"), null);

    // Idempotent: same edge session id replayed → return existing.
    if (overrideSessionId != null) {
      java.util.Optional<SalesDtos.PosSessionView> existing =
          salesRepository.findPosSession(overrideSessionId);
      if (existing.isPresent()) return existing.get();
    }

    String sessionCode = overrideSessionId != null
        ? "SYNC-" + outletId + "-" + businessDate.toString().replace("-", "")
            + (deviceId == null ? "" : "-DEV-" + deviceId)
            + (registerCode == null ? "" : "-REG-" + registerCode)
            + "-" + overrideSessionId
        : "SYNC-" + outletId + "-" + businessDate.toString().replace("-", "")
            + (deviceId == null ? "" : "-DEV-" + deviceId)
            + (registerCode == null ? "" : "-REG-" + registerCode);
    SalesDtos.OpenPosSessionRequest request = new SalesDtos.OpenPosSessionRequest(
        sessionCode, outletId, currencyCode, managerUserId, deviceId,
        registerCode, openedByUsername,
        businessDate, "opened_offline"
    );
    return salesRepository.openPosSession(request, overrideSessionId);
  }

  public SalesDtos.PosSessionView closePosSessionFromSync(long sessionId) {
    SalesDtos.PosSessionView session = salesRepository.findPosSession(sessionId).orElse(null);
    if (session == null || "closed".equalsIgnoreCase(session.status())) {
      return session; // idempotent
    }
    try {
      return salesRepository.closePosSession(sessionId, null);
    } catch (com.fern.common.middleware.ServiceException ex) {
      // SESSION_HAS_UNPAID_ORDERS or other conflict — accept silently for sync
      return salesRepository.findPosSession(sessionId).orElse(session);
    }
  }

  private java.time.Instant resolvePaymentTime(String clientOccurredAt, java.time.Instant serverReceived) {
    if (clientOccurredAt == null || clientOccurredAt.isBlank()) {
      return serverReceived;
    }
    java.time.Instant clientTime;
    try {
      clientTime = java.time.Instant.parse(clientOccurredAt);
    } catch (Exception e) {
      log.warn("Invalid client_occurred_at '{}', using server time", clientOccurredAt);
      return serverReceived;
    }
    long skewSeconds = Math.abs(java.time.Duration.between(serverReceived, clientTime).getSeconds());
    if (skewSeconds > 86_400) { // > 24h
      throw com.fern.common.middleware.ServiceException.badRequest(
          "Clock skew too large: client_occurred_at differs from server time by more than 24 hours");
    }
    // Clamp future timestamps: max = serverReceived + 5 min
    java.time.Instant maxAllowed = serverReceived.plusSeconds(300);
    if (clientTime.isAfter(maxAllowed)) {
      log.warn("Clock skew clamped: client_occurred_at={} clamped to {}", clientOccurredAt, maxAllowed);
      return maxAllowed;
    }
    return clientTime;
  }

  private static long toLong(Object v) {
    if (v instanceof Number n) return n.longValue();
    return Long.parseLong(String.valueOf(v));
  }

  static java.math.BigDecimal toBigDecimal(Object v) {
    if (v == null) return java.math.BigDecimal.ZERO;
    if (v instanceof java.math.BigDecimal bd) return bd;
    if (v instanceof Long l) return java.math.BigDecimal.valueOf(l);
    if (v instanceof Integer i) return java.math.BigDecimal.valueOf(i);
    if (v instanceof Short s) return java.math.BigDecimal.valueOf(s);
    if (v instanceof Byte b) return java.math.BigDecimal.valueOf(b);
    return new java.math.BigDecimal(String.valueOf(v));
  }

  static String toStr(Object v, String defaultValue) {
    if (v == null) return defaultValue;
    String s = String.valueOf(v).trim();
    return s.isEmpty() ? defaultValue : s;
  }

  static Object payloadValue(Map<String, Object> payload, String snakeCase, String camelCase) {
    if (payload.containsKey(snakeCase)) {
      return payload.get(snakeCase);
    }
    return payload.get(camelCase);
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
    return listPromotionRecords(
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
    SalesDtos.PromotionView promotion = findPromotionRecord(promotionId)
        .orElseThrow(() -> ServiceException.notFound("Promotion not found: " + promotionId));
    requirePromotionRead(promotion.outletIds());
    return promotion;
  }

  public SalesDtos.PromotionView createPromotion(SalesDtos.CreatePromotionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requirePromotionWrite(context, request.outletIds());
    return createPromotionRecord(request);
  }

  public SalesDtos.PromotionView updatePromotion(long promotionId, SalesDtos.UpdatePromotionRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.PromotionView existing = findPromotionRecord(promotionId)
        .orElseThrow(() -> ServiceException.notFound("Promotion not found: " + promotionId));
    requirePromotionWrite(context, existing.outletIds());
    if (request.outletIds() != null) {
      requirePromotionWrite(context, request.outletIds());
    }
    return updatePromotionRecord(promotionId, request);
  }

  public SalesDtos.PromotionView deactivatePromotion(long promotionId) {
    RequestUserContext context = RequestUserContextHolder.get();
    SalesDtos.PromotionView existing = findPromotionRecord(promotionId)
        .orElseThrow(() -> ServiceException.notFound("Promotion not found: " + promotionId));
    requirePromotionWrite(context, existing.outletIds());
    if ("inactive".equalsIgnoreCase(existing.status())) {
      return existing;
    }
    if (!"active".equalsIgnoreCase(existing.status()) && !"draft".equalsIgnoreCase(existing.status())) {
      throw ServiceException.conflict("Only active or draft promotions can be deactivated");
    }
    return updatePromotionStatusRecord(promotionId, "inactive");
  }

  private PagedResult<SalesDtos.PromotionView> listPromotionRecords(
      Set<Long> outletIds,
      String status,
      Instant effectiveAt,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return promotionRepository.listPromotions(outletIds, status, effectiveAt, q, sortBy, sortDir, limit, offset);
  }

  private Optional<SalesDtos.PromotionView> findPromotionRecord(long promotionId) {
    return promotionRepository.findPromotion(promotionId);
  }

  private SalesDtos.PromotionView createPromotionRecord(SalesDtos.CreatePromotionRequest request) {
    return promotionRepository.createPromotion(request);
  }

  private SalesDtos.PromotionView updatePromotionRecord(
      long promotionId,
      SalesDtos.UpdatePromotionRequest request
  ) {
    return promotionRepository.updatePromotion(promotionId, request);
  }

  private SalesDtos.PromotionView updatePromotionStatusRecord(long promotionId, String status) {
    return promotionRepository.updatePromotionStatus(promotionId, status);
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

  /**
   * Auto-credits loyalty points for an approved sale linked to a customer.
   * No-op when loyaltyService isn't wired (tests/legacy contexts) or when sale has no customer.
   */
  void autoEarnLoyalty(long saleId) {
    if (loyaltyService == null) return;
    Long customerId = salesRepository.findCustomerIdForSale(saleId).orElse(null);
    if (customerId == null) return;
    java.math.BigDecimal total = salesRepository.findSaleTotal(saleId);
    int points = LoyaltyService.pointsFor(total);
    if (points == 0) return;
    if (!salesRepository.tryClaimLoyaltyEarn(saleId, points)) {
      // Retry of an already-credited sale: ledger entry already written.
      return;
    }
    try {
      loyaltyService.earn(customerId, saleId, total);
    } catch (RuntimeException e) {
      // Roll back the claim so a subsequent retry can re-attempt the ledger write.
      salesRepository.recordPointsEarned(saleId, 0);
      throw e;
    }
  }
}
