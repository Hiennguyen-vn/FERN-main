package com.fern.simulator.cli;

import com.fern.simulator.persistence.DatabaseTarget;
import com.fern.simulator.persistence.SimulatorRunRepository;
import com.fern.simulator.render.AnsiColors;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

@Command(name = "runs", description = "List past simulation runs.")
public class RunsCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--limit", "-l"}, description = "Max runs to display.", defaultValue = "10")
    private int limit;

    @Override
    public void run() {
        DatabaseTarget target = new DatabaseTarget(
                parent.getDbUrl(), parent.getDbUser(), parent.getDbPassword());

        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║       FERN Data Simulator — Runs            ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();

        try (Connection conn = target.getConnection()) {
            String sql = """
                SELECT id, namespace, status, total_days, completed_days,
                       started_at, completed_at, error_message
                FROM core.simulator_run
                ORDER BY started_at DESC
                LIMIT ?
                """;
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setInt(1, limit);
                try (ResultSet rs = ps.executeQuery()) {
                    System.out.printf("  %-20s %-15s %-10s %-12s %-20s%n",
                            "NAMESPACE", "STATUS", "DAYS", "PROGRESS", "STARTED");
                    System.out.println("  " + "─".repeat(77));

                    int count = 0;
                    while (rs.next()) {
                        String status = rs.getString("status");
                        String statusColor = switch (status) {
                            case "complete" -> AnsiColors.green(status);
                            case "running" -> AnsiColors.yellow(status);
                            case "error" -> AnsiColors.red(status);
                            case "cleaned" -> AnsiColors.cyan(status);
                            default -> status;
                        };

                        int total = rs.getInt("total_days");
                        int completed = rs.getInt("completed_days");
                        String progress = total > 0 ? String.format("%d/%d", completed, total) : "-";

                        System.out.printf("  %-20s %-15s %-10s %-12s %-20s%n",
                                rs.getString("namespace"),
                                statusColor,
                                total,
                                progress,
                                rs.getTimestamp("started_at"));
                        count++;
                    }

                    if (count == 0) {
                        System.out.println("  No simulation runs found.");
                    }
                }
            }
        } catch (Exception e) {
            System.err.println(AnsiColors.red("✗ Failed to list runs: ") + e.getMessage());
        }
    }
}
