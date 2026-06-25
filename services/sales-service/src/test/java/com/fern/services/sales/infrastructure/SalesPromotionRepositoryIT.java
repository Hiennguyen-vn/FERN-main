package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.common.sync.CentralSyncOutboxWriter;
import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sales.api.PublicPosDtos;
import com.fern.services.sales.api.SalesDtos;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(PostgresContainerExtension.class)
class SalesPromotionRepositoryIT {

  private static final long PRODUCT_COFFEE = 9501L;
  private static final long PRODUCT_CAKE = 9502L;

  private DataSource dataSource;
  private SalesPromotionRepository promotionRepository;
  private SalesRepository salesRepository;

  @BeforeEach
  void setUp() throws Exception {
    dataSource = PostgresContainerExtension.dataSource();
    TestFixtures.seedBaseline(dataSource);
    resetSalesTables();
    seedProductsAndPublicTable();
    SnowflakeIdGenerator idGenerator = new SnowflakeIdGenerator(2L);
    Clock fixedClock = Clock.fixed(Instant.parse("2026-04-15T08:00:00Z"), ZoneOffset.UTC);
    promotionRepository = new SalesPromotionRepository(
        dataSource,
        idGenerator,
        fixedClock,
        new CentralSyncOutboxWriter(new ObjectMapper().findAndRegisterModules()));
    salesRepository = new SalesRepository(dataSource, idGenerator, fixedClock);
  }

  @Test
  void createPromotionPersistsAndLoadsBxgyRule() throws Exception {
    SalesDtos.PromotionView created = promotionRepository.createPromotion(new SalesDtos.CreatePromotionRequest(
        "Buy coffee get cake",
        "buy_x_get_y",
        null,
        null,
        BigDecimal.ZERO,
        null,
        Instant.parse("2026-04-01T00:00:00Z"),
        null,
        Set.of(TestFixtures.OUTLET_HCM_1),
        new SalesDtos.PromotionBxgyRule(
            PRODUCT_COFFEE,
            new BigDecimal("2.0000"),
            PRODUCT_CAKE,
            BigDecimal.ONE,
            new BigDecimal("100.0000")),
        null,
        null));

    SalesDtos.PromotionView found = promotionRepository.findPromotion(Long.parseLong(created.id())).orElseThrow();

    assertEquals("buy_x_get_y", found.promoType());
    assertEquals(Set.of(TestFixtures.OUTLET_HCM_1), found.outletIds());
    assertNotNull(found.bxgyRule());
    assertEquals(PRODUCT_COFFEE, found.bxgyRule().buyProductId());
    assertEquals(PRODUCT_CAKE, found.bxgyRule().getProductId());
    assertEquals(1, countCentralOutbox("PROMOTION_UPDATED", created.id()));
  }

  @Test
  void updatePromotionReplacesTypedRuleTablesWhenTypeChanges() {
    SalesDtos.PromotionView created = promotionRepository.createPromotion(new SalesDtos.CreatePromotionRequest(
        "Old Bxgy",
        "buy_x_get_y",
        null,
        null,
        BigDecimal.ZERO,
        null,
        Instant.parse("2026-04-01T00:00:00Z"),
        null,
        Set.of(TestFixtures.OUTLET_HCM_1),
        new SalesDtos.PromotionBxgyRule(
            PRODUCT_COFFEE,
            BigDecimal.ONE,
            PRODUCT_CAKE,
            BigDecimal.ONE,
            new BigDecimal("100.0000")),
        null,
        null));

    SalesDtos.PromotionView updated = promotionRepository.updatePromotion(
        Long.parseLong(created.id()),
        new SalesDtos.UpdatePromotionRequest(
            "Combo",
            "combo_price",
            null,
            null,
            BigDecimal.ZERO,
            null,
            null,
            null,
            "active",
            Set.of(TestFixtures.OUTLET_HCM_1),
            null,
            new SalesDtos.PromotionComboRule(
                new BigDecimal("45000.00"),
                List.of(
                    new SalesDtos.PromotionComboRuleItem(PRODUCT_COFFEE, BigDecimal.ONE),
                    new SalesDtos.PromotionComboRuleItem(PRODUCT_CAKE, BigDecimal.ONE))),
            null));

    assertEquals("combo_price", updated.promoType());
    assertEquals(null, updated.bxgyRule());
    assertNotNull(updated.comboRule());
    assertEquals(2, updated.comboRule().items().size());
    assertEquals(0, new BigDecimal("45000.00").compareTo(updated.comboRule().comboPrice()));
  }

