package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.idempotency.IdempotencyGuard;
import com.fern.common.idempotency.model.IdempotencyResult;
import com.fern.common.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SalesServiceTest {

  @Mock
  private SalesRepository salesRepository;
  @Mock
  private com.fern.services.sales.infrastructure.SalesPromotionRepository promotionRepository;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;
  @Mock
  private IdempotencyGuard idempotencyGuard;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  private static RequestUserContext deviceContext(long deviceId, long outletId) {
    return new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), true, false, null, deviceId, outletId);
  }

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void openPosSessionRejectsContextWithoutSalesWritePermission() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(false);
    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    assertThrows(ServiceException.class, () -> service.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "POS-001",
        7L,
        "USD",
        15L,
        null, null, null,
        LocalDate.parse("2026-03-27"),
        null
    )));
  }

  @Test
  void submitSaleCreatesOrderWithoutPublishingLifecycleEvents() {
    RequestUserContextHolder.set(deviceContext(55L, 7L));
    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L,
        300L,
        "USD",
        "dine_in",
        "table 3",
        List.of(new SalesDtos.SaleLineRequest(
            11L,
            new BigDecimal("2.0000"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(901L),
            null, null, null
        )),
        null
    );
    SalesDtos.SaleView sale = new SalesDtos.SaleView(
        "500",
        7L,
        "300",
        null,
        null,
        null,
        "USD",
        "dine_in",
        "order_created",
        "unpaid",
        new BigDecimal("10.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("10.00"),
        "table 3",
        List.of(new SalesDtos.SaleLineView(
            11L,
            "PROD-11",
            "Test Product",
            new BigDecimal("2.0000"),
            new BigDecimal("5.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("10.00"),
            Set.of(901L),
            null,
            null, null, null
        )),
        null,
        Instant.parse("2026-03-27T00:00:00Z")
    );
    when(salesRepository.submitSale(request)).thenReturn(sale);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.submitSale(request);

    verify(salesRepository).submitSale(request);
    assertEquals("500", result.id());
    assertEquals("order_created", result.status());
    assertEquals("unpaid", result.paymentStatus());
  }

  @Test
  void submitSaleWithIdempotencyKeyDelegatesToGuardAndReturnsReplayedResult() throws Exception {
    RequestUserContextHolder.set(deviceContext(55L, 7L));

    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L, 300L, "USD", "dine_in", "n",
        List.of(new SalesDtos.SaleLineRequest(
            11L, new BigDecimal("1.0000"), BigDecimal.ZERO, BigDecimal.ZERO, null, Set.of(),
            null, null, null
        )),
        null
    );
    SalesDtos.SaleView sale = new SalesDtos.SaleView(
        "777", 7L, "300", null, null, null, "USD", "dine_in", "order_created", "unpaid",
        new BigDecimal("5.00"), BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("5.00"),
        "n",
        List.of(new SalesDtos.SaleLineView(
            11L, "PROD-11", "P", new BigDecimal("1.0000"), new BigDecimal("5.00"),
            BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("5.00"), Set.of(), null,
            null, null, null
        )),
        null, Instant.parse("2026-03-27T00:00:00Z")
    );

    ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    String expectedBody = mapper.writeValueAsString(sale);

    when(idempotencyGuard.execute(
        eq("sales-service:create-order:outlet:7:device:55"),
        eq("550e8400-e29b-41d4-a716-446655440000"),
        any(String.class),
        eq(TtlPolicy.BET),
        any()
    )).thenReturn(new IdempotencyResult(false, 201, expectedBody, "777"));

    SalesService service = new SalesService(
        salesRepository, authorizationPolicyService, clock, idempotencyGuard, mapper
    );
    SalesDtos.SaleView result = service.submitSale("550e8400-e29b-41d4-a716-446655440000", request);

    assertEquals("777", result.id());
    verify(idempotencyGuard).execute(
        eq("sales-service:create-order:outlet:7:device:55"),
        eq("550e8400-e29b-41d4-a716-446655440000"),
        any(String.class),
        eq(TtlPolicy.BET),
        any()
    );
  }

  @Test
  void submitSaleWithInvalidIdempotencyKeyThrowsBadRequest() {
    RequestUserContextHolder.set(deviceContext(55L, 7L));

    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L, 300L, "USD", "dine_in", "n",
        List.of(new SalesDtos.SaleLineRequest(
            11L, new BigDecimal("1.0000"), BigDecimal.ZERO, BigDecimal.ZERO, null, Set.of(),
            null, null, null
        )),
        null
    );

    SalesService service = new SalesService(
        salesRepository, authorizationPolicyService, clock,
        idempotencyGuard, new ObjectMapper()
    );
    assertThrows(ServiceException.class, () -> service.submitSale("not-a-uuid", request));
    verifyNoInteractions(salesRepository);
  }

  @Test
  void submitSaleWithBlankIdempotencyKeyFallsBackToDirectRepositoryCall() {
    RequestUserContextHolder.set(deviceContext(55L, 7L));

    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L, 300L, "USD", "dine_in", "n",
        List.of(new SalesDtos.SaleLineRequest(
            11L, new BigDecimal("1.0000"), BigDecimal.ZERO, BigDecimal.ZERO, null, Set.of(),
            null, null, null
        )),
        null
    );
    SalesDtos.SaleView sale = new SalesDtos.SaleView(
        "900", 7L, "300", null, null, null, "USD", "dine_in", "order_created", "unpaid",
        new BigDecimal("5.00"), BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("5.00"),
        "n", List.of(), null, Instant.parse("2026-03-27T00:00:00Z")
    );
    when(salesRepository.submitSale(request)).thenReturn(sale);

    SalesService service = new SalesService(
        salesRepository, authorizationPolicyService, clock,
        idempotencyGuard, new ObjectMapper()
    );
    SalesDtos.SaleView result = service.submitSale(null, request);
    assertEquals("900", result.id());
    verifyNoInteractions(idempotencyGuard);
  }

  @Test
  void submitSaleRejectsInlinePaymentCapture() {
    RequestUserContextHolder.set(deviceContext(55L, 7L));
    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L,
        300L,
        "USD",
        "dine_in",
        "table 3",
        List.of(new SalesDtos.SaleLineRequest(
            11L,
            new BigDecimal("2.0000"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(901L),
            null, null, null
        )),
        new SalesDtos.PaymentRequest(
            "card",
            new BigDecimal("10.00"),
            "success",
            Instant.parse("2026-03-27T00:00:00Z"),
            "txn-1",
            null
        )
    );
    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.submitSale(request));

    assertEquals(400, exception.getStatusCode());
    verifyNoInteractions(salesRepository);
  }

  @Test
  void submitSaleAllowsUserContextWithSalesWritePermission() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of("sales.order.write"), Set.of(7L),
        true, false, null, null, null));
    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L, 300L, "USD", "dine_in", "n",
        List.of(new SalesDtos.SaleLineRequest(
            11L, new BigDecimal("1.0000"), BigDecimal.ZERO, BigDecimal.ZERO, null, Set.of(),
            null, null, null
        )),
        null
    );
    SalesDtos.SaleView sale = new SalesDtos.SaleView(
        "901", 7L, "300", null, null, null, "USD", "dine_in", "order_created", "unpaid",
        new BigDecimal("5.00"), BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("5.00"),
        "n", List.of(), null, Instant.parse("2026-03-27T00:00:00Z")
    );
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(7L))).thenReturn(true);
    when(salesRepository.submitSale(request)).thenReturn(sale);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.submitSale(request);

    assertEquals("901", result.id());
    verify(salesRepository).submitSale(request);
  }

  @Test
  void submitSaleRejectsUserContextWithoutSalesWritePermission() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(7L),
        true, false, null, null, null));
    SalesDtos.SubmitSaleRequest request = new SalesDtos.SubmitSaleRequest(
        7L, 300L, "USD", "dine_in", "n",
        List.of(new SalesDtos.SaleLineRequest(
            11L, new BigDecimal("1.0000"), BigDecimal.ZERO, BigDecimal.ZERO, null, Set.of(),
            null, null, null
        )),
        null
    );
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(7L))).thenReturn(false);
    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.submitSale(request));

    assertEquals(403, exception.getStatusCode());
    verifyNoInteractions(salesRepository);
  }

  @Test
  void createPromotionDelegatesForAuthorizedContext() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.manager",
        "sess-15",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(7L, 8L),
        true,
        false,
        null
    , null, null));
    SalesDtos.CreatePromotionRequest request = new SalesDtos.CreatePromotionRequest(
        "Happy Hour",
        "percentage",
        null,
        new BigDecimal("10.00"),
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-28T00:00:00Z"),
        Set.of(7L)
    );
    SalesDtos.PromotionView promotion = new SalesDtos.PromotionView(
        "700",
        "Happy Hour",
        "percentage",
        "active",
        null,
        new BigDecimal("10.00"),
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-28T00:00:00Z"),
        Set.of(7L)
    );
    when(promotionRepository.createPromotion(request)).thenReturn(promotion);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(7L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock, promotionRepository);
    SalesDtos.PromotionView result = service.createPromotion(request);

    verify(promotionRepository).createPromotion(request);
    assertEquals("700", result.id());
  }

  @Test
  void createPromotionRejectsScopedUserOutsideRequestedOutlets() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.manager",
        "sess-15",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(7L),
        true,
        false,
        null
    , null, null));
    SalesDtos.CreatePromotionRequest request = new SalesDtos.CreatePromotionRequest(
        "Happy Hour",
        "percentage",
        null,
        new BigDecimal("10.00"),
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-28T00:00:00Z"),
        Set.of(11L)
    );

    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(11L))).thenReturn(false);
    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createPromotion(request));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void getSaleRejectsScopedUserOutsideOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(7L), true, false, null
    , null, null));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(7L));
    when(salesRepository.findSale(500L)).thenReturn(java.util.Optional.of(new SalesDtos.SaleView(
        "500",
        11L,
        "300",
        null,
        null,
        null,
        "USD",
        "dine_in",
        "completed",
        "paid",
        new BigDecimal("10.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("10.00"),
        null,
        List.of(),
        null,
        Instant.parse("2026-03-27T00:00:00Z")
    )));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.getSale(500L));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listSalesRestrictsScopedUserToRequestedOutletAndLimit() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.manager",
        "sess-15",
        Set.of("outlet_manager"),
        Set.of(),
        Set.of(2000L, 2002L),
        true,
        false,
        null
    , null, null));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L, 2002L));
    when(salesRepository.listSales(
        Set.of(2002L),
        LocalDate.parse("2024-07-01"),
        LocalDate.parse("2024-07-31"),
        "completed",
        "paid",
        null,
        9201L,
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    service.listSales(
        2002L,
        LocalDate.parse("2024-07-01"),
        LocalDate.parse("2024-07-31"),
        "completed",
        "paid",
        null,
        9201L,
        null,
        null,
        null,
        500,
        null
    );

    verify(salesRepository).listSales(
        Set.of(2002L),
        LocalDate.parse("2024-07-01"),
        LocalDate.parse("2024-07-31"),
        "completed",
        "paid",
        null,
        9201L,
        null,
        null,
        null,
        100,
        0
    );
  }

  @Test
  void listOrderingTablesAllowsScopedSalesWriterForAllowedOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));
    List<SalesDtos.OrderingTableLinkView> tables = List.of(
        new SalesDtos.OrderingTableLinkView(
            "tbl_hcm1_u7k29q",
            "T1",
            "Table 1",
            "active",
            2000L,
            "VN-HCM-001",
            "Saigon Central Outlet"
        )
    );
    when(salesRepository.listOrderingTables(Set.of(2000L), null)).thenReturn(tables);
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    List<SalesDtos.OrderingTableLinkView> result = service.listOrderingTables(2000L, null);

    verify(salesRepository).listOrderingTables(Set.of(2000L), null);
    assertEquals(1, result.size());
    assertEquals("tbl_hcm1_u7k29q", result.getFirst().tableToken());
  }

  @Test
  void listOrderingTablesRejectsScopedUserWithoutSalesWrite() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.reader",
        "sess-15",
        Set.of("cashier"),
        Set.of(),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));

    when(authorizationPolicyService.canWriteSales(any())).thenReturn(false);
    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception =
        assertThrows(ServiceException.class, () -> service.listOrderingTables(2000L, null));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listOrderingTablesRejectsScopedWriterOutsideRequestedOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));

    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2002L))).thenReturn(false);
    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception =
        assertThrows(ServiceException.class, () -> service.listOrderingTables(2002L, null));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listOrderingTablesAllowsAdminAcrossOutlets() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    , null, null));
    when(salesRepository.listOrderingTables(null, "active")).thenReturn(List.of());
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(null);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    service.listOrderingTables(null, "active");

    verify(salesRepository).listOrderingTables(null, "active");
  }

  @Test
  void approveSaleAllowsScopedWriterForOpenPublicOrder() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));
    SalesDtos.SaleView openOrder = publicOrder("9800", 2000L, "order_created");
    SalesDtos.SaleView approvedOrder = publicOrder("9800", 2000L, "order_approved");
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(openOrder));
    when(salesRepository.approveSale(9800L, 15L)).thenReturn(approvedOrder);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.approveSale(9800L);

    verify(salesRepository).approveSale(9800L, 15L);
    assertEquals("order_approved", result.status());
  }

  @Test
  void approveSaleAllowsDeviceContextForSameOutlet() {
    RequestUserContextHolder.set(deviceContext(55L, 2000L));
    SalesDtos.SaleView openOrder = publicOrder("9800", 2000L, "order_created");
    SalesDtos.SaleView approvedOrder = publicOrder("9800", 2000L, "order_approved");
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(openOrder));
    when(salesRepository.approveSale(9800L, null)).thenReturn(approvedOrder);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.approveSale(9800L);

    verify(salesRepository).approveSale(9800L, null);
    verify(authorizationPolicyService, org.mockito.Mockito.never()).canWriteSalesForOutlet(any(), eq(2000L));
    assertEquals("order_approved", result.status());
  }

  @Test
  void approveSaleRejectsDeviceContextOutsideOutlet() {
    RequestUserContextHolder.set(deviceContext(55L, 2002L));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "order_created")));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.approveSale(9800L));
    assertEquals(403, exception.getStatusCode());
    verify(authorizationPolicyService, org.mockito.Mockito.never()).canWriteSalesForOutlet(any(), eq(2000L));
  }

  @Test
  void approveSaleRejectsScopedWriterOutsideOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2002L),
        true,
        false,
        null
    , null, null));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "order_created")));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(false);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.approveSale(9800L));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void approveSalePropagatesConflictWhenOutletHasNoOpenSession() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "order_created")));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);
    when(salesRepository.approveSale(9800L, 15L))
        .thenThrow(ServiceException.conflict("No open POS session for outlet 2000 — open a session before approving customer orders"));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.approveSale(9800L));
    assertEquals(409, exception.getStatusCode());
    assertEquals(
        "No open POS session for outlet 2000 — open a session before approving customer orders",
        exception.getMessage()
    );
  }

  @Test
  void confirmSaleAllowsScopedWriterForOpenPublicOrder() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));
    SalesDtos.SaleView openOrder = publicOrder("9800", 2000L, "order_created");
    SalesDtos.SaleView confirmedOrder = publicOrder("9800", 2000L, "order_approved");
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(openOrder));
    when(salesRepository.approveSale(9800L, 15L)).thenReturn(confirmedOrder);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.confirmSale(9800L);

    verify(salesRepository).approveSale(9800L, 15L);
    assertEquals("order_approved", result.status());
  }

  @Test
  void confirmSaleRejectsScopedWriterOutsideOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2002L),
        true,
        false,
        null
    , null, null));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "order_created")));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(false);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.confirmSale(9800L));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void confirmSaleRejectsNonPublicOrders() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);
    when(salesRepository.findSale(9801L)).thenReturn(Optional.of(new SalesDtos.SaleView(
        "9801",
        2000L,
        null,
        null,
        null,
        null,
        "VND",
        "dine_in",
        "order_created",
        "unpaid",
        new BigDecimal("35000.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("35000.00"),
        "Walk-in order",
        List.of(),
        null,
        Instant.parse("2026-03-31T08:35:00Z")
    )));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.confirmSale(9801L));
    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void confirmSaleRejectsNonOpenOrders() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    , null, null));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "payment_done")));
    when(salesRepository.approveSale(9800L, 7L))
        .thenThrow(ServiceException.conflict("Only newly created orders can be approved"));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.confirmSale(9800L));
    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void confirmSaleRejectsMissingOrders() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    , null, null));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.empty());

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.confirmSale(9800L));
    assertEquals(404, exception.getStatusCode());
  }

  @Test
  void markPaymentDonePublishesCompletionEventsAfterApprovedOrder() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.cashier",
        "sess-15",
        Set.of("cashier"),
        Set.of("sales.order.write"),
        Set.of(2000L),
        true,
        false,
        null
    , null, null));
    SalesDtos.SaleView approvedOrder = publicOrder("9800", 2000L, "order_approved");
    SalesDtos.MarkPaymentDoneRequest request = new SalesDtos.MarkPaymentDoneRequest(
        "cash",
        new BigDecimal("35000.00"),
        Instant.parse("2026-03-31T08:40:00Z"),
        "txn-9800",
        "Paid in cash"
    );
    SalesDtos.SaleView paidOrder = new SalesDtos.SaleView(
        "9800",
        2000L,
        null,
        "ord_public_9800",
        "T1",
        "Table 1",
        "VND",
        "online",
        "payment_done",
        "paid",
        new BigDecimal("35000.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("35000.00"),
        "QR order T1 (Table 1)",
        approvedOrder.items(),
        new SalesDtos.PaymentView(
            "9800",
            "cash",
            new BigDecimal("35000.00"),
            "success",
            Instant.parse("2026-03-31T08:40:00Z"),
            "txn-9800",
            "Paid in cash"
        ),
        Instant.parse("2026-03-31T08:35:00Z")
    );
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(approvedOrder));
    when(salesRepository.markPaymentDone(9800L, request)).thenReturn(paidOrder);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.markPaymentDone(9800L, request);

    verify(salesRepository).markPaymentDone(9800L, request);
    // Events now appended to outbox inside SalesRepository — verified via OutboxWriter, not direct publish.
    assertEquals("payment_done", result.status());
    assertEquals("paid", result.paymentStatus());
  }

  @Test
  void markPaymentDoneAllowsDeviceContextForSameOutlet() {
    RequestUserContextHolder.set(deviceContext(55L, 2000L));
    SalesDtos.SaleView approvedOrder = publicOrder("9800", 2000L, "order_approved");
    SalesDtos.MarkPaymentDoneRequest request = new SalesDtos.MarkPaymentDoneRequest(
        "cash",
        new BigDecimal("35000.00"),
        Instant.parse("2026-03-31T08:40:00Z"),
        "txn-9800",
        "Paid in cash"
    );
    SalesDtos.SaleView paidOrder = new SalesDtos.SaleView(
        "9800",
        2000L,
        null,
        "ord_public_9800",
        "T1",
        "Table 1",
        "VND",
        "online",
        "payment_done",
        "paid",
        new BigDecimal("35000.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("35000.00"),
        "QR order T1 (Table 1)",
        approvedOrder.items(),
        new SalesDtos.PaymentView(
            "9800",
            "cash",
            new BigDecimal("35000.00"),
            "success",
            Instant.parse("2026-03-31T08:40:00Z"),
            "txn-9800",
            "Paid in cash"
        ),
        Instant.parse("2026-03-31T08:35:00Z")
    );
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(approvedOrder));
    when(salesRepository.markPaymentDone(9800L, request)).thenReturn(paidOrder);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.markPaymentDone(9800L, request);

    verify(salesRepository).markPaymentDone(9800L, request);
    verify(authorizationPolicyService, org.mockito.Mockito.never()).canWriteSalesForOutlet(any(), eq(2000L));
    assertEquals("payment_done", result.status());
    assertEquals("paid", result.paymentStatus());
  }

  @Test
  void listPosSessionsAllowsAdminToReadAcrossOutlets() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    , null, null));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(null);
    when(salesRepository.listPosSessions(
        null,
        LocalDate.parse("2024-07-01"),
        null,
        null,
        "closed",
        null,
        null,
        null,
        null,
        50,
        0
    )).thenReturn(PagedResult.of(List.of(), 50, 0, 0));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    service.listPosSessions(
        null,
        LocalDate.parse("2024-07-01"),
        null,
        null,
        "closed",
        null,
        null,
        null,
        null,
        null,
        null
    );

    verify(salesRepository).listPosSessions(
        null,
        LocalDate.parse("2024-07-01"),
        null,
        null,
        "closed",
        null,
        null,
        null,
        null,
        50,
        0
    );
  }

  @Test
  void listPromotionsRestrictsScopedUserToAllowedOutletLimit() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.manager",
        "sess-15",
        Set.of("outlet_manager"),
        Set.of(),
        Set.of(2000L, 2002L),
        true,
        false,
        null
    , null, null));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L, 2002L));
    when(promotionRepository.listPromotions(
        Set.of(2000L),
        "active",
        Instant.parse("2026-03-30T00:00:00Z"),
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock, promotionRepository);
    service.listPromotions(
        2000L,
        "active",
        Instant.parse("2026-03-30T00:00:00Z"),
        null,
        null,
        null,
        1000,
        null
    );

    verify(promotionRepository).listPromotions(
        Set.of(2000L),
        "active",
        Instant.parse("2026-03-30T00:00:00Z"),
        null,
        null,
        null,
        100,
        0
    );
  }

  @Test
  void deactivatePromotionUpdatesStatusForScopedWriter() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L,
        "workflow.hcm.manager",
        "sess-15",
        Set.of("outlet_manager"),
        Set.of("sales.order.write"),
        Set.of(2000L, 2002L),
        true,
        false,
        null
    , null, null));
    SalesDtos.PromotionView existing = new SalesDtos.PromotionView(
        "9400",
        "HCM Coffee Happy Hour",
        "percentage",
        "active",
        null,
        new BigDecimal("10.00"),
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-04-30T23:59:59Z"),
        Set.of(2000L, 2002L)
    );
    SalesDtos.PromotionView inactive = new SalesDtos.PromotionView(
        "9400",
        "HCM Coffee Happy Hour",
        "percentage",
        "inactive",
        null,
        new BigDecimal("10.00"),
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-04-30T23:59:59Z"),
        Set.of(2000L, 2002L)
    );
    when(promotionRepository.findPromotion(9400L)).thenReturn(Optional.of(existing));
    when(promotionRepository.updatePromotionStatus(9400L, "inactive")).thenReturn(inactive);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2002L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock, promotionRepository);
    SalesDtos.PromotionView result = service.deactivatePromotion(9400L);

    verify(promotionRepository).updatePromotionStatus(9400L, "inactive");
    assertEquals("inactive", result.status());
  }

  @Test
  void getPromotionRejectsScopedUserOutsideOutletScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(2000L), true, false, null
    , null, null));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(promotionRepository.findPromotion(9401L)).thenReturn(Optional.of(new SalesDtos.PromotionView(
        "9401",
        "US Breakfast Combo",
        "amount",
        "active",
        new BigDecimal("5.00"),
        null,
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-04-30T23:59:59Z"),
        Set.of(2100L)
    )));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock, promotionRepository);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.getPromotion(9401L));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void getPromotionAllowsScopedUserWithinOutletScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(2000L), true, false, null
    , null, null));
    SalesDtos.PromotionView promotion = new SalesDtos.PromotionView(
        "9400",
        "HCM Coffee Happy Hour",
        "percentage",
        "active",
        null,
        new BigDecimal("10.00"),
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-04-30T23:59:59Z"),
        Set.of(2000L, 2002L)
    );
    when(promotionRepository.findPromotion(9400L)).thenReturn(Optional.of(promotion));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock, promotionRepository);

    SalesDtos.PromotionView result = service.getPromotion(9400L);
    assertEquals("9400", result.id());
  }

  // ── Sync idempotency tests (S1) ────────────────────────────────────────────

  @Test
  void approveSaleFromSyncIsIdempotentWhenAlreadyApproved() {
    SalesDtos.SaleView approved = syncSaleView(900L, "order_approved", "unpaid");
    when(salesRepository.findSale(900L)).thenReturn(Optional.of(approved));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = java.util.Map.of("sale_id", 900L, "actor_user_id", 7L);
    SalesDtos.SaleView result = service.approveSaleFromSync(payload);

    assertEquals("900", result.id());
    assertEquals("order_approved", result.status());
    verify(salesRepository).findSale(900L);
    // Critical: must NOT re-call approveSale (would double-deduct inventory).
    verify(salesRepository, org.mockito.Mockito.never())
        .approveSale(eq(900L), any(), org.mockito.ArgumentMatchers.anyBoolean());
  }

  @Test
  void approveSaleFromSyncDelegatesWhenSaleStillOpen() {
    SalesDtos.SaleView open = syncSaleView(901L, "order_created", "unpaid");
    SalesDtos.SaleView approved = syncSaleView(901L, "order_approved", "unpaid");
    when(salesRepository.findSale(901L)).thenReturn(Optional.of(open));
    when(salesRepository.approveSale(901L, 7L, true)).thenReturn(approved);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = java.util.Map.of("sale_id", 901L, "actor_user_id", 7L);
    SalesDtos.SaleView result = service.approveSaleFromSync(payload);

    assertEquals("order_approved", result.status());
    verify(salesRepository).approveSale(901L, 7L, true);
  }

  @Test
  void approveSaleFromSyncRecordsManagerOverrideWhenOversellFlagged() {
    SalesDtos.SaleView open = syncSaleView(910L, "order_created", "unpaid");
    SalesDtos.SaleView approved = syncSaleView(910L, "order_approved", "unpaid");
    when(salesRepository.findSale(910L)).thenReturn(Optional.of(open));
    when(salesRepository.approveSale(910L, 7L, true)).thenReturn(approved);
    when(salesRepository.isSaleOversell(910L)).thenReturn(true);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = new java.util.HashMap<>();
    payload.put("sale_id", 910L);
    payload.put("actor_user_id", 7L);
    payload.put("manager_override", java.util.Map.of(
        "manager_user_id", 99L,
        "manager_pin_hash", "hash:abc",
        "reason", "stock_short_at_close",
        "device_id", 555L
    ));
    service.approveSaleFromSync(payload);

    verify(salesRepository).recordManagerOverride(
        eq(7L), eq(910L), eq("oversell"),
        eq(99L), eq("hash:abc"), eq("stock_short_at_close"), eq(555L),
        any(String.class));
  }

  @Test
  void approveSaleFromSyncSkipsManagerOverrideWhenNoOversellFlag() {
    SalesDtos.SaleView open = syncSaleView(911L, "order_created", "unpaid");
    SalesDtos.SaleView approved = syncSaleView(911L, "order_approved", "unpaid");
    when(salesRepository.findSale(911L)).thenReturn(Optional.of(open));
    when(salesRepository.approveSale(911L, 7L, true)).thenReturn(approved);
    when(salesRepository.isSaleOversell(911L)).thenReturn(false);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = new java.util.HashMap<>();
    payload.put("sale_id", 911L);
    payload.put("actor_user_id", 7L);
    payload.put("manager_override", java.util.Map.of("reason", "anything"));
    service.approveSaleFromSync(payload);

    verify(salesRepository, org.mockito.Mockito.never()).recordManagerOverride(
        org.mockito.ArgumentMatchers.anyLong(),
        org.mockito.ArgumentMatchers.anyLong(),
        any(String.class), any(), any(), any(String.class), any(), any());
  }

  @Test
  void capturePaymentFromSyncIsIdempotentWhenAlreadyPaid() {
    SalesDtos.SaleView paid = syncSaleView(902L, "payment_done", "paid");
    when(salesRepository.findSale(902L)).thenReturn(Optional.of(paid));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 902L,
        "amount", new BigDecimal("35000.00"),
        "payment_method", "cash",
        "client_occurred_at", "2026-03-27T10:00:00Z"
    );
    SalesDtos.SaleView result = service.capturePaymentFromSync(payload);

    assertEquals("902", result.id());
    assertEquals("payment_done", result.status());
    // Critical: must NOT re-call markPaymentDone (would double-publish payment-captured event).
    verify(salesRepository, org.mockito.Mockito.never()).markPaymentDone(eq(902L), any());
  }

  @Test
  void capturePaymentFromSyncRejectsDuplicateWithDifferentAmount() {
    SalesDtos.SaleView paid = syncSaleView(902L, "payment_done", "paid");
    when(salesRepository.findSale(902L)).thenReturn(Optional.of(paid));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 902L,
        "amount", new BigDecimal("36000.00"),
        "payment_method", "cash"
    );

    assertThrows(ServiceException.class, () -> service.capturePaymentFromSync(payload));
    verify(salesRepository, org.mockito.Mockito.never()).markPaymentDone(eq(902L), any());
  }

  @Test
  void submitSaleFromSyncReturnsExistingDuplicateWhenPayloadMatches() {
    SalesDtos.SaleView existing = syncSaleView(930L, "order_created", "unpaid");
    when(salesRepository.findSale(930L)).thenReturn(Optional.of(existing));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.submitSaleFromSync(java.util.Map.of(
        "sale_id", 930L,
        "outlet_id", 7L,
        "pos_session_id", 300L,
        "currency_code", "VND",
        "order_type", "dine_in",
        "items", List.of(java.util.Map.of(
            "product_id", 11L,
            "quantity", "1.0000",
            "discount_amount", "0",
            "tax_amount", "0"))));

    assertEquals("930", result.id());
    verify(salesRepository, org.mockito.Mockito.never()).submitSale(any(SalesDtos.SubmitSaleRequest.class), eq(930L));
  }

  @Test
  void submitSaleFromSyncRejectsDuplicateSaleIdWithDifferentPayload() {
    SalesDtos.SaleView existing = syncSaleView(931L, "order_created", "unpaid");
    when(salesRepository.findSale(931L)).thenReturn(Optional.of(existing));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 931L,
        "outlet_id", 7L,
        "pos_session_id", 300L,
        "currency_code", "VND",
        "order_type", "dine_in",
        "items", List.of(java.util.Map.of(
            "product_id", 11L,
            "quantity", "2.0000",
            "discount_amount", "0",
            "tax_amount", "0")));

    assertThrows(ServiceException.class, () -> service.submitSaleFromSync(payload));
    verify(salesRepository, org.mockito.Mockito.never()).submitSale(any(SalesDtos.SubmitSaleRequest.class), eq(931L));
  }

  @Test
  void capturePaymentFromSyncRejectsCancelledSale() {
    SalesDtos.SaleView cancelled = syncSaleView(903L, "cancelled", "unpaid");
    when(salesRepository.findSale(903L)).thenReturn(Optional.of(cancelled));

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, clock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 903L,
        "amount", new BigDecimal("35000.00"),
        "payment_method", "cash"
    );
    assertThrows(ServiceException.class, () -> service.capturePaymentFromSync(payload));
    verify(salesRepository, org.mockito.Mockito.never()).markPaymentDone(eq(903L), any());
  }

  // ── A1: Clock skew clamp ─────────────────────────────────────────────────

  @Test
  void capturePaymentFromSyncClampsNearFutureTimestamp() {
    // client_occurred_at = serverNow + 6h → clamped to serverNow + 5min
    Instant serverNow = Instant.parse("2026-04-25T10:00:00Z");
    Clock fixedClock = Clock.fixed(serverNow, ZoneOffset.UTC);
    when(salesRepository.findSale(910L)).thenReturn(Optional.empty());
    SalesDtos.SaleView paid = syncSaleView(910L, "payment_done", "paid");
    when(salesRepository.markPaymentDone(eq(910L), any(), any(), any(), eq(true))).thenReturn(paid);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, fixedClock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 910L,
        "amount", new BigDecimal("35000.00"),
        "payment_method", "cash",
        "client_occurred_at", serverNow.plusSeconds(6 * 3600).toString()
    );
    service.capturePaymentFromSync(payload);

    org.mockito.ArgumentCaptor<SalesDtos.MarkPaymentDoneRequest> captor =
        org.mockito.ArgumentCaptor.forClass(SalesDtos.MarkPaymentDoneRequest.class);
    verify(salesRepository).markPaymentDone(eq(910L), captor.capture(), any(), any(), eq(true));
    Instant clamped = captor.getValue().paymentTime();
    Instant maxAllowed = serverNow.plusSeconds(300);
    assertFalse(clamped.isAfter(maxAllowed), "paymentTime must not exceed serverNow+5min");
  }

  @Test
  void capturePaymentFromSyncRejectsClockSkewOver24h() {
    Instant serverNow = Instant.parse("2026-04-25T10:00:00Z");
    Clock fixedClock = Clock.fixed(serverNow, ZoneOffset.UTC);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, fixedClock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 911L,
        "amount", new BigDecimal("35000.00"),
        "payment_method", "cash",
        "client_occurred_at", serverNow.plusSeconds(25 * 3600).toString()
    );
    assertThrows(ServiceException.class, () -> service.capturePaymentFromSync(payload));
    verify(salesRepository, org.mockito.Mockito.never()).markPaymentDone(anyLong(), any());
  }

  @Test
  void capturePaymentFromSyncKeepsPastTimestampWithinRange() {
    Instant serverNow = Instant.parse("2026-04-25T10:00:00Z");
    Instant clientTime = serverNow.minusSeconds(3600); // 1h offline — valid
    Clock fixedClock = Clock.fixed(serverNow, ZoneOffset.UTC);
    when(salesRepository.findSale(912L)).thenReturn(Optional.empty());
    SalesDtos.SaleView paid = syncSaleView(912L, "payment_done", "paid");
    when(salesRepository.markPaymentDone(eq(912L), any(), any(), any(), eq(true))).thenReturn(paid);

    SalesService service = new SalesService(salesRepository, authorizationPolicyService, fixedClock);
    java.util.Map<String, Object> payload = java.util.Map.of(
        "sale_id", 912L,
        "amount", new BigDecimal("35000.00"),
        "payment_method", "cash",
        "client_occurred_at", clientTime.toString()
    );
    service.capturePaymentFromSync(payload);

    org.mockito.ArgumentCaptor<SalesDtos.MarkPaymentDoneRequest> captor =
        org.mockito.ArgumentCaptor.forClass(SalesDtos.MarkPaymentDoneRequest.class);
    verify(salesRepository).markPaymentDone(eq(912L), captor.capture(), any(), any(), eq(true));
    assertEquals(clientTime, captor.getValue().paymentTime());
  }

  private SalesDtos.SaleView syncSaleView(long saleId, String status, String paymentStatus) {
    SalesDtos.PaymentView payment = "paid".equals(paymentStatus)
        ? new SalesDtos.PaymentView(
            Long.toString(saleId),
            "cash",
            new BigDecimal("35000.00"),
            "paid",
            Instant.parse("2026-03-27T10:00:00Z"),
            null,
            null)
        : null;
    return new SalesDtos.SaleView(
        Long.toString(saleId),
        7L,
        "300",
        null, null, null,
        "VND",
        "dine_in",
        status,
        paymentStatus,
        new BigDecimal("35000.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("35000.00"),
        null,
        List.of(new SalesDtos.SaleLineView(
            11L, "PROD-11", "P", BigDecimal.ONE, new BigDecimal("35000.00"),
            BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("35000.00"), Set.of(), null,
            null, null, null
        )),
        payment,
        Instant.parse("2026-03-27T10:00:00Z")
    );
  }

  private SalesDtos.SaleView publicOrder(String saleId, long outletId, String status) {
    return new SalesDtos.SaleView(
        saleId,
        outletId,
        null,
        "ord_public_9800",
        "T1",
        "Table 1",
        "VND",
        "online",
        status,
        "unpaid",
        new BigDecimal("35000.00"),
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        new BigDecimal("35000.00"),
        "QR order T1 (Table 1)",
        List.of(new SalesDtos.SaleLineView(
            501L,
            "PROD-501",
            "Public Order Product",
            BigDecimal.ONE,
            new BigDecimal("35000.00"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            new BigDecimal("35000.00"),
            Set.of(),
            null,
            null, null, null
        )),
        null,
        Instant.parse("2026-03-31T08:35:00Z")
    );
  }
}
