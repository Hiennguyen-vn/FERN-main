package com.fern.simulator.engine;

import java.time.LocalDate;
import java.util.Map;

/**
 * Callback interface for simulation progress events.
 * Used by the GUI to receive real-time updates without tight coupling.
 */
public interface ProgressListener {

    /** Called once when the simulation starts. */
    default void onStart(String namespace, long totalDays, LocalDate startDate, LocalDate endDate) {}

    /** Called after each day is processed. */
    default void onDayComplete(long dayNumber, long totalDays, LocalDate date,
                                int activeOutlets, int activeEmployees,
                                long monthRevenue, int monthSales, long totalRowsWritten) {}

    /** Called when a notable event occurs (region opened, employee hired, etc.). */
    default void onEvent(String type, String message, LocalDate date) {}

    /** Called on monthly boundary with summary stats including financials. */
    default void onMonthEnd(int year, int month, long revenue, int outlets,
                            int employees, int sales, int purchaseOrders,
                            long cogs, long payrollCost, long operatingCost,
                            long grossProfit, long netProfit,
                            long wasteCost, long lostSalesValue) {}

    /** Called when simulation completes successfully. */
    default void onComplete(Map<String, Long> rowCounts, long totalRevenue,
                            int totalEmployees, int activeEmployees,
                            int totalOutlets, int activeOutlets) {}

    /** Called with run-level diagnostics and timing data. */
    default void onDiagnostics(Map<String, Object> diagnostics) {}

    /** Called with daily operational incident summaries. */
    default void onOperationalSummary(Map<String, Object> summary) {}

    /** Called if simulation fails with an error. */
    default void onError(String message) {}
}
