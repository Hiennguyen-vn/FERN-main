package com.fern.simulator.economics;

import com.fern.simulator.model.SimOutlet;

import java.time.LocalDate;

/**
 * Outlet-level commercial controller.
 *
 * <p>This acts like a simple restaurant revenue-management loop:
 * price chases utilization and service availability, while hiring
 * cost pressure follows labor tightness and labor-share guardrails.</p>
 */
public final class OutletBusinessController {

    private OutletBusinessController() {}

    public static void applyDailyControls(SimOutlet outlet, LocalDate day,
                                          int targetedDemand, int completedOrders,
                                          int constrainedOrders, int capacityOrders,
                                          long payrollRunRate, long expectedOperatingRunRate) {
        RegionalEconomics.RegionProfile profile = RegionalEconomics.profileFor(RegionalEconomics.marketCode(outlet));
        double capacityPressure = capacityOrders <= 0
                ? 1.12
                : targetedDemand / (double) Math.max(1, capacityOrders);
        double serviceLossRate = targetedDemand <= 0
                ? 0.0
                : constrainedOrders / (double) Math.max(1, targetedDemand);
        double stockoutLossRate = outlet.currentMonthStockoutLossRate();
        double throughputUtilization = capacityOrders <= 0
                ? 0.0
                : completedOrders / (double) Math.max(1, capacityOrders);

        outlet.updateCommercialSignals(capacityPressure, serviceLossRate, stockoutLossRate, throughputUtilization);

        long revenueRunRate = revenueRunRate(outlet, day);
        long cogsRunRate = projectRunRate(outlet.getCurrentMonthCogs(), day);
        long wasteRunRate = projectRunRate(outlet.getWasteCostMonth(), day);

        double foodCostShare = revenueRunRate <= 0
                ? profile.targetFoodCostRatio()
                : clamp((cogsRunRate + Math.round(wasteRunRate * 0.35)) / (double) Math.max(1L, revenueRunRate), 0.16, 0.60);
        double laborShare = revenueRunRate <= 0
                ? 0.26
                : clamp(payrollRunRate / (double) Math.max(1L, revenueRunRate), 0.10, 0.70);
        double operatingShare = revenueRunRate <= 0
                ? 0.22
                : clamp(expectedOperatingRunRate / (double) Math.max(1L, revenueRunRate), 0.05, 0.60);
        double wasteShare = revenueRunRate <= 0
                ? 0.0
                : wasteRunRate / (double) Math.max(1L, revenueRunRate);

        double priceStep = 0.0;
        priceStep += clamp((outlet.getRollingCapacityPressure() - 0.98) * 0.050, -0.005, 0.012);
        priceStep += Math.min(0.009, outlet.getRollingServiceLossRate() * 0.030);
        priceStep += Math.min(0.007, outlet.getRollingStockoutLossRate() * 0.025);

        double contributionShare = 1.0 - foodCostShare - laborShare - operatingShare;
        if (contributionShare < 0.12 && outlet.getRollingThroughputUtilization() > 0.84) {
            priceStep += Math.min(0.006, (0.12 - contributionShare) * 0.040);
        }

        if (outlet.getRollingThroughputUtilization() < 0.70
                && outlet.getRollingServiceLossRate() < 0.04
                && outlet.getRollingStockoutLossRate() < 0.05) {
            priceStep -= Math.min(0.012, (0.74 - outlet.getRollingThroughputUtilization()) * 0.060);
        }
        if (wasteShare > 0.08 && outlet.getRollingThroughputUtilization() < 0.84) {
            priceStep -= 0.006;
        }

        outlet.adjustDynamicPriceMultiplier(1.0 + clamp(priceStep, -0.014, 0.015));

        double wageStep = 0.0;
        if (outlet.getRollingServiceLossRate() > 0.12
                && laborShare < 0.24
                && outlet.getAttendanceStressScore() > 0.75) {
            wageStep += 0.003;
        }
        if (outlet.getAttendanceStressScore() > 1.15
                && outlet.getRollingCapacityPressure() > 1.08
                && laborShare < 0.28) {
            wageStep += 0.002;
        }
        if (laborShare > 0.32
                && outlet.getRollingCapacityPressure() < 0.96
                && outlet.getRollingServiceLossRate() < 0.06) {
            wageStep -= 0.005;
        }
        if (outlet.getRollingThroughputUtilization() < 0.70 && wasteShare > 0.09) {
            wageStep -= 0.002;
        }

        outlet.adjustDynamicWageMultiplier(1.0 + clamp(wageStep, -0.007, 0.005));

        double reputationStep = 0.0;
        reputationStep += Math.min(0.010, Math.max(0.0, throughputUtilization - 0.72) * 0.030);
        reputationStep -= Math.min(0.006, serviceLossRate * 0.026);
        reputationStep -= Math.min(0.005, stockoutLossRate * 0.022);
        if (wasteShare > 0.10) {
            reputationStep -= Math.min(0.003, (wasteShare - 0.10) * 0.035);
        }
        if (contributionShare >= 0.16 && serviceLossRate < 0.08 && stockoutLossRate < 0.10) {
            reputationStep += 0.004;
        }
        if (throughputUtilization >= 0.74 && serviceLossRate < 0.16 && stockoutLossRate < 0.16) {
            reputationStep += 0.003;
        }
        if (outlet.getDynamicPriceMultiplier() > 1.08 && throughputUtilization < 0.84) {
            reputationStep -= 0.0015;
        }
        outlet.adjustReputationScore(1.0 + clamp(reputationStep, -0.007, 0.012));
    }

