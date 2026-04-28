package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class PromotionEngineTest {

  private final Clock clock = Clock.fixed(Instant.parse("2026-04-15T10:00:00Z"), ZoneOffset.UTC);
  private final SalesRepository salesRepository = mock(SalesRepository.class);
  private final PromotionEngine engine = new PromotionEngine(salesRepository, clock);

  @Test
  void appliesPercentagePromotionAcrossCart() {
    active(newPromo(1L, "percentage", null, "10", null));

    PromotionEngine.Allocation allocation = engine.evaluateForCart(10L, List.of(
        line(100L, "2", "50000.00"),
        line(101L, "1", "100000.00")));

    assertEquals(new BigDecimal("20000.00"), allocation.totalDiscount());
    assertEquals(2, allocation.lineDiscounts().size());
  }

  @Test
  void appliesFixedAmountPromotionWithSubtotalCap() {
    active(newPromo(2L, "fixed_amount", "250000.00", null, null));

    PromotionEngine.Allocation allocation = engine.evaluateForCart(10L, List.of(line(100L, "1", "90000.00")));

    assertEquals(new BigDecimal("90000.00"), allocation.totalDiscount());
  }

  @Test
  void appliesBuyXGetYToEligibleGetProduct() {
    active(newPromo(3L, "buy_x_get_y", null, null, null));
    when(salesRepository.findBxgyRule(3L)).thenReturn(Optional.of(
        new SalesRepository.BxgyRule(
            3L,
            100L,
            new BigDecimal("2"),
            101L,
            BigDecimal.ONE,
            new BigDecimal("100"))));

    PromotionEngine.Allocation allocation = engine.evaluateForCart(10L, List.of(
        line(100L, "4", "50000.00"),
        line(101L, "2", "30000.00")));

    assertEquals(new BigDecimal("60000.00"), allocation.totalDiscount());
    assertEquals(101L, allocation.lineDiscounts().get(0).productId());
  }

  @Test
  void appliesComboPriceWhenRequiredItemsExist() {
    active(newPromo(4L, "combo_price", null, null, null));
    when(salesRepository.findComboRule(4L)).thenReturn(Optional.of(
        new SalesRepository.ComboRule(
            4L,
            new BigDecimal("120000.00"),
            List.of(
                new SalesRepository.ComboRuleItem(100L, BigDecimal.ONE),
                new SalesRepository.ComboRuleItem(101L, BigDecimal.ONE)))));

    PromotionEngine.Allocation allocation = engine.evaluateForCart(10L, List.of(
        line(100L, "1", "80000.00"),
        line(101L, "1", "70000.00")));

    assertEquals(new BigDecimal("30000.00"), allocation.totalDiscount());
    assertEquals(2, allocation.lineDiscounts().size());
  }

  @Test
  void appliesProductScopedSubsidy() {
    active(newPromo(5L, "subsidy", null, "50", null));
    when(salesRepository.findSubsidyRule(5L)).thenReturn(Optional.of(
        new SalesRepository.SubsidyRule(5L, 101L, "brand", "MKT-2026")));

    PromotionEngine.Allocation allocation = engine.evaluateForCart(10L, List.of(
        line(100L, "1", "80000.00"),
        line(101L, "2", "40000.00")));

    assertEquals(new BigDecimal("40000.00"), allocation.totalDiscount());
    assertEquals(101L, allocation.lineDiscounts().get(0).productId());
  }

  private void active(SalesRepository.ActivePromotionRow row) {
    when(salesRepository.findActivePromotionsForOutlet(eq(10L), any())).thenReturn(List.of(row));
  }

  private SalesRepository.ActivePromotionRow newPromo(
      long id,
      String type,
      String amount,
      String percent,
      String max
  ) {
    return new SalesRepository.ActivePromotionRow(
        id,
        "Promo " + id,
        type,
        amount == null ? null : new BigDecimal(amount),
        percent == null ? null : new BigDecimal(percent),
        null,
        max == null ? null : new BigDecimal(max));
  }

  private PromotionEngine.CartLine line(long productId, String qty, String unitPrice) {
    return new PromotionEngine.CartLine(productId, new BigDecimal(qty), new BigDecimal(unitPrice));
  }
}
