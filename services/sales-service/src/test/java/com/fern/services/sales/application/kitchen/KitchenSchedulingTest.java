package com.fern.services.sales.application.kitchen;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fern.services.sales.api.kitchen.KitchenDtos;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class KitchenSchedulingTest {

  private static KitchenDtos.TicketView ticket(long id, Instant createdAt, int prepSlaSeconds) {
    return new KitchenDtos.TicketView(id, 999L, 10L, null, null, null, "dine_in",
        "new", prepSlaSeconds, null, false, createdAt, null, null, null, List.of());
  }

  private static List<Long> orderIds(List<KitchenDtos.TicketView> tickets) {
    List<Long> ids = new ArrayList<>(tickets.size());
    for (KitchenDtos.TicketView t : tickets) ids.add(t.id());
    return ids;
  }

  @Test
  void prepSlaIsLinearInTotalUnits() {
    // base=120, perItem=60 → 1 unit = 180s, 5 units = 420s.
    assertEquals(180, KitchenScheduling.computePrepSlaSeconds(List.of(BigDecimal.ONE), 120, 60));
    assertEquals(420, KitchenScheduling.computePrepSlaSeconds(
        List.of(new BigDecimal("2"), new BigDecimal("3")), 120, 60));
  }

  @Test
  void prepSlaRoundsFractionalQuantitiesUpAndFloorsAtBase() {
    // 1.5 units → ceil to 2 → 120 + 60*2 = 240.
    assertEquals(240, KitchenScheduling.computePrepSlaSeconds(List.of(new BigDecimal("1.5")), 120, 60));
    // Empty ticket still gets a positive deadline (the base).
    assertEquals(120, KitchenScheduling.computePrepSlaSeconds(List.of(), 120, 60));
  }

  @Test
  void earliestDeadlineFirstOrdersByDeadlineNotArrival() {
    Instant t0 = Instant.parse("2026-05-17T10:00:00Z");
    // A arrives first but has a long SLA; B arrives later with a short SLA → B is due sooner.
    KitchenDtos.TicketView a = ticket(1L, t0, 600);                 // deadline 10:10:00
    KitchenDtos.TicketView b = ticket(2L, t0.plusSeconds(60), 120); // deadline 10:03:00
    List<KitchenDtos.TicketView> list = new ArrayList<>(List.of(a, b));
    list.sort(KitchenScheduling.earliestDeadlineFirst());
    assertEquals(List.of(2L, 1L), orderIds(list));
  }

  @Test
  void degeneratesToFifoWhenSlaEqual() {
    Instant t0 = Instant.parse("2026-05-17T10:00:00Z");
    KitchenDtos.TicketView a = ticket(1L, t0, 300);
    KitchenDtos.TicketView b = ticket(2L, t0.plusSeconds(30), 300);
    KitchenDtos.TicketView c = ticket(3L, t0.plusSeconds(60), 300);
    List<KitchenDtos.TicketView> list = new ArrayList<>(List.of(c, a, b));
    list.sort(KitchenScheduling.earliestDeadlineFirst());
    // Equal SLA → deadline ordering collapses to arrival (FIFO) order.
    assertEquals(List.of(1L, 2L, 3L), orderIds(list));
  }
}
