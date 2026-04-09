package com.fern.simulator.export;

import com.fern.simulator.model.MonthSummary;
import com.fern.simulator.model.RunResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Exports simulation run summary as a formatted report.
 */
public final class SummaryExporter {

    private static final Logger log = LoggerFactory.getLogger(SummaryExporter.class);
    private static final ObjectMapper JSON = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .enable(SerializationFeature.INDENT_OUTPUT)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private SummaryExporter() {}

    public static void export(RunResult result, Path outputPath) throws IOException {
        Files.createDirectories(outputPath.getParent());

        Map<String, Object> summary = new LinkedHashMap<>();
        long totalCogs = result.months().stream().mapToLong(MonthSummary::getCogs).sum();
        long totalPayrollCost = result.months().stream().mapToLong(MonthSummary::getPayrollCost).sum();
        long totalOperatingCost = result.months().stream().mapToLong(MonthSummary::getOperatingCost).sum();
        long totalWasteCost = result.months().stream().mapToLong(MonthSummary::getWasteCost).sum();
        long totalLostSalesValue = result.months().stream().mapToLong(MonthSummary::getLostSalesValue).sum();
        long totalStockoutLostSalesValue = result.months().stream().mapToLong(MonthSummary::getStockoutLostSalesValue).sum();
        long totalServiceLostSalesValue = result.months().stream().mapToLong(MonthSummary::getServiceLostSalesValue).sum();
        long totalBasketShrinkLostSalesValue = result.months().stream().mapToLong(MonthSummary::getBasketShrinkLostSalesValue).sum();
        long totalGrossProfit = result.months().stream().mapToLong(MonthSummary::getGrossProfit).sum();
        long totalNetProfit = result.months().stream().mapToLong(MonthSummary::getNetProfit).sum();

        summary.put("seed", result.seed());
        summary.put("totalOutletsEver", result.totalOutletsEver());
        summary.put("activeOutletsAtEnd", result.activeOutletsAtEnd());
        summary.put("closedOutlets", Math.max(0, result.totalOutletsEver() - result.activeOutletsAtEnd()));
        summary.put("totalEmployeesEver", result.totalEmployeesEver());
        summary.put("activeEmployeesAtEnd", result.activeEmployeesAtEnd());
        summary.put("totalRevenue", result.totalRevenue());
        summary.put("totalCogs", totalCogs);
        summary.put("totalPayrollCost", totalPayrollCost);
        summary.put("totalOperatingCost", totalOperatingCost);
        summary.put("totalWasteCost", totalWasteCost);
        summary.put("lostSalesValue", totalLostSalesValue);
        summary.put("stockoutLostSalesValue", totalStockoutLostSalesValue);
        summary.put("serviceLostSalesValue", totalServiceLostSalesValue);
        summary.put("basketShrinkLostSalesValue", totalBasketShrinkLostSalesValue);
        summary.put("totalGrossProfit", totalGrossProfit);
        summary.put("totalNetProfit", totalNetProfit);
        summary.put("journalPath", result.journalPath());
        summary.put("rowCounts", result.rowCounts());
        summary.put("outletEconomics", result.outletEconomics());

        // Monthly breakdown
        summary.put("monthlyData", result.months().stream().map(m -> {
            Map<String, Object> month = new LinkedHashMap<>();
            month.put("period", m.getYear() + "-" + String.format("%02d", m.getMonth()));
            month.put("outletsOpened", m.getOutletsOpened());
            month.put("outletsClosed", m.getOutletsClosed());
            month.put("hired", m.getHired());
            month.put("departed", m.getDeparted());
            month.put("salesCount", m.getSalesCount());
            month.put("salesCancelled", m.getSalesCancelled());
            month.put("salesRefunded", m.getSalesRefunded());
            month.put("salesVoided", m.getSalesVoided());
            month.put("revenue", m.getRevenue());
            month.put("cogs", m.getCogs());
            month.put("procurementCost", m.getProcurementCost());
            month.put("payrollCost", m.getPayrollCost());
            month.put("operatingCost", m.getOperatingCost());
            month.put("grossProfit", m.getGrossProfit());
            month.put("netProfit", m.getNetProfit());
            month.put("purchaseOrders", m.getPoCount());
            month.put("goodsReceipts", m.getGrCount());
            month.put("payrollRuns", m.getPayrollCount());
            month.put("manufacturingBatches", m.getManufacturingBatches());
            month.put("wasteEvents", m.getWasteEvents());
            month.put("wasteCost", m.getWasteCost());
            month.put("stockoutEvents", m.getStockoutEvents());
            month.put("lostSalesValue", m.getLostSalesValue());
            month.put("stockoutLostSalesValue", m.getStockoutLostSalesValue());
            month.put("serviceLostSalesValue", m.getServiceLostSalesValue());
            month.put("basketShrinkLostSalesValue", m.getBasketShrinkLostSalesValue());
            month.put("dineInOrders", m.getDineInOrders());
            month.put("deliveryOrders", m.getDeliveryOrders());
            month.put("avgTicket", m.getSalesCount() <= 0 ? 0.0 : m.getRevenue() / (double) m.getSalesCount());
            month.put("lateDeliveries", m.getLateDeliveries());
            month.put("partialDeliveries", m.getPartialDeliveries());
            month.put("absentShifts", m.getAbsentShifts());
            month.put("lateShifts", m.getLateShifts());
            month.put("overtimeShifts", m.getOvertimeShifts());
            month.put("quits", m.getQuits());
            month.put("replacements", m.getReplacements());
            month.put("expansionEvents", m.getExpansionEvents());
            return month;
        }).toList());

        JSON.writeValue(outputPath.toFile(), summary);
        log.info("Exported run summary to: {}", outputPath);
    }
}
