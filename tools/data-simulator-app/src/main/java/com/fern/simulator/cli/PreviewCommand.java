package com.fern.simulator.cli;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.render.TableRenderer;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.nio.file.Path;

@Command(name = "preview", description = "Validate config, estimate row counts, and show warnings without writing to DB.")
public class PreviewCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--config", "-c"}, description = "Path to YAML config file.")
    private Path configPath;

    @Option(names = {"--preset", "-p"}, description = "Named preset: small, medium, large.")
    private String preset;

    @Override
    public void run() {
        SimulationConfig config = ConfigLoader.load(configPath, preset);
        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║       FERN Data Simulator — Preview         ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();
        System.out.println("  Namespace     : " + config.namespace());
        System.out.println("  Start Date    : " + config.startDate());
        System.out.println("  End Date      : " + config.endDate());
        System.out.println("  Seed          : " + config.seed());
        System.out.println("  Starting Region: " + config.startingRegion());
        System.out.println("  Total Days    : " + config.totalDays());
        System.out.println("  Initial Outlets: " + config.expansion().initialOutlets());
        System.out.println("  Expansion Enabled: " + config.expansion().globalExpansionEnabled());
        System.out.println();
        System.out.println("Preview mode — no database writes will occur.");
        if (config.expansion().initialOutlets() <= 0) {
            System.out.println("No outlets will be created unless the config explicitly opts in.");
        }
        // TODO: estimate row counts, run config validation, show warnings
    }
}
