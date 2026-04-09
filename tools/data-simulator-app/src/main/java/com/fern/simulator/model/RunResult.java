package com.fern.simulator.model;

import java.util.List;
import java.util.Map;

/**
 * Final result of a simulation run. Persisted to result_json.
 */
public record RunResult(
        long seed,
        Map<String, Long> rowCounts,
        List<MonthSummary> months,
        int totalEmployeesEver,
        int activeEmployeesAtEnd,
        int totalOutletsEver,
        int activeOutletsAtEnd,
        long totalRevenue,
        String journalPath,
        List<Map<String, Object>> outletEconomics
) {}