  @Test
  void createPromotionPersistsSubsidyRule() {
    SalesDtos.PromotionView created = promotionRepository.createPromotion(new SalesDtos.CreatePromotionRequest(
        "Partner subsidy",
        "subsidy",
        new BigDecimal("5000.00"),
        null,
        BigDecimal.ZERO,
        null,
        Instant.parse("2026-04-01T00:00:00Z"),
        null,
        Set.of(TestFixtures.OUTLET_HCM_1),
        null,
        null,
        new SalesDtos.PromotionSubsidyRule(PRODUCT_COFFEE, "partner", "MKT-2026")));

    SalesDtos.PromotionView found = promotionRepository.findPromotion(Long.parseLong(created.id())).orElseThrow();

    assertEquals("subsidy", found.promoType());
    assertNotNull(found.subsidyRule());
    assertEquals(PRODUCT_COFFEE, found.subsidyRule().scopeProductId());
    assertEquals("partner", found.subsidyRule().fundingSource());
  }

  @Test
  void publicOrderDiscountPersistsSaleItemPromotionLink() throws Exception {
    SalesDtos.PromotionView promotion = promotionRepository.createPromotion(new SalesDtos.CreatePromotionRequest(
        "Coffee discount",
        "fixed_amount",
        new BigDecimal("5000.00"),
        null,
        BigDecimal.ZERO,
        null,
        Instant.parse("2026-04-01T00:00:00Z"),
        null,
        Set.of(TestFixtures.OUTLET_HCM_1)));
    SalesRepository.PublicOrderingTableRecord table =
        salesRepository.findPublicOrderingTable("pub-table-1").orElseThrow();

    SalesRepository.CreatedPublicOrder order = salesRepository.submitPublicOrder(
        table,
        new PublicPosDtos.CreatePublicOrderRequest(
            List.of(new PublicPosDtos.PublicOrderLineRequest(
                Long.toString(PRODUCT_COFFEE),
                BigDecimal.ONE,
                null)),
            null),
        LocalDate.parse("2026-04-15"),
        Map.of(PRODUCT_COFFEE, new BigDecimal("5000.00")),
        Long.parseLong(promotion.id()));

    long saleId = Long.parseLong(order.sale().id());
    assertEquals(0, new BigDecimal("5000.00").compareTo(order.sale().discount()));
    assertEquals(1, countSaleItemPromotionLinks(saleId, PRODUCT_COFFEE, Long.parseLong(promotion.id())));
  }

  private void resetSalesTables() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(
          """
          TRUNCATE TABLE
            core.sale_item_promotion,
            core.central_outbox,
            core.sale_record,
            core.promotion,
            core.ordering_table,
            core.product_price,
            core.product_outlet_availability,
            core.product
          CASCADE
          """);
    }
  }

  private void seedProductsAndPublicTable() throws Exception {
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
          VALUES
            (%d, 'COFFEE', 'Coffee', 'MENU', 'active'),
            (%d, 'CAKE', 'Cake', 'MENU', 'active')
          ON CONFLICT (id) DO NOTHING
          """, PRODUCT_COFFEE, PRODUCT_CAKE));
      st.execute(String.format("""
          INSERT INTO core.product_outlet_availability (product_id, outlet_id, is_available)
          VALUES
            (%d, %d, TRUE),
            (%d, %d, TRUE)
          ON CONFLICT (product_id, outlet_id) DO UPDATE SET is_available = EXCLUDED.is_available
          """, PRODUCT_COFFEE, TestFixtures.OUTLET_HCM_1, PRODUCT_CAKE, TestFixtures.OUTLET_HCM_1));
      st.execute(String.format("""
          INSERT INTO core.product_price (product_id, outlet_id, currency_code, price_value, effective_from)
          VALUES
            (%d, %d, 'USD', 35000.00, '2026-01-01'),
            (%d, %d, 'USD', 20000.00, '2026-01-01')
          ON CONFLICT (product_id, outlet_id, effective_from) DO NOTHING
          """, PRODUCT_COFFEE, TestFixtures.OUTLET_HCM_1, PRODUCT_CAKE, TestFixtures.OUTLET_HCM_1));
      st.execute(String.format("""
          INSERT INTO core.ordering_table (id, outlet_id, table_code, display_name, public_token, status)
          VALUES (9901, %d, 'T1', 'Table 1', 'pub-table-1', 'active')
          ON CONFLICT (id) DO NOTHING
          """, TestFixtures.OUTLET_HCM_1));
    }
  }

  private int countSaleItemPromotionLinks(long saleId, long productId, long promotionId) throws Exception {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             SELECT COUNT(*)
             FROM core.sale_item_promotion
             WHERE sale_id = ? AND product_id = ? AND promotion_id = ?
             """)) {
      ps.setLong(1, saleId);
      ps.setLong(2, productId);
      ps.setLong(3, promotionId);
      try (ResultSet rs = ps.executeQuery()) {
        assertTrue(rs.next());
        return rs.getInt(1);
      }
    }
  }

  private int countCentralOutbox(String eventType, String aggregateId) throws Exception {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             SELECT COUNT(*)
             FROM core.central_outbox
             WHERE event_type = ? AND aggregate_id = ?
             """)) {
      ps.setString(1, eventType);
      ps.setString(2, aggregateId);
      try (ResultSet rs = ps.executeQuery()) {
        assertTrue(rs.next());
        return rs.getInt(1);
      }
    }
  }
}
