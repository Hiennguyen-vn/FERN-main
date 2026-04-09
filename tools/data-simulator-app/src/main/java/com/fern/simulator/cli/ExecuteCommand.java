package com.fern.simulator.cli;

import com.fern.simulator.config.ConfigLoader;
import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationEngine;
import com.fern.simulator.persistence.DatabaseTarget;
import com.fern.simulator.persistence.SafetyChecker;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.nio.file.Path;

@Command(name = "execute", description = "Run simulation and write data to the database.")
public class ExecuteCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--config", "-c"}, description = "Path to YAML config file.")
    private Path configPath;

    @Option(names = {"--preset", "-p"}, description = "Named preset: small, medium, large.")
    private String preset;

    @Option(names = {"--dry-run"}, description = "Run engine without DB writes.", defaultValue = "false")
    private boolean dryRun;

    @Override
    public void run() {
        SimulationConfig config = ConfigLoader.load(configPath, preset);
        DatabaseTarget target = new DatabaseTarget(
                parent.getDbUrl(), parent.getDbUser(), parent.getDbPassword());

        if (!parent.isAllowNonLocal()) {
            SafetyChecker.requireLocalhost(target);
        }

        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║       FERN Data Simulator — Execute         ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();
        System.out.println("  DB URL        : " + target.url());
        System.out.println("  Namespace     : " + config.namespace());
        System.out.println("  Duration      : " + config.startDate() + " → " + config.endDate());
        System.out.println("  Seed          : " + config.seed());
        System.out.println("  Dry Run       : " + dryRun);
        System.out.println();

        SimulationEngine engine = new SimulationEngine();
        engine.run(config, target, dryRun);
    }
}
