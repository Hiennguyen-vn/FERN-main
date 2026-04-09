package com.natsu.common.utils.usage;

import com.natsu.common.utils.config.ConfigSection;
import com.natsu.common.utils.config.ConfigurationManager;

import java.nio.file.Paths;

/**
 * Usage example for {@link ConfigurationManager}.
 * Demonstrates loading and accessing configurations.
 */
public final class ConfigurationUsage {

    public static void main(String[] args) {
        System.out.println("=== Configuration Usage Example ===");

        // 1. Initialize Configuration Manager
        // Note: In a real application, this is typically a singleton or injected
        // dependency.
        ConfigurationManager configManager = ConfigurationManager.create(Paths.get("."));
        configManager.start();

        System.out.println("Configuration Manager started.");

        try {
            // 2. Retrieve a configuration (tries to load from file, e.g.,
            // "application.yml")
            // Since we don't have the file here, it might return an empty section or throw
            // depending on impl.
            // But let's assume we have a config or use default fallback if supported.

            // Getting a config section. If file doesn't exist, it might throw or return
            // empty.
            // For usage demo, we can just show the API call.
            try {
                ConfigSection config = configManager.getConfig("application.yml");

                // 3. Retrieve values using ConfigSection API
                String appName = config.getString("app.name", "DefaultApp");
                int port = config.getInt("server.port", 8080);
                boolean debug = config.getBoolean("app.debug", false);

                System.out.println("App Name: " + appName);
                System.out.println("Port: " + port);
                System.out.println("Debug Mode: " + debug);
            } catch (Exception e) {
                System.out.println("Could not load 'application.yml' (expected in this demo): " + e.getMessage());
            }

        } catch (Exception e) {
            System.err.println("Configuration usage failed: " + e.getMessage());
        } finally {
            // 4. Clean up
            configManager.stop();
            System.out.println("Configuration Manager stopped.");
        }

        System.out.println("\n=== Done ===");
    }
}
