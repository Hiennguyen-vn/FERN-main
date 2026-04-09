package com.natsu.common.utils.log;

import com.natsu.common.utils.config.ConfigSection;
import com.natsu.common.utils.log.appender.ConsoleLogAppender;
import com.natsu.common.utils.log.appender.FileLogAppender;
import com.natsu.common.utils.log.appender.LogAppender;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Factory for creating and managing Logger instances.
 * Supports configuration from ConfigSection for appender setup.
 *
 * <p>Basic usage:
 * <pre>
 * Logger logger = LoggerFactory.getLogger(MyClass.class);
 * logger.info("Hello, world!");
 * </pre>
 *
 * <p>Configuration from YAML/JSON/TOML:
 * <pre>
 * ConfigSection config = Configuration.fromFile("logging.yml").load();
 * LoggerFactory.configure(config);
 * </pre>
 *
 * <p>Example configuration (YAML):
 * <pre>
 * logging:
 *   level: INFO
 *   appenders:
 *     console:
 *       enabled: true
 *       colorEnabled: true
 *       level: DEBUG
 *     file:
 *       enabled: true
 *       directory: logs
 *       pattern: app-{date}.log
 *       level: INFO
 *       maxFileSize: 10MB
 *       maxHistory: 7
 *       compress: true
 *   loggers:
 *     com.myapp.database: DEBUG
 *     com.myapp.security: TRACE
 * </pre>
 */
public final class LoggerFactory {

    private static final Map<String, Logger> loggers = new ConcurrentHashMap<>();
    private static final List<LogAppender> globalAppenders = new ArrayList<>();
    private static volatile LogLevel rootLevel = LogLevel.INFO;
    private static volatile Logger rootLogger;
    private static volatile boolean configured = false;

    static {
        // Initialize with default console appender
        initializeDefaults();
    }

    private LoggerFactory() {
        // Utility class
    }

    private static synchronized void initializeDefaults() {
        if (rootLogger == null) {
            rootLogger = new Logger("ROOT");
            rootLogger.setLevel(rootLevel);

            // Add default console appender
            ConsoleLogAppender consoleAppender = ConsoleLogAppender.builder()
                    .name("console")
                    .level(LogLevel.DEBUG)
                    .colorEnabled(true)
                    .build();
            rootLogger.addAppender(consoleAppender);
            globalAppenders.add(consoleAppender);
        }
    }

    /**
     * Gets a logger for the specified class.
     *
     * @param clazz the class
     * @return the logger
     */
    public static Logger getLogger(Class<?> clazz) {
        return getLogger(clazz.getName());
    }

    /**
     * Gets a logger for the specified name.
     *
     * @param name the logger name
     * @return the logger
     */
    public static Logger getLogger(String name) {
        return loggers.computeIfAbsent(name, n -> {
            Logger logger = new Logger(n, null, rootLogger);
            return logger;
        });
    }

    /**
     * Gets the root logger.
     *
     * @return the root logger
     */
    public static Logger getRootLogger() {
        return rootLogger;
    }

    /**
     * Sets the global root log level.
     *
     * @param level the log level
     */
    public static void setRootLevel(LogLevel level) {
        rootLevel = level;
        if (rootLogger != null) {
            rootLogger.setLevel(level);
        }
    }

    /**
     * Configures the logging system from a ConfigSection.
     *
     * @param config the configuration section (should contain 'logging' key or be the logging section)
     */
    public static synchronized void configure(ConfigSection config) {
        if (config == null) {
            return;
        }

        // Check if config contains 'logging' section
        ConfigSection loggingConfig = config.getSection("logging");
        if (loggingConfig == null) {
            loggingConfig = config;
        }

        // Clear existing appenders
        for (LogAppender appender : globalAppenders) {
            try {
                appender.close();
            } catch (Exception e) {
                // Ignore
            }
        }
        globalAppenders.clear();
        
        if (rootLogger != null) {
            for (LogAppender appender : rootLogger.getAppenders()) {
                rootLogger.removeAppender(appender);
            }
        }

        // Configure root level
        String rootLevelStr = loggingConfig.getString("level", "INFO");
        rootLevel = LogLevel.fromString(rootLevelStr);
        
        if (rootLogger == null) {
            rootLogger = new Logger("ROOT");
        }
        rootLogger.setLevel(rootLevel);

        // Configure appenders
        ConfigSection appendersConfig = loggingConfig.getSection("appenders");
        if (appendersConfig != null) {
            configureAppenders(appendersConfig);
        } else {
            // Add default console appender if no appenders configured
            addDefaultConsoleAppender();
        }

        // Configure individual loggers
        ConfigSection loggersConfig = loggingConfig.getSection("loggers");
        if (loggersConfig != null) {
            configureLoggers(loggersConfig);
        }

        configured = true;
    }

