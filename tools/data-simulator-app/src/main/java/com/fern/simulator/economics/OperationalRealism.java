package com.fern.simulator.economics;

import com.fern.simulator.engine.SimulationRandom;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimProduct;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Operational realism layer for outlet site selection and kitchen/service capacity.
 *
 * <p>The constants here are intentionally category-level rather than per-recipe-step.
 * They are calibrated from representative fast-casual/quick-service benchmarks:
 * small-format seating densities, multi-turn dining rooms, batch broth/sauce prep,
 * and short assembly lines for sandwiches, drinks, and plated rice/noodle dishes.</p>
 */
public final class OperationalRealism {

    private static final double BASE_OUTLET_AREA_SQM = 88.0;

    private static final Map<String, DishProfile> CATEGORY_PROFILES = Map.of(
            "PHO_SOUP", new DishProfile("soup_station", 2.4, 1.30),
            "RICE", new DishProfile("hot_line", 3.7, 1.12),
            "BANH_MI", new DishProfile("sandwich_station", 1.4, 1.02),
            "BUN", new DishProfile("assembly_line", 2.0, 1.05),
            "XAO", new DishProfile("wok_station", 4.1, 0.94),
            "BANH", new DishProfile("griddle_station", 3.0, 0.78),
            "SIDE", new DishProfile("cold_prep", 1.6, 0.88),
            "DRINK", new DishProfile("beverage_bar", 0.6, 0.56)
    );

    private static final Map<String, CompositePrepProfile> COMPOSITE_PROFILES = Map.of(
            "Pho Broth", new CompositePrepProfile(120),
            "Nuoc Cham", new CompositePrepProfile(18),
            "Cha Lua", new CompositePrepProfile(70),
            "Scallion Oil", new CompositePrepProfile(10),
            "Pickled Vegetables", new CompositePrepProfile(30),
            "Caramel Sauce", new CompositePrepProfile(12)
    );

    private OperationalRealism() {}

    public static OutletSiteProfile assignOutletSite(String regionCode, String subregionCode,
                                                     SimulationRandom rng, int outletOrdinal) {
        RegionalEconomics.RegionProfile region = RegionalEconomics.profileFor(subregionCode);
        Map<String, Double> weights = new LinkedHashMap<>();
        double infillBias = Math.min(0.14, Math.max(0, outletOrdinal - 1) * 0.05);
        weights.put("neighborhood", 0.34 + infillBias * 0.40);
        weights.put("transit", 0.42 + infillBias * 0.45);
        weights.put("prime", Math.max(0.12, 0.24 - infillBias * 0.85));

        String tier = rng.pickWeighted(weights);
        TierProfile tierProfile = tierProfile(tier);

        double regionalAreaMultiplier = regionalAreaMultiplier(subregionCode);
        double infillFootprintMultiplier = Math.max(0.80, 1.0 - Math.max(0, outletOrdinal - 1) * 0.05);
        double dineInShare = clamp(tierProfile.dineInShare() - Math.max(0, outletOrdinal - 1) * 0.05, 0.32, 0.60);
        int minArea = outletOrdinal > 1 ? 60 : 72;
        int areaSqm = clampInt((int) Math.round(
                BASE_OUTLET_AREA_SQM * regionalAreaMultiplier * tierProfile.areaMultiplier() * infillFootprintMultiplier
                        * rng.doubleBetween(0.94, 1.08)), minArea, 220);
        int seatCount = clampInt((int) Math.round(
                (areaSqm * tierProfile.diningShare()) / tierProfile.sqmPerSeat()), 18, 84);
        int tableCount = clampInt((int) Math.round(seatCount / 4.0), 4, 20);
        int pickupSlots = clampInt((int) Math.round(areaSqm * (1.0 - dineInShare) * 0.32), 8, 28);
        int serviceSlots = Math.max(seatCount + pickupSlots, tableCount * 5);

        long baseMonthlyRent = Math.max(1L, Math.round(
                region.baseRent() * tierProfile.rentMultiplier()
                        * (areaSqm / BASE_OUTLET_AREA_SQM)
                        * rng.doubleBetween(0.96, 1.07)));

        double demandMultiplier = clamp(
                Math.pow(tierProfile.footTrafficIndex() * tierProfile.affluenceIndex(), 0.55)
                        * (1.0 + (tierProfile.crowdIndex() - 1.0) * 0.20),
                0.82, 1.30);

        return new OutletSiteProfile(
                tier,
                areaSqm,
                seatCount,
                tableCount,
                serviceSlots,
                baseMonthlyRent,
                demandMultiplier,
                tierProfile.affluenceIndex(),
                tierProfile.footTrafficIndex(),
                tierProfile.crowdIndex(),
                dineInShare
        );
    }

    public static DishProfile dishProfileFor(SimProduct product) {
        return CATEGORY_PROFILES.getOrDefault(
                product.categoryCode(),
                new DishProfile("hot_line", 2.9, 1.0));
    }

    public static CompositePrepProfile compositePrepProfileFor(String compositeName) {
        return COMPOSITE_PROFILES.getOrDefault(compositeName, new CompositePrepProfile(24));
    }

