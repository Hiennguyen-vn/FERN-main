package com.fern.services.inventory.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.events.TypedKafkaEventPublisher;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.events.inventory.OfflineInventoryMovementRecordedEvent;
import com.fern.events.inventory.StockInSimpleRecordedEvent;
import com.fern.events.inventory.StockLowThresholdEvent;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCancelledEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.inventory.api.InventoryDtos;
import com.fern.services.inventory.infrastructure.InventoryRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InventoryServiceTest {

  private static final long OUTLET_ID = 7L;
  private static final long ITEM_ID = 88L;
  private static final long USER_ID = 42L;

  @Mock
  private InventoryRepository inventoryRepository;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;
  @Mock
  private TypedKafkaEventPublisher eventPublisher;
  @Mock
  private SnowflakeIdGenerator idGenerator;

  private final Clock clock = Clock.fixed(Instant.parse("2026-04-27T10:00:00Z"), ZoneOffset.UTC);
  private InventoryService service;

  @BeforeEach
  void setUp() {
    service = new InventoryService(inventoryRepository, authorizationPolicyService, eventPublisher, idGenerator, clock);
    RequestUserContextHolder.set(new RequestUserContext(
        USER_ID, "alice", "sess", Set.of("admin"), Set.of(), Set.of(OUTLET_ID), true, false, null, null, null));
  }

  @AfterEach
  void tearDown() {
    RequestUserContextHolder.clear();
  }

  private InventoryDtos.StockBalanceView sampleBalance() {
    return new InventoryDtos.StockBalanceView(
        OUTLET_ID, ITEM_ID, "SKU-1", "Item One", "CAT", "EA",
        new BigDecimal("12.5000"), new BigDecimal("3.50"),
        LocalDate.parse("2026-04-20"), clock.instant());
  }

  @Test
  void getStockBalanceReturnsRepositoryResultWhenAuthorized() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(OUTLET_ID));
    InventoryDtos.StockBalanceView expected = sampleBalance();
    when(inventoryRepository.findStockBalance(OUTLET_ID, ITEM_ID)).thenReturn(Optional.of(expected));

    InventoryDtos.StockBalanceView actual = service.getStockBalance(OUTLET_ID, ITEM_ID);

    assertSame(expected, actual);
    verify(inventoryRepository).findStockBalance(OUTLET_ID, ITEM_ID);
  }

  @Test
  void getStockBalanceThrowsNotFoundWhenMissing() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(OUTLET_ID));
    when(inventoryRepository.findStockBalance(OUTLET_ID, ITEM_ID)).thenReturn(Optional.empty());

    ServiceException ex = assertThrows(ServiceException.class,
        () -> service.getStockBalance(OUTLET_ID, ITEM_ID));
    assertTrue(ex.getMessage().contains("Stock balance not found"));
  }

  @Test
  void getStockBalanceForbiddenWhenOutletOutOfScope() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(99L));

    assertThrows(ServiceException.class, () -> service.getStockBalance(OUTLET_ID, ITEM_ID));
    verify(inventoryRepository, never()).findStockBalance(anyLong(), anyLong());
  }

  @Test
  void getStockBalanceForbiddenWhenReadableEmpty() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of());

    assertThrows(ServiceException.class, () -> service.getStockBalance(OUTLET_ID, ITEM_ID));
  }

  @Test
  void listStockBalancesPassesParametersThroughAfterAuth() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(OUTLET_ID));
    PagedResult<InventoryDtos.StockBalanceView> page =
        PagedResult.of(List.of(sampleBalance()), 50, 0, 1L);
    when(inventoryRepository.listStockBalances(eq(OUTLET_ID), eq(true), any(), any(), any(), anyInt(), anyInt()))
        .thenReturn(page);

    PagedResult<InventoryDtos.StockBalanceView> result =
        service.listStockBalances(OUTLET_ID, true, "  abc ", "qty", "asc", 200, 0);

    assertEquals(1, result.items().size());
    verify(inventoryRepository).listStockBalances(eq(OUTLET_ID), eq(true), any(), eq("qty"), eq("asc"), anyInt(), anyInt());
  }

  @Test
  void createWasteForbiddenWhenWriteDenied() {
    when(authorizationPolicyService.canWriteInventory(any(), eq(OUTLET_ID))).thenReturn(false);
    InventoryDtos.CreateWasteRequest request = sampleWasteRequest();

    assertThrows(ServiceException.class, () -> service.createWaste(request));
    verify(inventoryRepository, never()).createWaste(anyLong(), anyLong(), any(), any(), any(), any(), any(), anyLong());
  }

  @Test
  void createWasteDelegatesToRepositoryWhenAuthorized() {
    when(authorizationPolicyService.canWriteInventory(any(), eq(OUTLET_ID))).thenReturn(true);
    InventoryDtos.InventoryTransactionView txn = new InventoryDtos.InventoryTransactionView(
        100L, OUTLET_ID, ITEM_ID, "SKU-1", "Item One",
        new BigDecimal("-1.0000"), LocalDate.parse("2026-04-27"), clock.instant(), "waste",
        new BigDecimal("3.50"), USER_ID, "spoiled", null, clock.instant());
    InventoryDtos.WasteView expected = new InventoryDtos.WasteView(100L, "spoiled", null, txn);
    when(inventoryRepository.createWaste(
        eq(OUTLET_ID), eq(ITEM_ID), any(), any(), any(), any(), any(), eq(USER_ID))).thenReturn(expected);

    InventoryDtos.WasteView result = service.createWaste(sampleWasteRequest());

    assertSame(expected, result);
  }

  @Test
  void listTransactionsPassesSanitizedPagingAndNormalizedQuery() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(OUTLET_ID));
    PagedResult<InventoryDtos.InventoryTransactionView> page =
        PagedResult.of(List.of(sampleTransaction()), 50, 0, 1L);
    when(inventoryRepository.listTransactions(
        eq(OUTLET_ID), eq(ITEM_ID), any(), any(), eq("goods_receipt"), eq("milk"), eq("txnTime"), eq("desc"),
        eq(200), eq(0))).thenReturn(page);

    PagedResult<InventoryDtos.InventoryTransactionView> result = service.listTransactions(
        OUTLET_ID,
        ITEM_ID,
        LocalDate.parse("2026-04-01"),
        LocalDate.parse("2026-04-30"),
        "goods_receipt",
        "  milk  ",
        "txnTime",
        "desc",
        500,
        -4);

    assertEquals(1, result.items().size());
  }

  @Test
  void createStockCountSessionGeneratesIdAndUsesCurrentUser() {
    when(authorizationPolicyService.canWriteInventory(any(), eq(OUTLET_ID))).thenReturn(true);
    when(idGenerator.generateId()).thenReturn(9001L);
    InventoryDtos.CreateStockCountSessionRequest request = sampleStockCountRequest();
    InventoryDtos.StockCountSessionView expected = sampleStockCountSession("draft");
    when(inventoryRepository.createStockCountSession(9001L, request, USER_ID)).thenReturn(expected);

    InventoryDtos.StockCountSessionView result = service.createStockCountSession(request);

    assertSame(expected, result);
    verify(inventoryRepository).createStockCountSession(9001L, request, USER_ID);
  }

  @Test
  void listStockCountSessionsUsesReadableOutletScopeWhenNoOutletRequested() {
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(OUTLET_ID, 8L));
    PagedResult<InventoryDtos.StockCountSessionListItemView> page = PagedResult.of(
        List.of(new InventoryDtos.StockCountSessionListItemView(
            9001L,
            OUTLET_ID,
            LocalDate.parse("2026-04-27"),
            "draft",
            "Cycle",
            USER_ID,
            null,
            clock.instant(),
            clock.instant(),
            1,
            1,
            0,
            BigDecimal.ZERO)),
        25,
        0,
        1L);
    when(inventoryRepository.listStockCountSessions(
        eq(Set.of(OUTLET_ID, 8L)), eq("draft"), any(), any(), eq("cycle"), eq("countDate"), eq("asc"),
        eq(25), eq(0))).thenReturn(page);

    PagedResult<InventoryDtos.StockCountSessionListItemView> result = service.listStockCountSessions(
        null,
        "draft",
        LocalDate.parse("2026-04-01"),
        LocalDate.parse("2026-04-30"),
        " cycle ",
        "countDate",
        "asc",
        25,
        0);

    assertEquals(1, result.total());
  }

  @Test
  void getStockCountSessionAuthorizesLoadedOutlet() {
    InventoryDtos.StockCountSessionView expected = sampleStockCountSession("draft");
    when(inventoryRepository.findStockCountSession(9001L)).thenReturn(Optional.of(expected));
    when(authorizationPolicyService.resolveInventoryReadableOutletIds(any())).thenReturn(Set.of(OUTLET_ID));

    InventoryDtos.StockCountSessionView result = service.getStockCountSession(9001L);

    assertSame(expected, result);
  }

  @Test
  void postStockCountSessionPublishesLowStockForLowLines() {
    InventoryDtos.StockCountSessionView draft = sampleStockCountSession("draft");
    InventoryDtos.StockCountSessionView posted = sampleStockCountSession("posted");
    when(inventoryRepository.findStockCountSession(9001L)).thenReturn(Optional.of(draft));
    when(authorizationPolicyService.canWriteInventory(any(), eq(OUTLET_ID))).thenReturn(true);
    when(inventoryRepository.postStockCountSession(9001L, USER_ID)).thenReturn(posted);
    when(inventoryRepository.findLowStockState(OUTLET_ID, ITEM_ID)).thenReturn(Optional.of(
        new InventoryRepository.LowStockState(OUTLET_ID, ITEM_ID, new BigDecimal("2.0000"), new BigDecimal("5.0000"))));

    InventoryDtos.StockCountSessionView result = service.postStockCountSession(9001L);

    assertSame(posted, result);
    verify(eventPublisher).publish(
        eq("fern.inventory.stock-low-threshold"),
        eq("stock-count:9001:88"),
        eq("inventory.stock.low-threshold"),
        any(StockLowThresholdEvent.class));
  }

  @Test
  void applySaleApprovedBuildsRecipeMovementsAndPublishesLowStock() {
    SaleApprovedEvent event = new SaleApprovedEvent(
        44L,
        OUTLET_ID,
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T09:55:00Z"),
        USER_ID,
        false,
        true,
        List.of(new SaleCompletedLineItem(
            501L,
            new BigDecimal("2.0000"),
            new BigDecimal("10.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("20.00"))),
        null);
    when(inventoryRepository.findLatestActiveRecipe(501L)).thenReturn(Optional.of(
        new InventoryRepository.RecipeView(
            501L,
            "v1",
            BigDecimal.ONE,
            List.of(new InventoryRepository.RecipeComponent(ITEM_ID, new BigDecimal("0.2500"))))));
    when(inventoryRepository.applySaleApproved(
        eq(44L), eq(OUTLET_ID), eq(LocalDate.parse("2026-04-27")),
        eq(Instant.parse("2026-04-27T09:55:00Z")), eq(clock.instant()), eq(USER_ID), eq(true), any()))
        .thenReturn(1);
    when(inventoryRepository.findLowStockState(OUTLET_ID, ITEM_ID)).thenReturn(Optional.of(
        new InventoryRepository.LowStockState(OUTLET_ID, ITEM_ID, new BigDecimal("1.0000"), new BigDecimal("3.0000"))));

    int inserted = service.applySaleApproved(event);

    assertEquals(1, inserted);
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<InventoryRepository.SaleComponentMovement>> movements =
        ArgumentCaptor.forClass(List.class);
    verify(inventoryRepository).applySaleApproved(
        eq(44L), eq(OUTLET_ID), eq(LocalDate.parse("2026-04-27")),
        eq(Instant.parse("2026-04-27T09:55:00Z")), eq(clock.instant()), eq(USER_ID), eq(true), movements.capture());
    assertEquals(List.of(new InventoryRepository.SaleComponentMovement(501L, ITEM_ID, new BigDecimal("-0.5000"))),
        movements.getValue());
    verify(eventPublisher).publish(
        eq("fern.inventory.stock-low-threshold"),
        eq("sale:44:88"),
        eq("inventory.stock.low-threshold"),
        any(StockLowThresholdEvent.class));
  }

  @Test
  void applySaleCancelledUsesClockWhenCancelledAtMissing() {
    SaleCancelledEvent event = new SaleCancelledEvent(
        44L,
        OUTLET_ID,
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T09:55:00Z"),
        USER_ID,
        "Customer changed mind",
        null);
    when(inventoryRepository.reverseSaleUsage(
        44L,
        OUTLET_ID,
        LocalDate.parse("2026-04-27"),
        clock.instant(),
        USER_ID,
        "Sale 44 cancelled")).thenReturn(2);

    assertEquals(2, service.applySaleCancelled(event));
  }

  @Test
  void applyGoodsReceiptPostedUsesRepositoryOutletOverrideAndMovements() {
    GoodsReceiptPostedEvent event = new GoodsReceiptPostedEvent(
        6101L,
        70L,
        80L,
        99L,
        LocalDate.parse("2026-04-27"),
        "USD",
        List.of(),
        BigDecimal.TEN,
        null);
    List<InventoryRepository.GoodsReceiptMovement> movements = List.of(
        new InventoryRepository.GoodsReceiptMovement(7001L, ITEM_ID, new BigDecimal("4.0000"), new BigDecimal("2.50")));
    when(inventoryRepository.findGoodsReceiptOutletId(6101L)).thenReturn(Optional.of(OUTLET_ID));
    when(inventoryRepository.findGoodsReceiptMovements(6101L)).thenReturn(movements);
    when(inventoryRepository.applyGoodsReceiptPosted(
        6101L,
        OUTLET_ID,
        LocalDate.parse("2026-04-27"),
        clock.instant(),
        movements)).thenReturn(1);

    assertEquals(1, service.applyGoodsReceiptPosted(event));
  }

  @Test
  void applyOfflineStockInUsesClock() {
    StockInSimpleRecordedEvent event = new StockInSimpleRecordedEvent(
        "stock-in-1",
        "idem-stock-in-1",
        "STOCK_IN_SIMPLE",
        OUTLET_ID,
        101L,
        501L,
        "REGISTER-A",
        USER_ID,
        "alice",
        ITEM_ID,
        "SKU-1",
        new BigDecimal("3.0000"),
        "EA",
        "EMERGENCY_RECEIPT",
        "Received locally",
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T09:59:00Z"),
        "POS_OFFLINE",
        true);
    InventoryRepository.OfflineStockInResult expected =
        new InventoryRepository.OfflineStockInResult("APPLIED", 7001L, null, false);
    when(inventoryRepository.applyOfflineStockIn(event, clock.instant())).thenReturn(expected);

    assertSame(expected, service.applyOfflineStockIn(event));
  }

  @Test
  void applyOfflineWasteUsesClock() {
    OfflineInventoryMovementRecordedEvent event = new OfflineInventoryMovementRecordedEvent(
        "waste-1",
        "idem-waste-1",
        "WASTE",
        OUTLET_ID,
        101L,
        501L,
        "REGISTER-A",
        USER_ID,
        "alice",
        ITEM_ID,
        "SKU-1",
        new BigDecimal("1.0000"),
        "EA",
        new BigDecimal("2.50"),
        "SPILL",
        "Dropped",
        LocalDate.parse("2026-04-27"),
        Instant.parse("2026-04-27T09:59:00Z"),
        "POS_OFFLINE",
        true);
    InventoryRepository.OfflineInventoryMovementResult expected =
        new InventoryRepository.OfflineInventoryMovementResult("APPLIED", 7101L, null, false);
    when(inventoryRepository.applyOfflineWaste(event, clock.instant())).thenReturn(expected);

    assertSame(expected, service.applyOfflineWaste(event));
  }

  private InventoryDtos.CreateWasteRequest sampleWasteRequest() {
    return new InventoryDtos.CreateWasteRequest(
        OUTLET_ID, ITEM_ID, new BigDecimal("1.0000"),
        LocalDate.parse("2026-04-27"), new BigDecimal("3.50"), "spoiled", null);
  }

  private InventoryDtos.InventoryTransactionView sampleTransaction() {
    return new InventoryDtos.InventoryTransactionView(
        100L,
        OUTLET_ID,
        ITEM_ID,
        "SKU-1",
        "Item One",
        new BigDecimal("1.0000"),
        LocalDate.parse("2026-04-27"),
        clock.instant(),
        "purchase_in",
        new BigDecimal("3.50"),
        USER_ID,
        null,
        "received",
        clock.instant());
  }

  private InventoryDtos.CreateStockCountSessionRequest sampleStockCountRequest() {
    return new InventoryDtos.CreateStockCountSessionRequest(
        OUTLET_ID,
        LocalDate.parse("2026-04-27"),
        "Cycle",
        List.of(new InventoryDtos.StockCountLineRequest(ITEM_ID, new BigDecimal("2.0000"), "Counted")));
  }

  private InventoryDtos.StockCountSessionView sampleStockCountSession(String status) {
    return new InventoryDtos.StockCountSessionView(
        9001L,
        OUTLET_ID,
        LocalDate.parse("2026-04-27"),
        status,
        "Cycle",
        USER_ID,
        "posted".equals(status) ? USER_ID : null,
        clock.instant(),
        clock.instant(),
        List.of(new InventoryDtos.StockCountLineView(
            1L,
            ITEM_ID,
            new BigDecimal("5.0000"),
            new BigDecimal("2.0000"),
            new BigDecimal("-3.0000"),
            "Counted",
            clock.instant(),
            clock.instant())));
  }
}
