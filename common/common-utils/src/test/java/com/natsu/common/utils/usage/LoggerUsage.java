package com.natsu.common.utils.usage;

import com.natsu.common.utils.log.LogLevel;
import com.natsu.common.utils.log.Logger;
import com.natsu.common.utils.log.LoggerFactory;

/**
 * Usage example for {@link Logger}.
 * Demonstrates logging capabilities.
 */
public final class LoggerUsage {

    // 1. Create a logger for the class
    private static final Logger logger = LoggerFactory.getLogger(LoggerUsage.class);

    public static void main(String[] args) {
        System.out.println("=== Logger Usage Example ===");

        // 2. Log at different levels
        logger.info("This is an info message");
        logger.debug("This is a debug message (might not show if level is INFO)");
        logger.warn("This is a warning!");
        logger.error("This is an error!");

        // 3. Parameterized logging (avoids string concatenation overhead)
        String user = "Natsu";
        int id = 42;
        logger.info("User {} logged in with ID {}", user, id);

        // 4. Logging exceptions
        try {
            throwException();
        } catch (Exception e) {
            logger.error("An exception occurred", e);
        }

        // 5. Build-your-own logger config (Runtime)
        Logger customLogger = LoggerFactory.getLogger("CustomLogger");
        customLogger.setLevel(LogLevel.DEBUG);
        customLogger.debug("This custom logger shows debug messages");

        System.out.println("\n=== Done ===");
    }

    private static void throwException() {
        throw new RuntimeException("Simulated failure");
    }
}
