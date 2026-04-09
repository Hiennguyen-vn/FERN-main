package com.fern.simulator.engine.phases;

import com.fern.simulator.data.MenuData;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.economics.OperationalRealism;
import com.fern.simulator.economics.OutletBusinessController;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimEmployee;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimProduct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.util.*;

/**
 * Phase 5: Produces composite ingredients (Pho broth, Nuoc cham, Cha lua, etc.)
 * from base ingredients when stock falls below minimum level.
 * <p>
 * Runs before SalesPhase so composites are available for product recipes.
 */
public class ManufacturingPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(ManufacturingPhase.class);
    private int batchSeq = 0;

    @Override
    public String name() { return "Manufacturing"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        Map<String, MenuData.CompositeRecipe> composites = ctx.getCompositeRecipes();
        if (composites.isEmpty()) return;

        // Build name→item index
        Map<String, SimItem> itemsByName = new HashMap<>();
        for (SimItem item : ctx.getItems().values()) {
            itemsByName.put(item.getName(), item);
        }

        Map<Long, Double> compositeUnitsPerSale = estimateCompositeUnitsPerSale(ctx.getProducts().values());

        for (SimOutlet outlet : ctx.getActiveOutlets()) {
            double recentDailySales = estimateObservedDailyDemand(outlet, day);
            int carryoverDemand = ctx.getCurrentCarryoverDemand(outlet.getId());
            int availablePrepMinutes = availablePrepMinutes(ctx, outlet);
            int consumedPrepMinutes = ctx.getManufacturingLaborToday(outlet.getId());
            for (var entry : composites.entrySet()) {
                String compositeName = entry.getKey();
                MenuData.CompositeRecipe recipe = entry.getValue();
                OperationalRealism.CompositePrepProfile prepProfile =
                        OperationalRealism.compositePrepProfileFor(compositeName);

                SimItem compositeItem = itemsByName.get(compositeName);
                if (compositeItem == null) continue;

                SimItem compositeStock = ctx.getOutletStock(outlet.getId(), compositeItem.getId());
                if (compositeStock == null) continue;

                double unitsPerSale = compositeUnitsPerSale.getOrDefault(compositeItem.getId(), 0.0);
                int targetLevel = dynamicTargetLevel(ctx, outlet, compositeStock, unitsPerSale, recentDailySales, carryoverDemand);
                int triggerLevel = manufacturingTriggerLevel(compositeStock, targetLevel);
                if (compositeStock.getCurrentStock() >= triggerLevel) {
                    continue;
                }

                int estimatedBatches = (int) Math.ceil(
                        Math.max(0, targetLevel - compositeStock.getCurrentStock()) / (double) Math.max(1, recipe.yieldQty()));
                int maxBatches = Math.max(1, Math.min(10, estimatedBatches + 2));
                int batchesProduced = 0;

                while (compositeStock.getCurrentStock() < targetLevel && batchesProduced < maxBatches) {
                    int shortfall = Math.max(0, targetLevel - compositeStock.getCurrentStock());
                    if (shortfall <= 0) {
                        break;
                    }

                    double batchScale = Math.max(0.30, Math.min(1.0, shortfall / (double) recipe.yieldQty()));
                    int outputQty = Math.max(1, (int) Math.round(recipe.yieldQty() * batchScale));
                    int batchPrepMinutes = Math.max(8,
                            (int) Math.round(prepProfile.laborMinutesPerBatch() * batchScale));
                    if (consumedPrepMinutes + batchPrepMinutes > availablePrepMinutes) {
                        break;
                    }

                    // Check if we have enough source ingredients for this batch.
                    boolean canProduce = true;
                    for (MenuData.RecipeEntry src : recipe.sources()) {
                        SimItem srcItem = itemsByName.get(src.ingredientName());
                        if (srcItem == null) {
                            canProduce = false;
                            break;
                        }
                        SimItem srcStock = ctx.getOutletStock(outlet.getId(), srcItem.getId());
                        int requiredQty = Math.max(1, (int) Math.round(src.qty() * batchScale));
                        if (srcStock == null || !srcStock.hasStock(requiredQty)) {
                            canProduce = false;
                            break;
                        }
                    }

                    if (!canProduce) {
                        break;
                    }

                    // Consume inputs.
                    List<SimulationContext.ManufacturingTxn> inputs = new ArrayList<>();
                    for (MenuData.RecipeEntry src : recipe.sources()) {
                        SimItem srcItem = itemsByName.get(src.ingredientName());
                        int requiredQty = Math.max(1, (int) Math.round(src.qty() * batchScale));
                        ctx.removeStock(outlet.getId(), srcItem.getId(), requiredQty);

                        long txnId = ctx.getIdGen().nextId();
                        inputs.add(new SimulationContext.ManufacturingTxn(
                                txnId, srcItem.getId(), requiredQty, srcItem.getUnitCost()));
                        ctx.incrementRowCount("inventory_transaction", 1);
                        ctx.incrementRowCount("manufacturing_transaction", 1);
                    }

                    // Produce output.
                    ctx.addStock(outlet.getId(), compositeItem.getId(), outputQty);
                    long outputTxnId = ctx.getIdGen().nextId();
                    var outputTxn = new SimulationContext.ManufacturingTxn(
                            outputTxnId, compositeItem.getId(), outputQty, compositeItem.getUnitCost());
                    ctx.incrementRowCount("inventory_transaction", 1);
                    ctx.incrementRowCount("manufacturing_transaction", 1);

                    // Emit event.
                    long batchId = ctx.getIdGen().nextId();
                    String refCode = ctx.getNamespace() + "-MFG-" + String.format("%06d", ++batchSeq);
                    Long kitchenStaffId = ctx.getActiveEmployeesAtOutlet(outlet.getId()).stream()
                            .filter(e -> "kitchen_staff".equals(e.getRoleCode()))
                            .map(SimEmployee::getUserId).findFirst().orElse(null);
                    ctx.addManufacturingEvent(new SimulationContext.ManufacturingEvent(
                            batchId, outlet.getId(), refCode, day,
                            "Batch: " + refCode, kitchenStaffId,
                            inputs, outputTxn));
                    ctx.incrementRowCount("manufacturing_batch", 1);
                    ctx.getCurrentMonth().addManufacturingBatch();
                    ctx.recordManufacturingLabor(outlet.getId(), batchPrepMinutes);
                    consumedPrepMinutes += batchPrepMinutes;
                    batchesProduced++;
                }
            }
        }
    }

    private int availablePrepMinutes(SimulationContext ctx, SimOutlet outlet) {
        double prepMinutes = 0.0;
        for (SimEmployee employee : ctx.getActiveEmployeesAtOutlet(outlet.getId())) {
            String roleCode = employee.getRoleCode() == null ? "employee_no_role" : employee.getRoleCode();
            double prepHours = switch (roleCode) {
                case "kitchen_staff" -> "hourly".equals(employee.getSalaryType()) ? 4.8 : 7.2;
                case "inventory_clerk" -> "hourly".equals(employee.getSalaryType()) ? 3.4 : 4.8;
                case "outlet_manager" -> 1.2;
                case "cashier" -> "hourly".equals(employee.getSalaryType()) ? 0.5 : 0.8;
                default -> "hourly".equals(employee.getSalaryType()) ? 0.8 : 1.2;
            };
            prepMinutes += prepHours * OperationalRealism.manufacturingPrepMinutesPerHour(roleCode);
        }
        return Math.max(60, (int) Math.round(prepMinutes));
    }

    private Map<Long, Double> estimateCompositeUnitsPerSale(Collection<SimProduct> products) {
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
        double stockoutDemand = OutletBusinessController.stockoutOrdersPerDay(outlet, day) * 1.16;
        double upliftedDemand = servedDemand + stockoutDemand;
        double clientBaseLift = 0.94 + Math.max(0.0, outlet.getClientBaseIndex() - 0.84) * 0.62
                + Math.max(0.0, outlet.getRepeatCustomerPool() - 0.22) * 0.44;
        return Math.max(10.0, Math.min((servedDemand * 1.78 + 8.0) * clientBaseLift, upliftedDemand * 1.12));
    }

    private int dynamicTargetLevel(SimulationContext ctx, SimOutlet outlet, SimItem compositeStock, double unitsPerSale,
                                   double recentDailySales, int carryoverDemand) {
        double coverageDays = switch (compositeStock.getPerishabilityTier()) {
            case "very_high" -> 1.82;
            case "high" -> 2.48;
            case "low" -> 3.40;
            default -> 2.74;
        };
        coverageDays *= RegionalEconomics.forecastCoordinationMultiplier(
                (int) ctx.countActiveOutletsInSubregion(outlet.getSubregionCode()),
                (int) ctx.countActiveOutletsInCountry(outlet.getRegionCode()));
        double expectedDailyUnits = Math.max(0.0, unitsPerSale) * recentDailySales;
        double carryoverUnits = Math.max(0.0, unitsPerSale) * carryoverDemand * 0.68;
        int demandTarget = (int) Math.round(expectedDailyUnits * coverageDays + carryoverUnits);
        return Math.max(compositeStock.getMinStockLevel(),
                Math.min(compositeStock.getMaxStockLevel(), demandTarget));
    }

    private int manufacturingTriggerLevel(SimItem compositeStock, int targetLevel) {
        int bufferTrigger = (int) Math.round(targetLevel * 0.78);
        return Math.min(compositeStock.getMaxStockLevel(),
                Math.max(compositeStock.getMinStockLevel(), bufferTrigger));
    }
}
