package com.fern.services.sales.application;

import com.fern.services.sales.infrastructure.SalesPromotionRepository;
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
 * <p>Supported wider mechanics use typed rule tables:
 * <code>promotion_bxgy_rule</code>, <code>promotion_combo_rule</code>, and
 * <code>promotion_subsidy_rule</code>.
 *
 * <p>Stackability: promotions of the same type never stack. Across types, only the largest
 * single discount is applied — protects margin against unintended combinations.
 */
@Component
public class PromotionEngine {

  private static final Logger log = LoggerFactory.getLogger(PromotionEngine.class);

  private final SalesPromotionRepository promotionRepository;
  private final Clock clock;

  public PromotionEngine(SalesPromotionRepository promotionRepository, Clock clock) {
    this.promotionRepository = promotionRepository;
    this.clock = clock;
  }

  public Allocation evaluateForCart(long outletId, List<CartLine> lines) {
    if (lines == null || lines.isEmpty()) {
      return Allocation.EMPTY;
    }
    BigDecimal subtotal = lines.stream()
        .map(line -> line.unitPrice().multiply(line.quantity()))
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    if (subtotal.signum() <= 0) {
      return Allocation.EMPTY;
    }

    Instant now = clock.instant();
    List<SalesPromotionRepository.ActivePromotionRow> candidates =
        promotionRepository.findActivePromotionsForOutlet(outletId, now);

    Allocation bestAllocation = Allocation.EMPTY;
    for (SalesPromotionRepository.ActivePromotionRow promo : candidates) {
      if (promo.minOrderAmount() != null && subtotal.compareTo(promo.minOrderAmount()) < 0) {
        continue;
      }
      Allocation allocation = evaluatePromotion(promo, lines, subtotal);
      if (allocation.totalDiscount().compareTo(bestAllocation.totalDiscount()) > 0) {
        bestAllocation = allocation;
      }
    }

    if (bestAllocation.promotionId() == null || bestAllocation.totalDiscount().signum() <= 0) {
      return Allocation.EMPTY;
    }

    log.info("promotion applied outletId={} promoId={} subtotal={} discount={}",
        outletId, bestAllocation.promotionId(), subtotal, bestAllocation.totalDiscount());
    return bestAllocation;
  }

  private Allocation evaluatePromotion(
      SalesPromotionRepository.ActivePromotionRow promo,
      List<CartLine> lines,
      BigDecimal subtotal
  ) {
    return switch (promo.promoType()) {
      case "percentage", "fixed_amount" -> evaluateSimpleDiscount(promo, lines, subtotal);
      case "buy_x_get_y" -> evaluateBxgyDiscount(promo, lines);
      case "combo_price" -> evaluateComboDiscount(promo, lines);
      case "subsidy" -> evaluateSubsidyDiscount(promo, lines, subtotal);
      default -> Allocation.EMPTY;
    };
  }

  private Allocation evaluateSimpleDiscount(
      SalesPromotionRepository.ActivePromotionRow promo,
      List<CartLine> lines,
      BigDecimal subtotal
  ) {
    BigDecimal discount = switch (promo.promoType()) {
      case "percentage" -> promo.valuePercent() == null ? BigDecimal.ZERO
          : subtotal.multiply(promo.valuePercent()).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
      case "fixed_amount" -> promo.valueAmount() == null ? BigDecimal.ZERO : promo.valueAmount();
      default -> BigDecimal.ZERO;
    };
    discount = capDiscount(discount, subtotal, promo.maxDiscountAmount());
    return discount.signum() <= 0 ? Allocation.EMPTY : distributePerLine(lines, subtotal, discount, promo.id());
  }

  private Allocation evaluateBxgyDiscount(SalesPromotionRepository.ActivePromotionRow promo, List<CartLine> lines) {
    SalesPromotionRepository.BxgyRule rule = promotionRepository.findBxgyRule(promo.id()).orElse(null);
    if (rule == null) return Allocation.EMPTY;
    CartLine buyLine = findLine(lines, rule.buyProductId());
    CartLine getLine = findLine(lines, rule.getProductId());
    if (buyLine == null || getLine == null) return Allocation.EMPTY;

    BigDecimal eligibleGetQty;
    if (rule.buyProductId() == rule.getProductId()) {
      BigDecimal groupQty = rule.buyQuantity().add(rule.getQuantity());
      BigDecimal sets = floor(buyLine.quantity().divide(groupQty, 8, RoundingMode.DOWN));
      eligibleGetQty = sets.multiply(rule.getQuantity()).min(buyLine.quantity());
    } else {
      BigDecimal sets = floor(buyLine.quantity().divide(rule.buyQuantity(), 8, RoundingMode.DOWN));
      eligibleGetQty = sets.multiply(rule.getQuantity()).min(getLine.quantity());
    }
    if (eligibleGetQty.signum() <= 0) return Allocation.EMPTY;

    BigDecimal percent = rule.getDiscountPercent() == null ? BigDecimal.valueOf(100) : rule.getDiscountPercent();
    BigDecimal discount = getLine.unitPrice()
        .multiply(eligibleGetQty)
        .multiply(percent)
        .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
    discount = capDiscount(discount, getLine.unitPrice().multiply(eligibleGetQty), promo.maxDiscountAmount());
    return discount.signum() <= 0
        ? Allocation.EMPTY
        : new Allocation(promo.id(), discount, List.of(new LineDiscount(rule.getProductId(), discount)));
  }

