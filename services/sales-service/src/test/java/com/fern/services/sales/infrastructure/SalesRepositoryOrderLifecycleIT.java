package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sales.api.SalesDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(PostgresContainerExtension.class)
class SalesRepositoryOrderLifecycleIT {

  private static final long PRODUCT_ID = 9701L;

  private DataSource dataSource;
  private SalesRepository repository;

  @BeforeEach
  void setUp() throws Exception {
    dataSource = PostgresContainerExtension.dataSource();
    TestFixtures.seedBaseline(dataSource);
    resetSalesTables();
    seedProduct();
    repository = new SalesRepository(
        dataSource,
        new SnowflakeIdGenerator(4L),
        Clock.fixed(Instant.parse("2026-04-27T08:00:00Z"), ZoneOffset.UTC));
  }

  @Test
  void orderPaymentSessionLifecycleFeedsListsAndRevenueReports() {
    SalesDtos.PosSessionView session = repository.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "SHIFT-HCM-1",
        TestFixtures.OUTLET_HCM_1,
        "USD",
        null,
        null,
        "REGISTER-A",
        "cashier-a",
        LocalDate.parse("2026-04-27"),
        "Morning shift"));

    SalesDtos.SaleView created = repository.submitSale(new SalesDtos.SubmitSaleRequest(
        TestFixtures.OUTLET_HCM_1,
        Long.parseLong(session.id()),
        "USD",
        "dine_in",
        "Table 7",
        List.of(new SalesDtos.SaleLineRequest(
            PRODUCT_ID,
            new BigDecimal("2.0000"),
            new BigDecimal("1000.00"),
            new BigDecimal("500.00"),
            "less ice",
            Set.of(),
            null,
            null,
            null)),
        null));

    assertEquals("order_created", created.status());
    assertEquals(0, new BigDecimal("70000.00").compareTo(created.subtotal()));
    assertEquals(0, new BigDecimal("69500.00").compareTo(created.totalAmount()));

    SalesDtos.SaleView approved = repository.approveSale(Long.parseLong(created.id()), TestFixtures.USER_MANAGER_HCM);
    assertEquals("order_approved", approved.status());

    SalesDtos.SaleView paid = repository.markPaymentDone(
        Long.parseLong(created.id()),
        new SalesDtos.MarkPaymentDoneRequest(
            "cash",
            new BigDecimal("69500.00"),
            Instant.parse("2026-04-27T08:05:00Z"),
            "cash-1",
            "paid"));
    assertEquals("payment_done", paid.status());
    assertEquals("paid", paid.paymentStatus());

    PagedResult<SalesDtos.SaleListItemView> sales = repository.listSales(
        Set.of(TestFixtures.OUTLET_HCM_1),
        LocalDate.parse("2026-04-27"),
        LocalDate.parse("2026-04-27"),
        "payment_done",
        "paid",
        false,
        Long.parseLong(session.id()),
        "Table",
        "createdAt",
        "desc",
        20,
        0);
    assertEquals(1, sales.items().size());

    SalesDtos.PosSessionView closed = repository.closePosSession(Long.parseLong(session.id()), "counted");
    assertEquals("closed", closed.status());
    SalesDtos.PosSessionReconciliationView reconciled = repository.reconcilePosSession(
        Long.parseLong(session.id()),
        new SalesDtos.ReconcilePosSessionRequest(
            List.of(new SalesDtos.ReconcilePosSessionLineRequest("cash", new BigDecimal("69500.00"))),
            "balanced"),
        TestFixtures.USER_MANAGER_HCM);
    assertEquals("reconciled", reconciled.status());
    assertEquals(0, BigDecimal.ZERO.compareTo(reconciled.discrepancyTotal()));

    PagedResult<SalesDtos.PosSessionListItemView> sessions = repository.listPosSessions(
        Set.of(TestFixtures.OUTLET_HCM_1),
        LocalDate.parse("2026-04-27"),
        null,
        null,
        "reconciled",
        null,
        "REGISTER",
        "openedAt",
        "desc",
        20,
        0);
    assertEquals(1, sessions.items().size());
    assertFalse(repository.monthlyRevenue(Set.of(TestFixtures.OUTLET_HCM_1),
        LocalDate.parse("2026-04-01"), LocalDate.parse("2026-04-30")).isEmpty());
    assertFalse(repository.dailyRevenue(Set.of(TestFixtures.OUTLET_HCM_1),
        LocalDate.parse("2026-04-27"), LocalDate.parse("2026-04-27")).isEmpty());
    assertEquals(1, repository.getOutletStats(TestFixtures.OUTLET_HCM_1, LocalDate.parse("2026-04-27")).ordersToday());

    Optional<SalesDtos.SaleView> found = repository.findSale(Long.parseLong(created.id()));
    assertEquals("payment_done", found.orElseThrow().status());
  }

  @Test
  void cancelOrderCreatedSaleIsIdempotentAndPreservesReason() {
    SalesDtos.PosSessionView session = repository.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "SHIFT-HCM-CANCEL",
        TestFixtures.OUTLET_HCM_1,
        "USD",
        null,
        null,
        "REGISTER-A",
        "cashier-a",
        LocalDate.parse("2026-04-27"),
        null));
    SalesDtos.SaleView created = repository.submitSale(new SalesDtos.SubmitSaleRequest(
        TestFixtures.OUTLET_HCM_1,
        Long.parseLong(session.id()),
        "USD",
        "takeaway",
        "Customer changed mind",
        List.of(new SalesDtos.SaleLineRequest(
            PRODUCT_ID,
            BigDecimal.ONE,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(),
            null,
            null,
            null)),
        null));

    SalesDtos.SaleView cancelled =
        repository.cancelSale(Long.parseLong(created.id()), "void before prep", TestFixtures.USER_MANAGER_HCM);
    SalesDtos.SaleView replay =
        repository.cancelSale(Long.parseLong(created.id()), "void before prep", TestFixtures.USER_MANAGER_HCM);

    assertEquals("cancelled", cancelled.status());
    assertEquals("cancelled", replay.status());
    assertEquals(cancelled.note(), replay.note());
  }

  @Test
  void approveSaleAttributesPublicOrderToSessionMatchingDeviceContext() throws Exception {
    seedDevices();
    SalesDtos.PosSessionView terminalA = openSessionForDevice(8001L, "REGISTER-A", "shift-a");
    SalesDtos.PosSessionView terminalB = openSessionForDevice(8002L, "REGISTER-B", "shift-b");
    SalesDtos.SaleView publicOrder = submitPublicLikeSale();

    try {
      RequestUserContextHolder.set(deviceContext(8002L, TestFixtures.OUTLET_HCM_1));
      SalesDtos.SaleView approved = repository.approveSale(
          Long.parseLong(publicOrder.id()),
          TestFixtures.USER_MANAGER_HCM);
      assertEquals("order_approved", approved.status());
      assertEquals(terminalB.id(), approved.posSessionId());
      assertNotEquals(terminalA.id(), approved.posSessionId());
    } finally {
      RequestUserContextHolder.clear();
    }
  }

  @Test
  void approveSaleFallsBackToOutletWideLookupWithoutDeviceContext() throws Exception {
    seedDevices();
    SalesDtos.PosSessionView terminalA = openSessionForDevice(8001L, "REGISTER-A", "shift-a");
    SalesDtos.PosSessionView terminalB = openSessionForDevice(8002L, "REGISTER-B", "shift-b");
    SalesDtos.SaleView publicOrder = submitPublicLikeSale();

    // No RequestUserContext set — falls back to outlet-wide open-session lookup. Either of the
    // two open sessions is acceptable since clock is fixed and ordering is non-deterministic.
    SalesDtos.SaleView approved = repository.approveSale(
        Long.parseLong(publicOrder.id()),
        TestFixtures.USER_MANAGER_HCM);
    assertEquals("order_approved", approved.status());
    java.util.Set<String> openSessionIds = java.util.Set.of(terminalA.id(), terminalB.id());
    org.junit.jupiter.api.Assertions.assertTrue(
        openSessionIds.contains(approved.posSessionId()),
        "approved session " + approved.posSessionId() + " should be one of " + openSessionIds);
  }

  private void seedDevices() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(String.format("""
          INSERT INTO core.device_registry (id, outlet_id, device_label, worker_id)
          VALUES (8001, %d, 'Terminal A', 201),
                 (8002, %d, 'Terminal B', 202)
          ON CONFLICT (id) DO NOTHING
          """, TestFixtures.OUTLET_HCM_1, TestFixtures.OUTLET_HCM_1));
    }
  }

  private SalesDtos.PosSessionView openSessionForDevice(long deviceId, String registerCode, String sessionCode) {
    return repository.openPosSession(new SalesDtos.OpenPosSessionRequest(
        sessionCode,
        TestFixtures.OUTLET_HCM_1,
        "USD",
        null,
        deviceId,
        registerCode,
        "cashier-" + deviceId,
        LocalDate.parse("2026-04-27"),
        null));
  }

  private SalesDtos.SaleView submitPublicLikeSale() {
    return repository.submitSale(new SalesDtos.SubmitSaleRequest(
        TestFixtures.OUTLET_HCM_1,
        null,
        "USD",
        "online",
        "QR public order",
        List.of(new SalesDtos.SaleLineRequest(
            PRODUCT_ID,
            BigDecimal.ONE,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(),
            null,
            null,
            null)),
        null));
  }

  private RequestUserContext deviceContext(long deviceId, long outletId) {
    return new RequestUserContext(
        null, "device-" + deviceId, null,
        Set.of("pos.device"), Set.of(), Set.of(outletId),
        true, false, null, deviceId, outletId);
  }

  private void resetSalesTables() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(
          """
          TRUNCATE TABLE
            core.pos_session_reconciliation_line,
            core.pos_session_reconciliation,
            core.payment,
            core.sale_item_promotion,
            core.sale_item_modifier,
            core.sale_item,
            core.sale_record,
            core.pos_session,
            core.device_registry,
            core.ordering_table,
            core.product_price,
            core.product_outlet_availability,
            core.product
          CASCADE
          """);
    }
  }

  private void seedProduct() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("SET search_path TO core, public");
      st.execute("""
          INSERT INTO core.product_category (code, name)
          VALUES ('MENU', 'Menu')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute(String.format("""
          INSERT INTO core.product (id, code, name, category_code, status)
          VALUES (%d, 'LATTE-IT', 'Lifecycle Latte', 'MENU', 'active')
          ON CONFLICT (id) DO NOTHING
          """, PRODUCT_ID));
      st.execute(String.format("""
          INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
          VALUES (%d, %d, TRUE)
          ON CONFLICT (product_id, outlet_id) DO UPDATE SET is_available = EXCLUDED.is_available
          """, PRODUCT_ID, TestFixtures.OUTLET_HCM_1));
      st.execute(String.format("""
          INSERT INTO core.product_price (product_id, outlet_id, currency_code, price_value, effective_from)
          VALUES (%d, %d, 'USD', 35000.00, '2026-01-01')
          ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING
          """, PRODUCT_ID, TestFixtures.OUTLET_HCM_1));
    }
  }
}
