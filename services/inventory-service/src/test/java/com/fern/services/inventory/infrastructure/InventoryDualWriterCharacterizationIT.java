package com.fern.services.inventory.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.events.sales.SaleApprovedEvent;
import com.fern.events.sales.SaleCompletedLineItem;
import com.fern.services.inventory.application.InventoryService;
import com.fern.services.inventory.application.StockReservationService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * Characterization tests for the inventory dual-writer scenario.
 *
 * These tests pin the CURRENT behavior (not desired behavior) so that any
 * future refactoring toward single-writer can be validated against a known
 * baseline. They exercise:
 *
 * 1. Simple sale (no modifier) — dedup via sale_item_transaction works.
 * 2. Modifier effects (MULTIPLY, SCALE_ITEM, SUBSTITUTE, ADD) — inventory-service
 *    applies modifier-aware deduction correctly.
 * 3. Replay idempotency — same event processed twice yields no extra rows.
 * 4. Pre-existing sale_item_transaction rows (simulating sales-service wrote first)
 *    — inventory-service consumer skips those items.
 *
 * NOTE: These tests do NOT modify production logic. They only observe and pin.
 */
@ExtendWith(PostgresContainerExtension.class)
@DisplayName("Inventory Dual-Writer Characterization")
class InventoryDualWriterCharacterizationIT {

  // ─── Constants ──────────────────────────────────────────────────────────────

  private static final long OUTLET_ID = TestFixtures.OUTLET_HCM_1;
  private static final long USER_ID = TestFixtures.USER_MANAGER_HCM;

  // Items (raw ingredients)
  private static final long ITEM_COFFEE = 8001L;
  private static final long ITEM_MILK = 8002L;
  private static final long ITEM_SUGAR = 8003L;
  private static final long ITEM_TAPIOCA = 8004L;  // topping

  // Products (finished beverages)
  private static final long PRODUCT_LATTE = 8101L;

  // Modifier options
  private static final long MOD_EXTRA_SUGAR = 8201L;
  private static final long MOD_NO_SUGAR = 8202L;
  private static final long MOD_ADD_TAPIOCA = 8203L;
  private static final long MOD_DOUBLE_SHOT = 8204L;
  private static final long MOD_SUB_OAT_MILK = 8205L;

  // Substitute ingredient for oat milk
  private static final long ITEM_OAT_MILK = 8005L;

  private static final LocalDate BIZ_DATE = LocalDate.parse("2026-05-01");
  private static final Instant SALE_CREATED = Instant.parse("2026-05-01T08:00:00Z");
  private static final Instant APPROVE_TIME = Instant.parse("2026-05-01T08:05:00Z");

  private static final Clock FIXED_CLOCK = Clock.fixed(APPROVE_TIME, ZoneOffset.UTC);

  private DataSource dataSource;
  private InventoryRepository repository;
  private InventoryService service;

  @BeforeEach
  void setUp() throws Exception {
    dataSource = PostgresContainerExtension.dataSource();
    TestFixtures.seedBaseline(dataSource);
    resetTables();
    seedReferenceData();

    SnowflakeIdGenerator idGen = new SnowflakeIdGenerator(1L);
    var outboxWriter = new com.fern.common.outbox.OutboxWriter(
        new com.fasterxml.jackson.databind.ObjectMapper(), idGen::generateId);
    repository = new InventoryRepository(dataSource, idGen, outboxWriter, FIXED_CLOCK);
    var lotRepo = new InventoryLotRepository(dataSource, idGen);
    var stockBalanceRepo = new StockBalanceRepository(dataSource);
    var reservationService = new StockReservationService(dataSource, idGen, FIXED_CLOCK);
    service = new InventoryService(
        repository, lotRepo, stockBalanceRepo,
        null, // authorizationPolicyService not needed for applySaleApproved
        idGen, FIXED_CLOCK, reservationService);
  }

  // ─── Test Group 1: Simple sale without modifiers ─────────────────────────────

  @Nested
  @DisplayName("1. Simple sale (no modifier)")
  class SimpleSale {

