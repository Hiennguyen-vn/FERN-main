package com.fern.simulator.engine.phases;

import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.economics.OutletBusinessController;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimProduct;
import com.fern.simulator.model.SimSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Phase 4: Handles procurement with supplier reliability, delivery uncertainty, and payment lag.
 */
public class ProcurementPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(ProcurementPhase.class);

    private final List<PendingInvoice> pendingInvoices = new ArrayList<>();
    private int invoiceSeq = 0;

    private static final class PendingInvoice {
        private final long invoiceId;
        private final long supplierId;
        private final String regionCode;
        private final String currencyCode;
        private final long amount;
        private final long receiptReferenceId;
        private final Map<Long, Integer> receivedQuantities;
        private final LocalDate readyDate;
        private final LocalDate dueDate;
        private final LocalDate scheduledPaymentDate;
        private final String note;
        private boolean posted;

        private PendingInvoice(long invoiceId, long supplierId, String regionCode, String currencyCode, long amount,
                               long receiptReferenceId, Map<Long, Integer> receivedQuantities,
                               LocalDate readyDate, LocalDate dueDate,
                               LocalDate scheduledPaymentDate, String note) {
            this.invoiceId = invoiceId;
            this.supplierId = supplierId;
            this.regionCode = regionCode;
            this.currencyCode = currencyCode;
            this.amount = amount;
            this.receiptReferenceId = receiptReferenceId;
            this.receivedQuantities = new LinkedHashMap<>(receivedQuantities);
            this.readyDate = readyDate;
            this.dueDate = dueDate;
            this.scheduledPaymentDate = scheduledPaymentDate;
            this.note = note;
        }
    }

    @Override
    public String name() { return "Procurement"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        processDeliveries(ctx, day);
        processInvoices(ctx, day);
        processPayments(ctx, day);
        checkAndReorder(ctx, day);
    }

    private void processDeliveries(SimulationContext ctx, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();
        var iter = ctx.getPendingPOs().iterator();
        while (iter.hasNext()) {
            SimulationContext.PendingPurchaseOrder po = iter.next();
            if (po.nextReceiptDate().isAfter(day)) {
                continue;
            }

            SimOutlet outlet = ctx.getOutlets().get(po.outletId());
            if (outlet == null || !outlet.isActive()) {
                iter.remove();
                continue;
            }
            String marketCode = RegionalEconomics.marketCode(outlet);
            int activeSubregionOutlets = (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode());
            int activeCountryOutlets = (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode());

            if (!po.late() && shouldDelay(ctx, po, rng)) {
                int delayDays = rng.intBetween(1, 3);
                po.setNextReceiptDate(day.plusDays(delayDays));
                po.setExpectedDeliveryDate(po.expectedDeliveryDate().plusDays(delayDays));
                po.setLate(true);
                ctx.markSupplierLate(po.supplierId());
                outlet.incrementLateDeliveryCount();
                outlet.addAttendanceStress(0.25);
                continue;
            }

            Map<Long, Integer> delivered = buildDeliveredQuantities(ctx, po, rng);
            boolean partialReceipt = delivered.values().stream().mapToInt(Integer::intValue).sum()
                    < po.remainingQuantities().values().stream().mapToInt(Integer::intValue).sum();
            Map<Long, Integer> accepted = po.applyReceipt(delivered);
            if (accepted.isEmpty()) {
                iter.remove();
                continue;
            }

            OffsetDateTime receiptTime = ctx.getClock().timestampAt(9, rng.intBetween(0, 45),
                    ctx.getTimezoneForRegion(po.regionCode()));
            Long approverId = findOutletOperator(ctx, po.outletId(), "outlet_manager", "inventory_clerk", "cashier");
            String lotRef = "LOT-" + po.poId() + "-" + day.getDayOfYear();
            String note = partialReceipt
                    ? "Partial delivery received after supplier constraint"
                    : po.late() ? "Delayed delivery received" : "Scheduled delivery received";

            long totalReceiptCost = 0;
            LocalDate manufactureDate = day.minusDays(rng.intBetween(0, 2));
            LocalDate expiryDate = null;
            Map<Long, Integer> cumulative = new LinkedHashMap<>(po.cumulativeReceivedQuantities());

            for (var entry : accepted.entrySet()) {
                SimItem item = ctx.getItems().get(entry.getKey());
                if (item == null) {
                    continue;
                }
                LocalDate itemExpiry = manufactureDate.plusDays(Math.max(1, item.getShelfLifeDays()));
                expiryDate = expiryDate == null || itemExpiry.isBefore(expiryDate) ? itemExpiry : expiryDate;
                ctx.addInventoryLot(po.outletId(), item.getId(), entry.getValue(), day, manufactureDate, itemExpiry, lotRef);
                long scaledUnitCost = RegionalEconomics.scaleProcurementCost(
                        RegionalEconomics.effectiveItemCost(
                                item, marketCode, ctx.getConfig().startDate(), day),
                        activeSubregionOutlets,
                        activeCountryOutlets);
                totalReceiptCost += scaledUnitCost * entry.getValue();
            }

            ctx.markGoodsReceived(new SimulationContext.GoodsReceiptEvent(
                    po.poId(), po.outletId(), po.supplierId(), po.regionCode(), po.currencyCode(),
                    accepted, cumulative, new LinkedHashMap<>(po.orderedQuantities()),
                    totalReceiptCost, receiptTime, day, note, lotRef,
                    po.createdByUserId(), approverId, partialReceipt, po.late(), manufactureDate, expiryDate
            ));
            ctx.getCurrentMonth().addGr();
            ctx.getCurrentMonth().addProcurementCost(
                    RegionalEconomics.convertToReportingCurrency(totalReceiptCost, po.currencyCode()));

            long expenseId = ctx.getIdGen().nextId();
            ctx.addExpenseEvent(new SimulationContext.ExpenseEvent(
                    expenseId, po.outletId(), day, po.currencyCode(), totalReceiptCost, "inventory_purchase",
                    "Goods receipt for PO " + po.poId(), null, po.createdByUserId()));
            ctx.incrementRowCount("expense_record", 1);
            ctx.addExpenseSubtypeEvent(new SimulationContext.ExpenseSubtypeEvent(
                    expenseId, "inventory_purchase", note, po.poId()));
            ctx.incrementRowCount("expense_inventory_purchase", 1);

            int invoiceLag = ctx.getConfig().realism() != null
                    ? rng.intBetween(ctx.getConfig().realism().minInvoiceLagDays(), ctx.getConfig().realism().maxInvoiceLagDays())
                    : rng.intBetween(1, 5);
            long invoiceId = ctx.getIdGen().nextId();
            String invoiceNumber = ctx.getNamespace() + "-INV-" + String.format("%06d", ++invoiceSeq);
            long taxAmount = Math.round(totalReceiptCost * 0.08);
            long totalInvoiceAmount = totalReceiptCost + taxAmount;
            LocalDate readyDate = day.plusDays(invoiceLag);
            LocalDate dueDate = readyDate.plusDays(15);
            LocalDate paymentDate = schedulePaymentDate(ctx, readyDate, dueDate, totalInvoiceAmount, rng);
            pendingInvoices.add(new PendingInvoice(invoiceId, po.supplierId(), marketCode, po.currencyCode(), totalInvoiceAmount,
                    po.poId(), accepted, readyDate, dueDate, paymentDate, invoiceNumber + " for PO " + po.poId()));

            if (partialReceipt && !po.isComplete()) {
                po.setPartial(true);
                po.setNextReceiptDate(day.plusDays(rng.intBetween(1, 4)));
                ctx.markSupplierPartial(po.supplierId());
                outlet.addAttendanceStress(0.18);
            } else {
                ctx.markSupplierRecovered(po.supplierId());
                iter.remove();
            }
        }
    }

    private void processInvoices(SimulationContext ctx, LocalDate day) {
        var readyToday = pendingInvoices.stream()
                .filter(inv -> !inv.posted && !day.isBefore(inv.readyDate))
                .toList();

        for (PendingInvoice inv : readyToday) {
            List<SimulationContext.InvoiceLineEvent> lines = new ArrayList<>();
            int lineNumber = 1;
            for (var entry : inv.receivedQuantities.entrySet()) {
                SimItem item = ctx.getItems().get(entry.getKey());
                if (item == null || entry.getValue() <= 0) {
                    continue;
                }
                long unitCost = RegionalEconomics.scaleProcurementCost(
                        RegionalEconomics.effectiveItemCost(
                                item, inv.regionCode, ctx.getConfig().startDate(), day),
                        (int) ctx.countActiveOutletsInSubregion(inv.regionCode),
                        (int) ctx.countActiveOutletsInCountry(inv.regionCode));
                long lineCost = unitCost * entry.getValue();
                long lineTax = Math.round(lineCost * 0.08);
                String itemDescription = item.getName();
                lines.add(new SimulationContext.InvoiceLineEvent(
                        lineNumber++, entry.getKey(), null, entry.getValue(), unitCost, lineTax, lineCost + lineTax,
                        itemDescription, 8.0
                ));
            }

            long subtotal = Math.max(0L, inv.amount - Math.round(inv.amount / 1.08 * 0.08));
            long taxAmount = inv.amount - subtotal;
            ctx.addInvoiceEvent(new SimulationContext.InvoiceEvent(
                    inv.invoiceId,
                    inv.note.split(" ")[0],
                    inv.supplierId,
                    inv.currencyCode,
                    day,
                    inv.dueDate,
                    subtotal,
                    taxAmount,
                    inv.amount,
                    inv.receiptReferenceId,
                    "approved",
                    "Invoice matched after receipt verification",
                    lines
            ));

            ctx.incrementRowCount("supplier_invoice", 1);
            ctx.incrementRowCount("supplier_invoice_receipt", 1);
            ctx.incrementRowCount("supplier_invoice_item", lines.size());
            inv.posted = true;
        }
    }

    private void processPayments(SimulationContext ctx, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();
        List<PendingInvoice> remaining = new ArrayList<>();
        for (PendingInvoice inv : pendingInvoices) {
            if (!inv.posted || day.isBefore(inv.scheduledPaymentDate)) {
                remaining.add(inv);
                continue;
            }
            long paymentId = ctx.getIdGen().nextId();
            OffsetDateTime paymentTime = ctx.getClock().timestampAt(10, rng.intBetween(0, 40),
                    ctx.getTimezoneForRegion(inv.regionCode));
            Long operatorId = ctx.getActiveEmployees().stream().findFirst().map(SimEmployee::getUserId).orElse(null);
            ctx.addSupplierPaymentEvent(new SimulationContext.SupplierPaymentEvent(
                    paymentId, inv.supplierId, inv.currencyCode, "bank_transfer",
                    inv.amount, paymentTime, inv.invoiceId,
                    "TRX-" + paymentId, inv.note, operatorId
            ));
            ctx.incrementRowCount("supplier_payment", 1);
            ctx.incrementRowCount("supplier_payment_allocation", 1);
        }
        pendingInvoices.clear();
        pendingInvoices.addAll(remaining);
    }

    private void checkAndReorder(SimulationContext ctx, LocalDate day) {
        SimulationRandom rng = ctx.getRandom();
        boolean regularProcurementDay = isRegularProcurementDay(day);
        Map<Long, Double> itemUnitsPerSale = estimateUnitsPerSale(ctx.getProducts().values());

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            String marketCode = RegionalEconomics.marketCode(outlet);
            Map<Long, Integer> reorderItems = new LinkedHashMap<>();
            Map<Long, Integer> outstandingQty = outstandingQuantities(ctx, outlet.getId());
            int carryoverDemand = Math.max(0, ctx.getCurrentCarryoverDemand(outlet.getId()));
            double recentDailySales = seededDailyDemandForecast(ctx, outlet, day, estimateObservedDailyDemand(outlet, day));
            int leadTimeBufferDays = leadTimeBufferDays(ctx, marketCode);

            for (SimItem globalItem : ctx.getItems().values()) {
                SimItem stockItem = ctx.getOutletStock(outlet.getId(), globalItem.getId());
                if (stockItem == null || stockItem.isComposite()) {
                    continue;
                }
                int onOrder = outstandingQty.getOrDefault(globalItem.getId(), 0);
                double unitsPerSale = itemUnitsPerSale.getOrDefault(globalItem.getId(), 0.0);
                double demandPressure = unitsPerSale * recentDailySales;
                double volatilityFactor = demandVolatilityFactor(outlet);
                int targetLevel = targetStockLevel(ctx, stockItem, outlet, day, carryoverDemand, recentDailySales,
                        unitsPerSale, leadTimeBufferDays, volatilityFactor);
                int reorderPoint = reorderPoint(stockItem, targetLevel, outlet, volatilityFactor);
                int criticalLevel = Math.max(1, stockItem.getMinStockLevel() / 2);
                boolean emergency = stockItem.getCurrentStock() <= criticalLevel
                        || outlet.getStockoutStreakDays() >= 2
                        || outlet.getLateDeliveryCount30d() >= 3;
                boolean acceleratedCycle = demandPressure >= stockItem.getMinStockLevel() * 0.45
                        && stockItem.getCurrentStock() + onOrder < Math.round(targetLevel * 0.84);
                boolean highStressCycle = outlet.getRollingStockoutLossRate() >= 0.18
                        || outlet.getRollingServiceLossRate() >= 0.18
                        || carryoverDemand > 0;
                if (outlet.getRollingStockoutLossRate() >= 0.12
                        || outlet.getRollingServiceLossRate() >= 0.14
                        || carryoverDemand >= 4) {
                    highStressCycle = true;
                }
                if (!emergency && stockItem.getCurrentStock() + onOrder >= reorderPoint) {
                    continue;
                }
                if (!regularProcurementDay && !emergency && !acceleratedCycle && !highStressCycle) {
                    continue;
                }

                int reorderQty = targetLevel - (stockItem.getCurrentStock() + onOrder);
                if (reorderQty > 0) {
                    reorderItems.put(globalItem.getId(), normalizeReorderQuantity(stockItem, reorderQty));
                }
            }

            if (reorderItems.isEmpty()) {
                continue;
            }

            List<SimSupplier> suppliers = supplierCandidates(ctx, outlet);
            if (suppliers.isEmpty()) {
                continue;
            }
            SimSupplier supplier = selectSupplier(ctx, suppliers, rng);
            int leadTime = resolveLeadTime(ctx, outlet, marketCode, supplier.id(), rng);
            LocalDate deliveryDate = day.plusDays(leadTime);
            Long creatorId = findOutletOperator(ctx, outlet.getId(), "outlet_manager", "inventory_clerk", "cashier");
            long expectedTotal = expectedTotal(ctx, outlet, day, reorderItems);
            String note = "Forecast reorder for " + reorderItems.size() + " items; carryover="
                    + ctx.getCurrentCarryoverDemand(outlet.getId()) + ", stockoutStreak=" + outlet.getStockoutStreakDays();

            long poId = ctx.getIdGen().nextId();
            ctx.addPendingPO(new SimulationContext.PendingPurchaseOrder(
                    poId, outlet.getId(), supplier.id(), marketCode,
                    reorderItems, deliveryDate, supplier.currencyCode(), expectedTotal,
                    creatorId, ctx.supplierReliability(supplier.id()), note
            ));
            ctx.getCurrentMonth().addPo();
            log.debug("Created PO {} for outlet {} with {} items, expected delivery {}",
                    poId, outlet.getCode(), reorderItems.size(), deliveryDate);
        }
    }

    private int targetStockLevel(SimulationContext ctx, SimItem item, SimOutlet outlet, LocalDate day, int carryoverDemand,
                                 double recentDailySales, double unitsPerSale, int leadTimeBufferDays,
                                 double volatilityFactor) {
        long outletAgeDays = Math.max(0, java.time.temporal.ChronoUnit.DAYS.between(outlet.getOpenedDate(), day));
        double multiplier = switch (item.getPerishabilityTier()) {
            case "very_high" -> item.isComposite() ? 1.20 : 1.28;
            case "high" -> item.isComposite() ? 1.30 : 1.40;
            case "medium" -> 1.42;
            case "low" -> 1.66;
            default -> 1.22;
        };
        double coordinationFactor = RegionalEconomics.forecastCoordinationMultiplier(
                (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()),
                (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode()));
        int baseTarget = (int) Math.round(item.getMinStockLevel() * multiplier * coordinationFactor);
        double coverageDays = switch (item.getCategoryCode()) {
            case "NOODLE" -> Math.max(5.8, leadTimeBufferDays * 1.14);
            case "PROTEIN" -> Math.max(4.4, leadTimeBufferDays * 1.06);
            case "VEGETABLE" -> Math.max(2.8, leadTimeBufferDays * 0.88);
            default -> switch (item.getPerishabilityTier()) {
            case "very_high" -> Math.max(2.1, leadTimeBufferDays * 0.66);
            case "high" -> Math.max(2.8, leadTimeBufferDays * 0.80);
            case "low" -> Math.max(4.6, leadTimeBufferDays * 1.22);
            default -> Math.max(3.4, leadTimeBufferDays * 0.96);
            };
        };
        coverageDays *= Math.min(1.10, volatilityFactor);
        if (outletAgeDays < 45) {
            coverageDays += outletAgeDays < 21 ? 0.72 : 0.38;
        }
        if (outlet.getLateDeliveryCount30d() >= 2) {
            coverageDays += 0.50;
        }
        int demandTarget = (int) Math.round(unitsPerSale * recentDailySales * coverageDays);
        int carryoverUnits = (int) Math.round(unitsPerSale * carryoverDemand * 0.72);
        int referenceTarget = Math.max(baseTarget, demandTarget + carryoverUnits);
        double adjustmentFactor = importAdjustmentFactor(item, outlet, day, carryoverDemand, unitsPerSale, recentDailySales);
        int adjustedTarget = (int) Math.round(referenceTarget * adjustmentFactor);
        int effectiveCeiling = effectiveStockCeiling(item, recentDailySales, unitsPerSale, leadTimeBufferDays);
        return Math.max(item.getMinStockLevel(), Math.min(effectiveCeiling, adjustedTarget));
    }

    private int reorderPoint(SimItem item, int targetLevel, SimOutlet outlet, double volatilityFactor) {
        int demandBuffer = (int) Math.round(targetLevel * (0.66 + Math.min(0.10, (volatilityFactor - 1.0) * 0.28)));
        int reliabilityBuffer = outlet.getLateDeliveryCount30d() >= 2 ? Math.max(1, item.getMinStockLevel() / 4) : 0;
        int effectiveCeiling = effectiveStockCeiling(item, 0.0, 0.0, 0);
        return Math.min(effectiveCeiling, Math.max(item.getMinStockLevel(), demandBuffer + reliabilityBuffer));
    }

    private double importAdjustmentFactor(SimItem item, SimOutlet outlet, LocalDate day, int carryoverDemand,
                                          double unitsPerSale, double recentDailySales) {
        long referenceRevenue = Math.max(outlet.getCurrentMonthRevenue(),
                outlet.getMonthlyRevenue().isEmpty() ? 0L : outlet.getMonthlyRevenue().getLast());
        double wasteRatio = referenceRevenue <= 0 ? 0.0 : outlet.getWasteCostMonth() / (double) referenceRevenue;
        double lostSalesRatio = referenceRevenue <= 0 ? 0.0 : outlet.getStockoutLostSalesValueMonth() / (double) referenceRevenue;
        int referenceSales = Math.max(outlet.getCurrentMonthCompletedSales(),
                outlet.getMonthlyCompletedSales().isEmpty() ? 0 : outlet.getMonthlyCompletedSales().getLast());
        double demandPressure = unitsPerSale * recentDailySales;
        long outletAgeDays = Math.max(0, java.time.temporal.ChronoUnit.DAYS.between(outlet.getOpenedDate(), day));

        double factor = 1.0;
        switch (item.getPerishabilityTier()) {
            case "very_high" -> {
                if (wasteRatio >= 0.12) factor -= 0.06;
                else if (wasteRatio >= 0.08) factor -= 0.04;
                else if (wasteRatio >= 0.05) factor -= 0.02;
                if (referenceSales < 220 && carryoverDemand == 0) factor -= 0.015;
            }
            case "high" -> {
                if (wasteRatio >= 0.12) factor -= 0.05;
                else if (wasteRatio >= 0.08) factor -= 0.035;
                else if (wasteRatio >= 0.05) factor -= 0.015;
                if (referenceSales < 240 && carryoverDemand == 0) factor -= 0.01;
            }
            case "medium" -> {
                if (wasteRatio >= 0.12) factor -= 0.03;
            }
            default -> {
            }
        }

        if (demandPressure >= item.getMinStockLevel() * 0.64) {
            factor += 0.08;
        }
        if (demandPressure >= item.getMinStockLevel() * 1.00) {
            factor += 0.10;
        }
        if (demandPressure >= item.getMinStockLevel() * 1.30) {
            factor += 0.10;
        }

        if (lostSalesRatio >= 0.07 || carryoverDemand > 0 || outlet.getStockoutStreakDays() >= 2
                || outlet.getRollingStockoutLossRate() >= 0.12) {
            factor += 0.32;
        } else if (lostSalesRatio >= 0.04) {
            factor += 0.20;
        }
        if (outletAgeDays < 45 && (lostSalesRatio >= 0.03 || carryoverDemand > 0 || outlet.getRollingStockoutLossRate() >= 0.08)) {
            factor += outletAgeDays < 21 ? 0.14 : 0.08;
        }

        return Math.max(0.94, Math.min(1.72, factor));
    }

    private double demandVolatilityFactor(SimOutlet outlet) {
        List<Integer> history = outlet.getMonthlyCompletedSales();
        if (history.size() < 3) {
            return 1.03;
        }
        int start = Math.max(0, history.size() - 4);
        double average = history.subList(start, history.size()).stream()
                .mapToInt(Integer::intValue)
                .average()
                .orElse(0.0);
        if (average <= 0.0) {
            return 1.0;
        }
        double variance = 0.0;
        for (int i = start; i < history.size(); i++) {
            double diff = history.get(i) - average;
            variance += diff * diff;
        }
        double stddev = Math.sqrt(variance / Math.max(1, history.size() - start));
        double coefficient = stddev / average;
        return Math.max(1.0, Math.min(1.12, 1.0 + coefficient * 0.20));
    }

    private int normalizeReorderQuantity(SimItem item, int reorderQty) {
        int casePack = switch (item.getCategoryCode()) {
            case "NOODLE" -> 4;
            case "PROTEIN" -> 3;
            case "VEGETABLE", "AROMATIC" -> 2;
            case "SAUCE" -> 2;
            default -> item.getPerishabilityTier().equals("low") ? 6 : 2;
        };
        if (reorderQty <= casePack + 1) {
            return reorderQty;
        }
        int rounded = (int) Math.ceil(reorderQty / (double) casePack) * casePack;
        return Math.max(reorderQty, rounded);
    }

    private int effectiveStockCeiling(SimItem item, double recentDailySales, double unitsPerSale, int leadTimeBufferDays) {
        double maxMultiplier = switch (item.getCategoryCode()) {
            case "NOODLE" -> 2.00;
            case "PROTEIN" -> 1.62;
            case "VEGETABLE" -> 1.34;
            default -> switch (item.getPerishabilityTier()) {
                case "very_high" -> 1.22;
                case "high" -> 1.34;
                case "low" -> 1.90;
                default -> 1.52;
            };
        };
        int configuredCeiling = (int) Math.round(item.getMaxStockLevel() * maxMultiplier);
        int leadTimeDemandCap = (int) Math.round(item.getMaxStockLevel()
                + unitsPerSale * recentDailySales * Math.max(1, leadTimeBufferDays) * 0.85);
        return Math.max(item.getMaxStockLevel(), Math.max(configuredCeiling, leadTimeDemandCap));
    }

    private int leadTimeBufferDays(SimulationContext ctx, String regionCode) {
        return ctx.getConfig().regions().stream()
                .filter(region -> region.code().equals(RegionalEconomics.countryCode(regionCode)))
                .findFirst()
                .map(region -> region.supplierLeadTimeDaysRange() != null && region.supplierLeadTimeDaysRange().size() >= 2
                        ? Math.max(region.supplierLeadTimeDaysRange().getFirst(),
                        region.supplierLeadTimeDaysRange().getLast())
                        : 4)
                .orElse(4);
    }

    private Map<Long, Double> estimateUnitsPerSale(Iterable<SimProduct> products) {
        Map<Long, Double> weightedUsage = new HashMap<>();
        double totalWeight = 0.0;
        for (SimProduct product : products) {
            double demandWeight = switch (product.categoryCode()) {
                case "PHO_SOUP" -> 1.30;
                case "RICE" -> 1.18;
                case "BUN" -> 1.06;
                case "XAO" -> 1.02;
                case "BANH_MI" -> 0.92;
                case "BANH" -> 0.82;
                case "DRINK" -> 0.38;
                default -> 1.0;
            };
            totalWeight += demandWeight;
            for (SimProduct.RecipeItem recipeItem : product.recipeItems()) {
                weightedUsage.merge(recipeItem.itemId(), recipeItem.quantity() * demandWeight, Double::sum);
            }
        }
        if (totalWeight <= 0.0) {
            return Map.of();
        }
        final double normalizer = totalWeight;
        weightedUsage.replaceAll((itemId, usage) -> usage / normalizer);
        return weightedUsage;
    }

    private double estimateRecentDailySales(SimOutlet outlet, LocalDate day) {
        int completedDaysThisMonth = Math.max(1, day.getDayOfMonth() - 1);
        double currentRate = outlet.getCurrentMonthCompletedSales() / (double) completedDaysThisMonth;
        List<Integer> history = outlet.getMonthlyCompletedSales();
        if (history.isEmpty()) {
            return Math.max(8.0, currentRate);
        }
        int samples = Math.min(2, history.size());
        double trailing = 0.0;
        for (int i = history.size() - samples; i < history.size(); i++) {
            trailing += history.get(i) / 30.0;
        }
        double historicalRate = trailing / samples;
        return Math.max(8.0, Math.max(currentRate, historicalRate));
    }

    private double estimateObservedDailyDemand(SimOutlet outlet, LocalDate day) {
        double servedDemand = estimateRecentDailySales(outlet, day);
        double stockoutDemand = OutletBusinessController.stockoutOrdersPerDay(outlet, day) * 1.10;
        double upliftedDemand = servedDemand + stockoutDemand;
        double clientBaseLift = 0.94 + Math.max(0.0, outlet.getClientBaseIndex() - 0.84) * 0.60
                + Math.max(0.0, outlet.getRepeatCustomerPool() - 0.22) * 0.42
                + Math.max(0.0, outlet.getDeliveryCatchmentStrength() - 1.0) * 0.20;
        return Math.max(10.0, Math.min((servedDemand * 1.70 + 8.0) * clientBaseLift, upliftedDemand * 1.16));
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
                        peer.getRollingStockoutLossRate() * 0.68
                                + peer.getRollingServiceLossRate() * 0.32,
                        0.0, 1.0))
                .average()
                .orElse(0.0);
        double ageFactor = outletAgeDays < 14 ? 0.94 : outletAgeDays < 45 ? 0.72 : 0.42;
        double seededDemand = peerDailySales
                * clamp(0.18 + peerDemandOverflow * 0.50, 0.16, 0.42)
                * ageFactor;
        return Math.max(selfDemand, Math.min(peerDailySales * 0.92, selfDemand + seededDemand));
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private boolean isRegularProcurementDay(LocalDate day) {
        // Transit quick-service outlets generally reorder daily for perishables.
        return true;
    }

    private Map<Long, Integer> outstandingQuantities(SimulationContext ctx, long outletId) {
        Map<Long, Integer> outstanding = new HashMap<>();
        for (SimulationContext.PendingPurchaseOrder po : ctx.getPendingPOs()) {
            if (po.outletId() != outletId) {
                continue;
            }
            for (var entry : po.remainingQuantities().entrySet()) {
                outstanding.merge(entry.getKey(), entry.getValue(), Integer::sum);
            }
        }
        return outstanding;
    }

    private List<SimSupplier> supplierCandidates(SimulationContext ctx, SimOutlet outlet) {
        List<SimSupplier> regional = ctx.getSuppliers().values().stream()
                .filter(supplier -> RegionalEconomics.countryCode(supplier.regionCode())
                        .equals(RegionalEconomics.countryCode(RegionalEconomics.marketCode(outlet))))
                .sorted(Comparator.comparingDouble((SimSupplier supplier) -> ctx.supplierReliability(supplier.id())).reversed())
                .toList();
        return regional.isEmpty() ? new ArrayList<>(ctx.getSuppliers().values()) : regional;
    }

    private SimSupplier selectSupplier(SimulationContext ctx, List<SimSupplier> suppliers, SimulationRandom rng) {
        if (suppliers.size() == 1) {
            return suppliers.getFirst();
        }
        SimSupplier best = suppliers.getFirst();
        if (ctx.supplierLateCount(best.id()) >= 3 && rng.chance(0.70)) {
            return suppliers.get(rng.intBetween(1, suppliers.size() - 1));
        }
        return best;
    }

    private int resolveLeadTime(SimulationContext ctx, SimOutlet outlet, String regionCode, long supplierId, SimulationRandom rng) {
        var regionConfig = ctx.getConfig().regions().stream()
                .filter(region -> region.code().equals(RegionalEconomics.countryCode(regionCode)))
                .findFirst()
                .orElse(null);
        int min = 2;
        int max = 5;
        if (regionConfig != null && regionConfig.supplierLeadTimeDaysRange() != null
                && regionConfig.supplierLeadTimeDaysRange().size() >= 2) {
            min = regionConfig.supplierLeadTimeDaysRange().getFirst();
            max = regionConfig.supplierLeadTimeDaysRange().getLast();
        }
        double reliability = ctx.supplierReliability(supplierId);
        int reliabilityPenalty = reliability < 0.80 ? 2 : reliability < 0.88 ? 1 : 0;
        int leadTime = rng.intBetween(min + reliabilityPenalty, max + reliabilityPenalty);
        long outletAgeDays = Math.max(0, java.time.temporal.ChronoUnit.DAYS.between(outlet.getOpenedDate(), ctx.getClock().getCurrentDate()));
        if (outletAgeDays < 30) {
            leadTime -= 1;
        }
        if (ctx.countActiveOutletsInCountry(outlet.getRegionCode()) >= 2 && reliability >= 0.88) {
            leadTime -= 1;
        }
        return Math.max(min, leadTime);
    }

    private boolean shouldDelay(SimulationContext ctx, SimulationContext.PendingPurchaseOrder po, SimulationRandom rng) {
        double base = ctx.getConfig().realism() != null ? ctx.getConfig().realism().lateDeliveryChance() : 0.18;
        return rng.chance(Math.min(0.60, base + Math.max(0, 0.90 - po.supplierReliability()) * 0.5));
    }

    private Map<Long, Integer> buildDeliveredQuantities(SimulationContext ctx,
                                                        SimulationContext.PendingPurchaseOrder po,
                                                        SimulationRandom rng) {
        Map<Long, Integer> delivered = new LinkedHashMap<>();
        double partialChance = ctx.getConfig().realism() != null ? ctx.getConfig().realism().partialDeliveryChance() : 0.12;
        boolean partial = !po.partial() && rng.chance(partialChance);
        double fillRatio = partial ? rng.doubleBetween(0.40, 0.80) : 1.0;
        for (var entry : po.remainingQuantities().entrySet()) {
            int qty = partial ? Math.max(1, (int) Math.floor(entry.getValue() * fillRatio)) : entry.getValue();
            delivered.put(entry.getKey(), Math.min(entry.getValue(), qty));
        }
        return delivered;
    }

    private LocalDate schedulePaymentDate(SimulationContext ctx, LocalDate readyDate, LocalDate dueDate,
                                          long amount, SimulationRandom rng) {
        double baseDelayChance = ctx.getConfig().realism() != null ? ctx.getConfig().realism().paymentDelayChance() : 0.20;
        boolean lowCashPressure = ctx.getCurrentMonth() != null && ctx.getCurrentMonth().getNetProfit() < amount;
        if (!lowCashPressure && !rng.chance(baseDelayChance)) {
            return dueDate;
        }
        int delay = ctx.getConfig().realism() != null
                ? rng.intBetween(ctx.getConfig().realism().minPaymentDelayDays(), ctx.getConfig().realism().maxPaymentDelayDays())
                : rng.intBetween(1, 7);
        return dueDate.plusDays(delay);
    }

    private long expectedTotal(SimulationContext ctx, SimOutlet outlet, LocalDate day, Map<Long, Integer> reorderItems) {
        long total = 0;
        int activeSubregionOutlets = (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode());
        int activeCountryOutlets = (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode());
        for (var entry : reorderItems.entrySet()) {
            SimItem item = ctx.getItems().get(entry.getKey());
            if (item != null) {
                long scaledUnitCost = RegionalEconomics.scaleProcurementCost(
                        RegionalEconomics.effectiveItemCost(
                                item, RegionalEconomics.marketCode(outlet), ctx.getConfig().startDate(), day),
                        activeSubregionOutlets,
                        activeCountryOutlets);
                total += scaledUnitCost * entry.getValue();
            }
        }
        return total;
    }

    private Long findOutletOperator(SimulationContext ctx, long outletId, String... preferredRoles) {
        for (String role : preferredRoles) {
            var match = ctx.getActiveEmployeesAtOutlet(outletId).stream()
                    .filter(emp -> role.equals(emp.getRoleCode()))
                    .findFirst();
            if (match.isPresent()) {
                return match.get().getUserId();
            }
        }
        return ctx.getActiveEmployeesAtOutlet(outletId).stream().findFirst().map(SimEmployee::getUserId).orElse(null);
    }
}
