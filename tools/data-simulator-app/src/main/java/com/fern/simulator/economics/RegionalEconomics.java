package com.fern.simulator.economics;

import com.fern.simulator.data.MenuData;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimProduct;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/**
 * Regional economics inputs calibrated from current public wage, utility, rent,
 * and consumer price anchors for the simulator's supported regions.
 */
public final class RegionalEconomics {

    public static final String REPORTING_CURRENCY_CODE = "VND";
    private static final double LEGAL_MONTHLY_HOURS = 208.0;

    private static final long BASE_MEAL_PRICE_VND = 52_000L;
    private static final double BASE_AVERAGE_PRODUCT_PRICE_VND = 35_250.0;
    private static final double BASE_AVERAGE_PRODUCT_COST_VND = 11_840.0;
    private static final double BASE_MEAL_TO_DAILY_WAGE_RATIO = BASE_MEAL_PRICE_VND / (5_310_000.0 / 26.0);

    private static final Map<String, Long> FX_TO_VND = Map.of(
            "VND", 1L,
            "USD", 24_500L,
            "JPY", 165L
    );

    private static final RegionProfile DEFAULT_PROFILE = new RegionProfile(
            "VN",
            "VND",
            5_310_000L,
            60_000L,
            0.060,
            0.040,
            0.035,
            0.040,
            0.030,
            0.31,
            1.00,
            -0.82,
            0.38,
            22_000_000L,
            3_900.0,
            22_068.0,
            1_500,
            34,
            2_000_000L,
            2_400_000L,
            900
    );

    private static final Map<String, RegionProfile> PROFILES = Map.of(
            "VN", DEFAULT_PROFILE,
            "VN-HCM", new RegionProfile(
                    "VN-HCM",
                    "VND",
                    5_310_000L,
                    44_000L,
                    0.060,
                    0.040,
                    0.035,
                    0.040,
                    0.030,
                    0.32,
                    1.10,
                    -0.58,
                    0.34,
                    21_000_000L,
                    3_900.0,
                    22_068.0,
                    1_500,
                    34,
                    2_000_000L,
                    2_500_000L,
                    1_450
            ),
            "VN-HN", new RegionProfile(
                    "VN-HN",
                    "VND",
                    4_730_000L,
                    40_000L,
                    0.055,
                    0.035,
                    0.030,
                    0.030,
                    0.025,
                    0.32,
                    1.08,
                    -0.60,
                    0.32,
                    18_000_000L,
                    3_900.0,
                    27_000.0,
                    1_350,
                    31,
                    1_800_000L,
                    2_200_000L,
                    1_320
            ),
            "VN-DN", new RegionProfile(
                    "VN-DN",
                    "VND",
                    4_500_000L,
                    38_000L,
                    0.050,
                    0.030,
                    0.028,
                    0.030,
                    0.024,
                    0.31,
                    0.98,
                    -0.62,
                    0.30,
                    14_000_000L,
                    3_900.0,
                    26_594.0,
                    1_200,
                    29,
                    1_600_000L,
                    1_800_000L,
                    1_200
            ),
            "US", new RegionProfile(
                    "US",
                    "USD",
                    2_941L,
                    28L,
                    0.037,
                    0.033,
                    0.030,
                    0.033,
                    0.029,
                    0.29,
                    1.08,
                    -0.67,
                    0.28,
                    7_000L,
                    0.2330,
                    5.0,
                    3_700,
                    72,
                    240L,
                    560L,
                    920
            ),
            "US-NYC", new RegionProfile(
                    "US-NYC",
                    "USD",
                    2_941L,
                    30L,
                    0.035,
                    0.035,
                    0.030,
                    0.037,
                    0.030,
                    0.29,
                    1.16,
                    -0.65,
                    0.30,
                    8_500L,
                    0.2228,
                    6.58,
                    3_800,
                    75,
                    260L,
                    650L,
                    980
            ),
            "US-LA", new RegionProfile(
                    "US-LA",
                    "USD",
                    3_187L,
                    25L,
                    0.040,
                    0.031,
                    0.029,
                    0.030,
                    0.028,
                    0.28,
                    1.08,
                    -0.68,
                    0.28,
                    6_200L,
                    0.2445,
                    3.00,
                    3_600,
                    70,
                    230L,
                    540L,
                    900
            ),
            "JP", new RegionProfile(
                    "JP",
                    "JPY",
                    212_000L,
                    1_200L,
                    0.025,
                    0.030,
                    0.025,
                    0.020,
                    0.020,
                    0.30,
                    1.08,
                    -0.62,
                    0.22,
                    620_000L,
                    36.0,
                    310.0,
                    3_200,
                    66,
                    18_000L,
                    52_000L,
                    860
            ),
            "JP-TYO", new RegionProfile(
                    "JP-TYO",
                    "JPY",
                    212_000L,
                    1_200L,
                    0.025,
                    0.030,
                    0.025,
                    0.020,
                    0.020,
                    0.30,
                    1.10,
                    -0.62,
                    0.22,
                    650_000L,
                    36.0,
                    310.0,
                    3_300,
                    68,
                    18_000L,
                    55_000L,
                    880
            )
    );

