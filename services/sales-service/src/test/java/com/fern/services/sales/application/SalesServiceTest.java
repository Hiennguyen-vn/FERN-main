package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.events.sales.PaymentCapturedEvent;
import com.fern.events.sales.SaleCompletedEvent;
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
  private TypedKafkaEventPublisher kafkaEventPublisher;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void openPosSessionRejectsContextWithoutSalesWritePermission() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(7L), true, false, null
    ));
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(false);
    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    assertThrows(ServiceException.class, () -> service.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "POS-001",
        7L,
        "USD",
        15L,
        LocalDate.parse("2026-03-27"),
        null
    )));
  }

  @Test
  void submitSaleCreatesOrderWithoutPublishingLifecycleEvents() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    ));
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
            Set.of(901L)
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
            null
        )),
        null,
        Instant.parse("2026-03-27T00:00:00Z")
    );
    when(salesRepository.submitSale(request)).thenReturn(sale);
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.submitSale(request);

    verify(salesRepository).submitSale(request);
    verifyNoInteractions(kafkaEventPublisher);
    assertEquals("500", result.id());
    assertEquals("order_created", result.status());
    assertEquals("unpaid", result.paymentStatus());
  }

  @Test
  void submitSaleRejectsInlinePaymentCapture() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    ));
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
            Set.of(901L)
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
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);
    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.submitSale(request));

    assertEquals(400, exception.getStatusCode());
    verifyNoInteractions(salesRepository);
    verifyNoInteractions(kafkaEventPublisher);
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
    ));
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
    when(salesRepository.createPromotion(request)).thenReturn(promotion);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(7L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
    SalesDtos.PromotionView result = service.createPromotion(request);

    verify(salesRepository).createPromotion(request);
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
    ));
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
    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createPromotion(request));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void getSaleRejectsScopedUserOutsideOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(7L), true, false, null
    ));
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

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
    ));
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
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
    ));
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
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
    ));

    when(authorizationPolicyService.canWriteSales(any())).thenReturn(false);
    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

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
    ));

    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2002L))).thenReturn(false);
    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    ServiceException exception =
        assertThrows(ServiceException.class, () -> service.listOrderingTables(2002L, null));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listOrderingTablesAllowsAdminAcrossOutlets() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(salesRepository.listOrderingTables(null, "active")).thenReturn(List.of());
    when(authorizationPolicyService.canWriteSales(any())).thenReturn(true);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(null);

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
    service.listOrderingTables(null, "active");

    verify(salesRepository).listOrderingTables(null, "active");
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
    ));
    SalesDtos.SaleView openOrder = publicOrder("9800", 2000L, "order_created");
    SalesDtos.SaleView confirmedOrder = publicOrder("9800", 2000L, "order_approved");
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(openOrder));
    when(salesRepository.approveSale(9800L, 15L)).thenReturn(confirmedOrder);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.confirmSale(9800L);

    verify(salesRepository).approveSale(9800L, 15L);
    verifyNoInteractions(kafkaEventPublisher);
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
    ));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "order_created")));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(false);

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

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
    ));
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.confirmSale(9801L));
    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void confirmSaleRejectsNonOpenOrders() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);
    when(salesRepository.findSale(9800L)).thenReturn(Optional.of(publicOrder("9800", 2000L, "payment_done")));
    when(salesRepository.approveSale(9800L, 7L))
        .thenThrow(ServiceException.conflict("Only newly created orders can be approved"));

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.confirmSale(9800L));
    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void confirmSaleRejectsMissingOrders() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(salesRepository.findSale(9800L)).thenReturn(Optional.empty());

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

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
    ));
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
    SalesDtos.SaleView result = service.markPaymentDone(9800L, request);

    verify(salesRepository).markPaymentDone(9800L, request);
    verify(kafkaEventPublisher).publish(
        eq("fern.sales.sale-completed"),
        eq("9800"),
        eq("sales.sale.completed"),
        any(SaleCompletedEvent.class)
    );
    verify(kafkaEventPublisher).publish(
        eq("fern.sales.payment-captured"),
        eq("9800"),
        eq("sales.payment.captured"),
        any(PaymentCapturedEvent.class)
    );
    assertEquals("payment_done", result.status());
    assertEquals("paid", result.paymentStatus());
  }

  @Test
  void listPosSessionsAllowsAdminToReadAcrossOutlets() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
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
    ));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L, 2002L));
    when(salesRepository.listPromotions(
        Set.of(2000L),
        "active",
        Instant.parse("2026-03-30T00:00:00Z"),
        null,
        null,
        null,
        100,
        0
    )).thenReturn(PagedResult.of(List.of(), 100, 0, 0));

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
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

    verify(salesRepository).listPromotions(
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
    ));
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
    when(salesRepository.findPromotion(9400L)).thenReturn(Optional.of(existing));
    when(salesRepository.updatePromotionStatus(9400L, "inactive")).thenReturn(inactive);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2000L))).thenReturn(true);
    when(authorizationPolicyService.canWriteSalesForOutlet(any(), eq(2002L))).thenReturn(true);

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);
    SalesDtos.PromotionView result = service.deactivatePromotion(9400L);

    verify(salesRepository).updatePromotionStatus(9400L, "inactive");
    assertEquals("inactive", result.status());
  }

  @Test
  void getPromotionRejectsScopedUserOutsideOutletScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));
    when(salesRepository.findPromotion(9401L)).thenReturn(Optional.of(new SalesDtos.PromotionView(
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

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.getPromotion(9401L));
    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void getPromotionAllowsScopedUserWithinOutletScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "cashier", "sess-15", Set.of("cashier"), Set.of(), Set.of(2000L), true, false, null
    ));
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
    when(salesRepository.findPromotion(9400L)).thenReturn(Optional.of(promotion));
    when(authorizationPolicyService.resolveSalesReadableOutletIds(any())).thenReturn(Set.of(2000L));

    SalesService service = new SalesService(salesRepository, kafkaEventPublisher, authorizationPolicyService, clock);

    SalesDtos.PromotionView result = service.getPromotion(9400L);
    assertEquals("9400", result.id());
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
            null
        )),
        null,
        Instant.parse("2026-03-31T08:35:00Z")
    );
  }
}
