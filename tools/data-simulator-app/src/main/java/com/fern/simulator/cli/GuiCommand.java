package com.fern.simulator.cli;

import com.fern.simulator.gui.SimulatorWebServer;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;

import java.awt.Desktop;
import java.net.URI;

@Command(name = "gui", description = "Launch the web-based GUI dashboard.")
public class GuiCommand implements Runnable {

    @ParentCommand
    private SimulateCommand parent;

    @Option(names = {"--port", "-P"}, description = "HTTP port (default: 4567).", defaultValue = "4567")
    private int port;

    @Option(names = {"--no-browser"}, description = "Don't auto-open browser.", defaultValue = "false")
    private boolean noBrowser;

    @Override
    public void run() {
        System.out.println("╔══════════════════════════════════════════════╗");
        System.out.println("║       FERN Data Simulator — GUI Mode        ║");
        System.out.println("╚══════════════════════════════════════════════╝");
        System.out.println();

        SimulatorWebServer server = new SimulatorWebServer(
                parent.getDbUrl(), parent.getDbUser(), parent.getDbPassword(),
                parent.isAllowNonLocal(), port);

        try {
            server.start();
        } catch (java.io.IOException e) {
            System.err.println("Failed to start GUI server: " + e.getMessage());
            return;
        }

        String url = "http://localhost:" + port;
        System.out.println("  Dashboard: " + url);
        System.out.println("  Press Ctrl+C to stop.");
        System.out.println();

        // Auto-open browser
        if (!noBrowser) {
            try {
                if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                    Desktop.getDesktop().browse(new URI(url));
                } else {
                    // macOS fallback
                    Runtime.getRuntime().exec(new String[]{"open", url});
                }
            } catch (Exception e) {
                System.out.println("  Could not open browser automatically. Open " + url + " manually.");
            }
        }

        // Keep alive until Ctrl+C
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("\nShutting down...");
            server.stop();
        }));

        // Block main thread
        try {
            Thread.currentThread().join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