    private static void configureAppenders(ConfigSection appendersConfig) {
        // Console appender
        ConfigSection consoleConfig = appendersConfig.getSection("console");
        if (consoleConfig != null && consoleConfig.getBoolean("enabled", true)) {
            ConsoleLogAppender consoleAppender = ConsoleLogAppender.builder()
                    .name("console")
                    .level(LogLevel.fromString(consoleConfig.getString("level", "DEBUG")))
                    .colorEnabled(consoleConfig.getBoolean("colorEnabled", true))
                    .build();
            rootLogger.addAppender(consoleAppender);
            globalAppenders.add(consoleAppender);
        }

        // File appender
        ConfigSection fileConfig = appendersConfig.getSection("file");
        if (fileConfig != null && fileConfig.getBoolean("enabled", false)) {
            String directory = fileConfig.getString("directory", "logs");
            String pattern = fileConfig.getString("pattern", "app-{date}.log");
            String levelStr = fileConfig.getString("level", "INFO");
            long maxFileSize = parseSize(fileConfig.getString("maxFileSize", "10MB"));
            int maxHistory = fileConfig.getInt("maxHistory", 7);
            boolean compress = fileConfig.getBoolean("compress", true);

            FileLogAppender fileAppender = FileLogAppender.builder()
                    .name("file")
                    .directory(directory)
                    .fileNamePattern(pattern)
                    .level(LogLevel.fromString(levelStr))
                    .maxFileSize(maxFileSize)
                    .maxHistory(maxHistory)
                    .compressRotated(compress)
                    .build();
            rootLogger.addAppender(fileAppender);
            globalAppenders.add(fileAppender);
        }

        // If no appenders were configured, add default console
        if (globalAppenders.isEmpty()) {
            addDefaultConsoleAppender();
        }
    }

    private static void configureLoggers(ConfigSection loggersConfig) {
        for (String loggerName : loggersConfig.getKeys(false)) {
            // Use getDirect to avoid dot-splitting the logger name (e.g., "com.myapp.debug")
            Object value = loggersConfig.getDirect(loggerName);
            if (value instanceof String) {
                Logger logger = getLogger(loggerName);
                logger.setLevel(LogLevel.fromString((String) value));
            }
        }
    }

    private static void addDefaultConsoleAppender() {
        ConsoleLogAppender consoleAppender = ConsoleLogAppender.builder()
                .name("console")
                .level(LogLevel.DEBUG)
                .colorEnabled(true)
                .build();
        rootLogger.addAppender(consoleAppender);
        globalAppenders.add(consoleAppender);
    }

    private static long parseSize(String size) {
        if (size == null || size.isEmpty()) {
            return 10 * 1024 * 1024; // Default 10MB
        }

        size = size.trim().toUpperCase();
        long multiplier = 1;

        if (size.endsWith("KB")) {
            multiplier = 1024;
            size = size.substring(0, size.length() - 2);
        } else if (size.endsWith("MB")) {
            multiplier = 1024 * 1024;
            size = size.substring(0, size.length() - 2);
        } else if (size.endsWith("GB")) {
            multiplier = 1024L * 1024 * 1024;
            size = size.substring(0, size.length() - 2);
        } else if (size.endsWith("B")) {
            size = size.substring(0, size.length() - 1);
        }

        try {
            return Long.parseLong(size.trim()) * multiplier;
        } catch (NumberFormatException e) {
            return 10 * 1024 * 1024; // Default 10MB
        }
    }

    /**
     * Adds a global appender that receives all log events.
     *
     * @param appender the appender to add
     */
    public static synchronized void addAppender(LogAppender appender) {
        if (appender != null) {
            rootLogger.addAppender(appender);
            globalAppenders.add(appender);
        }
    }

    /**
     * Removes a global appender.
     *
     * @param appender the appender to remove
     */
    public static synchronized void removeAppender(LogAppender appender) {
        if (appender != null) {
            rootLogger.removeAppender(appender);
            globalAppenders.remove(appender);
        }
    }

    /**
     * Checks if the factory has been configured.
     *
     * @return true if configure() has been called
     */
    public static boolean isConfigured() {
        return configured;
    }

    /**
     * Shuts down the logging system, closing all appenders.
     */
    public static synchronized void shutdown() {
        for (LogAppender appender : globalAppenders) {
            try {
                appender.flush();
                appender.close();
            } catch (Exception e) {
                System.err.println("Error closing appender: " + e.getMessage());
            }
        }
        globalAppenders.clear();
        loggers.clear();
        configured = false;
    }

    /**
     * Resets the factory to its default state.
     */
    public static synchronized void reset() {
        shutdown();
        rootLogger = null;
        rootLevel = LogLevel.INFO;
        initializeDefaults();
    }
}
