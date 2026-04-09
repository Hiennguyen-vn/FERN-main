package com.fern.simulator;

import com.fern.simulator.cli.SimulateCommand;
import picocli.CommandLine;

/**
 * Entry point for the FERN Data Simulator CLI.
 * <p>
 * This is a local-only JVM tool — no HTTP server, no Spring Boot.
 * Run with: {@code java -jar data-simulator-app.jar <subcommand> [options]}
 */
public final class SimulatorApp {

    private SimulatorApp() {
    }

    public static void main(String[] args) {
        int exitCode = new CommandLine(new SimulateCommand())
                .setCaseInsensitiveEnumValuesAllowed(true)
                .setUsageHelpAutoWidth(true)
                .execute(args);
        System.exit(exitCode);
    }
}
