package com.fern.simulator.cli;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.export.UserExporter;
import com.fern.simulator.persistence.DatabaseTarget;
import com.fern.simulator.persistence.SafetyChecker;
import com.fern.simulator.render.AnsiColors;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.nio.file.Path;

@Command(name = "export-users", description = "Export simulator-owned user accounts from the database.")
public class ExportUsersCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--config", "-c"}, description = "Path to YAML config file.")
    private Path configPath;

    @Option(names = {"--preset", "-p"}, description = "Named preset: small, medium, large.")
    private String preset;

    @Option(names = {"--all"}, description = "Export all simulator-owned accounts across all namespaces.")
    private boolean exportAll;

    @Option(names = {"--output", "-o"}, description = "Output CSV file path.")
    private Path outputPath;

    @Override
    public void run() {
        SimulationConfig config = ConfigLoader.load(configPath, preset);
        DatabaseTarget target = new DatabaseTarget(
                config.database().url(),
                config.database().username(),
                config.database().password()
        );

        try {
            if (!config.database().allowNonLocal()) {
                SafetyChecker.requireLocalhost(target);
            }

            if (outputPath == null) {
                outputPath = Path.of("simulator-output",
                        exportAll ? "SIM-ALL-accounts.csv" : config.namespace() + "-accounts.csv");
            }

            try (var conn = target.getConnection()) {
                var accounts = exportAll
                        ? UserExporter.fetchAll(conn)
                        : UserExporter.fetchByNamespace(conn, config.namespace());
                UserExporter.exportCsv(accounts, outputPath);

                System.out.println("╔══════════════════════════════════════════════╗");
                System.out.println("║   FERN Data Simulator — Exported Accounts    ║");
                System.out.println("╚══════════════════════════════════════════════╝");
                System.out.println();
                System.out.println("  Scope  : " + (exportAll ? "ALL SIM NAMESPACES" : config.namespace()));
                System.out.println("  Output : " + outputPath);
                System.out.println("  Rows   : " + accounts.size());
                System.out.println();
                System.out.println(AnsiColors.green("✓") + " Account export complete");
            }
        } catch (Exception e) {
            System.err.println(AnsiColors.red("✗ Export failed: ") + e.getMessage());
            e.printStackTrace();
        }
    }
}