    private RegionalEconomics() {}

    public static RegionProfile profileFor(String regionCode) {
        if (regionCode == null || regionCode.isBlank()) {
            return DEFAULT_PROFILE;
        }
        RegionProfile direct = PROFILES.get(regionCode);
        return direct != null ? direct : PROFILES.getOrDefault(countryCode(regionCode), DEFAULT_PROFILE);
    }

    public static String countryCode(String regionCode) {
        if (regionCode == null || regionCode.isBlank()) {
            return "VN";
        }
        int separator = regionCode.indexOf('-');
        return separator > 0 ? regionCode.substring(0, separator) : regionCode;
    }

    public static String currencyFor(String regionCode) {
        return profileFor(regionCode).currencyCode();
    }

    public static String marketCode(String regionCode, String subregionCode) {
        if (subregionCode != null && !subregionCode.isBlank()) {
            return subregionCode;
        }
        return regionCode;
    }

    public static String marketCode(SimOutlet outlet) {
        return marketCode(outlet.getRegionCode(), outlet.getSubregionCode());
    }

    public static long convertToReportingCurrency(long amount, String currencyCode) {
        if (amount == 0L) {
            return 0L;
        }
        long fx = FX_TO_VND.getOrDefault(currencyCode, 1L);
        return "VND".equals(currencyCode) ? amount : Math.round(amount * (double) fx);
    }

    public static long convertToReportingCurrency(long amount, String regionCode, LocalDate startDate, LocalDate businessDate) {
        return convertToReportingCurrency(amount, currencyFor(regionCode));
    }

    public static long effectiveItemCost(SimItem item, String regionCode, LocalDate startDate, LocalDate businessDate) {
        RegionProfile profile = profileFor(regionCode);
        double months = elapsedMonths(startDate, businessDate);
        double converted = convertFromVnd(item.getUnitCost(), profile.currencyCode());
        double costGrowth = annualGrowth(profile.annualCogsInflation(), months)
                * Math.pow(annualGrowth(profile.annualWageGrowth(), months), 0.08);
        double categoryMultiplier = switch (item.getCategoryCode()) {
            case "PROTEIN", "EGG_DAIRY" -> 1.08;
            case "AROMATIC", "SAUCE" -> 1.04;
            case "NOODLE" -> 0.96;
            default -> 1.0;
        };
        double amount = converted * ingredientCostMultiplier(profile) * costGrowth * categoryMultiplier
                * dailyCostPulse(regionCode, item.getCategoryCode(), businessDate);
        return roundCurrency(amount, profile.currencyCode());
    }

