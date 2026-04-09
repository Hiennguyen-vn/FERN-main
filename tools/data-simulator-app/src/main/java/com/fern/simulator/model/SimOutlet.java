package com.fern.simulator.model;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Tracks the state of a simulated outlet across the simulation timeline.
 */
public class SimOutlet {
    private final long id;
    private final String code;
    private final String name;
    private long regionId;
    private final String regionCode;
    private final String subregionCode;
    private final String locationTier;
    private final int areaSqm;
    private final int seatCount;
    private final int tableCount;
    private final int serviceSlotCount;
    private final long baseMonthlyRent;
    private final double locationDemandMultiplier;
    private final double affluenceIndex;
    private final double footTrafficIndex;
    private final double crowdIndex;
    private final double dineInShare;
    private String status = "draft";
    private final LocalDate openedDate;
    private OffsetDateTime openedAt;
    private OffsetDateTime closedAt;

    /** Monthly revenue tracker for growth/close decisions. */
    private final List<Long> monthlyRevenue = new ArrayList<>();
    private final List<Integer> monthlyCompletedSales = new ArrayList<>();
    private final List<Long> monthlyCogs = new ArrayList<>();
    private final List<Long> monthlyPayrollCost = new ArrayList<>();
    private final List<Long> monthlyOperatingCost = new ArrayList<>();
    private final List<Long> monthlyWasteCost = new ArrayList<>();
    private final List<Long> monthlyLostSalesValue = new ArrayList<>();
    private final List<Long> monthlyStockoutLostSalesValue = new ArrayList<>();
    private final List<Long> monthlyServiceLostSalesValue = new ArrayList<>();
    private final List<Long> monthlyBasketShrinkLostSalesValue = new ArrayList<>();
    private final List<Integer> monthlyDineInOrders = new ArrayList<>();
    private final List<Integer> monthlyDeliveryOrders = new ArrayList<>();
    private final Map<String, Deque<Integer>> blockDemandHistory = new LinkedHashMap<>();
    private final Map<String, Deque<Integer>> blockServedHistory = new LinkedHashMap<>();

    /** Active staff count. */
    private int activeStaffCount = 0;

    /** Sales blocked by stockout this month. */
    private int stockoutsSalesThisMonth = 0;
    private int serviceConstrainedOrdersThisMonth = 0;
    private int totalSalesAttemptedThisMonth = 0;
    private long currentMonthRevenue = 0;
    private int currentMonthCompletedSales = 0;
    private long currentMonthCogs = 0;
    private long currentMonthPayrollCost = 0;
    private long currentMonthOperatingCost = 0;
    private long lostSalesValueMonth = 0;
    private long stockoutLostSalesValueMonth = 0;
    private long serviceLostSalesValueMonth = 0;
    private long basketShrinkLostSalesValueMonth = 0;
    private long wasteCostMonth = 0;
    private int currentMonthDineInOrders = 0;
    private int currentMonthDeliveryOrders = 0;
    private long totalRevenue = 0;
    private long totalCogs = 0;
    private long totalPayrollCost = 0;
    private long totalOperatingCost = 0;
    private long totalWasteCost = 0;
    private long totalLostSalesValue = 0;
    private long totalStockoutLostSalesValue = 0;
    private long totalServiceLostSalesValue = 0;
    private long totalBasketShrinkLostSalesValue = 0;
    private int lateDeliveryCount30d = 0;
    private double attendanceStressScore = 0.0;
    private int stockoutStreakDays = 0;
    private double unmetDemandCarryoverUnits = 0.0;
    private double dynamicPriceMultiplier = 1.0;
    private double dynamicWageMultiplier = 1.0;
    private double rollingCapacityPressure = 0.98;
    private double rollingServiceLossRate = 0.0;
    private double rollingStockoutLossRate = 0.0;
    private double rollingThroughputUtilization = 0.84;
    private double reputationScore = 0.98;
    private double clientBaseIndex = 0.84;
    private double repeatCustomerPool = 0.22;
    private double deliveryCatchmentStrength = 1.02;