    public static double weightedAveragePrepMinutes(Iterable<SimProduct> products) {
        double weightedMinutes = 0.0;
        double totalWeight = 0.0;
        for (SimProduct product : products) {
            DishProfile profile = dishProfileFor(product);
            weightedMinutes += profile.finishMinutesPerPortion() * profile.demandWeight();
            totalWeight += profile.demandWeight();
        }
        if (totalWeight <= 0.0) {
            return 2.8;
        }
        return weightedMinutes / totalWeight;
    }

    public static double weightedDemandWeight(Iterable<SimProduct> products) {
        double totalWeight = 0.0;
        for (SimProduct product : products) {
            totalWeight += dishProfileFor(product).demandWeight();
        }
        return totalWeight;
    }

    public static double transactionThroughputPerHour(String roleCode) {
        if (roleCode == null || "employee_no_role".equals(roleCode)) {
            return 20.0;
        }
        return switch (roleCode) {
            case "cashier" -> 60.0;
            case "outlet_manager" -> 34.0;
            case "inventory_clerk" -> 7.0;
            case "kitchen_staff" -> 5.2;
            default -> 20.0;
        };
    }

    public static double kitchenMinutesPerHour(String roleCode) {
        if (roleCode == null || "employee_no_role".equals(roleCode)) {
            return 42.0;
        }
        return switch (roleCode) {
            case "kitchen_staff" -> 80.0;
            case "inventory_clerk" -> 32.0;
            case "outlet_manager" -> 22.0;
            case "cashier" -> 8.0;
            default -> 42.0;
        };
    }

    public static double manufacturingPrepMinutesPerHour(String roleCode) {
        if (roleCode == null || "employee_no_role".equals(roleCode)) {
            return 20.0;
        }
        return switch (roleCode) {
            case "kitchen_staff" -> 34.0;
            case "inventory_clerk" -> 24.0;
            case "outlet_manager" -> 8.0;
            case "cashier" -> 3.0;
            default -> 20.0;
        };
    }

    public static double expectedDineInShare(OutletSiteProfile site, LocalDate day) {
        boolean weekend = isWeekend(day);
        double weekendLift = weekend ? 0.05 : 0.0;
        return clamp(site.dineInShare() + weekendLift, 0.28, 0.72);
    }

    public static int totalSeatLimitedOrders(OutletSiteProfile site, LocalDate day) {
        boolean weekend = isWeekend(day);
        double dailyTurns = (weekend ? 6.4 : 5.8) * clamp(site.crowdIndex(), 0.94, 1.24);
        double averagePartySize = weekend ? 2.25 : 2.00;
        double dineInOrders = (site.seatCount() * dailyTurns) / averagePartySize;
        double dineInShare = expectedDineInShare(site, day);
        double pickupCapacity = site.serviceSlots() * clamp(1.20 + (1.0 - dineInShare) * 0.95, 1.20, 2.00);
        return Math.max(20, (int) Math.floor((dineInOrders + pickupCapacity) / Math.max(0.38, dineInShare + (1.0 - dineInShare) * 0.56)));
    }

    public static int totalSeatLimitedOrders(SimOutlet outlet, LocalDate day) {
        return totalSeatLimitedOrders(new OutletSiteProfile(
                outlet.getLocationTier(),
                outlet.getAreaSqm(),
                outlet.getSeatCount(),
                outlet.getTableCount(),
                outlet.getServiceSlotCount(),
                outlet.getBaseMonthlyRent(),
                outlet.getLocationDemandMultiplier(),
                outlet.getAffluenceIndex(),
                outlet.getFootTrafficIndex(),
                outlet.getCrowdIndex(),
                outlet.getDineInShare()), day);
    }

    public static double averageItemsPerOrder(LocalDate day) {
        return isWeekend(day) ? 1.75 : 1.55;
    }

    private static boolean isWeekend(LocalDate day) {
        DayOfWeek dayOfWeek = day.getDayOfWeek();
        return dayOfWeek == DayOfWeek.SATURDAY || dayOfWeek == DayOfWeek.SUNDAY;
    }

    private static TierProfile tierProfile(String tier) {
        return switch (tier) {
            case "prime" -> new TierProfile(0.84, 0.56, 1.34, 1.10, 1.10, 1.20, 1.14, 0.42);
            case "transit" -> new TierProfile(0.90, 0.50, 1.40, 0.94, 1.02, 1.14, 1.10, 0.44);
            default -> new TierProfile(0.92, 0.50, 1.50, 0.78, 0.96, 0.92, 0.90, 0.54);
        };
    }

    private static double regionalAreaMultiplier(String subregionCode) {
        return switch (subregionCode) {
            case "US-LA" -> 1.08;
            case "US-NYC", "JP-TYO" -> 0.84;
            case "VN-DN" -> 1.00;
            case "VN-HCM", "VN-HN" -> 0.90;
            default -> 1.0;
        };
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    public record OutletSiteProfile(
            String locationTier,
            int areaSqm,
            int seatCount,
            int tableCount,
            int serviceSlots,
            long baseMonthlyRent,
            double demandMultiplier,
            double affluenceIndex,
            double footTrafficIndex,
            double crowdIndex,
            double dineInShare
    ) {}

    public record DishProfile(String station, double finishMinutesPerPortion, double demandWeight) {}

    public record CompositePrepProfile(double laborMinutesPerBatch) {}

    private record TierProfile(
            double areaMultiplier,
            double diningShare,
            double sqmPerSeat,
            double rentMultiplier,
            double affluenceIndex,
            double footTrafficIndex,
            double crowdIndex,
            double dineInShare
    ) {}
}
