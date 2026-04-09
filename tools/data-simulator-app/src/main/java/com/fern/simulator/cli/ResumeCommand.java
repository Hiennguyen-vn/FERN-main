package com.fern.simulator.cli;

import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

@Command(name = "resume", description = "Resume an interrupted simulation run using deterministic replay.")
public class ResumeCommand implements Runnable {

    @ParentCommand private SimulateCommand parent;

    @Option(names = {"--run-id"}, required = true, description = "Run ID to resume.")
    private String runId;

    @Override
    public void run() {
        System.out.println("Resuming run: " + runId);
        // TODO: implement deterministic replay resume
    }
}