    public static long effectiveProductCost(Map<Long, SimItem> items, SimProduct product, String regionCode,
                                            LocalDate startDate, LocalDate businessDate) {
        long total = 0;
        for (SimProduct.RecipeItem recipeItem : product.recipeItems()) {
            SimItem item = items.get(recipeItem.itemId());
            if (item == null) {
                continue;
            }
            total += effectiveItemCost(item, regionCode, startDate, businessDate) * recipeItem.quantity();
        }
        return total;
    }

    public static long effectiveProductPrice(SimProduct product, long effectiveRecipeCost, String regionCode,
                                             LocalDate startDate, LocalDate businessDate) {
        RegionProfile profile = profileFor(regionCode);
        if ("VN".equals(countryCode(regionCode))) {
            return vietnamAnchoredProductPrice(product, effectiveRecipeCost, profile, regionCode, null, businessDate);
        }
        double months = elapsedMonths(startDate, businessDate);
        double localizedBasePrice = (product.priceAmount() / (double) BASE_MEAL_PRICE_VND) * profile.baseMealPrice();
        double marketPrice = localizedBasePrice * menuPriceIndex(profile, months)
                * dailyMenuPulse(regionCode, businessDate);
        double costPlusFloor = effectiveRecipeCost / Math.max(0.18, profile.targetFoodCostRatio() * 0.95);
        return roundMenuPrice(Math.max(marketPrice, costPlusFloor), profile.currencyCode());
    }

    public static long effectiveProductPrice(SimProduct product, long effectiveRecipeCost, SimOutlet outlet,
                                             LocalDate startDate, LocalDate businessDate) {
        String marketCode = marketCode(outlet);
        RegionProfile profile = profileFor(marketCode);
        if ("VN".equals(countryCode(marketCode))) {
            return vietnamAnchoredProductPrice(product, effectiveRecipeCost, profile, marketCode, outlet, businessDate);
        }
        double months = elapsedMonths(startDate, businessDate);
        double localizedBasePrice = (product.priceAmount() / (double) BASE_MEAL_PRICE_VND) * profile.baseMealPrice();
        double sitePremium = outletPriceMultiplier(outlet);
        double adaptivePremium = outlet.getDynamicPriceMultiplier();
        double marketPrice = localizedBasePrice * menuPriceIndex(profile, months)
                * dailyMenuPulse(marketCode, businessDate) * sitePremium * adaptivePremium;
        double costPlusFloor = effectiveRecipeCost
                / Math.max(0.18, (profile.targetFoodCostRatio() * 0.95) - (sitePremium - 1.0) * 0.04);
        return roundMenuPrice(Math.max(marketPrice, costPlusFloor), profile.currencyCode());
    }

    public static double demandFactor(String regionCode, LocalDate startDate, LocalDate businessDate) {
        RegionProfile profile = profileFor(regionCode);
        double months = elapsedMonths(startDate, businessDate);
        double priceIndex = menuPriceIndex(profile, months) * dailyMenuPulse(regionCode, businessDate);
        double wageIndex = annualGrowth(profile.annualWageGrowth(), months);
        double affordability = baseAffordability(profile);
        double dynamic = Math.pow(priceIndex, profile.demandPriceElasticity())
                * Math.pow(wageIndex, profile.demandIncomeElasticity());
        return clamp(profile.marketDemandMultiplier() * affordability * dynamic, 0.72, 1.45);
    }

    public static double outletPriceMultiplier(SimOutlet outlet) {
        RegionProfile profile = profileFor(marketCode(outlet));
        double tierPremium = switch (outlet.getLocationTier()) {
            case "prime" -> 1.06;
            case "transit" -> 1.02;
            default -> 1.00;
        };
        double rentPressure = clamp(Math.pow(
                Math.max(0.72, outlet.getBaseMonthlyRent() / (double) Math.max(1L, profile.baseRent())),
                0.08), 0.98, 1.05);
        double affluencePremium = clamp(1.0 + (outlet.getAffluenceIndex() - 1.0) * 0.20, 0.97, 1.05);
        double crowdPremium = clamp(1.0 + (outlet.getCrowdIndex() - 1.0) * 0.06, 0.98, 1.03);
        return clamp(tierPremium * rentPressure * affluencePremium * crowdPremium, 0.97, 1.12);
    }

