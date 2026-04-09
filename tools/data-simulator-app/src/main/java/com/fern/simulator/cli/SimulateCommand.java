package com.fern.simulator.cli;

import picocli.CommandLine;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

/**
 * Root command for the FERN Data Simulator.
 */
@Command(
        name = "simulate",
        mixinStandardHelpOptions = true,
        version = "FERN Data Simulator 0.1.0",
        description = "Chronological business data simulation for FERN ERP.",
        subcommands = {
                PreviewCommand.class,
                ExecuteCommand.class,
                CleanupCommand.class,
                TreeCommand.class,
                RunsCommand.class,
                ExportUsersCommand.class,
                ExportSummaryCommand.class,
                ValidateCommand.class,
                ResumeCommand.class,
                GuiCommand.class,
                CommandLine.HelpCommand.class
        }
)
public class SimulateCommand implements Runnable {

    @Option(names = {"--db-url"}, description = "JDBC URL for PostgreSQL.", defaultValue = "${FERN_DB_URL:-jdbc:postgresql://localhost:5432/fern}")
    String dbUrl;

    @Option(names = {"--db-user"}, description = "Database username.", defaultValue = "${FERN_DB_USER:-fern}")
    String dbUser;

    @Option(names = {"--db-password"}, description = "Database password.", defaultValue = "${FERN_DB_PASSWORD:-fern}")
    String dbPassword;

    @Option(names = {"--allow-non-local"}, description = "Allow non-localhost database targets.", defaultValue = "false")
    boolean allowNonLocal;

    @Override
    public void run() {
        new CommandLine(this).usage(System.out);
    }

    public String getDbUrl() {
        return dbUrl;
    }

    public String getDbUser() {
        return dbUser;
    }

    public String getDbPassword() {
        return dbPassword;
    }

    public boolean isAllowNonLocal() {
        return allowNonLocal;
    }
}