    public SimOutlet(long id, String code, String name, long regionId,
                     String regionCode, String subregionCode,
                     String locationTier, int areaSqm, int seatCount,
                     int tableCount, int serviceSlotCount, long baseMonthlyRent,
                     double locationDemandMultiplier, double affluenceIndex,
                     double footTrafficIndex, double crowdIndex, double dineInShare,
                     LocalDate openedDate) {
        this.id = id;
        this.code = code;
        this.name = name;
        this.regionId = regionId;
        this.regionCode = regionCode;
        this.subregionCode = subregionCode;
        this.locationTier = locationTier;
        this.areaSqm = areaSqm;
        this.seatCount = seatCount;
        this.tableCount = tableCount;
        this.serviceSlotCount = serviceSlotCount;
        this.baseMonthlyRent = baseMonthlyRent;
        this.locationDemandMultiplier = locationDemandMultiplier;
        this.affluenceIndex = affluenceIndex;
        this.footTrafficIndex = footTrafficIndex;
        this.crowdIndex = crowdIndex;
        this.dineInShare = dineInShare;
        this.openedDate = openedDate;
    }

    public SimOutlet(long id, String code, String name, long regionId,
                     String regionCode, String subregionCode, LocalDate openedDate) {
        this(id, code, name, regionId, regionCode, subregionCode,
                "transit", 115, 40, 10, 40, 0L,
                1.0, 1.0, 1.0, 1.0, 0.50, openedDate);
    }

