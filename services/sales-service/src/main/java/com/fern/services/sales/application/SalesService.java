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
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
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
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final IdempotencyGuard idempotencyGuard;
  private final ObjectMapper objectMapper;
  private final TieredCache<List<SalesDtos.MonthlyRevenueRow>> monthlyRevenueCache;
  private final PosMetrics posMetrics;

  @Autowired
  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper,
      RedisClientAdapter redisClientAdapter,
      PosMetrics posMetrics
  ) {
    this.salesRepository = salesRepository;
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
    this(salesRepository, authorizationPolicyService, clock, null, new ObjectMapper(), null, null);
  }

  public SalesService(
      SalesRepository salesRepository,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      IdempotencyGuard idempotencyGuard,
      ObjectMapper objectMapper
  ) {
    this(salesRepository, authorizationPolicyService, clock, idempotencyGuard, objectMapper, null, null);
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
    requireSalesWriteForOutlet(context, request.outletId());
    if (request.payment() != null) {
      throw ServiceException.badRequest("Payment is captured with mark-payment-done after order approval");
    }
    if (idempotencyKey == null || idempotencyKey.isBlank()) {
      return salesRepository.submitSale(request);
    }
    String normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    String namespace = buildIdempotencyNamespace(deviceId, request.outletId());
    String requestBody = serializeForHash(request);
    IdempotencyResult result = idempotencyGuard.execute(
        namespace,
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

  private static String buildIdempotencyNamespace(Long deviceId, long outletId) {
    String device = deviceId == null ? "nodev" : deviceId.toString();
    return IDEMPOTENCY_SERVICE + ":outlet:" + outletId + ":device:" + device;
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
    requireSalesWriteForOutlet(context, existing.outletId());
    SalesDtos.SaleView cancelled = salesRepository.cancelSale(saleId, request == null ? null : request.reason(), context.userId());
    evictMonthlyRevenueCache();
    return cancelled;
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
        outletId, posSessionId, currencyCode, "dine_in", note, lines, null
    );
    return salesRepository.submitSale(request, overrideSaleId);
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
        return existing;
      }
      if ("cancelled".equalsIgnoreCase(s)) {
        throw com.dorabets.common.middleware.ServiceException.conflict(
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
    } catch (com.dorabets.common.middleware.ServiceException ex) {
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
      throw com.dorabets.common.middleware.ServiceException.badRequest(
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
