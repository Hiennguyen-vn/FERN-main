package com.fern.simulator.render;

import java.time.Duration;
import java.time.Instant;

/**
 * Renders a live progress bar and phase statistics during simulation execution.
 */
public final class ProgressRenderer {

    private final long totalDays;
    private final Instant startTime;
    private long completedDays = 0;

    public ProgressRenderer(long totalDays) {
        this.totalDays = totalDays;
        this.startTime = Instant.now();
    }

    /**
     * Update and render the progress bar. Call every N days.
     */
    public void update(long completedDays, String currentDate, int outlets, int employees, long monthRevenue) {
        this.completedDays = completedDays;
        double pct = totalDays > 0 ? (double) completedDays / totalDays : 0;

        Duration elapsed = Duration.between(startTime, Instant.now());
        String eta = estimateEta(pct, elapsed);

        // Build progress bar
        int barWidth = 30;
        int filled = (int) (pct * barWidth);
        StringBuilder bar = new StringBuilder();
        bar.append('[');
        for (int i = 0; i < barWidth; i++) {
            if (i < filled) bar.append('█');
            else if (i == filled) bar.append('▒');
            else bar.append('░');
        }
        bar.append(']');

        String line = String.format("\r%s %5.1f%% | Day %d/%d | %s | %d outlets | %d staff | Rev: %s | %s  ETA: %s",
                bar, pct * 100, completedDays, totalDays, currentDate,
                outlets, employees, formatAmount(monthRevenue),
                formatDuration(elapsed), eta);

        if (AnsiColors.isTerminal()) {
            System.out.print(line);
            System.out.flush();
        } else {
            System.out.println(line.trim());
        }
    }

    /** Print a final summary line after the progress bar. */
    public void complete() {
        Duration total = Duration.between(startTime, Instant.now());
        System.out.println();
        System.out.println();
        System.out.println(AnsiColors.green("✓") + " Simulation complete in " +
                AnsiColors.bold(formatDuration(total)));
    }

    private String estimateEta(double pct, Duration elapsed) {
        if (pct <= 0.01) return "calculating...";
        long totalMs = (long) (elapsed.toMillis() / pct);
        long remainMs = totalMs - elapsed.toMillis();
        return formatDuration(Duration.ofMillis(Math.max(0, remainMs)));
    }

    private static String formatDuration(Duration d) {
        long secs = d.getSeconds();
        if (secs < 60) return secs + "s";
        if (secs < 3600) return (secs / 60) + "m" + (secs % 60) + "s";
        return (secs / 3600) + "h" + ((secs % 3600) / 60) + "m";
    }

    private static String formatAmount(long amount) {
        if (amount >= 1_000_000_000) return String.format("%.1fB", amount / 1_000_000_000.0);
        if (amount >= 1_000_000) return String.format("%.1fM", amount / 1_000_000.0);
        if (amount >= 1_000) return String.format("%.1fK", amount / 1_000.0);
        return String.valueOf(amount);
    }
}
