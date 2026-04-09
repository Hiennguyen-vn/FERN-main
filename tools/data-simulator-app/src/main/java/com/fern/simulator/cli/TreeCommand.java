package com.fern.simulator.cli;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.engine.SimulationEngine;
import com.fern.simulator.model.RunResult;
import com.fern.simulator.render.AnsiColors;
import com.fern.simulator.render.TreeRenderer;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.nio.file.Path;

@Command(name = "tree", description = "Display simulation timeline as a tree view.")
public class TreeCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--config", "-c"}, description = "Path to YAML config file.")
    private Path configPath;

    @Option(names = {"--preset", "-p"}, description = "Named preset: small, medium, large.")
    private String preset;

    @Override
    public void run() {
        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║       FERN Data Simulator — Tree View       ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();

        // Run a dry-run simulation to collect monthly summaries
        SimulationConfig config = ConfigLoader.load(configPath, preset);

        System.out.println("  Running dry simulation to collect timeline data...");
        System.out.println("  Namespace : " + config.namespace());
        System.out.println("  Duration  : " + config.startDate() + " → " + config.endDate());
        System.out.println();

        SimulationEngine engine = new SimulationEngine();
        RunResult result = engine.run(config, null, true);

        System.out.println();
        System.out.println(TreeRenderer.renderSummaryTree(result.months()));

        // Print final metrics
        System.out.println();
        System.out.println(AnsiColors.bold("━━━ Final Metrics ━━━"));
        System.out.printf("  Total Outlets Ever   : %d (%d active at end)%n",
                result.totalOutletsEver(), result.activeOutletsAtEnd());
        System.out.printf("  Total Employees Ever : %d (%d active at end)%n",
                result.totalEmployeesEver(), result.activeEmployeesAtEnd());
        System.out.printf("  Total Revenue        : ₫%,d%n", result.totalRevenue());
        System.out.printf("  Seed                 : %d%n", result.seed());
    }
}
