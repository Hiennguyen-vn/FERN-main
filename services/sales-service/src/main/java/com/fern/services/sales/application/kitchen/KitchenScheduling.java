package com.fern.services.sales.application.kitchen;

import com.fern.services.sales.api.kitchen.KitchenDtos;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;

/**
 * Kitchen display scheduling policy.
 *
 * <p>Ordering uses <b>Earliest Deadline First (EDF)</b>, a classic greedy single-machine
 * dispatching rule. Each ticket has a deadline {@code createdAt + prepSlaSeconds}; tickets are
 * shown in non-decreasing deadline order. EDF is provably optimal for minimizing the maximum
 * lateness on a single machine (Jackson's rule), and it degenerates to plain FIFO when every
 * ticket shares the same SLA — so it strictly generalizes the previous created-at ordering.
 *
 * <p>The SLA itself is estimated with a simple, explainable linear model
 * {@code base + perItem * totalUnits} rather than a fixed constant, so a one-drink order and a
 * ten-item order do not share the same deadline. No history or ML is required.
 *
 * <p>This class is intentionally pure (no I/O) so the policy can be unit-tested and reasoned
 * about independently of persistence.
 */
public final class KitchenScheduling {

  private KitchenScheduling() {}

  /**
   * Estimate the preparation SLA for a ticket from the quantities of its items.
   * {@code sla = baseSeconds + perItemSeconds * ceil(sum(quantities))}, floored at
   * {@code baseSeconds} so an empty/degenerate ticket still has a positive deadline.
   */
  public static int computePrepSlaSeconds(
      List<BigDecimal> quantities, int baseSeconds, int perItemSeconds) {
    int base = Math.max(0, baseSeconds);
    int perItem = Math.max(0, perItemSeconds);
    long totalUnits = 0L;
    if (quantities != null) {
      BigDecimal sum = BigDecimal.ZERO;
      for (BigDecimal q : quantities) {
        if (q != null && q.signum() > 0) {
          sum = sum.add(q);
        }
      }
      totalUnits = sum.setScale(0, RoundingMode.CEILING).longValueExact();
    }
    long sla = (long) base + (long) perItem * totalUnits;
    if (sla <= 0) {
      sla = Math.max(1, base);
    }
    return (int) Math.min(sla, Integer.MAX_VALUE);
  }

  /**
   * Earliest Deadline First comparator. Primary key: deadline (createdAt + prepSlaSeconds).
   * Tie-break: createdAt ascending, preserving FIFO fairness for equal deadlines.
   */
  public static Comparator<KitchenDtos.TicketView> earliestDeadlineFirst() {
    return Comparator
        .comparingLong(KitchenScheduling::deadlineEpochSeconds)
        .thenComparing(KitchenScheduling::createdEpochSeconds);
  }

  static long deadlineEpochSeconds(KitchenDtos.TicketView ticket) {
    return createdEpochSeconds(ticket) + Math.max(0, ticket.prepSlaSeconds());
  }

  private static long createdEpochSeconds(KitchenDtos.TicketView ticket) {
    Instant created = ticket.createdAt();
    return created == null ? Instant.EPOCH.getEpochSecond() : created.getEpochSecond();
  }
}
