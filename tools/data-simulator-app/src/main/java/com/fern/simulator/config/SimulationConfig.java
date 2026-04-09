package com.fern.simulator.config;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * Top-level simulation configuration, deserialized from YAML.
 */
public record SimulationConfig(
        String namespace,
        LocalDate startDate,
        LocalDate endDate,
        long seed,
        String startingRegion,
        DatabaseConfig database,
        ExpansionConfig expansion,
        List<RegionConfig> regions,
        ProbabilityConfig probability,
        RealismConfig realism
) {
    public long totalDays() {
        return ChronoUnit.DAYS.between(startDate, endDate) + 1;
    }

    public record DatabaseConfig(
            String url,
            String username,
            String password,
            boolean allowNonLocal
    ) {}

    public record ExpansionConfig(
            boolean globalExpansionEnabled,
            int initialOutlets,
            int minActiveOutletsBeforeSubregion,
            int minConsecutiveProfitableMonths,
            long minAverageMonthlyRevenue,
            double minStaffRetentionRate,
            double minInventoryFulfillmentRate,
            int maxRegionsPerYear,
            int maxOutletsPerRegionPerYear,
            List<ExpansionTier> expansionOrder
    ) {
        public record ExpansionTier(
                String tier,
                int triggerOutlets,
                int triggerMonths
        ) {}
    }

    public record RegionConfig(
            String code,
            String currency,
            String timezone,
            List<SubregionConfig> subregions,
            List<HolidayConfig> holidays,
            Map<String, Double> seasonalMultipliers,
            double staffChurnMultiplier,
            List<Integer> supplierLeadTimeDaysRange
    ) {
        public record SubregionConfig(String code, String name) {}
        public record HolidayConfig(String date, double demandMultiplier, String name) {}
    }

    public record ProbabilityConfig(
            double outletOpenChancePerMonth,
            double outletCloseChancePerMonth,
            int outletCloseRevenueThresholdPercent,
            int outletCloseConsecutiveMonths,
            double monthlyTurnoverRate,
            int replacementLagDays,
            double replacementChance,
            double suspensionChance,
            int foundingStaffPerOutlet,
            int maxStaffPerOutlet,
            double hiringChancePerMonth,
            int baseDailySalesPerOutlet,
            int demandRampDays,
            double demandGrowthPerMonth,
            double demandDeclinePerMonth,
            Map<String, Double> weekdayMultipliers,
            double promotionStartChancePerMonth,
            List<Integer> promotionDurationDays,
            List<Integer> promotionDiscountPercent,
            List<Integer> reorderLeadTimeDays,
            double wasteRateDaily,
            String payrollCadence,
            int payDayOfMonth,
            Map<String, Double> roleDistribution,
            double saleCancelChance,
            double saleRefundChance,
            double salePartialRefundChance,
            double saleVoidChance
    ) {}

    public record RealismConfig(
            int stockoutCarryoverDays,
            double stockoutCarryoverRate,
            List<Integer> stockoutCarryoverWeights,
            double lateDeliveryChance,
            double partialDeliveryChance,
            List<Integer> invoiceLagDaysRange,
            double paymentDelayChance,
            List<Integer> paymentDelayDaysRange,
            double weekdayAbsenceChance,
            double weekendAbsenceChance,
            double lateChance,
            double noShowChance,
            double leaveChance,
            Map<String, WasteProfile> categoryProfiles
    ) {
        public int minInvoiceLagDays() {
            return rangeStart(invoiceLagDaysRange, 1);
        }

        public int maxInvoiceLagDays() {
            return rangeEnd(invoiceLagDaysRange, 5);
        }

        public int minPaymentDelayDays() {
            return rangeStart(paymentDelayDaysRange, 1);
        }

        public int maxPaymentDelayDays() {
            return rangeEnd(paymentDelayDaysRange, 7);
        }

        private int rangeStart(List<Integer> values, int fallback) {
            return values != null && !values.isEmpty() ? values.getFirst() : fallback;
        }

        private int rangeEnd(List<Integer> values, int fallback) {
            return values != null && !values.isEmpty() ? values.getLast() : fallback;
        }
    }

    public record WasteProfile(
            String perishabilityTier,
            int shelfLifeDays,
            double prepWasteWeight,
            double damageRiskWeight,
            double incidentWasteChance
    ) {}
}