  private Allocation evaluateComboDiscount(SalesPromotionRepository.ActivePromotionRow promo, List<CartLine> lines) {
    SalesPromotionRepository.ComboRule rule = promotionRepository.findComboRule(promo.id()).orElse(null);
    if (rule == null || rule.items().isEmpty()) return Allocation.EMPTY;
    List<CartLine> eligibleLines = new ArrayList<>();
    BigDecimal sets = null;
    BigDecimal regularSetPrice = BigDecimal.ZERO;
    for (SalesPromotionRepository.ComboRuleItem item : rule.items()) {
      CartLine line = findLine(lines, item.productId());
      if (line == null) return Allocation.EMPTY;
      BigDecimal itemSets = floor(line.quantity().divide(item.quantity(), 8, RoundingMode.DOWN));
      sets = sets == null ? itemSets : sets.min(itemSets);
      regularSetPrice = regularSetPrice.add(line.unitPrice().multiply(item.quantity()));
    }
    if (sets == null || sets.signum() <= 0) return Allocation.EMPTY;
    BigDecimal discountPerSet = regularSetPrice.subtract(rule.comboPrice());
    if (discountPerSet.signum() <= 0) return Allocation.EMPTY;
    BigDecimal totalDiscount = capDiscount(discountPerSet.multiply(sets), regularSetPrice.multiply(sets), promo.maxDiscountAmount());
    for (SalesPromotionRepository.ComboRuleItem item : rule.items()) {
      CartLine line = findLine(lines, item.productId());
      eligibleLines.add(new CartLine(item.productId(), item.quantity().multiply(sets), line.unitPrice()));
    }
    BigDecimal eligibleSubtotal = eligibleLines.stream()
        .map(line -> line.unitPrice().multiply(line.quantity()))
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    return totalDiscount.signum() <= 0
        ? Allocation.EMPTY
        : distributePerLine(eligibleLines, eligibleSubtotal, totalDiscount, promo.id());
  }

  private Allocation evaluateSubsidyDiscount(
      SalesPromotionRepository.ActivePromotionRow promo,
      List<CartLine> lines,
      BigDecimal subtotal
  ) {
    SalesPromotionRepository.SubsidyRule rule = promotionRepository.findSubsidyRule(promo.id()).orElse(null);
    if (rule == null || rule.fundingSource() == null || rule.fundingSource().isBlank()) return Allocation.EMPTY;
    List<CartLine> eligibleLines = rule.scopeProductId() == null
        ? lines
        : lines.stream().filter(line -> line.productId() == rule.scopeProductId()).toList();
    if (eligibleLines.isEmpty()) return Allocation.EMPTY;
    BigDecimal eligibleSubtotal = rule.scopeProductId() == null
        ? subtotal
        : eligibleLines.stream()
            .map(line -> line.unitPrice().multiply(line.quantity()))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    BigDecimal discount = promo.valuePercent() != null
        ? eligibleSubtotal.multiply(promo.valuePercent()).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP)
        : (promo.valueAmount() == null ? BigDecimal.ZERO : promo.valueAmount());
    discount = capDiscount(discount, eligibleSubtotal, promo.maxDiscountAmount());
    return discount.signum() <= 0
        ? Allocation.EMPTY
        : distributePerLine(eligibleLines, eligibleSubtotal, discount, promo.id());
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

  private BigDecimal capDiscount(BigDecimal discount, BigDecimal subtotal, BigDecimal maxDiscountAmount) {
    if (discount.compareTo(subtotal) > 0) {
      discount = subtotal;
    }
    if (maxDiscountAmount != null && discount.compareTo(maxDiscountAmount) > 0) {
      discount = maxDiscountAmount;
    }
    return discount.setScale(2, RoundingMode.HALF_UP);
  }

  private CartLine findLine(List<CartLine> lines, long productId) {
    return lines.stream().filter(line -> line.productId() == productId).findFirst().orElse(null);
  }

  private BigDecimal floor(BigDecimal value) {
    return value.setScale(0, RoundingMode.DOWN);
  }

  public record CartLine(long productId, BigDecimal quantity, BigDecimal unitPrice) {
  }

  public record LineDiscount(long productId, BigDecimal discountAmount) {
  }

  public record Allocation(Long promotionId, BigDecimal totalDiscount, List<LineDiscount> lineDiscounts) {
    public static final Allocation EMPTY = new Allocation(null, BigDecimal.ZERO, List.of());
  }
}
