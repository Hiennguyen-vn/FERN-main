package com.fern.services.inventory.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.events.inventory.OfflineInventoryMovementRecordedEvent;
import com.fern.events.inventory.StockInSimpleRecordedEvent;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCancelledEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.inventory.api.InventoryDtos;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryService {

  private static final Logger log = LoggerFactory.getLogger(InventoryService.class);

  private final InventoryRepository inventoryRepository;
  private final com.fern.services.inventory.infrastructure.InventoryLotRepository lotRepository;
  private final com.fern.services.inventory.infrastructure.StockBalanceRepository stockBalanceRepository;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final SnowflakeIdGenerator idGenerator;
  private final Clock clock;
  private final StockReservationService reservationService;

  public InventoryService(
      InventoryRepository inventoryRepository,
      com.fern.services.inventory.infrastructure.InventoryLotRepository lotRepository,
      com.fern.services.inventory.infrastructure.StockBalanceRepository stockBalanceRepository,
      AuthorizationPolicyService authorizationPolicyService,
      SnowflakeIdGenerator idGenerator,
      Clock clock,
      StockReservationService reservationService
  ) {
    this.inventoryRepository = inventoryRepository;
    this.lotRepository = lotRepository;
    this.stockBalanceRepository = stockBalanceRepository;
    this.authorizationPolicyService = authorizationPolicyService;
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.reservationService = reservationService;
  }

  public InventoryDtos.StockBalanceView getStockBalance(long outletId, long itemId) {
    requireInventoryRead(outletId);
    return stockBalanceRepository.findStockBalance(outletId, itemId)
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
    return stockBalanceRepository.listStockBalances(
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
    return posted;
  }

  @Transactional
  public int applySaleApproved(SaleApprovedEvent event) {
    java.util.Map<Long, java.util.List<Long>> modByProduct =
        inventoryRepository.findSaleModifierOptions(event.saleId());
    java.util.Set<Long> allModOptionIds = new java.util.HashSet<>();
    modByProduct.values().forEach(allModOptionIds::addAll);
    java.util.Map<Long, java.util.List<InventoryRepository.ModifierRecipeEffect>> effectsByOption =
        inventoryRepository.findModifierRecipeEffects(allModOptionIds);

    List<InventoryRepository.SaleComponentMovement> movements = new ArrayList<>();
    for (SaleCompletedLineItem saleItem : event.lineItems()) {
      inventoryRepository.findLatestActiveRecipe(saleItem.productId()).ifPresent(recipe -> {
        // Build base per-line consumption keyed by ingredient itemId.
        java.util.LinkedHashMap<Long, BigDecimal> perItem = new java.util.LinkedHashMap<>();
        for (InventoryRepository.RecipeComponent component : recipe.components()) {
          BigDecimal qty = saleItem.quantity()
              .multiply(component.qty())
              .divide(recipe.yieldQty(), 4, RoundingMode.HALF_UP);
          perItem.merge(component.itemId(), qty, BigDecimal::add);
        }
        // Apply modifier effects in deterministic order: MULTIPLY → SCALE_ITEM → SUBSTITUTE → ADD.
        java.util.List<Long> modIds = modByProduct.getOrDefault(saleItem.productId(), java.util.List.of());
        java.util.List<InventoryRepository.ModifierRecipeEffect> effects = new java.util.ArrayList<>();
        for (Long modId : modIds) effects.addAll(effectsByOption.getOrDefault(modId, java.util.List.of()));
        java.util.Comparator<InventoryRepository.ModifierRecipeEffect> order =
            java.util.Comparator.comparingInt(e -> switch (e.effectType()) {
              case "MULTIPLY" -> 0;
              case "SCALE_ITEM" -> 1;
              case "SUBSTITUTE" -> 2;
              case "ADD" -> 3;
              default -> 99;
            });
        effects.sort(order);
        for (InventoryRepository.ModifierRecipeEffect eff : effects) {
          switch (eff.effectType()) {
            case "MULTIPLY" -> {
              for (var entry : perItem.entrySet()) {
                entry.setValue(entry.getValue().multiply(eff.multiplier())
                    .setScale(4, RoundingMode.HALF_UP));
              }
            }
            case "SCALE_ITEM" -> {
              if (perItem.containsKey(eff.ingredientId())) {
                perItem.compute(eff.ingredientId(),
                    (k, v) -> v.multiply(eff.multiplier()).setScale(4, RoundingMode.HALF_UP));
              }
            }
            case "SUBSTITUTE" -> {
              BigDecimal qty = perItem.remove(eff.ingredientId());
              if (qty != null) {
                perItem.merge(eff.substituteIngredientId(), qty, BigDecimal::add);
              }
            }
            case "ADD" -> {
              BigDecimal add = saleItem.quantity().multiply(eff.qtyDelta())
                  .setScale(4, RoundingMode.HALF_UP);
              perItem.merge(eff.ingredientId(), add, BigDecimal::add);
            }
            default -> { /* ignore unknown */ }
          }
        }
        for (var entry : perItem.entrySet()) {
          if (entry.getValue().signum() == 0) continue;
          movements.add(new InventoryRepository.SaleComponentMovement(
              saleItem.productId(),
              entry.getKey(),
              entry.getValue().negate()
          ));
        }
      });
    }
    int inserted = inventoryRepository.applySaleApproved(
        event.saleId(),
        event.outletId(),
        event.businessDate(),
        event.saleCreatedAt(),
        event.approvedAt() == null ? clock.instant() : event.approvedAt(),
        event.approvedByUserId(),
        event.allowOversell() || event.oversell(),
        movements
    );
    // T1: Confirm reservation (terminal state) now that hard deduction is committed.
    // Idempotent — settled rows skipped via WHERE settled_at IS NULL clause.
    try {
      reservationService.confirmForSale(event.saleId());
    } catch (RuntimeException e) {
      log.error("confirm reservation failed for sale {}: {}", event.saleId(), e.getMessage(), e);
    }
    return inserted;
  }

  @Transactional
  public int applySaleCancelled(SaleCancelledEvent event) {
    int inserted = inventoryRepository.reverseSaleUsage(
        event.saleId(),
        event.outletId(),
        event.businessDate(),
        event.cancelledAt() == null ? clock.instant() : event.cancelledAt(),
        event.cancelledByUserId(),
        "Sale " + event.saleId() + " cancelled"
    );
    // T1: Release reservation row (no movement applied beyond reverse usage above).
    try {
      reservationService.releaseForSale(event.saleId());
    } catch (RuntimeException e) {
      log.error("release reservation failed for sale {}: {}", event.saleId(), e.getMessage(), e);
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

  @Transactional
  public InventoryRepository.OfflineStockInResult applyOfflineStockIn(StockInSimpleRecordedEvent event) {
    return inventoryRepository.applyOfflineStockIn(event, clock.instant());
  }

  @Transactional
  public InventoryRepository.OfflineInventoryMovementResult applyOfflineWaste(OfflineInventoryMovementRecordedEvent event) {
    return inventoryRepository.applyOfflineWaste(event, clock.instant());
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

  public java.util.List<InventoryDtos.StockLotView> listStockLots(Long itemId, Long locationId, String status, Integer limit, Integer offset) {
    return lotRepository.listStockLots(itemId, locationId, status, sanitizeLimit(limit), sanitizeOffset(offset));
  }

  public InventoryDtos.StockLotView createStockLot(InventoryDtos.CreateStockLotRequest req) {
    return lotRepository.createStockLot(req);
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 200);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