    public static long revenueRunRate(SimOutlet outlet, LocalDate day) {
        long projected = projectRunRate(outlet.getCurrentMonthRevenue(), day);
        long trailing = trailingAverage(outlet.getMonthlyRevenue());
        return blendedRunRate(projected, trailing);
    }

    public static int salesRunRate(SimOutlet outlet, LocalDate day) {
        int projected = (int) projectRunRate(outlet.getCurrentMonthCompletedSales(), day);
        long trailing = trailingAverageInt(outlet.getMonthlyCompletedSales());
        return (int) Math.max(0, blendedRunRate(projected, trailing));
    }

    public static double averageOrderValue(SimOutlet outlet, LocalDate day) {
        double currentAverage = outlet.getCurrentMonthCompletedSales() > 0
                ? outlet.getCurrentMonthRevenue() / (double) outlet.getCurrentMonthCompletedSales()
                : 0.0;
        long trailingRevenue = trailingAverage(outlet.getMonthlyRevenue());
        long trailingSales = trailingAverageInt(outlet.getMonthlyCompletedSales());
        double trailingAverageOrder = trailingSales > 0
                ? trailingRevenue / (double) trailingSales
                : 0.0;

        if (currentAverage > 0.0 && trailingAverageOrder > 0.0) {
            return currentAverage * 0.58 + trailingAverageOrder * 0.42;
        }
        if (currentAverage > 0.0) {
            return currentAverage;
        }
        if (trailingAverageOrder > 0.0) {
            return trailingAverageOrder;
        }
        return 48_000.0;
    }

    public static double stockoutOrdersPerDay(SimOutlet outlet, LocalDate day) {
        int elapsedDays = Math.max(1, day.getDayOfMonth());
        double observedRate = outlet.getStockoutsSalesThisMonth() / (double) elapsedDays;
        double completedRate = salesRunRate(outlet, day) / (double) Math.max(1, day.lengthOfMonth());
        double inferredRate = completedRate * clamp(outlet.currentMonthStockoutLossRate() * 1.35, 0.0, 1.0);
        return Math.max(observedRate, inferredRate);
    }

    private static long projectRunRate(long currentValue, LocalDate day) {
        if (currentValue <= 0) {
            return 0L;
        }
        int dayOfMonth = Math.max(1, day.getDayOfMonth());
        return Math.round(currentValue * (day.lengthOfMonth() / (double) dayOfMonth));
    }

    private static long trailingAverage(java.util.List<Long> history) {
        if (history.isEmpty()) {
            return 0L;
        }
        return Math.round(history.stream()
                .skip(Math.max(0, history.size() - 3L))
                .mapToLong(Long::longValue)
                .average()
                .orElse(0.0));
    }

    private static long trailingAverageInt(java.util.List<Integer> history) {
        if (history.isEmpty()) {
            return 0L;
        }
        return Math.round(history.stream()
                .skip(Math.max(0, history.size() - 3L))
                .mapToInt(Integer::intValue)
                .average()
                .orElse(0.0));
    }

    private static long blendedRunRate(long projected, long trailing) {
        if (projected <= 0) {
            return Math.max(0L, trailing);
        }
        if (trailing <= 0) {
            return Math.max(0L, projected);
        }
        return Math.round(projected * 0.58 + trailing * 0.42);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
