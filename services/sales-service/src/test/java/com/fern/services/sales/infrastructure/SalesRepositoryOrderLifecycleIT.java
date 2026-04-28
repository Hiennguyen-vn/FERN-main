package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.middleware.ServiceException;
import com.fern.common.outbox.OutboxWriter;
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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(PostgresContainerExtension.class)
class SalesRepositoryOrderLifecycleIT {

  private static final long PRODUCT_ID = 9701L;
  private static final long ITEM_ID = 9801L;

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
  void approveSaleDebitsRecipeStockSynchronously() {
    SalesDtos.PosSessionView session = repository.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "SHIFT-HCM-STOCK",
        TestFixtures.OUTLET_HCM_1,
        "USD",
        null,
        null,
        "REGISTER-STOCK",
        "cashier-stock",
        LocalDate.parse("2026-04-27"),
        null));
    SalesDtos.SaleView created = repository.submitSale(new SalesDtos.SubmitSaleRequest(
        TestFixtures.OUTLET_HCM_1,
        Long.parseLong(session.id()),
        "USD",
        "dine_in",
        "Stock debit",
        List.of(new SalesDtos.SaleLineRequest(
            PRODUCT_ID,
            new BigDecimal("2.0000"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(),
            null,
            null,
            null)),
        null));

    repository.approveSale(Long.parseLong(created.id()), TestFixtures.USER_MANAGER_HCM);

    assertEquals(0, new BigDecimal("8.0000").compareTo(currentStock()));
    assertEquals(1, saleUsageRows(Long.parseLong(created.id())));
  }

  @Test
  void concurrentTerminalApprovalsForSameStockDoNotOversellSilently() throws Exception {
    seedDevices();
    SalesDtos.PosSessionView terminalA = openSessionForDevice(8001L, "REGISTER-RACE-A", "race-a");
    SalesDtos.PosSessionView terminalB = openSessionForDevice(8002L, "REGISTER-RACE-B", "race-b");
    SalesDtos.SaleView saleA = submitSaleForSession(terminalA.id(), "Race A", new BigDecimal("6.0000"));
    SalesDtos.SaleView saleB = submitSaleForSession(terminalB.id(), "Race B", new BigDecimal("6.0000"));

    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch ready = new CountDownLatch(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<ApprovalAttempt> first = executor.submit(
          () -> approveAfterStart(Long.parseLong(saleA.id()), 8001L, ready, start));
      Future<ApprovalAttempt> second = executor.submit(
          () -> approveAfterStart(Long.parseLong(saleB.id()), 8002L, ready, start));

      assertTrue(ready.await(5, TimeUnit.SECONDS));
      start.countDown();
      List<ApprovalAttempt> attempts = List.of(
          first.get(10, TimeUnit.SECONDS),
          second.get(10, TimeUnit.SECONDS));

      long successCount = attempts.stream().filter(ApprovalAttempt::success).count();
      long conflictCount = attempts.stream()
          .filter(attempt -> attempt.failure() instanceof ServiceException ex && ex.getStatusCode() == 409)
          .count();
      assertEquals(1, successCount);
      assertEquals(1, conflictCount);
      assertEquals(0, new BigDecimal("4.0000").compareTo(currentStock()));
      assertEquals(1, saleUsageRows(Long.parseLong(saleA.id())) + saleUsageRows(Long.parseLong(saleB.id())));
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  void submitSaleUsesOutletTimezoneForPricingAtUtcBoundary() throws Exception {
    seedMayPrice();
    repository = new SalesRepository(
        dataSource,
        new SnowflakeIdGenerator(5L),
        Clock.fixed(Instant.parse("2026-04-30T16:30:00Z"), ZoneOffset.UTC));

    setOutletTimezone("Asia/Ho_Chi_Minh");
    SalesDtos.SaleView vnSale = submitPublicLikeSale();
    assertEquals(0, new BigDecimal("35000.00").compareTo(vnSale.items().get(0).unitPrice()));

    setOutletTimezone("Asia/Singapore");
    SalesDtos.SaleView sgSale = submitPublicLikeSale();
    assertEquals(0, new BigDecimal("45000.00").compareTo(sgSale.items().get(0).unitPrice()));
  }

  @Test
  void saleApprovedOutboxUsesOutletTimezoneBusinessDateAtUtcBoundary() throws Exception {
    setOutletTimezone("Asia/Singapore");
    OutboxWriter outboxWriter = new OutboxWriter(
        new ObjectMapper().findAndRegisterModules(),
        new SnowflakeIdGenerator(6L)::generateId);
    repository = new SalesRepository(
        dataSource,
        new SnowflakeIdGenerator(5L),
        Clock.fixed(Instant.parse("2026-04-30T16:30:00Z"), ZoneOffset.UTC),
        outboxWriter);
    repository.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "SHIFT-SG-BOUNDARY",
        TestFixtures.OUTLET_HCM_1,
        "USD",
        null,
        null,
        "REGISTER-SG",
        "cashier-sg",
        LocalDate.parse("2026-05-01"),
        null));
    SalesDtos.SaleView sale = submitPublicLikeSale();

    repository.approveSale(Long.parseLong(sale.id()), TestFixtures.USER_MANAGER_HCM);

    assertEquals("2026-05-01", outboxBusinessDate(Long.parseLong(sale.id()), "fern.sales.sale-approved"));
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

  private SalesDtos.SaleView submitSaleForSession(String sessionId, String note, BigDecimal quantity) {
    return repository.submitSale(new SalesDtos.SubmitSaleRequest(
        TestFixtures.OUTLET_HCM_1,
        Long.parseLong(sessionId),
        "USD",
        "dine_in",
        note,
        List.of(new SalesDtos.SaleLineRequest(
            PRODUCT_ID,
            quantity,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(),
            null,
            null,
            null)),
        null));
  }

  private void seedMayPrice() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(String.format("""
          INSERT INTO core.product_price (product_id, outlet_id, currency_code, price_value, effective_from)
          VALUES (%d, %d, 'USD', 45000.00, '2026-05-01')
          ON CONFLICT (product_id, outlet_id, effective_from)
          DO UPDATE SET price_value = EXCLUDED.price_value
          """, PRODUCT_ID, TestFixtures.OUTLET_HCM_1));
    }
  }

  private void setOutletTimezone(String timezone) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             """
             UPDATE core.region r
             SET timezone_name = ?
             FROM core.outlet o
             WHERE o.region_id = r.id
               AND o.id = ?
             """)) {
      ps.setString(1, timezone);
      ps.setLong(2, TestFixtures.OUTLET_HCM_1);
      ps.executeUpdate();
    }
  }

  private String outboxBusinessDate(long saleId, String topic) {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             """
             SELECT payload ->> 'businessDate' AS business_date
             FROM core.outbox_event
             WHERE aggregate_id = ?
               AND topic = ?
             ORDER BY created_at DESC
             LIMIT 1
             """)) {
      ps.setLong(1, saleId);
      ps.setString(2, topic);
      try (var rs = ps.executeQuery()) {
        assertTrue(rs.next());
        return normalizeJsonDate(rs.getString("business_date"));
      }
    } catch (Exception e) {
      throw new IllegalStateException("Unable to read outbox business date", e);
    }
  }

  private static String normalizeJsonDate(String raw) {
    String trimmed = String.valueOf(raw).trim();
    if (!trimmed.startsWith("[")) {
      return trimmed.replace("\"", "");
    }
    String[] parts = trimmed.replace("[", "").replace("]", "").split(",");
    return LocalDate.of(
        Integer.parseInt(parts[0].trim()),
        Integer.parseInt(parts[1].trim()),
        Integer.parseInt(parts[2].trim())
    ).toString();
  }

  private ApprovalAttempt approveAfterStart(
      long saleId,
      long deviceId,
      CountDownLatch ready,
      CountDownLatch start
  ) throws Exception {
    ready.countDown();
    assertTrue(start.await(5, TimeUnit.SECONDS));
    try {
      RequestUserContextHolder.set(deviceContext(deviceId, TestFixtures.OUTLET_HCM_1));
      repository.approveSale(saleId, TestFixtures.USER_MANAGER_HCM);
      return new ApprovalAttempt(true, null);
    } catch (Throwable failure) {
      return new ApprovalAttempt(false, failure);
    } finally {
      RequestUserContextHolder.clear();
    }
  }

  private RequestUserContext deviceContext(long deviceId, long outletId) {
    return new RequestUserContext(
        null, "device-" + deviceId, null,
        Set.of("pos.device"), Set.of(), Set.of(outletId),
        true, false, null, deviceId, outletId);
  }

  private record ApprovalAttempt(boolean success, Throwable failure) {
  }

  private void resetSalesTables() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(
          """
          TRUNCATE TABLE
            core.outbox_event,
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
      st.execute("""
          INSERT INTO core.item_category (code, name)
          VALUES ('INGREDIENT', 'Ingredient')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute("""
          INSERT INTO core.unit_of_measure (code, name)
          VALUES ('EA', 'Each')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute(String.format("""
          INSERT INTO core.item (id, code, name, category_code, base_uom_code, min_stock_level, status)
          VALUES (%d, 'MILK-IT', 'Lifecycle Milk', 'INGREDIENT', 'EA', 1.0000, 'active')
          ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
          """, ITEM_ID));
      st.execute(String.format("""
          INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost)
          VALUES (%d, %d, 10.0000, 2.50)
          ON CONFLICT (location_id, item_id)
          DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand, unit_cost = EXCLUDED.unit_cost
          """, TestFixtures.OUTLET_HCM_1, ITEM_ID));
      st.execute(String.format("""
          INSERT INTO core.product (id, code, name, category_code, status)
          VALUES (%d, 'LATTE-IT', 'Lifecycle Latte', 'MENU', 'active')
          ON CONFLICT (id) DO NOTHING
          """, PRODUCT_ID));
      st.execute(String.format("""
          INSERT INTO core.recipe (product_id, version, yield_qty, yield_uom_code, status)
          VALUES (%d, 'v1', 1.0000, 'EA', 'active')
          ON CONFLICT (product_id, version) DO UPDATE SET status = EXCLUDED.status
          """, PRODUCT_ID));
      st.execute(String.format("""
          INSERT INTO core.recipe_item (product_id, version, item_id, uom_code, qty)
          VALUES (%d, 'v1', %d, 'EA', 1.0000)
          ON CONFLICT (product_id, version, item_id) DO UPDATE SET qty = EXCLUDED.qty
          """, PRODUCT_ID, ITEM_ID));
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

  private BigDecimal currentStock() {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             """
             SELECT qty_on_hand
             FROM core.stock_balance
             WHERE location_id = ? AND item_id = ?
             """)) {
      ps.setLong(1, TestFixtures.OUTLET_HCM_1);
      ps.setLong(2, ITEM_ID);
      try (var rs = ps.executeQuery()) {
        org.junit.jupiter.api.Assertions.assertTrue(rs.next());
        return rs.getBigDecimal("qty_on_hand");
      }
    } catch (Exception e) {
      throw new IllegalStateException("Unable to read stock balance", e);
    }
  }

  private int saleUsageRows(long saleId) {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             """
             SELECT COUNT(*)
             FROM core.sale_item_transaction
             WHERE sale_id = ?
             """)) {
      ps.setLong(1, saleId);
      try (var rs = ps.executeQuery()) {
        org.junit.jupiter.api.Assertions.assertTrue(rs.next());
        return rs.getInt(1);
      }
    } catch (Exception e) {
      throw new IllegalStateException("Unable to count sale usage rows", e);
    }
  }
}