    public static double outletDemandAdjustment(SimOutlet outlet) {
        RegionProfile profile = profileFor(marketCode(outlet));
        double pricePremium = outletPriceMultiplier(outlet);
        double affluenceOffset = clamp(1.0 + (outlet.getAffluenceIndex() - 1.0) * 0.18, 0.97, 1.05);
        double adaptivePriceResponse = clamp(
                Math.pow(clamp(outlet.getDynamicPriceMultiplier(), 0.92, 1.08), profile.demandPriceElasticity()),
                0.92, 1.07);
        double reputationResponse = clamp(0.97 + (outlet.getReputationScore() - 0.98) * 1.40, 0.93, 1.18);
        double serviceReputation = clamp(
                1.0 - outlet.getRollingServiceLossRate() * 0.10 - outlet.getRollingStockoutLossRate() * 0.08,
                0.92, 1.03);
        double clientBaseResponse = clamp(0.86 + outlet.getClientBaseIndex() * 0.20, 0.90, 1.12);
        double repeatResponse = clamp(0.94 + outlet.getRepeatCustomerPool() * 0.22, 0.90, 1.14);
        double deliveryResponse = clamp(0.94 + outlet.getDeliveryCatchmentStrength() * 0.18, 0.92, 1.12);
        return clamp(Math.pow(pricePremium, -0.42) * affluenceOffset * adaptivePriceResponse
                * serviceReputation * reputationResponse * clientBaseResponse * repeatResponse * deliveryResponse,
                0.82, 1.26);
    }

    public static double networkDemandHalo(int activeSubregionOutlets, int activeCountryOutlets, double averageCountryReputation) {
        int localPeers = Math.max(0, activeSubregionOutlets - 1);
        int nationalPeers = Math.max(0, activeCountryOutlets - activeSubregionOutlets);
        double footprintBoost = 1.0 + Math.min(0.095, localPeers * 0.045 + nationalPeers * 0.015);
        double reputationBoost = clamp(0.985 + (averageCountryReputation - 0.98) * 0.50, 0.97, 1.07);
        return clamp(footprintBoost * reputationBoost, 0.99, 1.14);
    }

    public static double procurementScaleMultiplier(int activeSubregionOutlets, int activeCountryOutlets) {
        int localPeers = Math.max(0, activeSubregionOutlets - 1);
        int nationalPeers = Math.max(0, activeCountryOutlets - activeSubregionOutlets);
        double savings = Math.min(0.12, localPeers * 0.045 + nationalPeers * 0.020);
        return clamp(1.0 - savings, 0.88, 1.0);
    }

    public static double forecastCoordinationMultiplier(int activeSubregionOutlets, int activeCountryOutlets) {
        int localPeers = Math.max(0, activeSubregionOutlets - 1);
        int nationalPeers = Math.max(0, activeCountryOutlets - activeSubregionOutlets);
        // Shared forecasting should improve signal quality, but not slash safety stock so far
        // that high-velocity outlets repeatedly run dry.
        double coordination = Math.min(0.12, localPeers * 0.040 + nationalPeers * 0.018);
        return clamp(1.0 - coordination, 0.88, 1.0);
    }

    public static double sharedServicesMultiplier(int activeSubregionOutlets, int activeCountryOutlets) {
        int localPeers = Math.max(0, activeSubregionOutlets - 1);
        int nationalPeers = Math.max(0, activeCountryOutlets - activeSubregionOutlets);
        double savings = Math.min(0.10, localPeers * 0.060 + nationalPeers * 0.020);
        return clamp(1.0 - savings, 0.88, 1.0);
    }

    public static long scaleProcurementCost(long baseCost, int activeSubregionOutlets, int activeCountryOutlets) {
        return Math.max(0L, Math.round(baseCost * procurementScaleMultiplier(activeSubregionOutlets, activeCountryOutlets)));
    }

