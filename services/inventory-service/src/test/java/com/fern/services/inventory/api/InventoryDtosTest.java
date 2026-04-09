package com.fern.services.inventory.api;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class InventoryDtosTest {

  private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

  @Test
  void createWasteRequestIgnoresQtyAliasWhenQuantityIsPresent() throws Exception {
    InventoryDtos.CreateWasteRequest request = objectMapper.readValue(
        """
            {
              "outletId": 2001,
              "itemId": 4000,
              "quantity": 0.25,
              "qty": 0.25,
              "businessDate": "2026-04-10",
              "reason": "Spoilage",
              "note": "Damaged during storage"
            }
            """,
        InventoryDtos.CreateWasteRequest.class
    );

    assertEquals(2001L, request.outletId());
    assertEquals(4000L, request.itemId());
    assertEquals(LocalDate.parse("2026-04-10"), request.businessDate());
    assertEquals("Spoilage", request.reason());
  }

  @Test
  void createStockCountSessionRequestIgnoresBusinessDateWhenCountDateIsPresent() throws Exception {
    InventoryDtos.CreateStockCountSessionRequest request = objectMapper.readValue(
        """
            {
              "outletId": 2001,
              "countDate": "2026-04-10",
              "businessDate": "2026-04-10",
              "note": "cycle count",
              "lines": [
                {
                  "itemId": 4000,
                  "actualQty": 10.5,
                  "note": "manual count"
                }
              ]
            }
            """,
        InventoryDtos.CreateStockCountSessionRequest.class
    );

    assertEquals(2001L, request.outletId());
    assertEquals(LocalDate.parse("2026-04-10"), request.countDate());
    assertEquals(1, request.lines().size());
    assertEquals(4000L, request.lines().get(0).itemId());
  }

  @Test
  void createStockCountSessionRequestAcceptsCountDateWhenBusinessDateIsAlsoPresent() throws Exception {
    InventoryDtos.CreateStockCountSessionRequest request = objectMapper.readValue(
        """
            {
              "outletId": 2001,
              "countDate": "2026-04-10",
              "businessDate": "2026-04-10",
              "note": "cycle count",
              "lines": [
                {
                  "itemId": 4000,
                  "actualQty": 10,
                  "note": "manual count"
                }
              ]
            }
            """,
        InventoryDtos.CreateStockCountSessionRequest.class
    );

    assertEquals(LocalDate.parse("2026-04-10"), request.countDate());
  }
}
