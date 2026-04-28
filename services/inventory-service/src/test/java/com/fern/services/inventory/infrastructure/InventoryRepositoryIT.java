package com.fern.services.inventory.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fern.common.test.PostgresContainerExtension;
import com.fern.common.test.TestFixtures;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.inventory.api.InventoryDtos;
import java.math.BigDecimal;
import java.sql.Connection;
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
          INSERT INTO core.item (id, code, name, category_code, base_uom_code, status)
          VALUES (%d, 'ITEM-9001', 'Test Item', 'FOOD', 'EA', 'active')
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
}
