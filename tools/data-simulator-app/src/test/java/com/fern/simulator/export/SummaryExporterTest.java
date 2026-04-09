package com.fern.simulator.export;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.simulator.model.MonthSummary;
import com.fern.simulator.model.RunResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SummaryExporterTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @TempDir
    Path tempDir;

    @Test
    void exportIncludesMonthlyProfitFieldsAndTotals() throws Exception {
        MonthSummary january = new MonthSummary(2026, 1);
        january.addSale(120_000_000L);
        january.addCogs(42_000_000L);
        january.addPayrollCost(18_000_000L);
        january.addOperatingCost(9_000_000L);
        january.addPo();
        january.addGr();
        january.addPayroll();

        MonthSummary february = new MonthSummary(2026, 2);
        february.addSale(140_000_000L);
        february.addCogs(55_000_000L);
        february.addPayrollCost(19_000_000L);
        february.addOperatingCost(11_000_000L);
        february.addWasteEvent(500_000L);
        february.addStockout(1_200_000L);

        RunResult result = new RunResult(
                42L,
                Map.of("sale_record", 2L),
                List.of(january, february),
                12,
                10,
                3,
                2,
                260_000_000L,
                "journal.jsonl",
                List.of(Map.of(
                        "code", "OUT-001",
                        "locationTier", "transit",
                        "seatCount", 40,
                        "serviceSlotCount", 40,
                        "baseMonthlyRent", 25_000_000L
                ))
        );

        Path output = tempDir.resolve("summary.json");
        SummaryExporter.export(result, output);

        Map<?, ?> summary = JSON.readValue(output.toFile(), Map.class);
        assertEquals(260_000_000, ((Number) summary.get("totalRevenue")).longValue());
        assertEquals(97_000_000, ((Number) summary.get("totalCogs")).longValue());
        assertEquals(37_000_000, ((Number) summary.get("totalPayrollCost")).longValue());
        assertEquals(20_000_000, ((Number) summary.get("totalOperatingCost")).longValue());
        assertEquals(163_000_000, ((Number) summary.get("totalGrossProfit")).longValue());
        assertEquals(105_500_000, ((Number) summary.get("totalNetProfit")).longValue());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> monthlyData = (List<Map<String, Object>>) summary.get("monthlyData");
        assertEquals(2, monthlyData.size());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> outletEconomics = (List<Map<String, Object>>) summary.get("outletEconomics");
        assertEquals(1, outletEconomics.size());
        assertEquals("OUT-001", outletEconomics.getFirst().get("code"));
        assertEquals("transit", outletEconomics.getFirst().get("locationTier"));

        Map<String, Object> firstMonth = monthlyData.getFirst();
        assertEquals("2026-01", firstMonth.get("period"));
        assertEquals(42_000_000, ((Number) firstMonth.get("cogs")).longValue());
        assertEquals(18_000_000, ((Number) firstMonth.get("payrollCost")).longValue());
        assertEquals(9_000_000, ((Number) firstMonth.get("operatingCost")).longValue());
        assertEquals(78_000_000, ((Number) firstMonth.get("grossProfit")).longValue());
        assertEquals(51_000_000, ((Number) firstMonth.get("netProfit")).longValue());

        Map<String, Object> secondMonth = monthlyData.get(1);
        assertTrue(secondMonth.containsKey("wasteCost"));
        assertTrue(secondMonth.containsKey("lostSalesValue"));
        assertTrue(secondMonth.containsKey("stockoutLostSalesValue"));
        assertTrue(secondMonth.containsKey("serviceLostSalesValue"));
        assertEquals(500_000, ((Number) secondMonth.get("wasteCost")).longValue());
        assertEquals(1_200_000, ((Number) secondMonth.get("lostSalesValue")).longValue());
        assertEquals(1_200_000, ((Number) secondMonth.get("stockoutLostSalesValue")).longValue());
        assertEquals(0, ((Number) secondMonth.get("serviceLostSalesValue")).longValue());
    }
}
