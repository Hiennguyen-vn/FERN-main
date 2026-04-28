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

  private InventoryDtos.CreateWasteRequest sampleWasteRequest() {
    return new InventoryDtos.CreateWasteRequest(
        OUTLET_ID, ITEM_ID, new BigDecimal("1.0000"),
        LocalDate.parse("2026-04-27"), new BigDecimal("3.50"), "spoiled", null);
  }
}