    // --- Getters ---
    public long getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public long getRegionId() { return regionId; }
    public String getRegionCode() { return regionCode; }
    public String getSubregionCode() { return subregionCode; }
    public String getLocationTier() { return locationTier; }
    public int getAreaSqm() { return areaSqm; }
    public int getSeatCount() { return seatCount; }
    public int getTableCount() { return tableCount; }
    public int getServiceSlotCount() { return serviceSlotCount; }
    public long getBaseMonthlyRent() { return baseMonthlyRent; }
    public double getLocationDemandMultiplier() { return locationDemandMultiplier; }
    public double getAffluenceIndex() { return affluenceIndex; }
    public double getFootTrafficIndex() { return footTrafficIndex; }
    public double getCrowdIndex() { return crowdIndex; }
    public double getDineInShare() { return dineInShare; }
    public String getStatus() { return status; }
    public LocalDate getOpenedDate() { return openedDate; }
    public OffsetDateTime getOpenedAt() { return openedAt; }
    public OffsetDateTime getClosedAt() { return closedAt; }
    public int getActiveStaffCount() { return activeStaffCount; }
    public List<Long> getMonthlyRevenue() { return monthlyRevenue; }
    public List<Integer> getMonthlyCompletedSales() { return monthlyCompletedSales; }
    public List<Long> getMonthlyCogs() { return monthlyCogs; }
    public List<Long> getMonthlyPayrollCost() { return monthlyPayrollCost; }
    public List<Long> getMonthlyOperatingCost() { return monthlyOperatingCost; }
    public List<Long> getMonthlyWasteCost() { return monthlyWasteCost; }
    public List<Long> getMonthlyLostSalesValue() { return monthlyLostSalesValue; }
    public List<Long> getMonthlyStockoutLostSalesValue() { return monthlyStockoutLostSalesValue; }
    public List<Long> getMonthlyServiceLostSalesValue() { return monthlyServiceLostSalesValue; }
    public List<Long> getMonthlyBasketShrinkLostSalesValue() { return monthlyBasketShrinkLostSalesValue; }
    public List<Integer> getMonthlyDineInOrders() { return monthlyDineInOrders; }
    public List<Integer> getMonthlyDeliveryOrders() { return monthlyDeliveryOrders; }
    public long getCurrentMonthRevenue() { return currentMonthRevenue; }
    public int getCurrentMonthCompletedSales() { return currentMonthCompletedSales; }
    public long getCurrentMonthCogs() { return currentMonthCogs; }
    public long getCurrentMonthPayrollCost() { return currentMonthPayrollCost; }
    public long getCurrentMonthOperatingCost() { return currentMonthOperatingCost; }
    public long getLostSalesValueMonth() { return lostSalesValueMonth; }
    public long getStockoutLostSalesValueMonth() { return stockoutLostSalesValueMonth; }
    public long getServiceLostSalesValueMonth() { return serviceLostSalesValueMonth; }
    public long getBasketShrinkLostSalesValueMonth() { return basketShrinkLostSalesValueMonth; }
    public long getWasteCostMonth() { return wasteCostMonth; }
    public int getCurrentMonthDineInOrders() { return currentMonthDineInOrders; }
    public int getCurrentMonthDeliveryOrders() { return currentMonthDeliveryOrders; }
    public long getTotalRevenue() { return totalRevenue; }
    public long getTotalCogs() { return totalCogs; }
    public long getTotalPayrollCost() { return totalPayrollCost; }
    public long getTotalOperatingCost() { return totalOperatingCost; }
    public long getTotalWasteCost() { return totalWasteCost; }
    public long getTotalLostSalesValue() { return totalLostSalesValue; }
    public long getTotalStockoutLostSalesValue() { return totalStockoutLostSalesValue; }
    public long getTotalServiceLostSalesValue() { return totalServiceLostSalesValue; }
    public long getTotalBasketShrinkLostSalesValue() { return totalBasketShrinkLostSalesValue; }
    public long getTotalCost() { return totalCogs + totalPayrollCost + totalOperatingCost + totalWasteCost; }
    public long getNetContribution() { return totalRevenue - getTotalCost(); }
    public int getLateDeliveryCount30d() { return lateDeliveryCount30d; }
    public double getAttendanceStressScore() { return attendanceStressScore; }
    public int getStockoutStreakDays() { return stockoutStreakDays; }
    public int getStockoutsSalesThisMonth() { return stockoutsSalesThisMonth; }
    public int getTotalSalesAttemptedThisMonth() { return totalSalesAttemptedThisMonth; }
    public double getUnmetDemandCarryoverUnits() { return unmetDemandCarryoverUnits; }
    public int getServiceConstrainedOrdersThisMonth() { return serviceConstrainedOrdersThisMonth; }
    public double getDynamicPriceMultiplier() { return dynamicPriceMultiplier; }
    public double getDynamicWageMultiplier() { return dynamicWageMultiplier; }
    public double getRollingCapacityPressure() { return rollingCapacityPressure; }
    public double getRollingServiceLossRate() { return rollingServiceLossRate; }
    public double getRollingStockoutLossRate() { return rollingStockoutLossRate; }
    public double getRollingThroughputUtilization() { return rollingThroughputUtilization; }
    public double getReputationScore() { return reputationScore; }
    public double getClientBaseIndex() { return clientBaseIndex; }
    public double getRepeatCustomerPool() { return repeatCustomerPool; }
    public double getDeliveryCatchmentStrength() { return deliveryCatchmentStrength; }

    // --- Mutators ---
    public void setStatus(String status) { this.status = status; }
    public void setOpenedAt(OffsetDateTime openedAt) { this.openedAt = openedAt; }
    public void setClosedAt(OffsetDateTime closedAt) { this.closedAt = closedAt; }
    public void setActiveStaffCount(int count) { this.activeStaffCount = count; }
    public void setRegionId(long regionId) { this.regionId = regionId; }
    public void addMonthlyRevenue(long revenue) { this.monthlyRevenue.add(revenue); }

    public boolean isActive() { return "active".equals(status); }
    public boolean isClosed() { return "closed".equals(status); }

    /** Demand fulfilment rate for this month (for expansion evaluator). */
    public double inventoryFulfillmentRate() {
        if (totalSalesAttemptedThisMonth == 0) return 1.0;
        return 1.0 - ((double) stockoutsSalesThisMonth / totalSalesAttemptedThisMonth);
    }

    public void recordSaleAttempt(boolean stockout) {
        totalSalesAttemptedThisMonth++;
        if (stockout) {
            stockoutsSalesThisMonth++;
            stockoutStreakDays++;
        } else {
            stockoutStreakDays = 0;
        }
    }

    public void recordCompletedSale(long amount) {
        recordCompletedSale(amount, "dine_in");
    }

