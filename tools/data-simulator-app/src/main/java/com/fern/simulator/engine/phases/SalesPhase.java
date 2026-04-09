package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.data.MenuData;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.economics.OperationalRealism;
import com.fern.simulator.economics.OutletBusinessController;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimPromotion;
import com.fern.simulator.model.SimProduct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Predicate;

/**
 * Phase 8: Generates realistic daily sales and attendance-linked work shifts.
 */
public class SalesPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(SalesPhase.class);
    private static final double PART_TIME_MONTHLY_HOURS = 96.0;
    private static final List<BlockWindow> BLOCK_WINDOWS = List.of(
            new BlockWindow("06_08", 6, 8),
            new BlockWindow("08_10", 8, 10),
            new BlockWindow("10_12", 10, 12),
            new BlockWindow("12_14", 12, 14),
            new BlockWindow("14_16", 14, 16),
            new BlockWindow("16_18", 16, 18),
            new BlockWindow("18_20", 18, 20),
            new BlockWindow("20_22", 20, 22)
    );

    @Override
    public String name() { return "Sales"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        SimulationConfig.ProbabilityConfig prob = ctx.getConfig().probability();
        SimulationRandom rng = ctx.getRandom();
        List<SimProduct> productCatalog = new ArrayList<>(ctx.getProducts().values());

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            if (day.isBefore(outlet.getOpenedDate()) || productCatalog.isEmpty()) {
                continue;
            }

            List<SimEmployee> outletEmployees = ctx.getActiveEmployeesAtOutlet(outlet.getId());
            if (outletEmployees.isEmpty()) {
                continue;
            }

            int baselineDemand = calculateDailySales(ctx, outlet, day, prob, rng);
            int carryoverDemand = ctx.getCurrentCarryoverDemand(outlet.getId());
            int effectiveCarryoverDemand = effectiveCarryoverDemand(baselineDemand, carryoverDemand);
            int targetedDemand = Math.max(0, baselineDemand + effectiveCarryoverDemand);

            List<SimEmployee> scheduledEmployees = selectScheduledEmployees(ctx, outlet, outletEmployees, targetedDemand, day, rng);
            AttendancePlan attendancePlan = buildAttendancePlan(ctx, outlet, day, scheduledEmployees, targetedDemand, rng);
            if (attendancePlan.workingEmployees().stream().noneMatch(emp -> "cashier".equals(emp.getRoleCode()) || "outlet_manager".equals(emp.getRoleCode()))) {
                outlet.addAttendanceStress(1.4);
                continue;
            }

            long posSessionId = emitPosSession(ctx, outlet, day, attendancePlan.workingEmployees(), rng);
            emitWorkdayEvents(ctx, outlet, day, attendancePlan, rng);

            int salesCount = 0;
            int constrainedOrders = 0;
            int capacityOrders = 0;
            int shiftedWithinDay = 0;
            int startingDineInOrders = outlet.getCurrentMonthDineInOrders();
            int startingDeliveryOrders = outlet.getCurrentMonthDeliveryOrders();
            List<Daypart> dayparts = allocateDayparts(day, targetedDemand, rng);
            long averageOrderValue = averageOrderValue(ctx, outlet, day, productCatalog);
            for (int i = 0; i < dayparts.size(); i++) {
                Daypart daypart = dayparts.get(i);
                int daypartDemand = daypart.saleCount() + shiftedWithinDay;
                CapacityEnvelope capacity = buildCapacityEnvelope(
                        ctx, outlet, day, attendancePlan, daypartDemand, productCatalog, daypart);
                int daypartSales = Math.max(0, Math.min(daypartDemand, capacity.maxOrders()));
                int overflowOrders = Math.max(0, daypartDemand - daypartSales);
                int sameDayRecovered = i == dayparts.size() - 1
                        ? 0
                        : Math.min(overflowOrders, (int) Math.round(overflowOrders * daypart.sameDayShiftRate()));
                int abandonedOrders = Math.max(0, overflowOrders - sameDayRecovered);

                shiftedWithinDay = sameDayRecovered;
                salesCount += daypartSales;
                constrainedOrders += abandonedOrders;
                capacityOrders += capacity.maxOrders();
                outlet.recordBlockDemand(daypart.name(), daypartDemand, daypartSales);

                if (abandonedOrders > 0) {
                    long constrainedValue = Math.max(0L,
                            Math.round(averageOrderValue * daypart.marginalOrderValueFactor()) * abandonedOrders);
                    ctx.addServiceConstrainedDemand(
                            outlet.getId(),
                            abandonedOrders,
                            RegionalEconomics.convertToReportingCurrency(
                                    constrainedValue,
                                    RegionalEconomics.marketCode(outlet),
                                    ctx.getConfig().startDate(),
                                    day));
                }

                for (int j = 0; j < daypartSales; j++) {
                    generateSale(ctx, outlet, day, j, Math.max(daypartSales, 1), prob, rng,
                            posSessionId, productCatalog, daypart);
                }
            }

            // Generate POS session reconciliation
            emitPosReconciliation(ctx, outlet, day, posSessionId, rng);

            int dineInOrdersToday = Math.max(0, outlet.getCurrentMonthDineInOrders() - startingDineInOrders);
            int deliveryOrdersToday = Math.max(0, outlet.getCurrentMonthDeliveryOrders() - startingDeliveryOrders);
            int completedOrdersToday = Math.max(1, dineInOrdersToday + deliveryOrdersToday);
            double observedDeliveryShare = deliveryOrdersToday / (double) completedOrdersToday;
            double serviceLossRate = targetedDemand <= 0 ? 0.0 : constrainedOrders / (double) targetedDemand;
            double stockoutLossRate = outlet.currentMonthStockoutLossRate();
            outlet.applyClientBaseFeedback(
                    targetedDemand,
                    salesCount,
                    observedDeliveryShare,
                    serviceLossRate,
                    stockoutLossRate);

            long payrollRunRate = estimateMonthlyPayrollRunRate(outletEmployees);
            long expectedOperatingRunRate = expectedMonthlyOperatingRunRate(ctx, outlet, day);
            OutletBusinessController.applyDailyControls(
                    outlet,
                    day,
                    targetedDemand,
                    salesCount,
                    constrainedOrders,
                    Math.max(1, capacityOrders),
                    payrollRunRate,
                    expectedOperatingRunRate);

        }
    }

    private int calculateDailySales(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                    SimulationConfig.ProbabilityConfig prob, SimulationRandom rng) {
        String marketCode = RegionalEconomics.marketCode(outlet);
        double base = prob.baseDailySalesPerOutlet();
        long daysSinceOpen = Math.max(0, ChronoUnit.DAYS.between(outlet.getOpenedDate(), day));
        double rampFactor = clamp(0.60 + ((double) daysSinceOpen / Math.max(1, prob.demandRampDays())) * 0.92, 0.60, 1.46);
        double dowMultiplier = prob.weekdayMultipliers() != null
                ? prob.weekdayMultipliers().getOrDefault(day.getDayOfWeek().name(), 1.0)
                : 1.0;
        double seasonMultiplier = getSeasonalMultiplier(ctx, outlet, day);
        double holidayMultiplier = getHolidayMultiplier(ctx, outlet, day);
        double monthsOpen = Math.max(0.0, ChronoUnit.DAYS.between(outlet.getOpenedDate(), day) / 30.4375);
        double organicGrowth = Math.pow(1.0 + prob.demandGrowthPerMonth() * 0.45, monthsOpen);
        double promotionBoost = ctx.getActivePromotionsForOutlet(outlet.getId()).isEmpty() ? 1.0 : 1.09;
        double stockoutPenalty = clamp(1.0 - outlet.getStockoutStreakDays() * 0.005, 0.97, 1.03);
        double stressPenalty = clamp(1.0 - outlet.getAttendanceStressScore() * 0.011, 0.96, 1.03);
        // Carryover is injected directly at execution time. Avoid applying it again
        // here via rebound to prevent double-counting demand pressure.
        double rebound = 1.0;
        double economicsFactor = RegionalEconomics.demandFactor(marketCode, ctx.getConfig().startDate(), day);
        double locationFactor = outlet.getLocationDemandMultiplier()
                * Math.max(0.96, 1.0 + (outlet.getCrowdIndex() - 1.0) * 0.20)
                * Math.max(0.96, 1.0 + (outlet.getAffluenceIndex() - 1.0) * 0.08)
                * RegionalEconomics.outletDemandAdjustment(outlet);
        int activeSubregionOutlets = (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode());
        int activeCountryOutlets = (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode());
        double networkHalo = RegionalEconomics.networkDemandHalo(
                activeSubregionOutlets,
                activeCountryOutlets,
                ctx.averageActiveOutletReputation(outlet.getRegionCode()));
        double saturationFactor = subregionSaturationFactor(ctx, outlet);
        double spilloverCapture = sameSubregionOverflowCapture(ctx, outlet, day);
        double clientBaseFactor = clamp(
                0.86
                        + outlet.getClientBaseIndex() * 0.42
                        + outlet.getRepeatCustomerPool() * 0.45
                        + Math.max(0.0, outlet.getReputationScore() - 0.98) * 0.38,
                0.84, 1.62);
        double deliveryFactor = clamp(
                0.96
                        + outlet.getDeliveryCatchmentStrength() * 0.26
                        + Math.max(0.0, (1.0 - outlet.getDineInShare()) - 0.44) * 0.30,
                0.96, 1.40);
        double priceDiscipline = clamp(1.02 - Math.max(0.0, outlet.getDynamicPriceMultiplier() - 1.0) * 0.72, 0.93, 1.04);
        double seatTrafficPool = outlet.getSeatCount() * (day.getDayOfWeek().getValue() >= 6 ? 4.6 : 4.0)
                * clamp(outlet.getCrowdIndex() * 0.72 + outlet.getFootTrafficIndex() * 0.66, 1.00, 1.68);
        double serviceTrafficPool = outlet.getServiceSlotCount() * clamp(3.0 + outlet.getFootTrafficIndex() * 2.20, 4.6, 6.4);
        double deliveryTrafficPool = outlet.getServiceSlotCount() * (1.0 - outlet.getDineInShare())
                * clamp(2.6 + outlet.getDeliveryCatchmentStrength() * 2.0, 3.8, 5.6);
        double captureRate = clamp(
                ("transit".equals(outlet.getLocationTier()) ? 0.238 : "prime".equals(outlet.getLocationTier()) ? 0.214 : 0.188)
                        + Math.max(0.0, outlet.getReputationScore() - 0.98) * 0.044,
                0.17, 0.31);
        double localTrafficDemand = (seatTrafficPool + serviceTrafficPool + deliveryTrafficPool) * captureRate;
        double anchoredDemand = Math.max(
                base * 0.72,
                localTrafficDemand * rampFactor * clientBaseFactor * deliveryFactor * priceDiscipline);
        double randomFactor = rng.doubleBetween(0.96, 1.06);

        double sales = anchoredDemand * dowMultiplier * seasonMultiplier * holidayMultiplier
                * organicGrowth * promotionBoost * stockoutPenalty * stressPenalty * rebound
                * economicsFactor * locationFactor * networkHalo * saturationFactor * spilloverCapture * randomFactor;
        return Math.max(0, (int) Math.round(sales));
    }

    private int effectiveCarryoverDemand(int baselineDemand, int rawCarryoverDemand) {
        if (rawCarryoverDemand <= 0) {
            return 0;
        }
        int cap = Math.max(6, (int) Math.round(baselineDemand * 0.44));
        return Math.min(rawCarryoverDemand, cap);
    }

    static long effectiveLostBasketValue(long missedNominalValue, int fulfilledItems, int missedItems) {
        if (missedNominalValue <= 0 || missedItems <= 0) {
            return 0L;
        }
        if (fulfilledItems <= 0) {
            return missedNominalValue;
        }

        int plannedItems = Math.max(fulfilledItems + missedItems, 1);
        double missingShare = missedItems / (double) plannedItems;
        // When a basket is only partially fulfilled, most guests still complete a
        // smaller ticket instead of abandoning the full basket. Keep a penalty,
        // but value it as basket shrink rather than a completely lost order.
        double shrinkFactor = Math.min(0.58, 0.16 + missingShare * 0.36);
        return Math.max(0L, Math.round(missedNominalValue * shrinkFactor));
    }

    private AttendancePlan buildAttendancePlan(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                               List<SimEmployee> scheduledEmployees, int targetedDemand,
                                               SimulationRandom rng) {
        List<AttendanceOutcome> outcomes = new ArrayList<>();
        List<SimEmployee> workingEmployees = new ArrayList<>();
        boolean weekend = day.getDayOfWeek() == DayOfWeek.SATURDAY || day.getDayOfWeek() == DayOfWeek.SUNDAY;
        Map<Long, ShiftTemplate> shiftTemplates = assignShiftTemplates(scheduledEmployees, targetedDemand, weekend);
        double baseAbsence = weekend && ctx.getConfig().realism() != null
                ? ctx.getConfig().realism().weekendAbsenceChance()
                : ctx.getConfig().realism() != null ? ctx.getConfig().realism().weekdayAbsenceChance() : 0.03;
        double lateChance = ctx.getConfig().realism() != null ? ctx.getConfig().realism().lateChance() : 0.05;
        double noShowChance = ctx.getConfig().realism() != null ? ctx.getConfig().realism().noShowChance() : 0.01;
        double leaveChance = ctx.getConfig().realism() != null ? ctx.getConfig().realism().leaveChance() : 0.01;
        double peakStress = Math.min(0.10, targetedDemand / 320.0);
        Long managerId = scheduledEmployees.stream()
                .filter(emp -> "outlet_manager".equals(emp.getRoleCode()))
                .map(SimEmployee::getUserId)
                .findFirst()
                .orElse(scheduledEmployees.isEmpty() ? null : scheduledEmployees.getFirst().getUserId());
        ZoneId zoneId = ctx.getTimezoneForRegion(RegionalEconomics.marketCode(outlet));

        for (SimEmployee employee : scheduledEmployees) {
            ShiftTemplate shiftTemplate = shiftTemplates.getOrDefault(
                    employee.getUserId(),
                    new ShiftTemplate("standard", 9, 8));
            double reliabilityPenalty = Math.max(0.02, 1.0 - employee.getAttendanceReliability());
            double fatiguePenalty = employee.getFatigueScore() * 0.03 + outlet.getAttendanceStressScore() * 0.02;
            double absenceChance = Math.min(0.22, baseAbsence + reliabilityPenalty + fatiguePenalty);
            double employeeLateChance = Math.min(0.16, lateChance + fatiguePenalty + peakStress * 0.35);
            boolean onLeave = rng.chance(Math.min(0.09, leaveChance + reliabilityPenalty * 0.3));
            boolean noShow = !onLeave && rng.chance(Math.min(0.08, noShowChance + fatiguePenalty * 0.25));
            boolean absent = !onLeave && !noShow && rng.chance(absenceChance);
            boolean late = !onLeave && !noShow && !absent && rng.chance(employeeLateChance);
            boolean overtime = !onLeave && !noShow && !absent
                    && (targetedDemand >= 100 || outlet.getAttendanceStressScore() > 1.0)
                    && rng.chance(Math.min(0.42, 0.22 + peakStress * 1.2));

            String attendanceStatus = onLeave ? "leave" : noShow || absent ? "absent" : late ? "late" : "present";
            int lateMinutes = late ? rng.intBetween(12, 50) : 0;
            OffsetDateTime actualStart = "absent".equals(attendanceStatus) || "leave".equals(attendanceStatus)
                    ? null
                    : ctx.getClock().timestampAt(shiftTemplate.startHour(), lateMinutes, zoneId);
            OffsetDateTime actualEnd = actualStart == null ? null
                    : actualStart.plusHours(shiftTemplate.durationHours())
                    .plusMinutes(overtime ? rng.intBetween(40, 120) : 0);
            String note = switch (attendanceStatus) {
                case "leave" -> "Approved leave (" + shiftTemplate.label() + ")";
                case "absent" -> noShow ? "Unplanned no-show" : "Absent due to operational disruption";
                case "late" -> "Late arrival during " + shiftTemplate.label() + " shift";
                default -> overtime
                        ? "Extended " + shiftTemplate.label() + " shift to cover peak-hour demand"
                        : "Completed " + shiftTemplate.label() + " shift";
            };

            if (actualStart != null) {
                workingEmployees.add(employee);
                double workedHours = ChronoUnit.MINUTES.between(actualStart, actualEnd) / 60.0;
                employee.setFatigueScore(Math.min(4.0, employee.getFatigueScore() + (overtime ? 0.8 : 0.25)));
                employee.setAttendanceReliability(Math.max(0.70, employee.getAttendanceReliability() - (late ? 0.006 : 0.0)));
            } else {
                employee.setFatigueScore(Math.max(0.0, employee.getFatigueScore() - 0.2));
                if ("absent".equals(attendanceStatus)) {
                    employee.setAttendanceReliability(Math.max(0.65, employee.getAttendanceReliability() - 0.02));
                }
            }

            outcomes.add(new AttendanceOutcome(employee, attendanceStatus, actualStart, actualEnd, managerId,
                    managerId, note, overtime, shiftTemplate));
        }

        if (workingEmployees.size() < Math.max(2, scheduledEmployees.size() - 1)) {
            outlet.addAttendanceStress(0.9);
        } else {
            outlet.addAttendanceStress(-0.25);
        }
        return new AttendancePlan(outcomes, workingEmployees);
    }

    private void generateSale(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                              int saleIndex, int totalSales, SimulationConfig.ProbabilityConfig prob,
                              SimulationRandom rng, long posSessionId, List<SimProduct> productCatalog,
                              Daypart daypart) {
        OffsetDateTime paymentTime = distributedTimestampForDaypart(ctx, outlet, daypart, saleIndex, totalSales);
        String marketCode = RegionalEconomics.marketCode(outlet);
        int itemCount = plannedItemCount(day, daypart, rng);
        long subtotal = 0;
        int lostUnits = 0;
        long missedNominalValue = 0;

        List<SimProduct> saleProducts = new ArrayList<>(itemCount);
        for (int i = 0; i < itemCount; i++) {
            SimProduct product = pickProductForSale(ctx, outlet, day, daypart.hourHint(), productCatalog, saleProducts, rng);
            if (product == null) {
                continue;
            }

            boolean canFulfill = isProductFulfillable(ctx, outlet, product);
            if (!canFulfill) {
                SimProduct substitute = chooseSubstituteProduct(
                        ctx, outlet, day, daypart.hourHint(), productCatalog, saleProducts, product, rng);
                if (substitute != null) {
                    product = substitute;
                    canFulfill = true;
                }
            }

            if (!canFulfill) {
                lostUnits++;
                long missedCost = scaledEffectiveProductCost(ctx, outlet, product, marketCode, day);
                long missedPrice = RegionalEconomics.effectiveProductPrice(
                        product, missedCost, outlet, ctx.getConfig().startDate(), day);
                missedNominalValue += missedPrice;
                continue;
            }

            saleProducts.add(product);
            long effectiveCost = scaledEffectiveProductCost(ctx, outlet, product, marketCode, day);
            long effectivePrice = RegionalEconomics.effectiveProductPrice(
                    product, effectiveCost, outlet, ctx.getConfig().startDate(), day);
            subtotal += effectivePrice;
            for (SimProduct.RecipeItem ri : product.recipeItems()) {
                ctx.removeStock(outlet.getId(), ri.itemId(), ri.quantity());
            }
        }

        if (saleProducts.isEmpty() && lostUnits > 0) {
            SimProduct rescueProduct = chooseRescueFulfillableProduct(
                    ctx, outlet, day, daypart.hourHint(), productCatalog, rng);
            if (rescueProduct != null) {
                saleProducts.add(rescueProduct);
                long rescueCost = scaledEffectiveProductCost(ctx, outlet, rescueProduct, marketCode, day);
                long rescuePrice = RegionalEconomics.effectiveProductPrice(
                        rescueProduct, rescueCost, outlet, ctx.getConfig().startDate(), day);
                subtotal += rescuePrice;
                for (SimProduct.RecipeItem ri : rescueProduct.recipeItems()) {
                    ctx.removeStock(outlet.getId(), ri.itemId(), ri.quantity());
                }
            }
        }

        outlet.recordSaleAttempt(lostUnits > 0);
        if (lostUnits > 0) {
            long effectiveLostValue = effectiveLostBasketValue(
                    missedNominalValue,
                    saleProducts.size(),
                    lostUnits);
            long reportingLostValue = RegionalEconomics.convertToReportingCurrency(
                    effectiveLostValue, marketCode, ctx.getConfig().startDate(), day);
            if (saleProducts.isEmpty()) {
                ctx.addUnmetDemand(outlet.getId(), lostUnits, reportingLostValue);
            } else {
                ctx.addBasketShrinkDemand(outlet.getId(), reportingLostValue);
            }
        }

        if (saleProducts.isEmpty()) {
            return;
        }

        SimPromotion appliedPromo = null;
        long discount = 0;
        List<SimPromotion> activePromotions = ctx.getActivePromotionsForOutlet(outlet.getId());
        if (!activePromotions.isEmpty() && rng.chance(daypart.promoBoostChance())) {
            appliedPromo = rng.pickOne(activePromotions);
            discount = "percentage".equals(appliedPromo.getType())
                    ? subtotal * appliedPromo.getDiscountValue() / 100
                    : Math.min(subtotal, appliedPromo.getDiscountValue() * 1_000L);
        }

        long taxAmount = Math.max(0, (subtotal - discount) * 10 / 100);
        long totalAmount = subtotal - discount + taxAmount;

        String saleStatus = "completed";
        String paymentStatus = "paid";
        long recognizedRevenue = totalAmount;
        long paymentAmount = totalAmount;

        if (rng.chance(prob.saleCancelChance())) {
            saleStatus = "cancelled";
            paymentStatus = "unpaid";
            paymentAmount = 0;
            recognizedRevenue = 0;
            restoreStock(ctx, outlet, saleProducts);
            ctx.getCurrentMonth().addSaleCancelled();
        } else if (rng.chance(prob.saleVoidChance())) {
            saleStatus = "voided";
            paymentStatus = "unpaid";
            paymentAmount = 0;
            recognizedRevenue = 0;
            restoreStock(ctx, outlet, saleProducts);
            ctx.getCurrentMonth().addSaleVoided();
        } else if (rng.chance(prob.saleRefundChance())) {
            saleStatus = "refunded";
            paymentStatus = "refunded";
            recognizedRevenue = 0;
            ctx.getCurrentMonth().addSaleRefunded();
        } else if (rng.chance(prob.salePartialRefundChance())) {
            saleStatus = "partially_refunded";
            paymentStatus = "partially_paid";
            long refundAmount = Math.max(1_000L, Math.round(totalAmount * rng.doubleBetween(0.15, 0.35)));
            paymentAmount = Math.max(0, totalAmount - refundAmount);
            recognizedRevenue = paymentAmount;
            ctx.getCurrentMonth().addSaleRefunded();
        }

        long saleId = ctx.getIdGen().nextId();
        String orderType = inferOrderType(outlet, daypart.name(), day, rng);
        String[] paymentMethods = {"cash", "bank_transfer", "ewallet"};
        String paymentMethod = paymentMethods[rng.intBetween(0, paymentMethods.length - 1)];
        String transactionRef = "TXN-" + outlet.getCode() + "-" + day + "-" + saleIndex;
        Long orderingTableId = "dine_in".equals(orderType) ? ctx.getRandomOrderingTableId(outlet.getId()) : null;

        List<SimulationContext.SaleItemEvent> saleItems = new ArrayList<>();
        List<SimulationContext.SaleTxnEvent> inventoryTransactions = new ArrayList<>();
        List<Long> effectivePrices = new ArrayList<>(saleProducts.size());
        for (SimProduct product : saleProducts) {
            long effectiveCost = scaledEffectiveProductCost(ctx, outlet, product, marketCode, day);
            effectivePrices.add(RegionalEconomics.effectiveProductPrice(
                    product, effectiveCost, outlet, ctx.getConfig().startDate(), day));
        }

        long remainingDiscount = discount;
        long remainingTax = taxAmount;
        long discountBase = Math.max(1L, subtotal);
        long taxableBase = Math.max(1L, subtotal - discount);
        long saleCogs = 0;
        for (int index = 0; index < saleProducts.size(); index++) {
            SimProduct product = saleProducts.get(index);
            long effectiveCost = scaledEffectiveProductCost(ctx, outlet, product, marketCode, day);
            long effectivePrice = effectivePrices.get(index);
            long lineDiscount = index == saleProducts.size() - 1
                    ? remainingDiscount
                    : Math.min(remainingDiscount, Math.round(discount * (effectivePrice / (double) discountBase)));
            lineDiscount = Math.min(lineDiscount, effectivePrice);
            remainingDiscount -= lineDiscount;
            long netBeforeTax = Math.max(0, effectivePrice - lineDiscount);
            long lineTax = index == saleProducts.size() - 1
                    ? remainingTax
                    : Math.min(remainingTax, Math.round(taxAmount * (netBeforeTax / (double) taxableBase)));
            remainingTax -= lineTax;
            long lineTotal = netBeforeTax + lineTax;
            saleItems.add(new SimulationContext.SaleItemEvent(
                    product.id(), effectivePrice, 1, lineDiscount, lineTax, lineTotal));
            saleCogs += effectiveCost;

            if (!"cancelled".equals(saleStatus) && !"voided".equals(saleStatus)) {
                for (SimProduct.RecipeItem ri : product.recipeItems()) {
                    long txnId = ctx.getIdGen().nextId();
                    inventoryTransactions.add(new SimulationContext.SaleTxnEvent(txnId, ri.itemId(), product.id(), ri.quantity()));
                    ctx.incrementRowCount("inventory_transaction", 1);
                    ctx.incrementRowCount("sale_item_transaction", 1);
                }
            }
        }

        ctx.addSaleEvent(new SimulationContext.SaleEvent(
                saleId, outlet.getId(), posSessionId,
                RegionalEconomics.currencyFor(marketCode),
                orderType, saleStatus, paymentStatus,
                subtotal, discount, taxAmount, totalAmount,
                saleItems, paymentAmount, paymentMethod, paymentTime, inventoryTransactions,
                transactionRef, orderingTableId));

        if (recognizedRevenue > 0) {
            long reportingRevenue = RegionalEconomics.convertToReportingCurrency(
                    recognizedRevenue, marketCode, ctx.getConfig().startDate(), day);
            ctx.getCurrentMonth().addSale(reportingRevenue);
            if ("delivery".equals(orderType)) {
                ctx.getCurrentMonth().addDeliveryOrder();
            } else {
                ctx.getCurrentMonth().addDineInOrder();
            }
            outlet.recordCompletedSale(reportingRevenue, orderType);
        }
        ctx.incrementRowCount("sale_record", 1);
        ctx.incrementRowCount("sale_item", saleProducts.size());
        if (paymentAmount > 0 || "refunded".equals(paymentStatus) || "partially_paid".equals(paymentStatus)) {
            ctx.incrementRowCount("payment", 1);
        }

        if (appliedPromo != null && discount > 0) {
            for (SimProduct product : saleProducts) {
                ctx.addSaleItemPromotionEvent(new SimulationContext.SaleItemPromotionEvent(saleId, product.id(), appliedPromo.getId()));
                ctx.incrementRowCount("sale_item_promotion", 1);
            }
        }

        if (!"cancelled".equals(saleStatus) && !"voided".equals(saleStatus)) {
            long reportingCogs = RegionalEconomics.convertToReportingCurrency(
                    saleCogs, marketCode, ctx.getConfig().startDate(), day);
            ctx.getCurrentMonth().addCogs(reportingCogs);
            outlet.addCogs(reportingCogs);
        }
    }

    private void restoreStock(SimulationContext ctx, SimOutlet outlet, List<SimProduct> products) {
        for (SimProduct product : products) {
            for (SimProduct.RecipeItem ri : product.recipeItems()) {
                ctx.addStock(outlet.getId(), ri.itemId(), ri.quantity());
            }
        }
    }

    private List<SimEmployee> selectScheduledEmployees(SimulationContext ctx, SimOutlet outlet, List<SimEmployee> outletEmployees, int baselineSales,
                                                       LocalDate day, SimulationRandom rng) {
        List<SimEmployee> scheduled = new ArrayList<>();
        List<SimEmployee> pool = new ArrayList<>(outletEmployees);
        Collections.shuffle(pool, rng.underlying());
        pool.sort(Comparator.comparingInt(this::schedulePriority));

        boolean weekend = day.getDayOfWeek() == DayOfWeek.SATURDAY || day.getDayOfWeek() == DayOfWeek.SUNDAY;
        boolean peerSupported = ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) > 1
                && outlet.getServiceSlotCount() <= 38;
        int peakDemand = (int) Math.ceil(baselineSales * (weekend ? 0.52 : 0.48));
        int baseCoverageTarget = Math.max(3, 2 + baselineSales / (weekend ? 80 : 86));
        int peakCoverageTarget = Math.max(0, (int) Math.ceil(Math.max(0, peakDemand - 6) / 7.0));
        int targetStaff = Math.max(2, Math.min(pool.size(), baseCoverageTarget + peakCoverageTarget));
        int coreTarget = Math.max(2, Math.min(targetStaff, 2 + baselineSales / (weekend ? 132 : 148)));
        boolean managerShift = baselineSales >= 24
                || peakDemand >= 18
                || outlet.getAttendanceStressScore() >= 0.7
                || day.getDayOfWeek() == DayOfWeek.MONDAY;
        boolean inventoryShift = needsInventoryCoverage(outlet, baselineSales, day);

        scheduleRole(scheduled, pool, "cashier", 1, true);
        scheduleRole(scheduled, pool, "kitchen_staff", 1, true);
        if (managerShift) {
            scheduleRole(scheduled, pool, "outlet_manager", 1, true);
        }
        if (inventoryShift) {
            scheduleRole(scheduled, pool, "inventory_clerk", 1, false);
        }

        fillByPriority(scheduled, pool, Math.max(coreTarget, scheduled.size()), true);

        if (peakDemand >= 12) {
            scheduleRole(scheduled, pool, "cashier", 1, false);
        }
        if (peakDemand >= 14) {
            scheduleRole(scheduled, pool, "kitchen_staff", 1, false);
        }
        if (weekend && peakDemand >= 22) {
            scheduleRole(scheduled, pool, "cashier", 1, false);
        }
        if (peakDemand >= 24) {
            scheduleRole(scheduled, pool, "kitchen_staff", 1, false);
        }
        if (outlet.getRollingServiceLossRate() >= 0.08 && peakDemand >= 12) {
            scheduleRole(scheduled, pool, "cashier", 1, false);
        }
        if (outlet.getRollingStockoutLossRate() >= 0.12 && peakDemand >= 12) {
            scheduleRole(scheduled, pool, "kitchen_staff", 1, false);
        }
        if (outlet.getRollingServiceLossRate() >= 0.16 && peakDemand >= 12) {
            scheduleRole(scheduled, pool, "cashier", 1, false);
        }
        if (outlet.getRollingStockoutLossRate() >= 0.20 && peakDemand >= 12) {
            scheduleRole(scheduled, pool, "kitchen_staff", 1, false);
        }
        fillByPriority(scheduled, pool, Math.max(targetStaff, scheduled.size()), false);
        return scheduled;
    }

    private boolean needsInventoryCoverage(SimOutlet outlet, int baselineSales, LocalDate day) {
        return baselineSales >= 84
                || outlet.getRollingStockoutLossRate() >= 0.11
                || outlet.getLateDeliveryCount30d() >= 2
                || day.getDayOfWeek() == DayOfWeek.MONDAY
                || day.getDayOfWeek() == DayOfWeek.THURSDAY;
    }

    private void scheduleRole(List<SimEmployee> scheduled, List<SimEmployee> pool, String roleCode,
                              int count, boolean preferCore) {
        for (int i = 0; i < count; i++) {
            SimEmployee employee = popFirst(pool, candidate -> roleCode.equals(candidate.getRoleCode())
                    && (!preferCore || isCoreStaff(candidate)));
            if (employee == null && preferCore) {
                employee = popFirst(pool, candidate -> roleCode.equals(candidate.getRoleCode()));
            }
            if (employee != null) {
                scheduled.add(employee);
            }
        }
    }

    private void fillByPriority(List<SimEmployee> scheduled, List<SimEmployee> pool, int targetStaff, boolean coreOnly) {
        while (scheduled.size() < targetStaff && !pool.isEmpty()) {
            SimEmployee employee = popFirst(pool, candidate -> !coreOnly || isCoreStaff(candidate));
            if (employee == null) {
                if (coreOnly) {
                    break;
                }
                employee = pool.removeFirst();
            }
            scheduled.add(employee);
        }
    }

    private SimEmployee popFirst(List<SimEmployee> pool, Predicate<SimEmployee> predicate) {
        for (int i = 0; i < pool.size(); i++) {
            SimEmployee candidate = pool.get(i);
            if (predicate.test(candidate)) {
                return pool.remove(i);
            }
        }
        return null;
    }

    private Map<Long, ShiftTemplate> assignShiftTemplates(List<SimEmployee> scheduledEmployees, int targetedDemand,
                                                          boolean weekend) {
        List<SimEmployee> ordered = new ArrayList<>(scheduledEmployees);
        ordered.sort(Comparator.comparingInt(this::shiftPriority).thenComparing(SimEmployee::getUserId));

        Map<String, Integer> totalsByRole = new LinkedHashMap<>();
        for (SimEmployee employee : ordered) {
            totalsByRole.merge(roleKey(employee), 1, Integer::sum);
        }

        Map<String, Integer> seenByRole = new LinkedHashMap<>();
        Map<Long, ShiftTemplate> templates = new LinkedHashMap<>();
        boolean highDemand = targetedDemand >= 72 || weekend;

        for (SimEmployee employee : ordered) {
            String role = roleKey(employee);
            int roleIndex = seenByRole.merge(role, 1, Integer::sum);
            int roleTotal = totalsByRole.getOrDefault(role, 1);
            templates.put(employee.getUserId(), shiftTemplateFor(employee, roleIndex, roleTotal, ordered.size(), highDemand));
        }
        return templates;
    }

    private ShiftTemplate shiftTemplateFor(SimEmployee employee, int roleIndex, int roleTotal,
                                           int scheduledCount, boolean highDemand) {
        String roleCode = roleKey(employee);
        boolean flexShift = !isCoreStaff(employee);
        return switch (roleCode) {
            case "inventory_clerk" -> flexShift
                    ? new ShiftTemplate("10_12", 10, 2)
                    : new ShiftTemplate("06_08", 6, highDemand ? 4 : 3);
            case "outlet_manager" -> highDemand
                    ? new ShiftTemplate("10_12", 10, 10)
                    : new ShiftTemplate("10_12", 10, 6);
            case "cashier" -> flexShift
                    ? roleTotal > 1 && roleIndex == roleTotal
                            ? new ShiftTemplate("18_20", 18, 4)
                            : roleIndex == 1
                                    ? new ShiftTemplate("12_14", 12, 4)
                                    : new ShiftTemplate("16_18", 16, 4)
                    : highDemand
                            ? new ShiftTemplate("10_12", 10, 10)
                            : new ShiftTemplate("10_12", 10, 6);
            case "kitchen_staff" -> flexShift
                    ? roleTotal > 1 && roleIndex == roleTotal
                            ? new ShiftTemplate("16_18", 16, 5)
                            : roleIndex == 1
                                    ? new ShiftTemplate("10_12", 10, 5)
                                    : new ShiftTemplate("12_14", 12, 5)
                    : highDemand
                            ? new ShiftTemplate("08_10", 8, 10)
                            : new ShiftTemplate("10_12", 10, 6);
            default -> {
                if (flexShift) {
                    if (highDemand && scheduledCount >= 5 && roleIndex == 1) {
                        yield new ShiftTemplate("18_20", 18, 4);
                    }
                    yield highDemand
                            ? new ShiftTemplate("12_14", 12, 4)
                            : new ShiftTemplate("10_12", 10, 3);
                }
                yield highDemand
                        ? new ShiftTemplate("10_12", 10, 6)
                        : new ShiftTemplate("10_12", 10, 5);
            }
        };
    }

    private boolean isCoreStaff(SimEmployee employee) {
        return "monthly".equals(employee.getSalaryType())
                || "full_time".equals(employee.getEmploymentType())
                || "outlet_manager".equals(roleKey(employee));
    }

    private int schedulePriority(SimEmployee employee) {
        int employmentPriority = isCoreStaff(employee) ? 0 : 10;
        return employmentPriority + shiftPriority(employee);
    }

    private int shiftPriority(SimEmployee employee) {
        return switch (roleKey(employee)) {
            case "outlet_manager" -> 0;
            case "cashier" -> 1;
            case "kitchen_staff" -> 2;
            case "inventory_clerk" -> 3;
            default -> 4;
        };
    }

    private String roleKey(SimEmployee employee) {
        return employee.getRoleCode() == null ? "employee_no_role" : employee.getRoleCode();
    }

    private long emitPosSession(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                List<SimEmployee> workingEmployees, SimulationRandom rng) {
        long sessionId = ctx.getIdGen().nextId();
        SimEmployee sessionManager = workingEmployees.stream()
                .filter(emp -> "outlet_manager".equals(emp.getRoleCode()) || "cashier".equals(emp.getRoleCode()))
                .findFirst()
                .orElse(workingEmployees.getFirst());
        String marketCode = RegionalEconomics.marketCode(outlet);
        ZoneId zoneId = ctx.getTimezoneForRegion(marketCode);
        OffsetDateTime openedAt = ctx.getClock().timestampAt(7, rng.intBetween(0, 20), zoneId);
        OffsetDateTime closedAt = openedAt.plusHours(15);
        ctx.addPosSessionEvent(new SimulationContext.PosSessionEvent(
                sessionId, outlet.getCode() + "-" + day, outlet.getId(),
                RegionalEconomics.currencyFor(marketCode),
                sessionManager.getUserId(), openedAt, closedAt, day, "closed"));
        ctx.incrementRowCount("pos_session", 1);
        return sessionId;
    }

    private void emitPosReconciliation(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                        long posSessionId, SimulationRandom rng) {
        // Sum payment amounts for this session from dirty sales
        Map<String, Long> amountsByMethod = new LinkedHashMap<>();
        for (var sale : ctx.getDirtySales()) {
            if (sale.posSessionId() != null && sale.posSessionId() == posSessionId && sale.paymentAmount() > 0) {
                amountsByMethod.merge(sale.paymentMethod(), sale.paymentAmount(), Long::sum);
            }
        }
        if (amountsByMethod.isEmpty()) return;

        long expectedTotal = amountsByMethod.values().stream().mapToLong(Long::longValue).sum();
        // 5% chance of small cash discrepancy
        long discrepancyTotal = 0;
        if (rng.chance(0.05) && amountsByMethod.containsKey("cash")) {
            discrepancyTotal = Math.round(expectedTotal * rng.doubleBetween(-0.02, 0.02));
        }
        long actualTotal = expectedTotal + discrepancyTotal;

        List<SimulationContext.PosReconciliationLineEvent> lines = new ArrayList<>();
        long remainingDiscrepancy = discrepancyTotal;
        int idx = 0;
        for (var entry : amountsByMethod.entrySet()) {
            long lineDiscrepancy = idx == amountsByMethod.size() - 1 ? remainingDiscrepancy : 0;
            remainingDiscrepancy -= lineDiscrepancy;
            lines.add(new SimulationContext.PosReconciliationLineEvent(
                    entry.getKey(), entry.getValue(), entry.getValue() + lineDiscrepancy, lineDiscrepancy));
            idx++;
        }

        Long managerId = ctx.getActiveEmployeesAtOutlet(outlet.getId()).stream()
                .filter(e -> "outlet_manager".equals(e.getRoleCode()))
                .map(SimEmployee::getUserId).findFirst().orElse(null);
        String marketCode = RegionalEconomics.marketCode(outlet);
        ZoneId zoneId = ctx.getTimezoneForRegion(marketCode);
        OffsetDateTime reconciledAt = ctx.getClock().timestampAt(22, rng.intBetween(0, 30), zoneId);
        String note = discrepancyTotal != 0 ? "Cash discrepancy detected" : null;

        ctx.addReconciliationEvent(new SimulationContext.PosReconciliationEvent(
                posSessionId, managerId, reconciledAt, expectedTotal, actualTotal, discrepancyTotal, note, lines));
        ctx.incrementRowCount("pos_session_reconciliation", 1);
        ctx.incrementRowCount("pos_session_reconciliation_line", lines.size());
    }

    private void emitWorkdayEvents(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                   AttendancePlan attendancePlan, SimulationRandom rng) {
        for (AttendanceOutcome outcome : attendancePlan.outcomes()) {
            if (outcome.actualStart() == null || outcome.actualEnd() == null) {
                String blockCode = blockCodeForHour(outcome.shiftTemplate().startHour());
                long shiftId = ctx.getShiftIdForOutlet(outlet.getId(), blockCode);
                if (shiftId > 0) {
                    ctx.recordWorkedShift(outcome.employee().getUserId(), outlet.getId(), shiftId,
                            day, 0.0, outcome.attendanceStatus(), false);
                    ctx.addWorkShiftEvent(new SimulationContext.WorkShiftEvent(
                            ctx.getIdGen().nextId(),
                            shiftId,
                            outcome.employee().getUserId(),
                            day,
                            "scheduled",
                            outcome.attendanceStatus(),
                            "approved",
                            null,
                            null,
                            outcome.assignedByUserId(),
                            outcome.approvedByUserId(),
                            outcome.note()
                    ));
                    ctx.incrementRowCount("work_shift", 1);
                }
                continue;
            }

            List<BlockAssignment> assignments = blockAssignments(outcome);
            if (assignments.isEmpty()) {
                long shiftId = ctx.getShiftIdForOutlet(outlet.getId(), blockCodeForHour(outcome.shiftTemplate().startHour()));
                if (shiftId <= 0) {
                    continue;
                }
                ctx.recordWorkedShift(outcome.employee().getUserId(), outlet.getId(), shiftId,
                        day, 0.0, outcome.attendanceStatus(), outcome.overtime());
                ctx.addWorkShiftEvent(new SimulationContext.WorkShiftEvent(
                        ctx.getIdGen().nextId(),
                        shiftId,
                        outcome.employee().getUserId(),
                        day,
                        "scheduled",
                        outcome.attendanceStatus(),
                        "approved",
                        outcome.actualStart(),
                        outcome.actualEnd(),
                        outcome.assignedByUserId(),
                        outcome.approvedByUserId(),
                        outcome.note()
                ));
                ctx.incrementRowCount("work_shift", 1);
                continue;
            }

            for (int i = 0; i < assignments.size(); i++) {
                BlockAssignment assignment = assignments.get(i);
                long shiftId = ctx.getShiftIdForOutlet(outlet.getId(), assignment.blockCode());
                if (shiftId <= 0) {
                    continue;
                }
                boolean overtimeSegment = outcome.overtime() && i == assignments.size() - 1;
                String attendanceStatus = i == 0 ? outcome.attendanceStatus() : "present";
                double workedHours = ChronoUnit.MINUTES.between(assignment.start(), assignment.end()) / 60.0;
                ctx.recordWorkedShift(outcome.employee().getUserId(), outlet.getId(), shiftId,
                        day, workedHours, attendanceStatus, overtimeSegment);
                ctx.addWorkShiftEvent(new SimulationContext.WorkShiftEvent(
                        ctx.getIdGen().nextId(),
                        shiftId,
                        outcome.employee().getUserId(),
                        day,
                        "scheduled",
                        attendanceStatus,
                        "approved",
                        assignment.start(),
                        assignment.end(),
                        outcome.assignedByUserId(),
                        outcome.approvedByUserId(),
                        outcome.note()
                ));
                ctx.incrementRowCount("work_shift", 1);
            }

            String sessionId = "SES-" + outcome.employee().getUserId() + "-" + day + "-" + rng.intBetween(100, 999);
            ctx.addAuthSessionEvent(new SimulationContext.AuthSessionEvent(
                    sessionId,
                    outcome.employee().getUserId(),
                    outcome.actualStart(),
                    outcome.actualEnd() != null ? outcome.actualEnd() : outcome.actualStart().plusHours(8),
                    "FERN-POS/2.1",
                    "10.0." + (outlet.getId() % 255) + "." + (outcome.employee().getUserId() % 255)
            ));
            ctx.incrementRowCount("auth_session", 1);
        }
    }

    private double staffingFactor(SimOutlet outlet, AttendancePlan attendancePlan, int targetedDemand) {
        int working = attendancePlan.workingEmployees().size();
        int scheduled = Math.max(1, attendancePlan.outcomes().size());
        int idealStaff = Math.max(2, Math.min(12, 2 + targetedDemand / 36));
        double scheduleCoverage = (double) working / idealStaff;
        double absenteePenalty = 1.0 - ((double) (scheduled - working) / scheduled) * 0.28;
        return Math.max(0.68, Math.min(1.22, scheduleCoverage * absenteePenalty));
    }

    private CapacityEnvelope buildCapacityEnvelope(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                                   AttendancePlan attendancePlan, int targetedDemand,
                                                   List<SimProduct> productCatalog, Daypart daypart) {
        double kitchenMinutesAvailable = 0.0;
        double frontTransactionsAvailable = 0.0;
        for (AttendanceOutcome outcome : attendancePlan.outcomes()) {
            if (outcome.actualStart() == null || outcome.actualEnd() == null) {
                continue;
            }
            double workedHours = overlapHoursInDaypart(outcome, daypart);
            if (workedHours <= 0.0) {
                continue;
            }
            String roleCode = outcome.employee().getRoleCode();
            kitchenMinutesAvailable += workedHours * OperationalRealism.kitchenMinutesPerHour(roleCode);
            frontTransactionsAvailable += workedHours * OperationalRealism.transactionThroughputPerHour(roleCode);
        }

        double overlapMinutes = manufacturingOverlapMinutes(ctx, outlet, daypart);
        double cappedOverlap = Math.min(overlapMinutes, kitchenMinutesAvailable * 0.30);
        kitchenMinutesAvailable = Math.max(30.0, kitchenMinutesAvailable - cappedOverlap);
        double avgPrepMinutes = Math.max(0.75,
                OperationalRealism.weightedAveragePrepMinutes(productCatalog)
                        * OperationalRealism.averageItemsPerOrder(day)
                        * 0.82);
        double throughputBoost = "transit".equals(outlet.getLocationTier()) ? 1.46
                : "prime".equals(outlet.getLocationTier()) ? 1.40 : 1.34;
        int kitchenOrders = Math.max(0, (int) Math.floor((kitchenMinutesAvailable / avgPrepMinutes) * throughputBoost));
        int frontOrders = Math.max(0, (int) Math.floor(frontTransactionsAvailable * (throughputBoost + 0.06)));
        int seatLimitedOrders = Math.max(4,
                (int) Math.floor(OperationalRealism.totalSeatLimitedOrders(outlet, day) * daypart.capacityShare()));
        double coverageFactor = Math.max(1.00, Math.min(1.20, staffingFactor(outlet, attendancePlan, targetedDemand)));
        int maxOrders = Math.max(0, (int) Math.floor(Math.min(frontOrders, Math.min(kitchenOrders, seatLimitedOrders)) * coverageFactor));
        return new CapacityEnvelope(frontOrders, kitchenOrders, seatLimitedOrders, maxOrders);
    }

    private long averageOrderValue(SimulationContext ctx, SimOutlet outlet, LocalDate day, List<SimProduct> productCatalog) {
        double totalWeight = 0.0;
        double weightedProductValue = 0.0;
        for (SimProduct product : productCatalog) {
            OperationalRealism.DishProfile profile = OperationalRealism.dishProfileFor(product);
            long effectiveCost = scaledEffectiveProductCost(
                    ctx, outlet, product, RegionalEconomics.marketCode(outlet), day);
            long effectivePrice = RegionalEconomics.effectiveProductPrice(
                    product, effectiveCost, outlet, ctx.getConfig().startDate(), day);
            weightedProductValue += effectivePrice * profile.demandWeight();
            totalWeight += profile.demandWeight();
        }
        if (totalWeight <= 0.0) {
            return 0L;
        }
        double averageItemValue = weightedProductValue / totalWeight;
        return Math.max(1L, Math.round(averageItemValue * OperationalRealism.averageItemsPerOrder(day)));
    }

    private long estimateMonthlyPayrollRunRate(List<SimEmployee> outletEmployees) {
        return outletEmployees.stream()
                .mapToLong(this::monthlyPayrollEquivalent)
                .sum();
    }

    private long monthlyPayrollEquivalent(SimEmployee employee) {
        long localized = "hourly".equals(employee.getSalaryType())
                ? Math.round(employee.getBaseSalary() * PART_TIME_MONTHLY_HOURS)
                : employee.getBaseSalary();
        return RegionalEconomics.convertToReportingCurrency(localized, employee.getCurrencyCode());
    }

    private long expectedMonthlyOperatingRunRate(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        int salesRunRate = Math.max(outlet.getCurrentMonthCompletedSales(), OutletBusinessController.salesRunRate(outlet, day));
        var expenseProfile = RegionalEconomics.expenseProfile(
                outlet,
                ctx.getConfig().startDate(),
                day,
                outlet.getActiveStaffCount(),
                salesRunRate);
        long localized = expenseProfile.rent() + expenseProfile.utilities() + expenseProfile.maintenance();
        return RegionalEconomics.convertToReportingCurrency(localized, expenseProfile.currencyCode());
    }

    private SimProduct pickProductForSale(SimulationContext ctx, SimOutlet outlet, LocalDate day, int hour,
                                          List<SimProduct> productCatalog, List<SimProduct> alreadySelected,
                                          SimulationRandom rng) {
        return pickProductForSale(ctx, outlet, day, hour, productCatalog, alreadySelected, rng, false);
    }

    private SimProduct pickProductForSale(SimulationContext ctx, SimOutlet outlet, LocalDate day, int hour,
                                          List<SimProduct> productCatalog, List<SimProduct> alreadySelected,
                                          SimulationRandom rng, boolean requireFulfillable) {
        double totalWeight = 0;
        List<Double> weights = new ArrayList<>(productCatalog.size());
        boolean promoted = !ctx.getActivePromotionsForOutlet(outlet.getId()).isEmpty();
        boolean weekend = day.getDayOfWeek().getValue() >= 5;

        for (SimProduct product : productCatalog) {
            if (alreadySelected.stream().anyMatch(selected -> selected.id() == product.id())) {
                weights.add(0.0);
                continue;
            }
            if (requireFulfillable && !isProductFulfillable(ctx, outlet, product)) {
                weights.add(0.0);
                continue;
            }

            double weight = switch (product.categoryCode()) {
                case "PHO_SOUP" -> hour <= 11 ? 1.45 : hour <= 15 ? 1.05 : 0.85;
                case "RICE", "XAO" -> hour >= 11 && hour <= 14 ? 1.35 : hour >= 17 ? 1.20 : 0.90;
                case "BANH_MI" -> hour <= 10 || hour >= 15 ? 1.30 : 0.85;
                case "BUN", "SIDE" -> weekend ? 1.18 : 1.0;
                case "DRINK" -> hour >= 14 ? 1.25 : 0.92;
                case "BANH" -> hour >= 15 ? 1.10 : 0.78;
                default -> 1.0;
            };

            if (promoted) {
                weight *= 1.10;
            }
            if (ChronoUnit.DAYS.between(outlet.getOpenedDate(), day) < 30) {
                weight *= 0.95;
            }
            long effectiveCost = scaledEffectiveProductCost(
                    ctx, outlet, product, RegionalEconomics.marketCode(outlet), day);
            long effectivePrice = RegionalEconomics.effectiveProductPrice(
                    product, effectiveCost, outlet, ctx.getConfig().startDate(), day);
            OperationalRealism.DishProfile profile = OperationalRealism.dishProfileFor(product);
            MenuData.ProductCommercialProfile commercialProfile = MenuData.commercialProfile(
                    product.name(), product.categoryCode(), product.priceAmount());
            double marginRate = effectivePrice <= 0 ? 0.0 : (effectivePrice - effectiveCost) / (double) effectivePrice;
            double prepEfficiency = clamp(0.78 + marginRate * 0.58 - profile.finishMinutesPerPortion() * 0.024, 0.60, 1.20);
            double contributionBias = clamp(0.84 + marginRate * 0.48, 0.76, 1.18);
            double regionFit = regionPreference(outlet, product);
            double availableWeight = availabilityFactor(ctx, outlet, product);
            double daypartFit = MenuData.daypartFit(commercialProfile, daypartBlockCode(hour));
            double deliveryFit = clamp(
                    0.88
                            + commercialProfile.deliverySuitability() * Math.max(0.0, 1.0 - outlet.getDineInShare()) * 0.28
                            + Math.max(0.0, outlet.getDeliveryCatchmentStrength() - 1.0) * 0.10,
                    0.86, 1.24);
            double popularity = clamp(commercialProfile.basePopularity() * 0.98, 0.74, 1.28);
            double complexityPenalty = clamp(1.08 - commercialProfile.prepComplexity() * 0.11, 0.72, 1.06);
            if (marginRate < 0.42 && profile.finishMinutesPerPortion() >= 3.8) {
                availableWeight *= 0.90;
            }
            weight *= prepEfficiency * contributionBias * regionFit * availableWeight
                    * daypartFit * deliveryFit * popularity * complexityPenalty;

            weights.add(weight);
            totalWeight += weight;
        }

        if (totalWeight <= 0) {
            return null;
        }

        double roll = rng.doubleBetween(0, totalWeight);
        double cumulative = 0;
        for (int i = 0; i < productCatalog.size(); i++) {
            cumulative += weights.get(i);
            if (roll <= cumulative) {
                return productCatalog.get(i);
            }
        }
        return productCatalog.getLast();
    }

    private long scaledEffectiveProductCost(SimulationContext ctx, SimOutlet outlet, SimProduct product,
                                            String marketCode, LocalDate day) {
        long baseCost = RegionalEconomics.effectiveProductCost(
                ctx.getItems(), product, marketCode, ctx.getConfig().startDate(), day);
        int activeSubregionOutlets = (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode());
        int activeCountryOutlets = (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode());
        return RegionalEconomics.scaleProcurementCost(baseCost, activeSubregionOutlets, activeCountryOutlets);
    }

    private SimProduct chooseSubstituteProduct(SimulationContext ctx, SimOutlet outlet, LocalDate day, int hour,
                                               List<SimProduct> productCatalog, List<SimProduct> alreadySelected,
                                               SimProduct unavailableProduct, SimulationRandom rng) {
        if (!rng.chance(0.96)) {
            return null;
        }
        List<SimProduct> exclusions = new ArrayList<>(alreadySelected);
        exclusions.add(unavailableProduct);
        List<SimProduct> sameCategory = productCatalog.stream()
                .filter(product -> product.categoryCode().equals(unavailableProduct.categoryCode()))
                .toList();
        for (int attempt = 0; attempt < 4; attempt++) {
            SimProduct substitute = pickProductForSale(
                    ctx, outlet, day, hour,
                    sameCategory.isEmpty() ? productCatalog : sameCategory,
                    exclusions,
                    rng,
                    true);
            if (substitute != null) {
                return substitute;
            }
        }
        return pickProductForSale(ctx, outlet, day, hour, productCatalog, exclusions, rng, true);
    }

    private SimProduct chooseRescueFulfillableProduct(SimulationContext ctx, SimOutlet outlet, LocalDate day, int hour,
                                                      List<SimProduct> productCatalog, SimulationRandom rng) {
        if (!rng.chance(0.82)) {
            return null;
        }
        List<SimProduct> preferred = productCatalog.stream()
                .filter(product -> "BANH_MI".equals(product.categoryCode())
                        || "DRINK".equals(product.categoryCode())
                        || "BANH".equals(product.categoryCode())
                        || "SIDE".equals(product.categoryCode()))
                .toList();
        SimProduct rescue = pickProductForSale(
                ctx, outlet, day, hour,
                preferred.isEmpty() ? productCatalog : preferred,
                List.of(),
                rng,
                true);
        if (rescue != null) {
            return rescue;
        }
        return pickProductForSale(ctx, outlet, day, hour, productCatalog, List.of(), rng, true);
    }

    private boolean isProductFulfillable(SimulationContext ctx, SimOutlet outlet, SimProduct product) {
        for (SimProduct.RecipeItem recipeItem : product.recipeItems()) {
            var stock = ctx.getOutletStock(outlet.getId(), recipeItem.itemId());
            if (stock == null || stock.getCurrentStock() < recipeItem.quantity()) {
                return false;
            }
        }
        return true;
    }

    private double availabilityFactor(SimulationContext ctx, SimOutlet outlet, SimProduct product) {
        if (product.recipeItems().isEmpty()) {
            return 1.0;
        }
        double minCoverage = Double.MAX_VALUE;
        double meanCoverage = 0.0;
        double minReserveRatio = Double.MAX_VALUE;
        double averageReserveRatio = 0.0;
        for (SimProduct.RecipeItem recipeItem : product.recipeItems()) {
            var stock = ctx.getOutletStock(outlet.getId(), recipeItem.itemId());
            double coverage = stock == null ? 0.0 : stock.getCurrentStock() / (double) Math.max(1, recipeItem.quantity());
            minCoverage = Math.min(minCoverage, coverage);
            meanCoverage += Math.min(4.0, coverage);
            double reserveRatio = stock == null ? 0.0 : stock.getCurrentStock() / (double) Math.max(1, stock.getMinStockLevel());
            minReserveRatio = Math.min(minReserveRatio, reserveRatio);
            averageReserveRatio += Math.min(1.5, reserveRatio);
        }
        meanCoverage /= product.recipeItems().size();
        averageReserveRatio /= product.recipeItems().size();
        double factor = 0.02
                + Math.min(0.76, Math.min(1.0, minCoverage) * 0.76)
                + Math.min(0.20, meanCoverage * 0.08)
                + Math.min(0.18, averageReserveRatio * 0.12);
        if (minReserveRatio < 0.25) {
            factor *= 0.24;
        } else if (minReserveRatio < 0.45) {
            factor *= 0.44;
        } else if (minReserveRatio < 0.70) {
            factor *= 0.64;
        }
        return Math.max(0.03, Math.min(1.25, factor));
    }

    private int plannedItemCount(LocalDate day, Daypart daypart, SimulationRandom rng) {
        double targetAverage = OperationalRealism.averageItemsPerOrder(day);
        int items = 1;
        if (rng.chance(Math.max(0.0, Math.min(0.85, targetAverage - 1.0)))) {
            items++;
        }
        if (targetAverage > 1.55 && daypart.multiItemMax() >= 3
                && rng.chance(Math.max(0.0, Math.min(0.35, targetAverage - 1.50)))) {
            items++;
        }
        return Math.max(1, Math.min(daypart.multiItemMax(), items));
    }

    static String inferOrderType(SimOutlet outlet, String daypartName, LocalDate day, SimulationRandom rng) {
        boolean weekend = day.getDayOfWeek().getValue() >= 5;
        double dineInShare = clamp(outlet.getDineInShare() + switch (daypartName) {
            case "06_08", "08_10" -> -0.14;
            case "10_12" -> -0.05;
            case "12_14" -> 0.08;
            case "14_16" -> -0.08;
            case "16_18" -> -0.02;
            case "18_20" -> weekend ? 0.10 : 0.05;
            case "20_22" -> -0.16;
            default -> weekend ? 0.06 : 0.0;
        }, 0.22, 0.72);
        return rng.chance(dineInShare) ? "dine_in" : "delivery";
    }

    private List<Daypart> allocateDayparts(LocalDate day, int salesCount, SimulationRandom rng) {
        Map<String, Double> weights = new LinkedHashMap<>();
        boolean weekend = day.getDayOfWeek().getValue() >= 5;
        weights.put("06_08", weekend ? 0.04 : 0.05);
        weights.put("08_10", weekend ? 0.07 : 0.09);
        weights.put("10_12", weekend ? 0.12 : 0.13);
        weights.put("12_14", weekend ? 0.20 : 0.23);
        weights.put("14_16", weekend ? 0.09 : 0.10);
        weights.put("16_18", weekend ? 0.13 : 0.12);
        weights.put("18_20", weekend ? 0.24 : 0.20);
        weights.put("20_22", weekend ? 0.11 : 0.08);

        int assigned = 0;
        List<Daypart> dayparts = new ArrayList<>();
        int index = 0;
        for (var entry : weights.entrySet()) {
            int bucketCount = index == weights.size() - 1
                    ? Math.max(0, salesCount - assigned)
                    : (int) Math.round(salesCount * entry.getValue());
            assigned += bucketCount;
            dayparts.add(daypartProfile(entry.getKey(), rng, bucketCount));
            index++;
        }
        return dayparts;
    }

    private int hourHint(String daypart, SimulationRandom rng) {
        return switch (daypart) {
            case "06_08" -> rng.intBetween(6, 7);
            case "08_10" -> rng.intBetween(8, 9);
            case "10_12" -> rng.intBetween(10, 11);
            case "12_14" -> rng.intBetween(12, 13);
            case "14_16" -> rng.intBetween(14, 15);
            case "16_18" -> rng.intBetween(16, 17);
            case "18_20" -> rng.intBetween(18, 19);
            default -> rng.intBetween(20, 21);
        };
    }

    private OffsetDateTime distributedTimestampForDaypart(SimulationContext ctx, SimOutlet outlet, Daypart daypart,
                                                          int saleIndex, int totalSales) {
        BlockWindow blockWindow = blockWindow(daypart.name());
        int startHour = blockWindow.startHour();
        int endHour = blockWindow.endHour();
        return ctx.getClock().distributedTimestamp(saleIndex, totalSales, startHour, endHour,
                ctx.getTimezoneForRegion(RegionalEconomics.marketCode(outlet)));
    }

    private Daypart daypartProfile(String name, SimulationRandom rng, int bucketCount) {
        return switch (name) {
            case "06_08" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.08, 1, 0.05, 6, 8, 0.32, 0.34);
            case "08_10" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.12, 2, 0.09, 8, 10, 0.44, 0.42);
            case "10_12" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.18, 2, 0.13, 10, 12, 0.48, 0.50);
            case "12_14" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.30, 3, 0.22, 12, 14, 0.58, 0.56);
            case "14_16" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.16, 2, 0.10, 14, 16, 0.46, 0.44);
            case "16_18" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.20, 2, 0.12, 16, 18, 0.52, 0.48);
            case "18_20" -> new Daypart(name, hourHint(name, rng), bucketCount, 0.28, 3, 0.21, 18, 20, 0.60, 0.54);
            default -> new Daypart(name, hourHint(name, rng), bucketCount, 0.12, 2, 0.08, 20, 22, 0.42, 0.40);
        };
    }

    private double overlapHoursInDaypart(AttendanceOutcome outcome, Daypart daypart) {
        if (outcome.actualStart() == null || outcome.actualEnd() == null) {
            return 0.0;
        }
        int startHour = Math.max(daypart.startHour(), outcome.actualStart().getHour());
        int endHour = Math.min(daypart.endHour(), outcome.actualEnd().getHour());
        if (endHour <= startHour) {
            return 0.0;
        }
        return endHour - startHour;
    }

    private double manufacturingOverlapMinutes(SimulationContext ctx, SimOutlet outlet, Daypart daypart) {
        double overlapFactor = switch (daypart.name()) {
            case "06_08", "08_10" -> 0.20;
            case "10_12", "12_14" -> 0.10;
            case "14_16" -> 0.06;
            case "16_18", "18_20" -> 0.08;
            default -> 0.03;
        };
        return ctx.getManufacturingLaborToday(outlet.getId()) * overlapFactor;
    }

    private List<BlockAssignment> blockAssignments(AttendanceOutcome outcome) {
        List<BlockAssignment> assignments = new ArrayList<>();
        for (BlockWindow block : BLOCK_WINDOWS) {
            OffsetDateTime blockStart = outcome.actualStart().withHour(block.startHour()).withMinute(0).withSecond(0).withNano(0);
            OffsetDateTime blockEnd = outcome.actualStart().withHour(block.endHour()).withMinute(0).withSecond(0).withNano(0);
            OffsetDateTime start = outcome.actualStart().isAfter(blockStart) ? outcome.actualStart() : blockStart;
            OffsetDateTime end = outcome.actualEnd().isBefore(blockEnd) ? outcome.actualEnd() : blockEnd;
            if (!end.isAfter(start)) {
                continue;
            }
            assignments.add(new BlockAssignment(block.code(), start, end));
        }
        return assignments;
    }

    private BlockWindow blockWindow(String code) {
        return BLOCK_WINDOWS.stream()
                .filter(block -> block.code().equals(code))
                .findFirst()
                .orElseGet(() -> BLOCK_WINDOWS.get(0));
    }

    private String blockCodeForHour(int hour) {
        return BLOCK_WINDOWS.stream()
                .filter(block -> hour >= block.startHour() && hour < block.endHour())
                .map(BlockWindow::code)
                .findFirst()
                .orElse("20_22");
    }

    private String daypartBlockCode(int hour) {
        return blockCodeForHour(hour);
    }

    private double subregionSaturationFactor(SimulationContext ctx, SimOutlet outlet) {
        List<SimOutlet> peers = ctx.getActiveOutlets().stream()
                .filter(peer -> peer.getId() != outlet.getId())
                .filter(peer -> peer.getSubregionCode().equals(outlet.getSubregionCode()))
                .toList();
        long peerCount = peers.size();
        if (peerCount <= 0) {
            return 1.0;
        }
        long daysOpen = Math.max(0, ChronoUnit.DAYS.between(outlet.getOpenedDate(), ctx.getClock().getCurrentDate()));
        double overlapPenalty = 0.07 + ("prime".equals(outlet.getLocationTier()) ? 0.02 : 0.0);
        double relief = Math.max(0.90, outlet.getFootTrafficIndex() * 0.88 + outlet.getCrowdIndex() * 0.08);
        double launchRelief = daysOpen < 150 ? Math.max(0.0, (150 - daysOpen) / 150.0) * 0.14 : 0.0;
        double maturePenalty = daysOpen >= 180 ? peerCount * 0.022 : daysOpen >= 90 ? peerCount * 0.011 : 0.0;
        double peerOverflowRelief = peers.stream()
                .mapToDouble(peer -> clamp(
                        peer.getRollingStockoutLossRate() * 0.14
                                + peer.getRollingServiceLossRate() * 0.12
                                + Math.max(0.0, peer.getRollingCapacityPressure() - 1.0) * 0.10,
                        0.0, 0.14))
                .average()
                .orElse(0.0);
        double localAccessRelief = Math.min(0.08, peerCount * 0.032);
        return Math.max(0.86,
                1.0 - Math.min(0.24, peerCount * overlapPenalty / relief + maturePenalty)
                        + launchRelief + peerOverflowRelief + localAccessRelief);
    }

    private double sameSubregionOverflowCapture(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        long outletAgeDays = Math.max(0, ChronoUnit.DAYS.between(outlet.getOpenedDate(), day));
        if (outletAgeDays >= 180 || ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) <= 1) {
            return 1.0;
        }

        List<SimOutlet> peers = ctx.getActiveOutlets().stream()
                .filter(peer -> peer.getId() != outlet.getId())
                .filter(peer -> peer.getSubregionCode().equals(outlet.getSubregionCode()))
                .toList();
        if (peers.isEmpty()) {
            return 1.0;
        }

        double peerOverflow = peers.stream()
                .mapToDouble(peer -> clamp(
                        peer.getRollingStockoutLossRate() * 0.42
                                + peer.getRollingServiceLossRate() * 0.26
                                + Math.max(0.0, peer.getRollingCapacityPressure() - 1.0) * 0.16,
                        0.0, 1.0))
                .average()
                .orElse(0.0);
        double peerThroughput = peers.stream()
                .mapToDouble(SimOutlet::getRollingThroughputUtilization)
                .average()
                .orElse(0.0);
        double peerReputation = peers.stream()
                .mapToDouble(SimOutlet::getReputationScore)
                .average()
                .orElse(0.98);
        double ageFactor = outletAgeDays < 21 ? 0.28 : outletAgeDays < 60 ? 0.20 : outletAgeDays < 120 ? 0.12 : 0.06;
        double captureBoost = peerOverflow * ageFactor
                + Math.max(0.0, peerReputation - 0.99) * 0.08
                + Math.max(0.0, peerThroughput - 0.75) * 0.06;
        return clamp(1.0 + captureBoost, 1.0, 1.20);
    }

    private double regionPreference(SimOutlet outlet, SimProduct product) {
        String region = outlet.getSubregionCode();
        return switch (region) {
            case "US-NYC", "US-LA" -> switch (product.categoryCode()) {
                case "BANH_MI", "RICE", "DRINK" -> 1.08;
                case "PHO_SOUP", "BUN" -> 0.98;
                default -> 1.0;
            };
            case "JP-TYO" -> switch (product.categoryCode()) {
                case "PHO_SOUP", "RICE", "DRINK" -> 1.06;
                case "BANH_MI" -> 0.94;
                default -> 1.0;
            };
            default -> switch (product.categoryCode()) {
                case "PHO_SOUP", "BUN", "BANH_MI" -> 1.05;
                case "DRINK", "BANH" -> 0.96;
                default -> 1.0;
            };
        };
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private double getSeasonalMultiplier(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        var regionConfig = ctx.getConfig().regions().stream()
                .filter(r -> r.code().equals(RegionalEconomics.marketCode(outlet)))
                .findFirst().orElse(null);
        if (regionConfig == null || regionConfig.seasonalMultipliers() == null) {
            return 1.0;
        }
        String quarter = "Q" + ((day.getMonthValue() - 1) / 3 + 1);
        return regionConfig.seasonalMultipliers().getOrDefault(quarter, 1.0);
    }

    private double getHolidayMultiplier(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        var regionConfig = ctx.getConfig().regions().stream()
                .filter(r -> r.code().equals(RegionalEconomics.marketCode(outlet)))
                .findFirst().orElse(null);
        if (regionConfig == null || regionConfig.holidays() == null) {
            return 1.0;
        }
        String dayStr = String.format(Locale.ROOT, "%02d-%02d", day.getMonthValue(), day.getDayOfMonth());
        return regionConfig.holidays().stream()
                .filter(h -> h.date().equals(dayStr))
                .mapToDouble(SimulationConfig.RegionConfig.HolidayConfig::demandMultiplier)
                .findFirst().orElse(1.0);
    }

    private record AttendancePlan(List<AttendanceOutcome> outcomes, List<SimEmployee> workingEmployees) {}

    private record AttendanceOutcome(
            SimEmployee employee,
            String attendanceStatus,
            OffsetDateTime actualStart,
            OffsetDateTime actualEnd,
            Long assignedByUserId,
            Long approvedByUserId,
            String note,
            boolean overtime,
            ShiftTemplate shiftTemplate
    ) {}

    private record CapacityEnvelope(
            int frontOrders,
            int kitchenOrders,
            int seatLimitedOrders,
            int maxOrders
    ) {}

    private record Daypart(
            String name,
            int hourHint,
            int saleCount,
            double promoBoostChance,
            int multiItemMax,
            double capacityShare,
            int startHour,
            int endHour,
            double sameDayShiftRate,
            double marginalOrderValueFactor
    ) {}

    private record ShiftTemplate(String label, int startHour, int durationHours) {}

    private record BlockWindow(String code, int startHour, int endHour) {}

    private record BlockAssignment(String blockCode, OffsetDateTime start, OffsetDateTime end) {}
}