    public static long salaryForRole(String regionCode, LocalDate startDate, LocalDate businessDate, String roleCode,
                                     long recentRevenue, int recentSales, double stochasticFactor) {
        RegionProfile profile = profileFor(regionCode);
        boolean vietnam = "VN".equals(countryCode(regionCode));
        double months = elapsedMonths(startDate, businessDate);
        double roleMultiplier = switch (roleCode == null ? "employee_no_role" : roleCode) {
            case "outlet_manager" -> vietnam ? 1.48 : 1.72;
            case "inventory_clerk" -> vietnam ? 0.98 : 1.10;
            case "kitchen_staff" -> vietnam ? 0.92 : 1.00;
            case "cashier" -> vietnam ? 0.86 : 0.94;
            default -> vietnam ? 0.82 : 0.90;
        };
        double outletPerformance = vietnam ? 0.84 : 0.88;
        if (recentRevenue > 0) {
            outletPerformance += 0.03;
        }
        if (recentRevenue >= performanceRevenueThreshold(profile, 1.0) || recentSales >= profile.referenceMonthlySales()) {
            outletPerformance += 0.04;
        }
        if (recentRevenue >= performanceRevenueThreshold(profile, 1.4) || recentSales >= Math.round(profile.referenceMonthlySales() * 1.25)) {
            outletPerformance += 0.04;
        }

        double wageGrowth = annualGrowth(profile.annualWageGrowth(), months);
        double salary = profile.wageFloorMonthly() * roleMultiplier * outletPerformance * wageGrowth * stochasticFactor;
        long rounded = roundSalary(salary, profile.currencyCode());
        return Math.max(roundSalary(profile.wageFloorMonthly() * roleMultiplier * 0.88, profile.currencyCode()), rounded);
    }

    public static long adjustSalaryOffer(long baseSalary, String regionCode, double outletWageMultiplier) {
        RegionProfile profile = profileFor(regionCode);
        long adjusted = roundSalary(baseSalary * outletWageMultiplier, profile.currencyCode());
        return Math.max(roundSalary(profile.wageFloorMonthly(), profile.currencyCode()), adjusted);
    }

    public static long hourlyWageFloor(String regionCode) {
        RegionProfile profile = profileFor(regionCode);
        if ("VND".equals(profile.currencyCode())) {
            return roundHourlyCompensation(Math.ceil(profile.wageFloorMonthly() / LEGAL_MONTHLY_HOURS), profile.currencyCode());
        }
        return roundHourlyCompensation(profile.wageFloorMonthly() / 176.0, profile.currencyCode());
    }

    public static long hourlyWageForRole(String regionCode, String roleCode, double outletWageMultiplier) {
        RegionProfile profile = profileFor(regionCode);
        double roleMultiplier = switch (roleCode == null ? "employee_no_role" : roleCode) {
            case "outlet_manager" -> 1.22;
            case "inventory_clerk" -> 1.08;
            case "kitchen_staff" -> 1.10;
            case "cashier" -> 1.00;
            default -> 0.96;
        };
        double wagePressure = clamp(outletWageMultiplier, 0.96, 1.03);
        return roundHourlyCompensation(hourlyWageFloor(regionCode) * roleMultiplier * wagePressure, profile.currencyCode());
    }

