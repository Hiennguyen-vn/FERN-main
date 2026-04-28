package com.fern.services.inventory.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.events.inventory.OfflineInventoryMovementRecordedEvent;
import com.fern.events.inventory.StockInSimpleRecordedEvent;
import com.fern.services.inventory.api.InventoryDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(PostgresContainerExtension.class)
class InventoryRepositoryIT {

  private static final long ITEM_ID = 9001L;

  private DataSource dataSource;
  private InventoryRepository repository;

  @BeforeEach
  void setUp() throws Exception {
    dataSource = PostgresContainerExtension.dataSource();
    TestFixtures.seedBaseline(dataSource);
    resetInventoryTables();
    seedItemAndStock();
    repository = new InventoryRepository(dataSource, new SnowflakeIdGenerator(1L));
  }

  @Test
  void findStockBalanceReturnsRowWhenPresent() {
    Optional<InventoryDtos.StockBalanceView> result =
        repository.findStockBalance(TestFixtures.OUTLET_HCM_1, ITEM_ID);

    assertTrue(result.isPresent());
    InventoryDtos.StockBalanceView view = result.get();
    assertEquals(TestFixtures.OUTLET_HCM_1, view.outletId());
    assertEquals(ITEM_ID, view.itemId());
    assertEquals("ITEM-9001", view.itemCode());
    assertEquals(0, new BigDecimal("12.5000").compareTo(view.qtyOnHand()));
    assertNotNull(view.updatedAt());
  }

  @Test
  void findStockBalanceReturnsEmptyForUnknownItem() {
    Optional<InventoryDtos.StockBalanceView> result =
        repository.findStockBalance(TestFixtures.OUTLET_HCM_1, 999_999L);
    assertFalse(result.isPresent());
  }

  @Test
  void findStockBalanceIsScopedByOutlet() {
    Optional<InventoryDtos.StockBalanceView> wrongOutlet =
        repository.findStockBalance(TestFixtures.OUTLET_NY_1, ITEM_ID);
    assertFalse(wrongOutlet.isPresent());
  }

