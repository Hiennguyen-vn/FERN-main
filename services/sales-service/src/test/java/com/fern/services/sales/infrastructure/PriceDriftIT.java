package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.*;

import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sales.api.SalesDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(PostgresContainerExtension.class)
class PriceDriftIT {

  private static final long PRODUCT_ID = 9711L;
  private static final long ITEM_ID = 9811L;

  private DataSource dataSource;
  private SalesRepository repository;

  @BeforeEach
  void setUp() throws Exception {
    dataSource = PostgresContainerExtension.dataSource();
    TestFixtures.seedBaseline(dataSource);
    repository = new SalesRepository(
        dataSource,
        new SnowflakeIdGenerator(7L),
        Clock.fixed(Instant.parse("2026-04-27T08:00:00Z"), ZoneOffset.UTC));
    seedProduct(new BigDecimal("35000.00"));
  }

  @Test
  void noLegacyFlagWhenPricesMatch() throws Exception {
    long saleId = createApprovedSale(new BigDecimal("35000.00"));
    int flagged = repository.markPriceDrift(saleId);
    assertEquals(0, flagged);
    assertFalse(legacyFlagSet(saleId));
  }

  @Test
  void flagsLegacyAndComputesDriftWhenPriceChanged() throws Exception {
    long saleId = createApprovedSale(new BigDecimal("30000.00")); // edge submitted stale
    bumpPrice(new BigDecimal("35000.00"));

    int flagged = repository.markPriceDrift(saleId);
    assertEquals(1, flagged);

    BigDecimal drift = readDrift(saleId);
    assertEquals(0, drift.compareTo(new BigDecimal("5000.00")));

    // Idempotent: re-running shouldn't re-flag.
    int second = repository.markPriceDrift(saleId);
    assertEquals(0, second);
  }

  @Test
  void reportListsFlaggedSale() throws Exception {
    long saleId = createApprovedSale(new BigDecimal("28000.00"));
    bumpPrice(new BigDecimal("35000.00"));
    repository.markPriceDrift(saleId);

    var rows = repository.reportPriceDrift(
        List.of(TestFixtures.OUTLET_HCM_1),
        Instant.parse("2026-04-26T00:00:00Z"),
        Instant.parse("2026-04-30T00:00:00Z"),
        100);
    assertEquals(1, rows.size());
    assertEquals(saleId, rows.get(0).get("saleId"));
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private long createApprovedSale(BigDecimal unitPrice) throws Exception {
    SalesDtos.PosSessionView session = repository.openPosSession(new SalesDtos.OpenPosSessionRequest(
        "SHIFT-DRIFT-" + System.nanoTime(),
        TestFixtures.OUTLET_HCM_1,
        "USD",
        null, null,
        "REGISTER-DRIFT",
        "cashier-drift",
        LocalDate.parse("2026-04-27"),
        null));
    SalesDtos.SaleView created = repository.submitSale(new SalesDtos.SubmitSaleRequest(
        TestFixtures.OUTLET_HCM_1,
        Long.parseLong(session.id()),
        "USD",
        "dine_in",
        "drift test",
        List.of(new SalesDtos.SaleLineRequest(
            PRODUCT_ID,
            new BigDecimal("1.0000"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            null,
            Set.of(),
            null, null, null)),
        null));
    long saleId = Long.parseLong(created.id());
    // Force the unit_price to the test value (submitSale resolved live price; we override post-hoc).
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             "UPDATE core.sale_item SET unit_price = ? WHERE sale_id = ?")) {
      ps.setBigDecimal(1, unitPrice);
      ps.setLong(2, saleId);
      ps.executeUpdate();
    }
    repository.approveSale(saleId, TestFixtures.USER_MANAGER_HCM, true);
    return saleId;
  }

  private void seedProduct(BigDecimal price) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("SET search_path TO core, public");
      st.execute("INSERT INTO core.product_category (code, name) VALUES ('MENU', 'Menu') ON CONFLICT DO NOTHING");
      st.execute("INSERT INTO core.item_category (code, name) VALUES ('INGREDIENT', 'Ingredient') ON CONFLICT DO NOTHING");
      st.execute("INSERT INTO core.unit_of_measure (code, name) VALUES ('EA', 'Each') ON CONFLICT DO NOTHING");
      st.execute(String.format(
          "INSERT INTO core.item (id, code, name, category_code, base_uom_code, min_stock_level, status) "
          + "VALUES (%d, 'IT-DRIFT', 'Drift item', 'INGREDIENT', 'EA', 1.0, 'active') ON CONFLICT DO NOTHING",
          ITEM_ID));
      st.execute(String.format(
          "INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost) "
          + "VALUES (%d, %d, 100, 1) ON CONFLICT (location_id, item_id) DO UPDATE SET qty_on_hand = 100",
          TestFixtures.OUTLET_HCM_1, ITEM_ID));
      st.execute(String.format(
          "INSERT INTO core.product (id, code, name, category_code, status) "
          + "VALUES (%d, 'PD-DRIFT', 'Drift Latte', 'MENU', 'active') ON CONFLICT DO NOTHING",
          PRODUCT_ID));
      st.execute(String.format(
          "INSERT INTO core.recipe (product_id, version, yield_qty, yield_uom_code, status) "
          + "VALUES (%d, 'v1', 1, 'EA', 'active') ON CONFLICT DO NOTHING", PRODUCT_ID));
      st.execute(String.format(
          "INSERT INTO core.recipe_item (product_id, version, item_id, uom_code, qty) "
          + "VALUES (%d, 'v1', %d, 'EA', 1) ON CONFLICT DO NOTHING", PRODUCT_ID, ITEM_ID));
      st.execute(String.format(
          "INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available) "
          + "VALUES (%d, %d, TRUE) ON CONFLICT DO NOTHING", PRODUCT_ID, TestFixtures.OUTLET_HCM_1));
      try (var ps = conn.prepareStatement(
          "INSERT INTO core.product_price (product_id, outlet_id, currency_code, price_value, effective_from) "
          + "VALUES (?, ?, 'USD', ?, '2026-01-01') ON CONFLICT (product_id, outlet_id, effective_from) DO UPDATE SET price_value = EXCLUDED.price_value")) {
        ps.setLong(1, PRODUCT_ID);
        ps.setLong(2, TestFixtures.OUTLET_HCM_1);
        ps.setBigDecimal(3, price);
        ps.executeUpdate();
      }
    }
  }

  private void bumpPrice(BigDecimal newPrice) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             "UPDATE core.product_price SET price_value = ?, updated_at = NOW() "
             + "WHERE product_id = ? AND outlet_id = ?")) {
      ps.setBigDecimal(1, newPrice);
      ps.setLong(2, PRODUCT_ID);
      ps.setLong(3, TestFixtures.OUTLET_HCM_1);
      ps.executeUpdate();
    }
  }

  private boolean legacyFlagSet(long saleId) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             "SELECT legacy_price FROM core.sale_item WHERE sale_id = ?")) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) return false;
        return rs.getBoolean(1);
      }
    }
  }

  private BigDecimal readDrift(long saleId) throws Exception {
    try (Connection conn = dataSource.getConnection();
         var ps = conn.prepareStatement(
             "SELECT price_drift_amount FROM core.sale_item WHERE sale_id = ?")) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getBigDecimal(1);
      }
    }
  }
}
