package com.fern.services.inventory.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.inventory.StockLowThresholdEvent;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.sales.SaleCompletedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.inventory.api.InventoryDtos;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryService {

  private final InventoryRepository inventoryRepository;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final TypedKafkaEventPublisher eventPublisher;
  private final SnowflakeIdGenerator idGenerator;
  private final Clock clock;

  public InventoryService(
      InventoryRepository inventoryRepository,
      AuthorizationPolicyService authorizationPolicyService,
      TypedKafkaEventPublisher eventPublisher,
      SnowflakeIdGenerator idGenerator,
      Clock clock
  ) {
    this.inventoryRepository = inventoryRepository;
    this.authorizationPolicyService = authorizationPolicyService;
    this.eventPublisher = eventPublisher;
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  public InventoryDtos.StockBalanceView getStockBalance(long outletId, long itemId) {
    requireInventoryRead(outletId);
    return inventoryRepository.findStockBalance(outletId, itemId)
        .orElseThrow(() -> ServiceException.notFound(
            "Stock balance not found for outlet " + outletId + " item " + itemId));
  }

  public PagedResult<InventoryDtos.StockBalanceView> listStockBalances(
      long outletId,
      boolean lowOnly,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireInventoryRead(outletId);
    return inventoryRepository.listStockBalances(
        outletId,
        lowOnly,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<InventoryDtos.InventoryTransactionView> listTransactions(
      long outletId,
      Long itemId,
      LocalDate dateFrom,
      LocalDate dateTo,
      String txnType,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireInventoryRead(outletId);
    return inventoryRepository.listTransactions(
        outletId,
        itemId,
        dateFrom,
        dateTo,
        txnType,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public InventoryDtos.WasteView createWaste(InventoryDtos.CreateWasteRequest request) {
    requireInventoryWrite(request.outletId());
    return inventoryRepository.createWaste(
        request.outletId(),
        request.itemId(),
        request.quantity(),
        request.businessDate(),
        request.unitCost(),
        request.reason(),
        request.note(),
        RequestUserContextHolder.get().userId()
    );
  }

  public InventoryDtos.StockCountSessionView createStockCountSession(
      InventoryDtos.CreateStockCountSessionRequest request
  ) {
    requireInventoryWrite(request.outletId());
    return inventoryRepository.createStockCountSession(
        idGenerator.generateId(),
        request,
        RequestUserContextHolder.get().userId()
    );
  }

  public PagedResult<InventoryDtos.StockCountSessionListItemView> listStockCountSessions(
      Long outletId,
      String status,
      LocalDate dateFrom,
      LocalDate dateTo,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return inventoryRepository.listStockCountSessions(
        resolveReadableOutletIds(outletId),
        status,
        dateFrom,
        dateTo,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public InventoryDtos.StockCountSessionView getStockCountSession(long sessionId) {
    InventoryDtos.StockCountSessionView session = inventoryRepository.findStockCountSession(sessionId)
        .orElseThrow(() -> ServiceException.notFound("Stock count session not found: " + sessionId));
    requireInventoryRead(session.outletId());
    return session;
  }

  public InventoryDtos.StockCountSessionView postStockCountSession(long sessionId) {
    InventoryDtos.StockCountSessionView existing = inventoryRepository.findStockCountSession(sessionId)
        .orElseThrow(() -> ServiceException.notFound("Stock count session not found: " + sessionId));
    requireInventoryWrite(existing.outletId());
    InventoryDtos.StockCountSessionView posted = inventoryRepository.postStockCountSession(
        sessionId,
        RequestUserContextHolder.get().userId()
    );
    for (InventoryDtos.StockCountLineView line : posted.lines()) {
      publishLowStockIfNeeded(posted.outletId(), line.itemId(), "stock-count:" + sessionId);
    }
    return posted;
  }

  @Transactional
  public int applySaleCompleted(SaleCompletedEvent event) {
    List<InventoryRepository.SaleComponentMovement> movements = new ArrayList<>();
    for (SaleCompletedLineItem saleItem : event.lineItems()) {
      inventoryRepository.findLatestActiveRecipe(saleItem.productId()).ifPresent(recipe -> {
        for (InventoryRepository.RecipeComponent component : recipe.components()) {
          BigDecimal deduction = saleItem.quantity()
              .multiply(component.qty())
              .divide(recipe.yieldQty(), 4, RoundingMode.HALF_UP)
              .negate();
          movements.add(new InventoryRepository.SaleComponentMovement(
              saleItem.productId(),
              component.itemId(),
              deduction
          ));
        }
      });
    }
    int inserted = inventoryRepository.applySaleCompleted(
        event.saleId(),
        event.outletId(),
        event.businessDate(),
        event.completedAt() == null ? clock.instant() : event.completedAt(),
        movements
    );
    for (InventoryRepository.SaleComponentMovement movement : movements) {
      publishLowStockIfNeeded(event.outletId(), movement.itemId(), "sale:" + event.saleId());
    }
    return inserted;
  }

  @Transactional
  public int applyGoodsReceiptPosted(GoodsReceiptPostedEvent event) {
    long outletId = inventoryRepository.findGoodsReceiptOutletId(event.goodsReceiptId())
        .orElse(event.outletId());
    return inventoryRepository.applyGoodsReceiptPosted(
        event.goodsReceiptId(),
        outletId,
        event.businessDate(),
        event.postedAt() == null ? clock.instant() : event.postedAt(),
        inventoryRepository.findGoodsReceiptMovements(event.goodsReceiptId())
    );
  }

  private void publishLowStockIfNeeded(long outletId, long itemId, String aggregateId) {
    inventoryRepository.findLowStockState(outletId, itemId)
        .filter(InventoryRepository.LowStockState::isLow)
        .ifPresent(state -> eventPublisher.publish(
            "fern.inventory.stock-low-threshold",
            aggregateId + ":" + itemId,
            "inventory.stock.low-threshold",
            new StockLowThresholdEvent(
                state.outletId(),
                state.itemId(),
                state.qtyOnHand(),
                state.reorderThreshold(),
                clock.instant()
            )
        ));
  }

  private void requireInventoryWrite(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canWriteInventory(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Inventory write access is required for outlet " + outletId);
  }

  private void requireInventoryRead(long outletId) {
    resolveReadableOutletIds(outletId);
  }

  private Set<Long> resolveReadableOutletIds(Long requestedOutletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    Set<Long> readable = authorizationPolicyService.resolveInventoryReadableOutletIds(context);
    if (readable == null) {
      return requestedOutletId == null ? null : Set.of(requestedOutletId);
    }
    if (readable.isEmpty()) {
      throw ServiceException.forbidden("Inventory read access requires outlet scope");
    }
    if (requestedOutletId != null) {
      if (!readable.contains(requestedOutletId)) {
        throw ServiceException.forbidden("Inventory read access denied for outlet " + requestedOutletId);
      }
      return Set.of(requestedOutletId);
    }
    return readable;
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 200);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
