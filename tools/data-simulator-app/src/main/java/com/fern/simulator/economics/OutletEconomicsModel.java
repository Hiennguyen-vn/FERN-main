package com.fern.simulator.economics;

import com.fern.simulator.model.SimOutlet;

import java.time.LocalDate;

/**
 * Derives outlet-level economics and viability signals from the persisted outlet state.
 */
public final class OutletEconomicsModel {

    private OutletEconomicsModel() {}

    public static Snapshot snapshot(SimOutlet outlet) {
        long revenue = outlet.getTotalRevenue();
        long cogs = outlet.getTotalCogs();
        long payroll = outlet.getTotalPayrollCost();
        long operating = outlet.getTotalOperatingCost();
        long waste = outlet.getTotalWasteCost();
        long stockoutLost = outlet.getTotalStockoutLostSalesValue();
        long serviceLost = outlet.getTotalServiceLostSalesValue();
        long totalLost = stockoutLost + serviceLost;
        int activeMonths = Math.max(1, outlet.getMonthlyRevenue().size());

        long grossProfit = revenue - cogs;
        long storeContribution = revenue - cogs - waste - payroll;
        long netContribution = storeContribution - operating;
        long avgMonthlyRevenue = revenue / activeMonths;
        long avgMonthlyContribution = storeContribution / activeMonths;
        long avgMonthlyPayroll = payroll / activeMonths;
        long avgMonthlyCogs = cogs / activeMonths;
        long estimatedLaunchCost = Math.round(
                outlet.getBaseMonthlyRent() * 4.0
                        + avgMonthlyPayroll * 0.45
                        + avgMonthlyCogs * 0.80);

        double grossMarginPct = ratio(grossProfit, revenue);
        double contributionMarginPct = ratio(storeContribution, revenue);
        double netMarginPct = ratio(netContribution, revenue);
        double cogsPct = ratio(cogs, revenue);
        double laborPct = ratio(payroll, revenue);
        double opexPct = ratio(operating, revenue);
        double wastePct = ratio(waste, revenue);
        long demandBase = Math.max(1L, revenue + totalLost);
        double stockoutLostPct = ratio(stockoutLost, demandBase);
        double serviceLostPct = ratio(serviceLost, demandBase);
        double totalLostPct = ratio(totalLost, demandBase);
        double seatUtilization = seatUtilization(outlet);
        double serviceSlotUtilization = clamp(outlet.getRollingThroughputUtilization(), 0.0, 1.20);
        Double paybackMonths = avgMonthlyContribution > 0
                ? estimatedLaunchCost / (double) avgMonthlyContribution
                : null;

        return new Snapshot(
                grossProfit,
                storeContribution,
                netContribution,
                grossMarginPct,
                contributionMarginPct,
                netMarginPct,
                cogsPct,
                laborPct,
                opexPct,
                wastePct,
                stockoutLostPct,
                serviceLostPct,
                totalLostPct,
                seatUtilization,
                serviceSlotUtilization,
                avgMonthlyRevenue,
                avgMonthlyContribution,
                estimatedLaunchCost,
                paybackMonths,
                classify(
                        contributionMarginPct,
                        netMarginPct,
                        wastePct,
                        stockoutLostPct,
                        serviceLostPct,
                        seatUtilization,
                        serviceSlotUtilization,
                        paybackMonths)
        );
    }

    private static String classify(double contributionMarginPct,
                                   double netMarginPct,
                                   double wastePct,
                                   double stockoutLostPct,
                                   double serviceLostPct,
                                   double seatUtilization,
                                   double serviceSlotUtilization,
                                   Double paybackMonths) {
        double effectiveOccupancy = Math.max(seatUtilization, serviceSlotUtilization * 0.45);
        if (contributionMarginPct >= 0.18
                && netMarginPct >= 0.04
                && wastePct <= 0.08
                && stockoutLostPct <= 0.28
                && serviceLostPct <= 0.18
                && effectiveOccupancy >= 0.34
                && serviceSlotUtilization >= 0.52
                && paybackMonths != null
                && paybackMonths <= 18.0) {
            return "strong";
        }
        if (contributionMarginPct >= 0.12
                && netMarginPct >= -0.03
                && wastePct <= 0.10
                && stockoutLostPct <= 0.38
                && serviceLostPct <= 0.24
                && effectiveOccupancy >= 0.24
                && serviceSlotUtilization >= 0.42
                && (paybackMonths == null || paybackMonths <= 30.0)) {
            return "viable";
        }
        if (contributionMarginPct >= 0.05
                && wastePct <= 0.14
                && effectiveOccupancy >= 0.16
                && serviceSlotUtilization >= 0.28) {
            return "marginal";
        }
        return "distressed";
    }

    private static double seatUtilization(SimOutlet outlet) {
        int weekdayCapacity = OperationalRealism.totalSeatLimitedOrders(
                outlet, LocalDate.of(2024, 1, 8));
        int weekendCapacity = OperationalRealism.totalSeatLimitedOrders(
                outlet, LocalDate.of(2024, 1, 13));
        double averageDailySeatCapacity = Math.max(1.0, (weekdayCapacity * 5.0 + weekendCapacity * 2.0) / 7.0);
        double recentMonthlySales = outlet.getMonthlyCompletedSales().isEmpty()
                ? outlet.getCurrentMonthCompletedSales()
                : outlet.getMonthlyCompletedSales().stream()
                .skip(Math.max(0, outlet.getMonthlyCompletedSales().size() - 3L))
                .mapToInt(Integer::intValue)
                .average()
                .orElse(0.0);
        double averageDailySales = recentMonthlySales / 30.4375;
        double averageDailyDineInSales = averageDailySales * clamp(outlet.getDineInShare(), 0.20, 0.72);
        return clamp(averageDailyDineInSales / averageDailySeatCapacity, 0.0, 1.25);
    }

    private static double ratio(long numerator, long denominator) {
        if (denominator <= 0) {
            return 0.0;
        }
        return numerator / (double) denominator;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    public record Snapshot(
            long grossProfit,
            long storeContribution,
            long netContribution,
            double grossMarginPct,
            double contributionMarginPct,
            double netMarginPct,
            double cogsPct,
            double laborPct,
            double opexPct,
            double wastePct,
            double stockoutLostPct,
            double serviceLostPct,
            double totalLostPct,
            double seatUtilization,
            double serviceSlotUtilization,
            long averageMonthlyRevenue,
            long averageMonthlyContribution,
            long estimatedLaunchCost,
            Double paybackEstimateMonths,
            String viabilityBand
    ) {}
}