    public static ExpenseProfile expenseProfile(String regionCode, LocalDate startDate, LocalDate businessDate,
                                                int activeStaffCount, int monthlySales) {
        RegionProfile profile = profileFor(regionCode);
        double months = elapsedMonths(startDate, businessDate);
        double rentGrowth = annualGrowth(profile.annualRentInflation(), months);
        double utilityGrowth = annualGrowth(profile.annualUtilityInflation(), months);
        double activity = monthlySales <= 0
                ? 1.0
                : clamp(monthlySales / (double) profile.referenceMonthlySales(), 0.80, 1.65);

        long rent = roundCurrency(profile.baseRent() * rentGrowth * (0.94 + (activity - 1.0) * 0.12), profile.currencyCode());
        double electricityAmount = (profile.baseElectricityKwh() * activity + activeStaffCount * 16.0)
                * profile.electricityRate() * utilityGrowth;
        double waterAmount = (profile.baseWaterM3() * activity + activeStaffCount * 0.35)
                * profile.waterRate() * utilityGrowth;
        long telecom = roundCurrency(profile.telecomBase() * utilityGrowth, profile.currencyCode());
        long utilities = roundCurrency(electricityAmount + waterAmount + telecom, profile.currencyCode());
        long maintenance = roundCurrency((profile.maintenanceBase() + profile.baseRent() * Math.max(0.0, activity - 1.0) * 0.015)
                * utilityGrowth, profile.currencyCode());
        return new ExpenseProfile(rent, utilities, maintenance, profile.currencyCode());
    }

    public static ExpenseProfile expenseProfile(SimOutlet outlet, LocalDate startDate, LocalDate businessDate,
                                                int activeStaffCount, int monthlySales) {
        RegionProfile profile = profileFor(marketCode(outlet));
        double months = elapsedMonths(startDate, businessDate);
        double rentGrowth = annualGrowth(profile.annualRentInflation(), months);
        double utilityGrowth = annualGrowth(profile.annualUtilityInflation(), months);
        double activity = monthlySales <= 0
                ? 1.0
                : clamp(monthlySales / (double) profile.referenceMonthlySales(), 0.82, 1.55);
        double areaFactor = clamp(outlet.getAreaSqm() / 102.0, 0.72, 1.85);

        long rent = roundCurrency(
                outlet.getBaseMonthlyRent() * rentGrowth * (0.88 + Math.max(0.0, activity - 1.0) * 0.05),
                profile.currencyCode());
        double electricityAmount = ((profile.baseElectricityKwh() * 0.38 * areaFactor)
                + monthlySales * 0.41
                + activeStaffCount * 7.0)
                * profile.electricityRate() * utilityGrowth;
        double waterAmount = ((profile.baseWaterM3() * 0.34 * areaFactor)
                + monthlySales * 0.007
                + activeStaffCount * 0.18)
                * profile.waterRate() * utilityGrowth;
        long telecom = roundCurrency(profile.telecomBase() * utilityGrowth, profile.currencyCode());
        long utilities = roundCurrency(electricityAmount + waterAmount + telecom, profile.currencyCode());
        long maintenance = roundCurrency(
                (profile.maintenanceBase() * 0.60 * areaFactor + outlet.getBaseMonthlyRent() * 0.0040)
                        * utilityGrowth,
                profile.currencyCode());
        return new ExpenseProfile(rent, utilities, maintenance, profile.currencyCode());
    }

    private static double performanceRevenueThreshold(RegionProfile profile, double multiplier) {
        double avgTicket = (BASE_AVERAGE_PRODUCT_PRICE_VND / (double) BASE_MEAL_PRICE_VND) * profile.baseMealPrice();
        return avgTicket * profile.referenceMonthlySales() * multiplier;
    }

    private static double ingredientCostMultiplier(RegionProfile profile) {
        double localizedAveragePrice = (BASE_AVERAGE_PRODUCT_PRICE_VND / (double) BASE_MEAL_PRICE_VND) * profile.baseMealPrice();
        double convertedAverageCost = convertFromVnd(BASE_AVERAGE_PRODUCT_COST_VND, profile.currencyCode());
        double required = (localizedAveragePrice * profile.targetFoodCostRatio()) / Math.max(1.0, convertedAverageCost);
        return Math.max(0.72, required);
    }

    private static double baseAffordability(RegionProfile profile) {
        double dailyWage = profile.wageFloorMonthly() / 26.0;
        double ratio = profile.baseMealPrice() / Math.max(1.0, dailyWage);
        return clamp(Math.pow(BASE_MEAL_TO_DAILY_WAGE_RATIO / ratio, 0.18), 0.88, 1.14);
    }