    @Test
    @DisplayName("applySaleApproved deducts correct qty based on recipe")
    void deductsCorrectQtyFromRecipe() {
      // Latte recipe: 20g coffee + 200ml milk + 10g sugar per 1 cup yield
      // Order: 2 cups → expect -40g coffee, -400ml milk, -20g sugar
      long saleId = 9001L;
      seedSaleRecord(saleId);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 2);
      int inserted = service.applySaleApproved(event);

      assertEquals(3, inserted); // 3 items deducted
      assertStockQty(ITEM_COFFEE, bd("960.0000"));  // 1000 - 40
      assertStockQty(ITEM_MILK, bd("600.0000"));    // 1000 - 400
      assertStockQty(ITEM_SUGAR, bd("980.0000"));   // 1000 - 20
    }

    @Test
    @DisplayName("Replay same event yields 0 new inserts (idempotent)")
    void replayIsIdempotent() {
      long saleId = 9002L;
      seedSaleRecord(saleId);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int first = service.applySaleApproved(event);
      int replay = service.applySaleApproved(event);

      assertEquals(3, first);  // coffee + milk + sugar
      assertEquals(0, replay); // all skipped
      assertStockQty(ITEM_COFFEE, bd("980.0000"));  // 1000 - 20
      assertStockQty(ITEM_MILK, bd("800.0000"));    // 1000 - 200
      assertStockQty(ITEM_SUGAR, bd("990.0000"));   // 1000 - 10
    }