    public void recordCompletedSale(long amount, String orderType) {
        currentMonthRevenue += amount;
        currentMonthCompletedSales++;
        totalRevenue += amount;
        if ("delivery".equals(orderType)) {
            currentMonthDeliveryOrders++;
        } else {
            currentMonthDineInOrders++;
        }
    }

    public void addCogs(long amount) {
        currentMonthCogs += amount;
        totalCogs += amount;
    }

    public void addPayrollCost(long amount) {
        currentMonthPayrollCost += amount;
        totalPayrollCost += amount;
    }

    public void addPayrollCostToPreviousMonth(long amount) {
        totalPayrollCost += amount;
        if (!monthlyPayrollCost.isEmpty()) {
            int lastIndex = monthlyPayrollCost.size() - 1;
            monthlyPayrollCost.set(lastIndex, monthlyPayrollCost.get(lastIndex) + amount);
            return;
        }
        currentMonthPayrollCost += amount;
    }

    public void addOperatingCost(long amount) {
        currentMonthOperatingCost += amount;
        totalOperatingCost += amount;
    }

    public void addLostSalesValue(long amount) {
        lostSalesValueMonth += amount;
        totalLostSalesValue += amount;
    }

    public void addStockoutLostSalesValue(long amount) {
        if (amount <= 0) {
            return;
        }
        addLostSalesValue(amount);
        stockoutLostSalesValueMonth += amount;
        totalStockoutLostSalesValue += amount;
    }

    public void addServiceLostSalesValue(long amount) {
        if (amount <= 0) {
            return;
        }
        addLostSalesValue(amount);
        serviceLostSalesValueMonth += amount;
        totalServiceLostSalesValue += amount;
    }

    public void addBasketShrinkLostSalesValue(long amount) {
        if (amount <= 0) {
            return;
        }
        addLostSalesValue(amount);
        basketShrinkLostSalesValueMonth += amount;
        totalBasketShrinkLostSalesValue += amount;
    }

    public void addWasteCost(long amount) {
        wasteCostMonth += amount;
        totalWasteCost += amount;
    }

    public void recordServiceConstrainedOrders(int units) {
        if (units > 0) {
            serviceConstrainedOrdersThisMonth += units;
        }
    }

    public void incrementLateDeliveryCount() {
        lateDeliveryCount30d++;
    }

    public void easeLateDeliveryPressure() {
        lateDeliveryCount30d = Math.max(0, lateDeliveryCount30d - 1);
    }

    public void addAttendanceStress(double delta) {
        attendanceStressScore = Math.max(0.0, attendanceStressScore + delta);
    }

    public void decayAttendanceStress() {
        attendanceStressScore = Math.max(0.0, attendanceStressScore * 0.82);
    }

    public void addUnmetDemandCarryover(double qty) {
        unmetDemandCarryoverUnits += qty;
    }

    public void consumeUnmetDemandCarryover(double qty) {
        unmetDemandCarryoverUnits = Math.max(0.0, unmetDemandCarryoverUnits - qty);
    }

    public double currentMonthStockoutLossRate() {
        if (totalSalesAttemptedThisMonth == 0) {
            return 0.0;
        }
        return stockoutsSalesThisMonth / (double) totalSalesAttemptedThisMonth;
    }

    public double currentMonthGrossMarginRate() {
        if (currentMonthRevenue <= 0) {
            return 1.0;
        }
        return (currentMonthRevenue - currentMonthCogs) / (double) currentMonthRevenue;
    }

    public void updateCommercialSignals(double capacityPressure, double serviceLossRate,
                                        double stockoutLossRate, double throughputUtilization) {
        rollingCapacityPressure = smooth(rollingCapacityPressure, capacityPressure, 0.24);
        rollingServiceLossRate = smooth(rollingServiceLossRate, serviceLossRate, 0.22);
        rollingStockoutLossRate = smooth(rollingStockoutLossRate, stockoutLossRate, 0.18);
        rollingThroughputUtilization = smooth(rollingThroughputUtilization, throughputUtilization, 0.20);
    }

    public void adjustDynamicPriceMultiplier(double factor) {
        dynamicPriceMultiplier = clamp(dynamicPriceMultiplier * factor, 0.92, 1.08);
    }