    private static double menuPriceIndex(RegionProfile profile, double months) {
        double menuInflation = annualGrowth(profile.annualMenuInflation(), months);
        double cogsPassThrough = Math.pow(annualGrowth(profile.annualCogsInflation(), months), 0.25);
        double wagePassThrough = Math.pow(annualGrowth(profile.annualWageGrowth(), months), 0.15);
        return menuInflation * cogsPassThrough * wagePassThrough;
    }

    private static double dailyCostPulse(String regionCode, String categoryCode, LocalDate businessDate) {
        int dayOfYear = businessDate.getDayOfYear();
        int regionOffset = Math.floorMod(regionCode.hashCode(), 17);
        int categoryOffset = Math.floorMod(categoryCode.hashCode(), 11);
        double amplitude = switch (categoryCode) {
            case "PROTEIN", "EGG_DAIRY" -> 0.030;
            case "VEGETABLE" -> 0.026;
            case "AROMATIC", "SAUCE" -> 0.014;
            case "NOODLE" -> 0.010;
            default -> 0.016;
        };
        double shortCycle = Math.sin((dayOfYear + regionOffset + categoryOffset) / 5.8);
        double longCycle = Math.cos((dayOfYear + categoryOffset) / 17.0);
        return clamp(1.0 + shortCycle * amplitude + longCycle * amplitude * 0.55, 0.92, 1.11);
    }

    private static double dailyMenuPulse(String regionCode, LocalDate businessDate) {
        int dayOfYear = businessDate.getDayOfYear();
        int regionOffset = Math.floorMod(regionCode.hashCode(), 23);
        double weekly = Math.sin((dayOfYear + regionOffset) / 8.5);
        double seasonal = Math.cos((dayOfYear + regionOffset) / 28.0);
        return clamp(1.0 + weekly * 0.006 + seasonal * 0.004, 0.988, 1.014);
    }

    private static long vietnamAnchoredProductPrice(SimProduct product, long effectiveRecipeCost, RegionProfile profile,
                                                    String regionCode, SimOutlet outlet, LocalDate businessDate) {
        MenuData.ProductCommercialProfile commercial = MenuData.commercialProfile(
                product.name(), product.categoryCode(), product.priceAmount());
        double regionFactor = switch (regionCode) {
            case "VN-HCM" -> 0.98;
            case "VN-HN" -> 1.00;
            case "VN-DN" -> 0.96;
            default -> 1.0;
        };
        double sitePremium = outlet == null ? 1.0 : clamp(vietnamSitePriceMultiplier(outlet), 0.98, 1.04);
        double adaptivePremium = outlet == null ? 1.0 : clamp(outlet.getDynamicPriceMultiplier(), 0.92, 1.08);
        long lowerBand = commercial.basePriceMin();
        long upperBand = commercial.basePriceMax();
        long anchoredBase = clampLong(commercial.basePriceTarget(), lowerBand, upperBand);
        double marketPulse = clamp(dailyMenuPulse(regionCode, businessDate), 0.996, 1.004);
        double marketPrice = anchoredBase * regionFactor * sitePremium * adaptivePremium * marketPulse;
        double floorRatio = Math.max(0.36, profile.targetFoodCostRatio() + 0.03);
        long costPlusFloor = roundMenuPrice(effectiveRecipeCost / floorRatio, profile.currencyCode());
        long boundedMarketPrice = clampLong(
                roundMenuPrice(Math.max(marketPrice, costPlusFloor), profile.currencyCode()),
                roundMenuPrice(lowerBand * regionFactor, profile.currencyCode()),
                roundMenuPrice(upperBand * regionFactor * Math.max(1.0, sitePremium), profile.currencyCode()));
        return boundedMarketPrice;
    }