  private void seedItemAndStock() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("SET search_path TO core, public");
      st.execute("""
          INSERT INTO core.item_category (code, name) VALUES ('FOOD', 'Food')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute("""
          INSERT INTO core.unit_of_measure (code, name) VALUES ('EA', 'Each')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute(String.format("""
          INSERT INTO core.item (id, code, name, category_code, base_uom_code, min_stock_level, status)
          VALUES (%d, 'ITEM-9001', 'Test Item', 'FOOD', 'EA', 15.0000, 'active')
          ON CONFLICT (id) DO NOTHING
          """, ITEM_ID));
      st.execute(String.format("""
          INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost)
          VALUES (%d, %d, 12.5000, 3.50)
          ON CONFLICT (location_id, item_id) DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand
          """, TestFixtures.OUTLET_HCM_1, ITEM_ID));
    }
  }

  @Test
  void listStockBalancesPagesAndFiltersByLowOnly() {
    com.fern.common.spring.web.PagedResult<InventoryDtos.StockBalanceView> page =
        repository.listStockBalances(TestFixtures.OUTLET_HCM_1, false, null, null, null, 50, 0);
    assertTrue(page.totalCount() >= 1);
    assertTrue(page.items().stream().anyMatch(v -> v.itemId() == ITEM_ID));
  }

  @Test
  void findStockBalanceConsistentAfterRepeatedLookups() {
    Optional<InventoryDtos.StockBalanceView> a = repository.findStockBalance(TestFixtures.OUTLET_HCM_1, ITEM_ID);
    Optional<InventoryDtos.StockBalanceView> b = repository.findStockBalance(TestFixtures.OUTLET_HCM_1, ITEM_ID);
    assertTrue(a.isPresent() && b.isPresent());
    assertEquals(0, a.get().qtyOnHand().compareTo(b.get().qtyOnHand()));
  }

  @Test
  void createWasteWritesTransactionAndReducesStockBalance() {
    InventoryDtos.WasteView waste = repository.createWaste(
        TestFixtures.OUTLET_HCM_1,
        ITEM_ID,
        new BigDecimal("2.5000"),
        LocalDate.parse("2026-04-10"),
        new BigDecimal("3.50"),
        "Spoilage",
        "Damaged during storage",
        null);

    assertEquals("Spoilage", waste.reason());
    assertEquals("waste_out", waste.transaction().txnType());
    assertEquals(0, new BigDecimal("-2.5000").compareTo(waste.transaction().qtyChange()));
    assertQuantity(new BigDecimal("10.0000"));
  }

  @Test
  void listTransactionsFiltersGoodsReceiptAliasToPurchaseIn() throws Exception {
    insertInventoryTransaction(8101L, new BigDecimal("3.0000"), "purchase_in", "Manual goods receipt");

    com.fern.common.spring.web.PagedResult<InventoryDtos.InventoryTransactionView> page =
        repository.listTransactions(
            TestFixtures.OUTLET_HCM_1,
            ITEM_ID,
            null,
            null,
            "goods_receipt",
            null,
            "txnTime",
            "desc",
            10,
            0);

    assertEquals(1, page.items().size());
    assertEquals("purchase_in", page.items().get(0).txnType());
  }

  @Test
  void createStockCountSessionCapturesSystemQtyAndVariance() {
    InventoryDtos.StockCountSessionView session = repository.createStockCountSession(
        9101L,
        new InventoryDtos.CreateStockCountSessionRequest(
            TestFixtures.OUTLET_HCM_1,
            LocalDate.parse("2026-04-11"),
            "Cycle count",
            List.of(new InventoryDtos.StockCountLineRequest(
                ITEM_ID,
                new BigDecimal("8.0000"),
                "Manual count"))),
        null);

    assertEquals("draft", session.status());
    assertEquals(1, session.lines().size());
    assertEquals(0, new BigDecimal("12.5000").compareTo(session.lines().get(0).systemQty()));
    assertEquals(0, new BigDecimal("-4.5000").compareTo(session.lines().get(0).varianceQty()));
  }

  @Test
  void postStockCountSessionWritesAdjustmentAndUpdatesStockBalance() {
    repository.createStockCountSession(
        9102L,
        new InventoryDtos.CreateStockCountSessionRequest(
            TestFixtures.OUTLET_HCM_1,
            LocalDate.parse("2026-04-11"),
            "Cycle count",
            List.of(new InventoryDtos.StockCountLineRequest(
                ITEM_ID,
                new BigDecimal("9.0000"),
                "Manual count"))),
        null);

    InventoryDtos.StockCountSessionView posted = repository.postStockCountSession(9102L, null);

    assertEquals("posted", posted.status());
    assertQuantity(new BigDecimal("9.0000"));
    com.fern.common.spring.web.PagedResult<InventoryDtos.InventoryTransactionView> txns =
        repository.listTransactions(
            TestFixtures.OUTLET_HCM_1,
            ITEM_ID,
            LocalDate.parse("2026-04-11"),
            LocalDate.parse("2026-04-11"),
            "stock_count",
            null,
            "txnTime",
            "desc",
            10,
            0);
    assertEquals(1, txns.items().size());
    assertEquals("stock_adjustment_out", txns.items().get(0).txnType());
  }

  @Test
  void applyOfflineStockInIsIdempotentBySourceEventId() {
    StockInSimpleRecordedEvent event = stockInEvent("stock-in-1", new BigDecimal("4.0000"));

    InventoryRepository.OfflineStockInResult first =
        repository.applyOfflineStockIn(event, Instant.parse("2026-04-12T10:00:00Z"));
    InventoryRepository.OfflineStockInResult duplicate =
        repository.applyOfflineStockIn(event, Instant.parse("2026-04-12T10:01:00Z"));

    assertEquals("APPLIED", first.status());
    assertFalse(first.duplicate());
    assertEquals("APPLIED", duplicate.status());
    assertTrue(duplicate.duplicate());
    assertEquals(first.inventoryTransactionId(), duplicate.inventoryTransactionId());
    assertQuantity(new BigDecimal("16.5000"));
  }

  @Test
  void applyOfflineStockInRejectsInvalidQuantityWithoutChangingStock() {
    StockInSimpleRecordedEvent event = stockInEvent(
        "stock-in-bad",
        new BigDecimal("1.0000"),
        "UNSUPPORTED_STOCK_IN",
        "Received while offline");

    InventoryRepository.OfflineStockInResult result =
        repository.applyOfflineStockIn(event, Instant.parse("2026-04-12T10:00:00Z"));

    assertEquals("REJECTED", result.status());
    assertTrue(result.rejectedReason().contains("unsupported"));
    assertQuantity(new BigDecimal("12.5000"));
  }

  @Test
  void applyOfflineWasteIsIdempotentAndWritesWasteRecord() throws Exception {
    OfflineInventoryMovementRecordedEvent event = wasteEvent("waste-1", new BigDecimal("1.2500"));

    InventoryRepository.OfflineInventoryMovementResult first =
        repository.applyOfflineWaste(event, Instant.parse("2026-04-12T11:00:00Z"));
    InventoryRepository.OfflineInventoryMovementResult duplicate =
        repository.applyOfflineWaste(event, Instant.parse("2026-04-12T11:01:00Z"));

    assertEquals("APPLIED", first.status());
    assertFalse(first.duplicate());
    assertTrue(duplicate.duplicate());
    assertEquals(first.inventoryTransactionId(), duplicate.inventoryTransactionId());
    assertQuantity(new BigDecimal("11.2500"));
    assertEquals(1, countRows("core.waste_record"));
  }

  @Test
  void lowStockStateUsesConfiguredThreshold() {
    InventoryRepository.LowStockState state =
        repository.findLowStockState(TestFixtures.OUTLET_HCM_1, ITEM_ID).orElseThrow();

    assertTrue(state.isLow());
    assertEquals(0, new BigDecimal("15.0000").compareTo(state.reorderThreshold()));
  }

  @Test
  void listStockBalancesLowOnlyReturnsOnlyItemsAtOrBelowThreshold() {
    com.fern.common.spring.web.PagedResult<InventoryDtos.StockBalanceView> page =
        repository.listStockBalances(TestFixtures.OUTLET_HCM_1, true, null, "qtyOnHand", "asc", 50, 0);

    assertTrue(page.items().stream().anyMatch(item -> item.itemId() == ITEM_ID));
  }

  private StockInSimpleRecordedEvent stockInEvent(String sourceEventId, BigDecimal quantity) {
    return stockInEvent(sourceEventId, quantity, "STOCK_IN_SIMPLE", "Received while offline");
  }

  private StockInSimpleRecordedEvent stockInEvent(
      String sourceEventId,
      BigDecimal quantity,
      String type,
      String note
  ) {
    return new StockInSimpleRecordedEvent(
        sourceEventId,
        "idem-" + sourceEventId,
        type,
        TestFixtures.OUTLET_HCM_1,
        101L,
        501L,
        "REGISTER-A",
        null,
        "manager",
        ITEM_ID,
        "ITEM-9001",
        quantity,
        "EA",
        "EMERGENCY_RECEIPT",
        note,
        LocalDate.parse("2026-04-12"),
        Instant.parse("2026-04-12T10:00:00Z"),
        "POS_OFFLINE",
        true);
  }

  private void resetInventoryTables() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(
          """
          TRUNCATE TABLE
            core.offline_inventory_movement,
            core.inventory_adjustment,
            core.waste_record,
            core.goods_receipt_transaction,
            core.sale_item_transaction,
            core.inventory_transaction,
            core.stock_count_session,
            core.stock_balance,
            core.item
          CASCADE
          """);
    }
  }

  private OfflineInventoryMovementRecordedEvent wasteEvent(String sourceEventId, BigDecimal quantity) {
    return new OfflineInventoryMovementRecordedEvent(
        sourceEventId,
        "idem-" + sourceEventId,
        "WASTE",
        TestFixtures.OUTLET_HCM_1,
        101L,
        501L,
        "REGISTER-A",
        null,
        "manager",
        ITEM_ID,
        "ITEM-9001",
        quantity,
        "EA",
        null,
        "SPILL",
        "Dropped during prep",
        LocalDate.parse("2026-04-12"),
        Instant.parse("2026-04-12T11:00:00Z"),
        "POS_OFFLINE",
        true);
  }

  private void insertInventoryTransaction(long id, BigDecimal qty, String txnType, String note) throws Exception {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             INSERT INTO core.inventory_transaction (
               id, outlet_id, item_id, qty_change, business_date, txn_time, txn_type, unit_cost, note
             ) VALUES (?, ?, ?, ?, ?, ?, ?::inventory_txn_type_enum, ?, ?)
             """)) {
      ps.setLong(1, id);
      ps.setLong(2, TestFixtures.OUTLET_HCM_1);
      ps.setLong(3, ITEM_ID);
      ps.setBigDecimal(4, qty);
      ps.setObject(5, LocalDate.parse("2026-04-10"));
      ps.setTimestamp(6, Timestamp.from(Instant.parse("2026-04-10T08:00:00Z")));
      ps.setString(7, txnType);
      ps.setBigDecimal(8, new BigDecimal("3.50"));
      ps.setString(9, note);
      ps.executeUpdate();
    }
  }

  private void assertQuantity(BigDecimal expected) {
    assertEquals(0, expected.compareTo(currentQuantity()));
  }

  private BigDecimal currentQuantity() {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             SELECT qty_on_hand
             FROM core.stock_balance
             WHERE location_id = ? AND item_id = ?
             """)) {
      ps.setLong(1, TestFixtures.OUTLET_HCM_1);
      ps.setLong(2, ITEM_ID);
      try (ResultSet rs = ps.executeQuery()) {
        assertTrue(rs.next());
        return rs.getBigDecimal("qty_on_hand");
      }
    } catch (Exception e) {
      throw new IllegalStateException("Failed to read stock quantity", e);
    }
  }

  private int countRows(String tableName) throws Exception {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM " + tableName);
         ResultSet rs = ps.executeQuery()) {
      assertTrue(rs.next());
      return rs.getInt(1);
    }
  }
}
