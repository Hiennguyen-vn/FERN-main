package com.fern.simulator.engine.phases;

import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.economics.OutletBusinessController;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimOutlet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Phase 7: Handles inventory waste, stock counts, and adjustments.
 * <p>
 * Daily waste is applied based on configurable waste rate.
 * Periodic stock counts verify accuracy (simulated, no actual variance).
 */
public class InventoryPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(InventoryPhase.class);

    @Override
    public String name() { return "Inventory"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        var unitsPerSale = estimateUnitsPerSale(ctx);
        rebalanceSubregionInventory(ctx, day, unitsPerSale);
        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            applyExpiryWaste(ctx, outlet, day);
            applyIncidentWaste(ctx, outlet, day);
            applyEndOfDayPreparedWaste(ctx, outlet, day, unitsPerSale);
        }

        // Stock count every 7 days
        if (day.getDayOfMonth() % 7 == 0) {
            conductStockCount(ctx, day);
        }
    }

    private void rebalanceSubregionInventory(SimulationContext ctx, LocalDate day,
                                             java.util.Map<Long, Double> unitsPerSale) {
        java.util.Map<String, List<SimOutlet>> outletsBySubregion = new java.util.LinkedHashMap<>();
        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            outletsBySubregion.computeIfAbsent(outlet.getSubregionCode(), ignored -> new ArrayList<>()).add(outlet);
        }

        for (List<SimOutlet> subregionOutlets : outletsBySubregion.values()) {
            if (subregionOutlets.size() < 2) {
                continue;
            }
            for (SimItem globalItem : ctx.getItems().values()) {
                rebalanceItemAcrossSubregion(ctx, day, unitsPerSale, subregionOutlets, globalItem);
            }
        }
    }

    private void rebalanceItemAcrossSubregion(SimulationContext ctx, LocalDate day,
                                              java.util.Map<Long, Double> unitsPerSale,
                                              List<SimOutlet> subregionOutlets,
                                              SimItem globalItem) {
        List<OutletStockNeed> donors = new ArrayList<>();
        List<OutletStockNeed> receivers = new ArrayList<>();

        for (SimOutlet outlet : subregionOutlets) {
            SimItem stock = ctx.getOutletStock(outlet.getId(), globalItem.getId());
            if (stock == null || stock.getCurrentStock() <= 0) {
                continue;
            }

            int transferNeed = transferNeedLevel(ctx, outlet, globalItem, day, unitsPerSale);
            int donorReserve = donorReserveLevel(ctx, outlet, globalItem, day, unitsPerSale, transferNeed);
            int currentStock = stock.getCurrentStock();

            if (currentStock < transferNeed) {
                receivers.add(new OutletStockNeed(outlet, transferNeed - currentStock));
            } else if (currentStock > donorReserve) {
                donors.add(new OutletStockNeed(outlet, currentStock - donorReserve));
            }
        }

        if (donors.isEmpty() || receivers.isEmpty()) {
            return;
        }

        donors.sort(java.util.Comparator.comparingInt(OutletStockNeed::qty).reversed());
        receivers.sort(java.util.Comparator.comparingInt(OutletStockNeed::qty).reversed());

        for (OutletStockNeed receiver : receivers) {
            int remainingNeed = receiver.qty();
            for (int i = 0; i < donors.size() && remainingNeed > 0; i++) {
                OutletStockNeed donor = donors.get(i);
                if (donor.qty() <= 0 || donor.outlet().getId() == receiver.outlet().getId()) {
                    continue;
                }

                int maxTransfer = Math.min(remainingNeed,
                        Math.min(donor.qty(), transferCap(globalItem, donor.outlet(), receiver.outlet())));
                if (maxTransfer <= 0) {
                    continue;
                }

                int moved = ctx.transferStock(donor.outlet().getId(), receiver.outlet().getId(),
                        globalItem.getId(), maxTransfer, day, "internal-rebalance");
                if (moved <= 0) {
                    continue;
                }

                remainingNeed -= moved;
                donors.set(i, donor.withQty(donor.qty() - moved));
            }
        }
    }

    private int transferNeedLevel(SimulationContext ctx, SimOutlet outlet, SimItem item, LocalDate day,
                                  java.util.Map<Long, Double> unitsPerSale) {
        int forecast = estimateNextDayForecast(ctx, outlet, item, day, unitsPerSale);
        double needFactor = item.isComposite() ? 1.04 : switch (item.getPerishabilityTier()) {
            case "very_high" -> 0.82;
            case "high" -> 0.90;
            case "medium" -> 0.98;
            case "low" -> 1.14;
            default -> 0.92;
        };
        if (outlet.getRollingStockoutLossRate() >= 0.12) {
            needFactor += 0.08;
        }
        if (java.time.temporal.ChronoUnit.DAYS.between(outlet.getOpenedDate(), day) < 45) {
            needFactor += 0.10;
        }
        return Math.max(item.getMinStockLevel(), (int) Math.ceil(forecast * needFactor));
    }

    private int donorReserveLevel(SimulationContext ctx, SimOutlet outlet, SimItem item, LocalDate day,
                                  java.util.Map<Long, Double> unitsPerSale, int transferNeed) {
        int forecast = estimateNextDayForecast(ctx, outlet, item, day, unitsPerSale);
        double reserveFactor = item.isComposite() ? 1.12 : switch (item.getPerishabilityTier()) {
            case "very_high" -> 1.00;
            case "high" -> 1.08;
            case "medium" -> 1.18;
            case "low" -> 1.30;
            default -> 1.18;
        };
        if (outlet.getWasteCostMonth() > 0 && outlet.getCurrentMonthRevenue() > 0
                && outlet.getWasteCostMonth() / (double) outlet.getCurrentMonthRevenue() >= 0.10) {
            reserveFactor -= 0.08;
        }
        return Math.max(transferNeed + 1, (int) Math.ceil(forecast * reserveFactor));
    }

    private int transferCap(SimItem item, SimOutlet donor, SimOutlet receiver) {
        int baseCap = switch (item.getPerishabilityTier()) {
            case "very_high" -> 10;
            case "high" -> 15;
            case "medium" -> 22;
            case "low" -> 30;
            default -> 18;
        };
        if (item.isComposite()) {
            baseCap = Math.max(6, baseCap - 2);
        }
        if (receiver.getRollingStockoutLossRate() >= 0.16) {
            baseCap += 6;
        }
        if (donor.getWasteCostMonth() > donor.getCurrentMonthRevenue() * 0.08) {
            baseCap += 4;
        }
        return Math.max(2, baseCap);
    }

    private void applyExpiryWaste(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        for (SimItem globalItem : ctx.getItems().values()) {
            SimItem stock = ctx.getOutletStock(outlet.getId(), globalItem.getId());
            if (stock == null || stock.getCurrentStock() <= 0) {
                continue;
            }
            int expiredQty = ctx.expireLots(outlet.getId(), globalItem.getId(), day);
            if (expiredQty > 0) {
                recordWaste(ctx, outlet, globalItem, day, expiredQty, "Expired ingredients");
            }
        }
    }

    private void applyIncidentWaste(SimulationContext ctx, SimOutlet outlet, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();
        double stressFactor = 1.0 + Math.min(0.45, outlet.getAttendanceStressScore() * 0.18)
                + Math.min(0.20, outlet.getLateDeliveryCount30d() * 0.03);

        for (SimItem globalItem : ctx.getItems().values()) {
            SimItem stock = ctx.getOutletStock(outlet.getId(), globalItem.getId());
            if (stock == null || stock.getCurrentStock() <= 0) {
                continue;
            }

            double incidentChance = baseIncidentChance(ctx, globalItem) * stressFactor;
            if (!rng.chance(incidentChance)) {
                continue;
            }

            int wasteQty = Math.max(1, (int) Math.round(stock.getCurrentStock()
                    * rng.doubleBetween(0.01, Math.min(0.10, 0.03 + globalItem.getDamageRiskWeight()))));
            wasteQty = Math.min(wasteQty, stock.getCurrentStock());
            String reason = pickIncidentReason(globalItem, rng);
            emitWaste(ctx, outlet, globalItem, day, wasteQty, reason);
        }
    }

    private void applyEndOfDayPreparedWaste(SimulationContext ctx, SimOutlet outlet, LocalDate day,
                                            java.util.Map<Long, Double> unitsPerSale) {
        for (SimItem globalItem : ctx.getItems().values()) {
            SimItem stock = ctx.getOutletStock(outlet.getId(), globalItem.getId());
            if (stock == null || stock.getCurrentStock() <= 0) {
                continue;
            }
            boolean preparedRisk = isPreparedWasteRisk(globalItem);
            if (!preparedRisk) {
                continue;
            }

            int nextDayForecast = estimateNextDayForecast(ctx, outlet, globalItem, day, unitsPerSale);
            double keepBuffer = globalItem.isComposite()
                    ? Math.max(1.28, 1.60 - outlet.getRollingStockoutLossRate() * 0.11)
                    : Math.max(0.94, 1.06 - outlet.getRollingStockoutLossRate() * 0.05);
            int excessQty = Math.max(0, stock.getCurrentStock() - (int) Math.ceil(nextDayForecast * keepBuffer));
            double wasteFactor = globalItem.isComposite()
                    ? clamp(globalItem.getPrepWasteWeight() * 0.042, 0.004, 0.020)
                    : clamp(globalItem.getPrepWasteWeight() * 0.020, 0.0015, 0.007);
            int wasteQty = Math.min(stock.getCurrentStock(),
                    (int) Math.round(excessQty * wasteFactor));
            if (wasteQty <= 0) {
                continue;
            }

            emitWaste(ctx, outlet, globalItem, day, wasteQty,
                    globalItem.isComposite() ? "End-of-day excess prepared stock" : "Fresh prep trim loss");
        }
    }

    private void conductStockCount(SimulationContext ctx, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            long sessionId = ctx.getIdGen().nextId();
            List<SimulationContext.StockCountLineEvent> lines = new ArrayList<>();
            Long approvedBy = findOutletApprover(ctx, outlet.getId());

            for (SimItem globalItem : ctx.getItems().values()) {
                SimItem stock = ctx.getOutletStock(outlet.getId(), globalItem.getId());
                if (stock != null) {
                    int systemQty = stock.getCurrentStock();
                    double varianceChance = 0.03 + globalItem.getDamageRiskWeight() * 0.10
                            + Math.min(0.06, outlet.getAttendanceStressScore() * 0.02);
                    int countedQty = systemQty;
                    if (systemQty > 10 && rng.chance(varianceChance)) {
                        int variance = Math.max(1, (int)(systemQty * rng.doubleBetween(0.01, 0.04)));
                        countedQty = rng.chance(0.5) ? systemQty + variance : Math.max(0, systemQty - variance);
                    }
                    lines.add(new SimulationContext.StockCountLineEvent(
                            globalItem.getId(), systemQty, countedQty));
                }
            }

            if (!lines.isEmpty()) {
                Long countedBy = ctx.getActiveEmployeesAtOutlet(outlet.getId()).stream()
                        .filter(e -> "inventory_clerk".equals(e.getRoleCode()) || "kitchen_staff".equals(e.getRoleCode()))
                        .map(com.fern.simulator.model.SimEmployee::getUserId).findFirst().orElse(approvedBy);
                ctx.addStockCountEvent(new SimulationContext.StockCountEvent(
                        sessionId, outlet.getId(), day, countedBy, approvedBy, "Weekly stock count", lines));
                ctx.incrementRowCount("stock_count_session", 1);
                ctx.incrementRowCount("stock_count_line", lines.size());

                // Emit inventory_adjustment for variances
                for (var line : lines) {
                    int variance = line.countedQty() - line.systemQty();
                    if (variance != 0) {
                        ctx.reconcileLots(outlet.getId(), line.itemId(), line.countedQty(), day);
                        long txnId = ctx.getIdGen().nextId();
                        String reason = variance > 0 ? "Stock count surplus" : "Stock count shortage";
                        ctx.addInventoryAdjustmentEvent(new SimulationContext.InventoryAdjustmentEvent(
                                txnId, outlet.getId(), line.itemId(), variance,
                                null, reason, approvedBy));
                        ctx.incrementRowCount("inventory_transaction", 1);
                        ctx.incrementRowCount("inventory_adjustment", 1);
                    }
                }
            }
            log.trace("Stock count at outlet {} on {}: {} items", outlet.getCode(), day, lines.size());
        }
    }

    private void emitWaste(SimulationContext ctx, SimOutlet outlet, SimItem item, LocalDate day,
                           int wasteQty, String reason) {
        if (wasteQty <= 0) {
            return;
        }
        int removed = ctx.wasteStock(outlet.getId(), item.getId(), wasteQty);
        if (removed <= 0) {
            return;
        }
        recordWaste(ctx, outlet, item, day, removed, reason);
    }

    private void recordWaste(SimulationContext ctx, SimOutlet outlet, SimItem item, LocalDate day,
                             int removedQty, String reason) {
        long txnId = ctx.getIdGen().nextId();
        Long approvedBy = findOutletApprover(ctx, outlet.getId());
        String marketCode = RegionalEconomics.marketCode(outlet);
        ctx.addWasteEvent(new SimulationContext.WasteEvent(
                txnId, outlet.getId(), item.getId(), removedQty, outlet.getRegionCode(), reason, approvedBy));
        ctx.incrementRowCount("inventory_transaction", 1);
        ctx.incrementRowCount("waste_record", 1);
        long unitWasteCost = RegionalEconomics.effectiveItemCost(
                item, marketCode, ctx.getConfig().startDate(), day);
        unitWasteCost = RegionalEconomics.scaleProcurementCost(
                unitWasteCost,
                (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()),
                (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode()));
        long wasteCost = removedQty * unitWasteCost;
        long reportingWasteCost = RegionalEconomics.convertToReportingCurrency(
                wasteCost, marketCode, ctx.getConfig().startDate(), day);
        ctx.recordWasteImpact(removedQty, reportingWasteCost, reason);
        outlet.addWasteCost(reportingWasteCost);
    }

    private double baseIncidentChance(SimulationContext ctx, SimItem item) {
        double configured = ctx.getConfig().realism() != null && ctx.getConfig().realism().categoryProfiles() != null
                && ctx.getConfig().realism().categoryProfiles().containsKey(item.getCategoryCode())
                ? ctx.getConfig().realism().categoryProfiles().get(item.getCategoryCode()).incidentWasteChance()
                : ctx.getConfig().probability().wasteRateDaily();
        return Math.max(0.0012, configured + item.getDamageRiskWeight() * 0.024);
    }

    private int estimateNextDayForecast(SimulationContext ctx, SimOutlet outlet, SimItem item, LocalDate day,
                                        java.util.Map<Long, Double> unitsPerSale) {
        double weekendFactor = day.plusDays(1).getDayOfWeek().getValue() >= 5 ? 1.12 : 1.0;
        double maturityFactor = Math.min(1.18, 0.86 + Math.max(0, day.toEpochDay() - outlet.getOpenedDate().toEpochDay()) / 320.0);
        int carryover = ctx.getCurrentCarryoverDemand(outlet.getId());
        double dailySalesForecast = seededDailyDemandForecast(ctx, outlet, day, estimateObservedDailyDemand(outlet, day))
                * weekendFactor * maturityFactor;
        double unitsForecast = unitsPerSale.getOrDefault(item.getId(), item.getMinStockLevel() * 0.10);
        double stockoutPressure = 1.0 + Math.min(0.42, outlet.getRollingStockoutLossRate() * 0.52);
        double wasteDiscipline = outlet.getCurrentMonthRevenue() > 0
                && outlet.getWasteCostMonth() / (double) outlet.getCurrentMonthRevenue() > 0.10 ? 0.95 : 1.0;
        double coordinationFactor = RegionalEconomics.forecastCoordinationMultiplier(
                (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()),
                (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode()));
        double coverage = item.isComposite() ? 1.18 : switch (item.getPerishabilityTier()) {
            case "very_high" -> 0.82;
            case "high" -> 0.94;
            case "low" -> 1.24;
            default -> 1.04;
        };
        int demandDriven = (int) Math.round(unitsForecast * dailySalesForecast * stockoutPressure
                * wasteDiscipline * coverage * coordinationFactor);
        int baseline = Math.max(1, (int) Math.round(item.getMinStockLevel() * 0.18 * weekendFactor));
        return Math.max(baseline, demandDriven + Math.max(0, carryover / 4));
    }

    private boolean isPreparedWasteRisk(SimItem item) {
        if (item.isComposite()) {
            return true;
        }
        if (item.getShelfLifeDays() > 2) {
            return false;
        }
        String category = item.getCategoryCode();
        if (!"VEGETABLE".equals(category) && !"AROMATIC".equals(category)) {
            return false;
        }
        String name = item.getName().toLowerCase(Locale.ROOT);
        return name.contains("bean sprouts")
                || name.contains("thai basil")
                || name.contains("mint")
                || name.contains("cilantro")
                || name.contains("perilla")
                || name.contains("lettuce");
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private String pickIncidentReason(SimItem item, SimulationRandom rng) {
        List<String> reasons = new ArrayList<>(List.of("Damaged goods", "Failed quality check"));
        if ("very_high".equals(item.getPerishabilityTier()) || "high".equals(item.getPerishabilityTier())) {
            reasons.add("Temperature or storage incident");
            reasons.add("Spoilage");
        }
        if (item.isComposite()) {
            reasons.add("End-of-day excess prepared stock");
        }
        return reasons.get(rng.intBetween(0, reasons.size() - 1));
    }

    private java.util.Map<Long, Double> estimateUnitsPerSale(SimulationContext ctx) {
        java.util.Map<Long, Double> weightedUsage = new java.util.HashMap<>();
        double totalWeight = 0.0;
        for (var product : ctx.getProducts().values()) {
            double weight = switch (product.categoryCode()) {
                case "PHO_SOUP" -> 1.30;
                case "RICE" -> 1.16;
                case "BANH_MI" -> 1.00;
                case "BUN" -> 1.08;
                case "XAO" -> 0.92;
                case "SIDE" -> 0.74;
                case "DRINK", "BANH" -> 0.55;
                default -> 1.0;
            };
            totalWeight += weight;
            for (var recipeItem : product.recipeItems()) {
                weightedUsage.merge(recipeItem.itemId(), recipeItem.quantity() * weight, Double::sum);
            }
        }
        if (totalWeight <= 0.0) {
            return java.util.Map.of();
        }
        double normalizer = totalWeight;
        weightedUsage.replaceAll((itemId, usage) -> usage / normalizer);
        return weightedUsage;
    }

    private double estimateRecentDailySales(SimOutlet outlet, LocalDate day) {
        int completedDaysThisMonth = Math.max(1, day.getDayOfMonth() - 1);
        double currentRate = outlet.getCurrentMonthCompletedSales() / (double) completedDaysThisMonth;
        if (outlet.getMonthlyCompletedSales().isEmpty()) {
            return Math.max(8.0, currentRate);
        }
        int samples = Math.min(3, outlet.getMonthlyCompletedSales().size());
        double trailingRate = 0.0;
        for (int i = outlet.getMonthlyCompletedSales().size() - samples; i < outlet.getMonthlyCompletedSales().size(); i++) {
            trailingRate += outlet.getMonthlyCompletedSales().get(i) / 30.0;
        }
        trailingRate /= samples;
        return Math.max(8.0, currentRate * 0.55 + trailingRate * 0.45);
    }

    private double estimateObservedDailyDemand(SimOutlet outlet, LocalDate day) {
        double servedDemand = estimateRecentDailySales(outlet, day);
        double stockoutDemand = OutletBusinessController.stockoutOrdersPerDay(outlet, day) * 1.20;
        double upliftedDemand = servedDemand + stockoutDemand;
        double clientBaseLift = 0.98 + Math.max(0.0, outlet.getClientBaseIndex() - 0.82) * 0.72
                + Math.max(0.0, outlet.getRepeatCustomerPool() - 0.20) * 0.52
                + Math.max(0.0, outlet.getDeliveryCatchmentStrength() - 1.0) * 0.28;
        return Math.max(12.0, Math.min((servedDemand * 1.80 + 10.0) * clientBaseLift, upliftedDemand * 1.16));
    }

    private double seededDailyDemandForecast(SimulationContext ctx, SimOutlet outlet, LocalDate day, double selfDemand) {
        long outletAgeDays = Math.max(0, java.time.temporal.ChronoUnit.DAYS.between(outlet.getOpenedDate(), day));
        if (outletAgeDays >= 90 || ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()) <= 1) {
            return selfDemand;
        }

        List<SimOutlet> peers = ctx.getActiveOutlets().stream()
                .filter(peer -> peer.getId() != outlet.getId())
                .filter(peer -> peer.getSubregionCode().equals(outlet.getSubregionCode()))
                .toList();
        if (peers.isEmpty()) {
            return selfDemand;
        }

        double peerDailySales = peers.stream()
                .mapToDouble(peer -> estimateRecentDailySales(peer, day))
                .average()
                .orElse(selfDemand);
        double peerDemandOverflow = peers.stream()
                .mapToDouble(peer -> clamp(
                        peer.getRollingStockoutLossRate() * 0.64
                                + peer.getRollingServiceLossRate() * 0.28
                                + Math.max(0.0, peer.getReputationScore() - 1.0) * 0.18,
                        0.0, 1.0))
                .average()
                .orElse(0.0);
        double ageFactor = outletAgeDays < 14 ? 0.92 : outletAgeDays < 45 ? 0.68 : 0.38;
        double seededDemand = peerDailySales
                * clamp(0.16 + peerDemandOverflow * 0.48, 0.14, 0.38)
                * ageFactor;
        return Math.max(selfDemand, Math.min(peerDailySales * 0.88, selfDemand + seededDemand));
    }

    private Long findOutletApprover(SimulationContext ctx, long outletId) {
        return ctx.getActiveEmployeesAtOutlet(outletId).stream()
                .filter(emp -> "outlet_manager".equals(emp.getRoleCode()) || "inventory_clerk".equals(emp.getRoleCode()))
                .map(emp -> emp.getUserId())
                .findFirst()
                .orElse(null);
    }

    private record OutletStockNeed(SimOutlet outlet, int qty) {
        private OutletStockNeed withQty(int newQty) {
            return new OutletStockNeed(outlet, newQty);
        }
    }
}
