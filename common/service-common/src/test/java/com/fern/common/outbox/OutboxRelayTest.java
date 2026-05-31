package com.fern.common.outbox;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import org.junit.jupiter.api.Test;

class OutboxRelayTest {

  @Test
  void serviceClaimsOnlyItsOwnedTopicPrefix() {
    assertEquals(List.of("fern.procurement."), OutboxRelay.topicPrefixesForService("procurement-service"));
    assertEquals(List.of("fern.inventory."), OutboxRelay.topicPrefixesForService("inventory-service"));
    assertFalse(OutboxRelay.topicPrefixesForService("inventory-service").contains("fern.procurement."));
  }

  @Test
  void sourceComponentIsDerivedFromTopicOwner() {
    assertEquals("procurement-service",
        OutboxRelay.sourceComponentForTopic("fern.procurement.goods-receipt-posted"));
    assertEquals("inventory-service",
        OutboxRelay.sourceComponentForTopic("fern.inventory.stock-in-recorded"));
    assertEquals("unknown-service", OutboxRelay.sourceComponentForTopic("fern.unknown.event"));
  }
}
