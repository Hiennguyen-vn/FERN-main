package com.fern.simulator.model;

import java.util.HashMap;
import java.util.Map;

/**
 * Aggregated summary for a single simulation month, including financials.
 */
public class MonthSummary {
    private int year;
    private int month;
    private int outletsOpened;
    private int outletsClosed;
    private int hired;
    private int departed;
    private int salesCount;
    private int salesCancelled;
    private int salesRefunded;
    private int salesVoided;
    private long revenue;
    private long cogs; // cost of goods sold
    private long procurementCost; // total goods receipt cost
    private long payrollCost; // total payroll for the month
    private long operatingCost; // rent, utilities, etc.
    private int poCount;
    private int grCount;
    private int payrollCount;
    private int manufacturingBatches;
    private int wasteEvents;
    private long wasteCost;
    private int stockoutEvents;
    private long lostSalesValue;
    private long stockoutLostSalesValue;
    private long serviceLostSalesValue;
    private long basketShrinkLostSalesValue;
    private int dineInOrders;
    private int deliveryOrders;
    private int lateDeliveries;
    private int partialDeliveries;
    private int absentShifts;
    private int lateShifts;
    private int overtimeShifts;
    private int quits;
    private int replacements;
    private final Map<String, Object> expansionEvents = new HashMap<>();

    public MonthSummary(int year, int month) {
        this.year = year;
        this.month = month;
    }

    // --- Increment helpers ---
    public void addOutletOpened() { outletsOpened++; }
    public void addOutletClosed() { outletsClosed++; }
    public void addHired(int count) { hired += count; }
    public void addDeparted() { departed++; }
    public void addSale(long amount) { salesCount++; revenue += amount; }
    public void addCogs(long cost) { cogs += cost; }
    public void addProcurementCost(long cost) { procurementCost += cost; }
    public void addPayrollCost(long cost) { payrollCost += cost; }
    public void addOperatingCost(long cost) { operatingCost += cost; }
    public void addSaleCancelled() { salesCancelled++; }
    public void addSaleRefunded() { salesRefunded++; }
    public void addSaleVoided() { salesVoided++; }
    public void addPo() { poCount++; }
    public void addGr() { grCount++; }
    public void addPayroll() { payrollCount++; }
    public void addManufacturingBatch() { manufacturingBatches++; }
    public void addWasteEvent(long cost) { wasteEvents++; wasteCost += cost; }
    public void addStockout(long lostValue) {
        stockoutEvents++;
        lostSalesValue += lostValue;
        stockoutLostSalesValue += lostValue;
    }
    public void addDemandLoss(long lostValue) {
        lostSalesValue += lostValue;
        serviceLostSalesValue += lostValue;
    }
    public void addBasketShrinkLoss(long lostValue) {
        lostSalesValue += lostValue;
        basketShrinkLostSalesValue += lostValue;
    }
    public void addDineInOrder() { dineInOrders++; }
    public void addDeliveryOrder() { deliveryOrders++; }
    public void addLateDelivery() { lateDeliveries++; }
    public void addPartialDelivery() { partialDeliveries++; }
    public void addAbsentShift() { absentShifts++; }
    public void addLateShift() { lateShifts++; }
    public void addOvertimeShift() { overtimeShifts++; }
    public void addQuit() { quits++; }
    public void addReplacement() { replacements++; }
    public void addExpansionEvent(String key, Object value) { expansionEvents.put(key, value); }

    // --- Getters ---
    public int getYear() { return year; }
    public int getMonth() { return month; }
    public int getOutletsOpened() { return outletsOpened; }
    public int getOutletsClosed() { return outletsClosed; }
    public int getHired() { return hired; }
    public int getDeparted() { return departed; }
    public int getSalesCount() { return salesCount; }
    public int getSalesCancelled() { return salesCancelled; }
    public int getSalesRefunded() { return salesRefunded; }
    public int getSalesVoided() { return salesVoided; }
    public long getRevenue() { return revenue; }
    public long getCogs() { return cogs; }
    public long getProcurementCost() { return procurementCost; }
    public long getPayrollCost() { return payrollCost; }
    public long getOperatingCost() { return operatingCost; }
    public long getGrossProfit() { return revenue - cogs; }
    public long getNetProfit() { return revenue - cogs - payrollCost - operatingCost - wasteCost; }
    public int getPoCount() { return poCount; }
    public int getGrCount() { return grCount; }
    public int getPayrollCount() { return payrollCount; }
    public int getManufacturingBatches() { return manufacturingBatches; }
    public int getWasteEvents() { return wasteEvents; }
    public long getWasteCost() { return wasteCost; }
    public int getStockoutEvents() { return stockoutEvents; }
    public long getLostSalesValue() { return lostSalesValue; }
    public long getStockoutLostSalesValue() { return stockoutLostSalesValue; }
    public long getServiceLostSalesValue() { return serviceLostSalesValue; }
    public long getBasketShrinkLostSalesValue() { return basketShrinkLostSalesValue; }
    public int getDineInOrders() { return dineInOrders; }
    public int getDeliveryOrders() { return deliveryOrders; }
    public int getLateDeliveries() { return lateDeliveries; }
    public int getPartialDeliveries() { return partialDeliveries; }
    public int getAbsentShifts() { return absentShifts; }
    public int getLateShifts() { return lateShifts; }
    public int getOvertimeShifts() { return overtimeShifts; }
    public int getQuits() { return quits; }
    public int getReplacements() { return replacements; }
    public Map<String, Object> getExpansionEvents() { return expansionEvents; }
}