    public void adjustDynamicWageMultiplier(double factor) {
        dynamicWageMultiplier = clamp(dynamicWageMultiplier * factor, 0.95, 1.04);
    }

    public void adjustReputationScore(double factor) {
        reputationScore = clamp(reputationScore * factor, 0.94, 1.18);
    }

    public void recordBlockDemand(String blockCode, int candidateOrders, int servedOrders) {
        remember(blockDemandHistory, blockCode, candidateOrders);
        remember(blockServedHistory, blockCode, servedOrders);
    }

    public double recentBlockDemandAverage(String blockCode) {
        return average(blockDemandHistory.get(blockCode));
    }

    public double recentBlockServedAverage(String blockCode) {
        return average(blockServedHistory.get(blockCode));
    }

    public void applyClientBaseFeedback(int targetedDemand, int completedOrders,
                                        double observedDeliveryShare,
                                        double serviceLossRate,
                                        double stockoutLossRate) {
        double demandSignal = clamp(targetedDemand / 120.0, 0.0, 1.4);
        double servedSignal = clamp(completedOrders / 110.0, 0.0, 1.4);
        double servicePenalty = clamp(serviceLossRate * 0.22 + stockoutLossRate * 0.18, 0.0, 0.18);
        clientBaseIndex = clamp(clientBaseIndex + servedSignal * 0.018 + demandSignal * 0.008 - servicePenalty, 0.72, 1.36);
        repeatCustomerPool = clamp(repeatCustomerPool + reputationScore * 0.012 + servedSignal * 0.010 - servicePenalty * 0.55, 0.12, 0.84);
        deliveryCatchmentStrength = clamp(deliveryCatchmentStrength + (observedDeliveryShare - 0.58) * 0.050
                + demandSignal * 0.010 - serviceLossRate * 0.028, 0.88, 1.28);
    }

    public void closeMonth() {
        monthlyRevenue.add(currentMonthRevenue);
        monthlyCompletedSales.add(currentMonthCompletedSales);
        monthlyCogs.add(currentMonthCogs);
        monthlyPayrollCost.add(currentMonthPayrollCost);
        monthlyOperatingCost.add(currentMonthOperatingCost);
        monthlyWasteCost.add(wasteCostMonth);
        monthlyLostSalesValue.add(lostSalesValueMonth);
        monthlyStockoutLostSalesValue.add(stockoutLostSalesValueMonth);
        monthlyServiceLostSalesValue.add(serviceLostSalesValueMonth);
        monthlyBasketShrinkLostSalesValue.add(basketShrinkLostSalesValueMonth);
        monthlyDineInOrders.add(currentMonthDineInOrders);
        monthlyDeliveryOrders.add(currentMonthDeliveryOrders);
        currentMonthRevenue = 0;
        currentMonthCompletedSales = 0;
        resetMonthlyCounters();
    }

    public void resetMonthlyCounters() {
        stockoutsSalesThisMonth = 0;
        serviceConstrainedOrdersThisMonth = 0;
        totalSalesAttemptedThisMonth = 0;
        lostSalesValueMonth = 0;
        stockoutLostSalesValueMonth = 0;
        serviceLostSalesValueMonth = 0;
        basketShrinkLostSalesValueMonth = 0;
        wasteCostMonth = 0;
        currentMonthCogs = 0;
        currentMonthPayrollCost = 0;
        currentMonthOperatingCost = 0;
        currentMonthDineInOrders = 0;
        currentMonthDeliveryOrders = 0;
    }

    private void remember(Map<String, Deque<Integer>> history, String key, int value) {
        Deque<Integer> deque = history.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        deque.addLast(Math.max(0, value));
        while (deque.size() > 28) {
            deque.removeFirst();
        }
    }

    private double average(Deque<Integer> deque) {
        if (deque == null || deque.isEmpty()) {
            return 0.0;
        }
        return deque.stream().mapToInt(Integer::intValue).average().orElse(0.0);
    }

    private double smooth(double current, double next, double alpha) {
        return current + ((next - current) * alpha);
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