    private static double vietnamSitePriceMultiplier(SimOutlet outlet) {
        double tierPremium = switch (outlet.getLocationTier()) {
            case "prime" -> 1.02;
            case "transit" -> 0.99;
            default -> 0.97;
        };
        double affluencePremium = clamp(1.0 + (outlet.getAffluenceIndex() - 1.0) * 0.10, 0.97, 1.03);
        double crowdPremium = clamp(1.0 + (outlet.getCrowdIndex() - 1.0) * 0.05, 0.98, 1.02);
        return tierPremium * affluencePremium * crowdPremium;
    }

    private static long vietnamBandLower(SimProduct product) {
        if ("DRINK".equals(product.categoryCode()) && product.priceAmount() <= 10_000L) {
            return 5_000L;
        }
        return switch (product.categoryCode()) {
            case "BANH_MI" -> 18_000L;
            case "DRINK" -> 18_000L;
            case "PHO_SOUP", "BUN" -> 35_000L;
            case "RICE" -> 35_000L;
            case "XAO" -> 45_000L;
            case "BANH", "SIDE" -> 15_000L;
            default -> 40_000L;
        };
    }

    private static long vietnamBandUpper(SimProduct product) {
        if ("DRINK".equals(product.categoryCode()) && product.priceAmount() <= 10_000L) {
            return 12_000L;
        }
        return switch (product.categoryCode()) {
            case "BANH_MI" -> 35_000L;
            case "DRINK" -> 45_000L;
            case "PHO_SOUP", "BUN" -> 65_000L;
            case "RICE" -> 75_000L;
            case "XAO" -> 85_000L;
            case "BANH", "SIDE" -> 40_000L;
            default -> 95_000L;
        };
    }

    private static double annualGrowth(double annualRate, double elapsedMonths) {
        return Math.pow(1.0 + annualRate, elapsedMonths / 12.0);
    }

    private static double elapsedMonths(LocalDate startDate, LocalDate businessDate) {
        long days = Math.max(0, ChronoUnit.DAYS.between(startDate, businessDate));
        return days / 30.4375;
    }

    private static double convertFromVnd(double amount, String currencyCode) {
        long fx = FX_TO_VND.getOrDefault(currencyCode, 1L);
        return "VND".equals(currencyCode) ? amount : amount / fx;
    }

    private static long roundCurrency(double amount, String currencyCode) {
        return Math.max(1L, Math.round(amount));
    }

    private static long roundMenuPrice(double amount, String currencyCode) {
        if (!"VND".equals(currencyCode)) {
            return roundCurrency(amount, currencyCode);
        }
        long rounded = Math.max(1L, Math.round(amount));
        long step = rounded < 30_000L ? 1_000L : 5_000L;
        return Math.max(step, Math.round(rounded / (double) step) * step);
    }

    private static long roundHourlyCompensation(double amount, String currencyCode) {
        long step = switch (currencyCode) {
            case "VND" -> 500L;
            case "JPY" -> 10L;
            default -> 1L;
        };
        return Math.max(step, (long) Math.ceil(amount / step) * step);
    }

    private static long clampLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static long roundSalary(double amount, String currencyCode) {
        long step = switch (currencyCode) {
            case "VND" -> 100_000L;
            case "JPY" -> 1_000L;
            default -> 25L;
        };
        return Math.max(step, Math.round(amount / step) * step);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    public record RegionProfile(
            String regionCode,
            String currencyCode,
            long wageFloorMonthly,
            long baseMealPrice,
            double annualWageGrowth,
            double annualMenuInflation,
            double annualCogsInflation,
            double annualRentInflation,
            double annualUtilityInflation,
            double targetFoodCostRatio,
            double marketDemandMultiplier,
            double demandPriceElasticity,
            double demandIncomeElasticity,
            long baseRent,
            double electricityRate,
            double waterRate,
            int baseElectricityKwh,
            int baseWaterM3,
            long telecomBase,
            long maintenanceBase,
            int referenceMonthlySales
    ) {}

    public record ExpenseProfile(long rent, long utilities, long maintenance, String currencyCode) {}
}
