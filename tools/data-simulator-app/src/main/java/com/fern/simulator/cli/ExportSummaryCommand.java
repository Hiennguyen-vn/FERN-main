package com.fern.simulator.cli;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationEngine;
import com.fern.simulator.export.SummaryExporter;
import com.fern.simulator.model.RunResult;
import com.fern.simulator.render.AnsiColors;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.nio.file.Path;

@Command(name = "export-summary", description = "Export simulation run summary.")
public class ExportSummaryCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--config", "-c"}, description = "Path to YAML config file.")
    private Path configPath;

    @Option(names = {"--preset", "-p"}, description = "Named preset: small, medium, large.")
    private String preset;

    @Option(names = {"--output", "-o"}, description = "Output file path.")
    private Path outputPath;

    @Override
    public void run() {
        SimulationConfig config = ConfigLoader.load(configPath, preset);

        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║     FERN Data Simulator — Export Summary     ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();

        // Run simulation to collect summary
        SimulationEngine engine = new SimulationEngine();
        RunResult result = engine.run(config, null, true);

        if (outputPath == null) {
            outputPath = Path.of("simulator-output", config.namespace() + "-summary.json");
        }

        try {
            SummaryExporter.export(result, outputPath);
            long totalGrossProfit = result.months().stream().mapToLong(month -> month.getGrossProfit()).sum();
            long totalNetProfit = result.months().stream().mapToLong(month -> month.getNetProfit()).sum();
            System.out.println();
            System.out.println(AnsiColors.green("✓") + " Summary exported to: " + outputPath);
            System.out.println();
            System.out.println(AnsiColors.bold("━━━ Quick Stats ━━━"));
            System.out.printf("  Outlets      : %d total, %d active%n",
                    result.totalOutletsEver(), result.activeOutletsAtEnd());
            System.out.printf("  Employees    : %d total, %d active%n",
                    result.totalEmployeesEver(), result.activeEmployeesAtEnd());
            System.out.printf("  Revenue      : ₫%,d%n", result.totalRevenue());
            System.out.printf("  Gross Profit : ₫%,d%n", totalGrossProfit);
            System.out.printf("  Net Profit   : ₫%,d%n", totalNetProfit);
            System.out.printf("  Months       : %d%n", result.months().size());
        } catch (Exception e) {
            System.err.println(AnsiColors.red("✗ Export failed: ") + e.getMessage());
            e.printStackTrace();
        }
    }
}
