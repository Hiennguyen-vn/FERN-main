package com.fern.services.sales.application;

import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Evaluates promotions against an in-flight cart and returns discount allocations per line.
 *
 * <p>Coverage:
 * <ul>
 *   <li><b>percentage</b> — applies value_percent to subtotal, capped by max_discount_amount</li>
 *   <li><b>fixed_amount</b> — applies value_amount as flat discount, capped by subtotal</li>
 *   <li><b>min_order_amount</b> — promotion skipped if cart subtotal below threshold</li>
 *   <li><b>effective window</b> — only active and within effective_from / effective_to</li>
 *   <li><b>scope</b> — promotion_scope.outlet_id must match cart's outlet (or scope row absent = global)</li>
 * </ul>
 *
 * <p>Not yet implemented: <code>buy_x_get_y</code>, <code>combo_price</code>, <code>subsidy</code>.
 * For those types, the engine returns <code>EMPTY</code> and the caller falls back to
 * client-supplied discount values from the sync payload.
 *
 * <p>Stackability: promotions of the same type never stack. Across types, only the largest
 * single discount is applied — protects margin against unintended combinations.
 */
@Component
public class PromotionEngine {

  private static final Logger log = LoggerFactory.getLogger(PromotionEngine.class);

  private final SalesRepository salesRepository;
  private final Clock clock;

  public PromotionEngine(SalesRepository salesRepository, Clock clock) {
    this.salesRepository = salesRepository;
    this.clock = clock;
  }

  public Allocation evaluateForCart(long outletId, List<CartLine> lines) {
    if (lines == null || lines.isEmpty()) {
      return Allocation.EMPTY;
    }
    BigDecimal subtotal = lines.stream()
        .map(line -> line.unitPrice().multiply(line.quantity()))
        .reduce(BigDecimal.ZERO, BigDecimal::add);

    Instant now = clock.instant();
    List<SalesRepository.ActivePromotionRow> candidates =
        salesRepository.findActivePromotionsForOutlet(outletId, now);

    BigDecimal bestDiscount = BigDecimal.ZERO;
    Long winningPromotionId = null;
    for (SalesRepository.ActivePromotionRow promo : candidates) {
      if (promo.minOrderAmount() != null && subtotal.compareTo(promo.minOrderAmount()) < 0) {
        continue;
      }
      BigDecimal discount = computeDiscount(promo, subtotal);
      if (discount.compareTo(bestDiscount) > 0) {
        bestDiscount = discount;
        winningPromotionId = promo.id();
      }
    }

    if (winningPromotionId == null || bestDiscount.signum() <= 0) {
      return Allocation.EMPTY;
    }

    log.info("promotion applied outletId={} promoId={} subtotal={} discount={}",
        outletId, winningPromotionId, subtotal, bestDiscount);
    return distributePerLine(lines, subtotal, bestDiscount, winningPromotionId);
  }

  private BigDecimal computeDiscount(SalesRepository.ActivePromotionRow promo, BigDecimal subtotal) {
    BigDecimal discount = switch (promo.promoType()) {
      case "percentage" -> promo.valuePercent() == null ? BigDecimal.ZERO
          : subtotal.multiply(promo.valuePercent()).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
      case "fixed_amount" -> promo.valueAmount() == null ? BigDecimal.ZERO : promo.valueAmount();
      default -> BigDecimal.ZERO;
    };
    if (discount.compareTo(subtotal) > 0) {
      discount = subtotal;
    }
    if (promo.maxDiscountAmount() != null && discount.compareTo(promo.maxDiscountAmount()) > 0) {
      discount = promo.maxDiscountAmount();
    }
    return discount;
  }

  private Allocation distributePerLine(List<CartLine> lines, BigDecimal subtotal, BigDecimal totalDiscount, long promotionId) {
    List<LineDiscount> lineDiscounts = new ArrayList<>(lines.size());
    BigDecimal allocated = BigDecimal.ZERO;
    for (int i = 0; i < lines.size(); i++) {
      CartLine line = lines.get(i);
      BigDecimal lineSubtotal = line.unitPrice().multiply(line.quantity());
      BigDecimal share;
      if (i == lines.size() - 1) {
        share = totalDiscount.subtract(allocated);
      } else {
        share = totalDiscount.multiply(lineSubtotal).divide(subtotal, 2, RoundingMode.HALF_UP);
        allocated = allocated.add(share);
      }
      lineDiscounts.add(new LineDiscount(line.productId(), share));
    }
    return new Allocation(promotionId, totalDiscount, lineDiscounts);
  }

  public record CartLine(long productId, BigDecimal quantity, BigDecimal unitPrice) {
  }

  public record LineDiscount(long productId, BigDecimal discountAmount) {
  }

  public record Allocation(Long promotionId, BigDecimal totalDiscount, List<LineDiscount> lineDiscounts) {
    public static final Allocation EMPTY = new Allocation(null, BigDecimal.ZERO, List.of());
  }
}
