package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.engine.StatusTransitions;
import com.fern.simulator.model.SimPromotion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Phase 8: Manages promotion lifecycle — creation, activation, and expiry.
 */
public class PromotionPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(PromotionPhase.class);

    private static final String[] PROMO_NAMES = {
            "Happy Hour", "Weekend Special", "Lunch Deal", "Holiday Sale",
            "New Menu Launch", "Loyalty Reward", "Grand Opening", "Flash Sale",
            "Anniversary Special", "Festival Promotion"
    };

    @Override
    public String name() { return "Promotions"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        // Activate promotions that are due
        for (SimPromotion promo : ctx.getPromotions()) {
            if (promo.shouldActivate(day)) {
                StatusTransitions.validate(StatusTransitions.PROMOTION, "Promotion",
                        promo.getStatus(), "active");
                promo.setStatus("active");
                log.debug("Activated promotion {} on {}", promo.getCode(), day);
            }
            if (promo.isActive() && promo.isExpired(day)) {
                StatusTransitions.validate(StatusTransitions.PROMOTION, "Promotion",
                        promo.getStatus(), "expired");
                promo.setStatus("expired");
                log.debug("Expired promotion {} on {}", promo.getCode(), day);
            }
        }

        // Create new promotions on 1st of month
        if (day.getDayOfMonth() == 1) {
            evaluateNewPromotion(ctx, day);
        }
    }

    private void evaluateNewPromotion(SimulationContext ctx, LocalDate day) {
        SimulationConfig.ProbabilityConfig prob = ctx.getConfig().probability();
        SimulationRandom rng = ctx.getRandom();
        PromotionScenario scenario = chooseScenario(ctx, day, rng);

        if (scenario != null || rng.chance(prob.promotionStartChancePerMonth())) {
            long id = ctx.getIdGen().nextId();
            String code = ctx.nextPromotionCode();
            String name = scenario != null ? scenario.name() : PROMO_NAMES[rng.intBetween(0, PROMO_NAMES.length - 1)];

            int durationDays = prob.promotionDurationDays() != null && !prob.promotionDurationDays().isEmpty()
                    ? rng.pickOne(prob.promotionDurationDays())
                    : 14;
            int discount = prob.promotionDiscountPercent() != null && !prob.promotionDiscountPercent().isEmpty()
                    ? rng.pickOne(prob.promotionDiscountPercent())
                    : 10;
            if (scenario != null) {
                durationDays = scenario.durationDays();
                discount = scenario.discountPercent();
            }

            LocalDate start = scenario != null ? scenario.startDate() : day.plusDays(rng.intBetween(1, 7));
            LocalDate end = start.plusDays(durationDays);

            SimPromotion promo = new SimPromotion(id, code, name, "percentage",
                    discount, start, end);
            ctx.addPromotion(promo);

            List<Long> targetIds = scenario != null ? scenario.outletIds() : pickPromotionTargets(ctx, day, rng);
            for (long outletId : targetIds) {
                ctx.registerPromotionScope(id, outletId);
                ctx.addPromotionScopeEvent(new SimulationContext.PromotionScopeEvent(id, outletId));
                ctx.incrementRowCount("promotion_scope", 1);
            }

            log.debug("Created promotion {} ({} for {}d) effective {}-{}",
                    code, discount + "%", durationDays, start, end);
        }
    }

    private List<Long> pickPromotionTargets(SimulationContext ctx, LocalDate day, SimulationRandom rng) {
        List<Long> targetOutletIds = new ArrayList<>();
        long medianRevenue = medianTrailingRevenue(ctx);

        for (var outlet : ctx.getActiveOutlets()) {
            long daysOpen = ChronoUnit.DAYS.between(outlet.getOpenedDate(), day);
            long trailingRevenue = outlet.getMonthlyRevenue().isEmpty()
                    ? outlet.getCurrentMonthRevenue()
                    : outlet.getMonthlyRevenue().get(outlet.getMonthlyRevenue().size() - 1);

            boolean newlyOpened = daysOpen <= 30;
            boolean underperforming = trailingRevenue > 0 && trailingRevenue <= medianRevenue;
            boolean lowFulfillment = outlet.inventoryFulfillmentRate() < 0.92;
            boolean heavyWaste = outlet.getWasteCostMonth() > 120_000;
            boolean severeStockout = outlet.getStockoutStreakDays() >= 3 || outlet.getLateDeliveryCount30d() >= 4;

            if (newlyOpened || (underperforming && !severeStockout) || heavyWaste || (lowFulfillment && rng.chance(0.35)) || rng.chance(0.10)) {
                targetOutletIds.add(outlet.getId());
            }
        }

        if (targetOutletIds.isEmpty() && !ctx.getActiveOutlets().isEmpty()) {
            targetOutletIds.add(rng.pickOne(ctx.getActiveOutlets()).getId());
        }
        return targetOutletIds;
    }

    private long medianTrailingRevenue(SimulationContext ctx) {
        List<Long> revenues = ctx.getActiveOutlets().stream()
                .map(outlet -> outlet.getMonthlyRevenue().isEmpty()
                        ? outlet.getCurrentMonthRevenue()
                        : outlet.getMonthlyRevenue().get(outlet.getMonthlyRevenue().size() - 1))
                .sorted()
                .toList();
        if (revenues.isEmpty()) return 0;
        return revenues.get(revenues.size() / 2);
    }

    private PromotionScenario chooseScenario(SimulationContext ctx, LocalDate day, SimulationRandom rng) {
        List<Long> newlyOpened = ctx.getActiveOutlets().stream()
                .filter(outlet -> ChronoUnit.DAYS.between(outlet.getOpenedDate(), day) <= 30)
                .map(outlet -> outlet.getId())
                .toList();
        if (!newlyOpened.isEmpty()) {
            return new PromotionScenario("Grand Opening Week", newlyOpened, day.plusDays(1), 10, 10);
        }

        List<Long> recoveryTargets = ctx.getActiveOutlets().stream()
                .filter(outlet -> outlet.getCurrentMonthRevenue() > 0 && outlet.getCurrentMonthRevenue() < medianTrailingRevenue(ctx))
                .filter(outlet -> outlet.inventoryFulfillmentRate() > 0.90)
                .map(outlet -> outlet.getId())
                .toList();
        if (!recoveryTargets.isEmpty() && rng.chance(0.55)) {
            return new PromotionScenario("Weekday Lunch Recovery", recoveryTargets, day.plusDays(2), 14, 12);
        }

        List<Long> wasteTargets = ctx.getActiveOutlets().stream()
                .filter(outlet -> outlet.getWasteCostMonth() > 100_000 && outlet.getStockoutStreakDays() < 2)
                .map(outlet -> outlet.getId())
                .toList();
        if (!wasteTargets.isEmpty()) {
            return new PromotionScenario("Fresh Shelf Saver", wasteTargets, day.plusDays(1), 7, 8);
        }

        boolean holidayWeek = ctx.getConfig().regions().stream()
                .flatMap(region -> region.holidays().stream())
                .anyMatch(holiday -> {
                    LocalDate holidayDate = LocalDate.of(day.getYear(),
                            Integer.parseInt(holiday.date().substring(0, 2)),
                            Integer.parseInt(holiday.date().substring(3, 5)));
                    return !holidayDate.isBefore(day) && !holidayDate.isAfter(day.plusDays(7));
                });
        if (holidayWeek && !ctx.getActiveOutlets().isEmpty()) {
            return new PromotionScenario("Holiday Weekend Lift",
                    ctx.getActiveOutlets().stream().map(outlet -> outlet.getId()).toList(),
                    day.plusDays(1), 9, 9);
        }
        return null;
    }

    private record PromotionScenario(String name, List<Long> outletIds, LocalDate startDate,
                                     int durationDays, int discountPercent) {}
}
