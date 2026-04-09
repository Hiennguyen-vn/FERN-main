package com.fern.simulator.render;

import com.fern.simulator.model.MonthSummary;

import java.util.List;

/**
 * Renders a tree view of simulation results — either from result_json MonthSummary
 * data or from the event journal file.
 */
public final class TreeRenderer {

    private TreeRenderer() {}

    /**
     * Renders a compact tree view of all monthly summaries.
     */
    public static String renderSummaryTree(List<MonthSummary> months) {
        if (months == null || months.isEmpty()) return "No data available.\n";

        StringBuilder sb = new StringBuilder();
        sb.append(AnsiColors.bold("📊 Simulation Timeline\n"));
        sb.append("═".repeat(60)).append('\n');

        int currentYear = -1;
        for (int i = 0; i < months.size(); i++) {
            MonthSummary m = months.get(i);
            boolean isLast = (i == months.size() - 1);

            if (m.getYear() != currentYear) {
                if (currentYear != -1) sb.append("  │\n");
                currentYear = m.getYear();
                sb.append(AnsiColors.bold("  📅 " + currentYear + "\n"));
            }

            String connector = isLast ? "  └── " : "  ├── ";
            String monthName = java.time.Month.of(m.getMonth()).name().substring(0, 3);

            sb.append(connector);
            sb.append(AnsiColors.cyan(monthName));
            sb.append(" — ");

            // Compact stats
            List<String> stats = new java.util.ArrayList<>();
            if (m.getOutletsOpened() > 0) stats.add(AnsiColors.green("+" + m.getOutletsOpened() + " outlets"));
            if (m.getOutletsClosed() > 0) stats.add(AnsiColors.red("-" + m.getOutletsClosed() + " outlets"));
            if (m.getHired() > 0) stats.add(AnsiColors.green("+" + m.getHired() + " hired"));
            if (m.getDeparted() > 0) stats.add(AnsiColors.yellow("-" + m.getDeparted() + " departed"));
            stats.add(m.getSalesCount() + " sales");
            if (m.getSalesCancelled() > 0) stats.add(m.getSalesCancelled() + "↩ cancel");
            if (m.getSalesRefunded() > 0) stats.add(m.getSalesRefunded() + "↩ refund");
            if (m.getSalesVoided() > 0) stats.add(m.getSalesVoided() + "↩ void");
            stats.add("₫" + formatCompact(m.getRevenue()));
            if (m.getPoCount() > 0) stats.add(m.getPoCount() + " PO");
            if (m.getPayrollCount() > 0) stats.add(m.getPayrollCount() + " payroll");

            sb.append(String.join(" | ", stats));
            sb.append('\n');
        }

        return sb.toString();
    }

    private static String formatCompact(long amount) {
        if (amount >= 1_000_000_000) return String.format("%.1fB", amount / 1_000_000_000.0);
        if (amount >= 1_000_000) return String.format("%.1fM", amount / 1_000_000.0);
        if (amount >= 1_000) return String.format("%.1fK", amount / 1_000.0);
        return String.valueOf(amount);
    }
}
