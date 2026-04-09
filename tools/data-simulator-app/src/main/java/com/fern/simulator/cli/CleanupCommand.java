package com.fern.simulator.cli;

import com.fern.simulator.persistence.CleanupRepository;
import com.fern.simulator.persistence.DatabaseTarget;
import com.fern.simulator.persistence.SafetyChecker;
import com.fern.simulator.render.AnsiColors;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.sql.Connection;
import java.util.Map;

@Command(name = "cleanup", description = "Remove simulator-generated data by namespace, or across all simulator namespaces.")
public class CleanupCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--namespace", "-n"}, description = "Namespace to clean up.")
    private String namespace;

    @Option(names = {"--all", "-a"}, description = "Clean all simulator-owned namespaces recorded in simulator_run.", defaultValue = "false")
    private boolean all;

    @Option(names = {"--preview"}, description = "Show what would be deleted without deleting.", defaultValue = "false")
    private boolean preview;

    @Option(names = {"--execute"}, description = "Execute the cleanup.", defaultValue = "false")
    private boolean execute;

    @Override
    public void run() {
        if (!preview && !execute) {
            System.err.println("Please specify either --preview or --execute.");
            return;
        }
        if (all && namespace != null) {
            System.err.println("Use either --all or --namespace, not both.");
            return;
        }
        if (!all && (namespace == null || namespace.isBlank())) {
            System.err.println("Please specify --namespace or use --all.");
            return;
        }

        DatabaseTarget target = new DatabaseTarget(
                parent.getDbUrl(), parent.getDbUser(), parent.getDbPassword());

        if (!parent.isAllowNonLocal()) {
            SafetyChecker.requireLocalhost(target);
        }

        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║       FERN Data Simulator — Cleanup         ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();
        System.out.println("  Scope     : " + (all ? "ALL SIMULATOR NAMESPACES" : namespace));
        System.out.println("  Mode      : " + (preview ? "PREVIEW" : AnsiColors.red("EXECUTE")));
        System.out.println();

        try (Connection conn = target.getConnection()) {
            if (preview) {
                if (all) {
                    long grandTotal = 0;
                    for (var summary : CleanupRepository.listNamespaces(conn)) {
                        Map<String, Long> counts = CleanupRepository.preview(conn, summary.namespace());
                        long total = counts.values().stream().mapToLong(Long::longValue).sum();
                        if (total == 0 && summary.cleanedAt() != null) {
                            continue;
                        }
                        grandTotal += total;
                        System.out.println(AnsiColors.bold(summary.namespace()) + " — " + String.format("%,d rows", total));
                        for (var entry : counts.entrySet()) {
                            if (entry.getValue() > 0) {
                                System.out.printf("  %-35s %,d rows%n", entry.getKey(), entry.getValue());
                            }
                        }
                        System.out.println();
                    }
                    System.out.printf("  %-35s %s%n", AnsiColors.bold("TOTAL"),
                            AnsiColors.bold(String.format("%,d rows", grandTotal)));
                } else {
                    Map<String, Long> counts = CleanupRepository.preview(conn, namespace);
                    long total = counts.values().stream().mapToLong(Long::longValue).sum();

                    System.out.println(AnsiColors.bold("Would delete:"));
                    for (var entry : counts.entrySet()) {
                        if (entry.getValue() > 0) {
                            System.out.printf("  %-35s %,d rows%n", entry.getKey(), entry.getValue());
                        }
                    }
                    System.out.println();
                    System.out.printf("  %-35s %s%n", AnsiColors.bold("TOTAL"),
                            AnsiColors.bold(String.format("%,d rows", total)));
                }
            } else {
                System.out.println(AnsiColors.yellow("⚠ WARNING: This will permanently delete data!"));
                System.out.println();

                if (all) {
                    long grandTotal = 0;
                    for (var summary : CleanupRepository.listNamespaces(conn)) {
                        conn.setAutoCommit(false);
                        try {
                            try (var stmt = conn.createStatement()) {
                                stmt.execute("SET LOCAL fern.simulator_cleanup = 'on'");
                            }
                            Map<String, Long> deleted = CleanupRepository.execute(conn, summary.namespace());
                            conn.commit();
                            long total = deleted.values().stream().mapToLong(Long::longValue).sum();
                            grandTotal += total;
                            if (total > 0) {
                                System.out.println(AnsiColors.green("✓") + " " + summary.namespace()
                                        + " — " + String.format("%,d rows affected", total));
                            }
                        } catch (Exception e) {
                            conn.rollback();
                            throw e;
                        }
                    }
                    System.out.printf("  %-35s %s%n", AnsiColors.bold("TOTAL"),
                            AnsiColors.bold(String.format("%,d rows affected", grandTotal)));
                } else {
                    conn.setAutoCommit(false);
                    try {
                        try (var stmt = conn.createStatement()) {
                            stmt.execute("SET LOCAL fern.simulator_cleanup = 'on'");
                        }
                        Map<String, Long> deleted = CleanupRepository.execute(conn, namespace);
                        conn.commit();

                        long total = deleted.values().stream().mapToLong(Long::longValue).sum();
                        System.out.println(AnsiColors.green("✓") + " Cleanup completed:");
                        for (var entry : deleted.entrySet()) {
                            if (entry.getValue() > 0) {
                                System.out.printf("  %-35s %,d rows affected%n", entry.getKey(), entry.getValue());
                            }
                        }
                        System.out.println();
                        System.out.printf("  %-35s %s%n", AnsiColors.bold("TOTAL"),
                                AnsiColors.bold(String.format("%,d rows affected", total)));
                    } catch (Exception e) {
                        conn.rollback();
                        throw e;
                    }
                }
            }
        } catch (Exception e) {
            System.err.println(AnsiColors.red("✗ Cleanup failed: ") + e.getMessage());
            e.printStackTrace();
        }
    }
}