    @Test
    @DisplayName("Pre-existing sale_item_transaction rows are skipped")
    void preExistingRowsSkipped() throws Exception {
      // Simulate sales-service having already written the coffee deduction
      // (the pre-existing inventory_transaction also triggers stock_balance via trigger)
      long saleId = 9003L;
      seedSaleRecord(saleId);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_COFFEE);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      // Only milk + sugar should be inserted (coffee already exists)
      assertEquals(2, inserted);
      // Coffee was deducted by the pre-existing inventory_transaction (-1.0000 via trigger)
      assertStockQty(ITEM_COFFEE, bd("999.0000"));
      // Milk and sugar deducted normally by consumer
      assertStockQty(ITEM_MILK, bd("800.0000"));
      assertStockQty(ITEM_SUGAR, bd("990.0000"));
    }
  }

  // ─── Test Group 2: Modifier effects ──────────────────────────────────────────

  @Nested
  @DisplayName("2. Modifier-aware deduction")
  class ModifierEffects {

    @Test
    @DisplayName("MULTIPLY effect scales all ingredients")
    void multiplyScalesAll() {
      // MOD_DOUBLE_SHOT: MULTIPLY × 2.0 on all ingredients
      // 1 cup latte with double shot → coffee 20×2=40g, milk 200×2=400ml, sugar 10×2=20g
      long saleId = 9010L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_DOUBLE_SHOT);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      assertEquals(3, inserted);
      assertStockQty(ITEM_COFFEE, bd("960.0000"));  // 1000 - 40
      assertStockQty(ITEM_MILK, bd("600.0000"));    // 1000 - 400
      assertStockQty(ITEM_SUGAR, bd("980.0000"));   // 1000 - 20
    }

    @Test
    @DisplayName("SCALE_ITEM effect scales only target ingredient")
    void scaleItemScalesTarget() {
      // MOD_EXTRA_SUGAR: SCALE_ITEM on ITEM_SUGAR × 1.5
      // 1 cup latte → coffee 20g, milk 200ml, sugar 10×1.5=15g
      long saleId = 9011L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_EXTRA_SUGAR);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      assertEquals(3, inserted); // coffee + milk + sugar
      assertStockQty(ITEM_COFFEE, bd("980.0000"));  // 1000 - 20
      assertStockQty(ITEM_MILK, bd("800.0000"));    // 1000 - 200
      assertStockQty(ITEM_SUGAR, bd("985.0000"));   // 1000 - 15
    }

    @Test
    @DisplayName("SUBSTITUTE replaces ingredient")
    void substituteReplacesIngredient() {
      // MOD_SUB_OAT_MILK: SUBSTITUTE milk → oat_milk
      // 1 cup latte → coffee 20g, oat_milk 200ml (milk untouched), sugar 10g
      long saleId = 9012L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_SUB_OAT_MILK);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      assertEquals(3, inserted); // coffee + oat_milk + sugar
      assertStockQty(ITEM_COFFEE, bd("980.0000"));    // 1000 - 20
      assertStockQty(ITEM_MILK, bd("1000.0000"));     // untouched
      assertStockQty(ITEM_OAT_MILK, bd("800.0000"));  // 1000 - 200
      assertStockQty(ITEM_SUGAR, bd("990.0000"));     // 1000 - 10
    }

    @Test
    @DisplayName("ADD effect adds extra ingredient")
    void addEffectAddsIngredient() {
      // MOD_ADD_TAPIOCA: ADD 30g tapioca per cup
      // 1 cup latte → coffee 20g, milk 200ml, sugar 10g, tapioca 30g
      long saleId = 9013L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_ADD_TAPIOCA);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      assertEquals(4, inserted); // coffee + milk + sugar + tapioca
      assertStockQty(ITEM_COFFEE, bd("980.0000"));    // 1000 - 20
      assertStockQty(ITEM_MILK, bd("800.0000"));      // 1000 - 200
      assertStockQty(ITEM_SUGAR, bd("990.0000"));     // 1000 - 10
      assertStockQty(ITEM_TAPIOCA, bd("970.0000"));   // 1000 - 30
    }
  }

  // ─── Test Group 3: Dual-writer conflict characterization ─────────────────────

  @Nested
  @DisplayName("3. Dual-writer conflict (sales wrote first, inventory consumer follows)")
  class DualWriterConflict {

    @Test
    @DisplayName("When sales-service pre-wrote base recipe (no modifier), consumer skips all")
    void salesPreWroteBaseRecipe_consumerSkipsAll() throws Exception {
      long saleId = 9020L;
      seedSaleRecord(saleId);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_COFFEE);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_MILK);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_SUGAR);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      assertEquals(0, inserted);
    }

    @Test
    @DisplayName("When sales pre-wrote base recipe but modifier adds new ingredient, consumer adds it")
    void salesPreWroteBase_modifierAddsNewIngredient() throws Exception {
      // Sales wrote coffee + milk + sugar (base recipe, no modifier awareness).
      // Modifier ADD_TAPIOCA adds tapioca — sales didn't write that.
      // Consumer should: skip coffee, skip milk, skip sugar, INSERT tapioca.
      long saleId = 9021L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_ADD_TAPIOCA);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_COFFEE);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_MILK);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_SUGAR);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      // Only tapioca is new (coffee/milk/sugar already exist)
      assertEquals(1, inserted);
      assertStockQty(ITEM_TAPIOCA, bd("970.0000")); // 1000 - 30
    }

    @Test
    @DisplayName("When sales pre-wrote base recipe but SUBSTITUTE replaces milk, consumer adds substitute only")
    void salesPreWroteBase_substituteAddsNewIngredient() throws Exception {
      // Sales wrote coffee + milk + sugar (base recipe, no modifier awareness).
      // Modifier SUBSTITUTE milk→oat_milk means consumer's plan is:
      //   coffee + oat_milk + sugar (milk removed from plan by SUBSTITUTE).
      // Pre-existing: coffee→skip, milk (not in plan→irrelevant), sugar→skip.
      // Only oat_milk is new → insert.
      // This characterizes the BUG: milk was deducted by sales (shouldn't have been
      // with substitute), and oat_milk gets added by consumer.
      long saleId = 9022L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_SUB_OAT_MILK);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_COFFEE);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_MILK);
      insertPreExistingSaleItemTransaction(saleId, PRODUCT_LATTE, ITEM_SUGAR);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      // Consumer's plan: coffee(skip) + oat_milk(new) + sugar(skip). milk not in plan.
      assertEquals(1, inserted);
      assertStockQty(ITEM_OAT_MILK, bd("800.0000")); // 1000 - 200
      // NOTE: In the dual-writer world, milk was ALSO deducted by sales-service
      // (which doesn't know about the substitute). This test pins that behavior.
      // After single-writer refactor, milk should NOT be deducted at all.
    }
  }

  // ─── Test Group 4: NO_SUGAR modifier (SCALE_ITEM × 0) ───────────────────────

  @Nested
  @DisplayName("4. NO_SUGAR modifier (SCALE_ITEM × 0 removes sugar)")
  class NoSugarModifier {

    @Test
    @DisplayName("NO_SUGAR zeroes out sugar deduction")
    void noSugarZeroesOutSugar() {
      // MOD_NO_SUGAR: SCALE_ITEM on ITEM_SUGAR × 0.0
      // 1 cup latte → coffee 20g, milk 200ml, sugar 10×0=0 (not deducted)
      long saleId = 9030L;
      seedSaleRecord(saleId);
      seedSaleItemModifier(saleId, PRODUCT_LATTE, MOD_NO_SUGAR);

      SaleApprovedEvent event = saleApprovedEvent(saleId, 1);
      int inserted = service.applySaleApproved(event);

      // Sugar qty becomes 0 → signum check skips it → only coffee + milk
      assertEquals(2, inserted);
      assertStockQty(ITEM_COFFEE, bd("980.0000"));  // 1000 - 20
      assertStockQty(ITEM_MILK, bd("800.0000"));    // 1000 - 200
      assertStockQty(ITEM_SUGAR, bd("1000.0000"));  // untouched
    }
  }

  // ─── Helper methods ─────────────────────────────────────────────────────────

  private SaleApprovedEvent saleApprovedEvent(long saleId, int qty) {
    return new SaleApprovedEvent(
        saleId,
        OUTLET_ID,
        BIZ_DATE,
        SALE_CREATED,
        USER_ID,
        false,
        false,
        List.of(new SaleCompletedLineItem(
            PRODUCT_LATTE,
            new BigDecimal(qty),
            bd("50000"),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            bd("50000").multiply(new BigDecimal(qty))
        )),
        APPROVE_TIME
    );
  }

  private void seedSaleRecord(long saleId) {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute(String.format("""
          INSERT INTO core.sale_record (
            id, outlet_id, currency_code, order_type, status, payment_status,
            subtotal, discount, tax_amount, total_amount, created_at, updated_at
          ) VALUES (
            %d, %d, 'USD', 'dine_in', 'order_approved', 'unpaid',
            50000, 0, 0, 50000, TIMESTAMPTZ '%s', TIMESTAMPTZ '%s'
          )
          """, saleId, OUTLET_ID, SALE_CREATED, SALE_CREATED));
      // sale_item row needed for FK from sale_item_modifier and sale_item_transaction
      st.execute(String.format("""
          INSERT INTO core.sale_item (
            sale_id, sale_created_at, outlet_id, product_id, unit_price, qty,
            discount_amount, tax_amount, line_total, created_at, updated_at
          ) VALUES (
            %d, TIMESTAMPTZ '%s', %d, %d, 50000, 1.0000,
            0, 0, 50000, TIMESTAMPTZ '%s', TIMESTAMPTZ '%s'
          )
          """, saleId, SALE_CREATED, OUTLET_ID, PRODUCT_LATTE, SALE_CREATED, SALE_CREATED));
    } catch (Exception e) {
      throw new IllegalStateException("seedSaleRecord", e);
    }
  }

  private void seedSaleItemModifier(long saleId, long productId, long modifierOptionId) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("""
             INSERT INTO core.sale_item_modifier (sale_id, sale_created_at, product_id, modifier_option_id)
             VALUES (?, ?, ?, ?)
             """)) {
      ps.setLong(1, saleId);
      ps.setTimestamp(2, Timestamp.from(SALE_CREATED));
      ps.setLong(3, productId);
      ps.setLong(4, modifierOptionId);
      ps.executeUpdate();
    } catch (Exception e) {
      throw new IllegalStateException("seedSaleItemModifier", e);
    }
  }

  private void insertPreExistingSaleItemTransaction(
      long saleId, long productId, long itemId
  ) throws Exception {
    // Simulates what sales-service writes synchronously during approveSale.
    // Must also insert a dummy inventory_transaction row (FK fk_sale_item_txn).
    long txnId = 70000L + saleId * 100 + itemId;
    try (Connection conn = dataSource.getConnection()) {
      try (PreparedStatement ps = conn.prepareStatement("""
               INSERT INTO core.inventory_transaction (
                 id, outlet_id, item_id, qty_change, business_date, txn_time,
                 txn_type, unit_cost, note
               ) VALUES (?, ?, ?, -1.0000, ?, ?, 'sale_usage'::inventory_txn_type_enum, 5.00, 'pre-existing')
               """)) {
        ps.setLong(1, txnId);
        ps.setLong(2, OUTLET_ID);
        ps.setLong(3, itemId);
        ps.setObject(4, BIZ_DATE);
        ps.setTimestamp(5, Timestamp.from(APPROVE_TIME));
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("""
               INSERT INTO core.sale_item_transaction (
                 inventory_transaction_id, sale_id, sale_created_at,
                 product_id, item_id, txn_time
               ) VALUES (?, ?, ?, ?, ?, ?)
               """)) {
        ps.setLong(1, txnId);
        ps.setLong(2, saleId);
        ps.setTimestamp(3, Timestamp.from(SALE_CREATED));
        ps.setLong(4, productId);
        ps.setLong(5, itemId);
        ps.setTimestamp(6, Timestamp.from(APPROVE_TIME));
        ps.executeUpdate();
      }
    }
  }

  private void assertStockQty(long itemId, BigDecimal expected) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             "SELECT qty_on_hand FROM core.stock_balance WHERE location_id = ? AND item_id = ?")) {
      ps.setLong(1, OUTLET_ID);
      ps.setLong(2, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        assertTrue(rs.next(), "stock_balance row must exist for item " + itemId);
        BigDecimal actual = rs.getBigDecimal("qty_on_hand");
        assertEquals(0, expected.compareTo(actual),
            "Expected qty " + expected + " but got " + actual + " for item " + itemId);
      }
    } catch (Exception e) {
      throw new IllegalStateException("assertStockQty item=" + itemId, e);
    }
  }

  private static BigDecimal bd(String v) {
    return new BigDecimal(v);
  }

  // ─── Data setup ─────────────────────────────────────────────────────────────

  private void resetTables() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("""
          TRUNCATE TABLE
            core.sale_item_modifier,
            core.modifier_recipe_effect,
            core.product_modifier_group,
            core.modifier_option,
            core.modifier_group,
            core.offline_inventory_movement,
            core.inventory_adjustment,
            core.waste_record,
            core.goods_receipt_transaction,
            core.sale_item_transaction,
            core.sale_item,
            core.sale_record,
            core.inventory_transaction,
            core.stock_count_session,
            core.stock_balance,
            core.recipe_item,
            core.recipe,
            core.product,
            core.item
          CASCADE
          """);
    }
  }

  /**
   * Seeds the full reference data needed for modifier-aware inventory tests:
   * - Items: coffee, milk, sugar, tapioca, oat_milk
   * - Product: latte
   * - Recipe: latte = 20g coffee + 200ml milk + 10g sugar (yield 1 cup)
   * - Modifier groups + options + recipe effects
   * - Stock balances: 1000 each
   */
  private void seedReferenceData() throws Exception {
    try (Connection conn = dataSource.getConnection();
         var st = conn.createStatement()) {
      st.execute("SET search_path TO core, public");

      // Categories + UoM
      st.execute("""
          INSERT INTO core.item_category (code, name) VALUES ('INGREDIENT', 'Ingredient')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute("""
          INSERT INTO core.product_category (code, name) VALUES ('BEVERAGE', 'Beverage')
          ON CONFLICT (code) DO NOTHING
          """);
      st.execute("""
          INSERT INTO core.unit_of_measure (code, name) VALUES
            ('g', 'Gram'), ('ml', 'Milliliter'), ('cup', 'Cup')
          ON CONFLICT (code) DO NOTHING
          """);

      // Items
      seedItem(st, ITEM_COFFEE, "COFFEE-BEAN", "Coffee Bean", "g");
      seedItem(st, ITEM_MILK, "FRESH-MILK", "Fresh Milk", "ml");
      seedItem(st, ITEM_SUGAR, "SUGAR", "Sugar", "g");
      seedItem(st, ITEM_TAPIOCA, "TAPIOCA", "Tapioca Pearl", "g");
      seedItem(st, ITEM_OAT_MILK, "OAT-MILK", "Oat Milk", "ml");

      // Product
      st.execute(String.format("""
          INSERT INTO core.product (id, code, name, category_code, status)
          VALUES (%d, 'LATTE', 'Cafe Latte', 'BEVERAGE', 'active')
          ON CONFLICT (id) DO NOTHING
          """, PRODUCT_LATTE));

      // Recipe: 1 cup latte = 20g coffee + 200ml milk + 10g sugar
      st.execute(String.format("""
          INSERT INTO core.recipe (product_id, version, yield_qty, yield_uom_code, status)
          VALUES (%d, 'v1', 1.0000, 'cup', 'active')
          ON CONFLICT (product_id, version) DO NOTHING
          """, PRODUCT_LATTE));
      seedRecipeItem(st, PRODUCT_LATTE, ITEM_COFFEE, "20.0000", "g");
      seedRecipeItem(st, PRODUCT_LATTE, ITEM_MILK, "200.0000", "ml");
      seedRecipeItem(st, PRODUCT_LATTE, ITEM_SUGAR, "10.0000", "g");

      // Modifier groups
      st.execute("""
          INSERT INTO core.modifier_group (id, code, name, selection_type, min_selections, max_selections, is_active)
          VALUES
            (8301, 'SUGAR_LEVEL', 'Sugar Level', 'single', 0, 1, true),
            (8302, 'TOPPING', 'Topping', 'multiple', 0, 3, true),
            (8303, 'SHOT', 'Espresso Shot', 'single', 0, 1, true),
            (8304, 'MILK_TYPE', 'Milk Type', 'single', 0, 1, true)
          ON CONFLICT (id) DO NOTHING
          """);

      // Modifier options
      st.execute(String.format("""
          INSERT INTO core.modifier_option (id, modifier_group_id, code, name, price_adjustment, display_order, is_active)
          VALUES
            (%d, 8301, 'EXTRA_SUGAR', 'Extra Sugar', 0, 1, true),
            (%d, 8301, 'NO_SUGAR', 'No Sugar', 0, 2, true),
            (%d, 8302, 'ADD_TAPIOCA', 'Add Tapioca', 10000, 1, true),
            (%d, 8303, 'DOUBLE_SHOT', 'Double Shot', 15000, 1, true),
            (%d, 8304, 'OAT_MILK', 'Oat Milk', 12000, 1, true)
          ON CONFLICT (id) DO NOTHING
          """, MOD_EXTRA_SUGAR, MOD_NO_SUGAR, MOD_ADD_TAPIOCA, MOD_DOUBLE_SHOT, MOD_SUB_OAT_MILK));

      // Link modifier groups to product
      st.execute(String.format("""
          INSERT INTO core.product_modifier_group (product_id, modifier_group_id, is_required, display_order)
          VALUES
            (%d, 8301, false, 1),
            (%d, 8302, false, 2),
            (%d, 8303, false, 3),
            (%d, 8304, false, 4)
          ON CONFLICT DO NOTHING
          """, PRODUCT_LATTE, PRODUCT_LATTE, PRODUCT_LATTE, PRODUCT_LATTE));

      // Modifier recipe effects (id is required PK)
      // EXTRA_SUGAR: SCALE_ITEM sugar × 1.5
      st.execute(String.format("""
          INSERT INTO core.modifier_recipe_effect
            (id, modifier_option_id, effect_type, ingredient_id, substitute_ingredient_id, multiplier, qty_delta)
          VALUES
            (88001, %d, 'SCALE_ITEM', %d, NULL, 1.5000, NULL)
          ON CONFLICT (id) DO NOTHING
          """, MOD_EXTRA_SUGAR, ITEM_SUGAR));

      // NO_SUGAR: SCALE_ITEM sugar × 0
      st.execute(String.format("""
          INSERT INTO core.modifier_recipe_effect
            (id, modifier_option_id, effect_type, ingredient_id, substitute_ingredient_id, multiplier, qty_delta)
          VALUES
            (88002, %d, 'SCALE_ITEM', %d, NULL, 0.0000, NULL)
          ON CONFLICT (id) DO NOTHING
          """, MOD_NO_SUGAR, ITEM_SUGAR));

      // ADD_TAPIOCA: ADD 30g tapioca (uom_code required by chk_effect_shape)
      st.execute(String.format("""
          INSERT INTO core.modifier_recipe_effect
            (id, modifier_option_id, effect_type, ingredient_id, substitute_ingredient_id, multiplier, qty_delta, uom_code)
          VALUES
            (88003, %d, 'ADD', %d, NULL, NULL, 30.0000, 'g')
          ON CONFLICT (id) DO NOTHING
          """, MOD_ADD_TAPIOCA, ITEM_TAPIOCA));

      // DOUBLE_SHOT: MULTIPLY × 2
      st.execute(String.format("""
          INSERT INTO core.modifier_recipe_effect
            (id, modifier_option_id, effect_type, ingredient_id, substitute_ingredient_id, multiplier, qty_delta)
          VALUES
            (88004, %d, 'MULTIPLY', NULL, NULL, 2.0000, NULL)
          ON CONFLICT (id) DO NOTHING
          """, MOD_DOUBLE_SHOT));

      // OAT_MILK: SUBSTITUTE milk → oat_milk
      st.execute(String.format("""
          INSERT INTO core.modifier_recipe_effect
            (id, modifier_option_id, effect_type, ingredient_id, substitute_ingredient_id, multiplier, qty_delta)
          VALUES
            (88005, %d, 'SUBSTITUTE', %d, %d, NULL, NULL)
          ON CONFLICT (id) DO NOTHING
          """, MOD_SUB_OAT_MILK, ITEM_MILK, ITEM_OAT_MILK));

      // Stock balances: 1000 each
      seedStockBalance(st, ITEM_COFFEE, "1000.0000");
      seedStockBalance(st, ITEM_MILK, "1000.0000");
      seedStockBalance(st, ITEM_SUGAR, "1000.0000");
      seedStockBalance(st, ITEM_TAPIOCA, "1000.0000");
      seedStockBalance(st, ITEM_OAT_MILK, "1000.0000");
    }
  }

  private void seedItem(java.sql.Statement st, long id, String code, String name, String uom) throws Exception {
    st.execute(String.format("""
        INSERT INTO core.item (id, code, name, category_code, base_uom_code, status)
        VALUES (%d, '%s', '%s', 'INGREDIENT', '%s', 'active')
        ON CONFLICT (id) DO NOTHING
        """, id, code, name, uom));
  }

  private void seedRecipeItem(java.sql.Statement st, long productId, long itemId, String qty, String uom)
      throws Exception {
    st.execute(String.format("""
        INSERT INTO core.recipe_item (product_id, version, item_id, qty, uom_code)
        VALUES (%d, 'v1', %d, %s, '%s')
        ON CONFLICT DO NOTHING
        """, productId, itemId, qty, uom));
  }

  private void seedStockBalance(java.sql.Statement st, long itemId, String qty) throws Exception {
    st.execute(String.format("""
        INSERT INTO core.stock_balance (location_id, item_id, qty_on_hand, unit_cost)
        VALUES (%d, %d, %s, 5.00)
        ON CONFLICT (location_id, item_id) DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand
        """, OUTLET_ID, itemId, qty));
  }
}
