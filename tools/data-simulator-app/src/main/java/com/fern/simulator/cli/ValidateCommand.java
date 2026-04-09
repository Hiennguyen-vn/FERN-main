package com.fern.simulator.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

@Command(name = "validate", description = "Post-run integrity validation against DB.")
public class ValidateCommand implements Runnable {

    @ParentCommand private SimulateCommand parent;

    @Option(names = {"--run-id"}, required = true, description = "Simulation run ID.")
    private String runId;

    @Override
    public void run() {
        System.out.println("Validating run: " + runId);
        // TODO: implement post-run validation
    }
}
