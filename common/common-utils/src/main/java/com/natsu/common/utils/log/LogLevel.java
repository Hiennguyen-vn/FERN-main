package com.natsu.common.utils.log;

/**
 * Log levels in order of severity.
 * Lower ordinal values are more verbose.
 */
public enum LogLevel {
    /**
     * Finest level of detail, typically used for tracing execution flow.
     */
    TRACE(0, "TRACE"),

    /**
     * Debug information useful during development.
     */
    DEBUG(1, "DEBUG"),

    /**
     * General informational messages.
     */
    INFO(2, "INFO"),

    /**
     * Warning messages for potentially harmful situations.
     */
    WARN(3, "WARN"),

    /**
     * Error messages for serious problems.
     */
    ERROR(4, "ERROR"),

    /**
     * Turn off logging.
     */
    OFF(5, "OFF");

    private final int severity;
    private final String label;

    LogLevel(int severity, String label) {
        this.severity = severity;
        this.label = label;
    }

    /**
     * Gets the severity level (higher = more severe).
     *
     * @return the severity level
     */
    public int getSeverity() {
        return severity;
    }

    /**
     * Gets the display label for this level.
     *
     * @return the label
     */
    public String getLabel() {
        return label;
    }

    /**
     * Checks if this level is enabled for the given threshold.
     *
     * @param threshold the minimum level to log
     * @return true if this level should be logged
     */
    public boolean isEnabledFor(LogLevel threshold) {
        return this.severity >= threshold.severity;
    }

    /**
     * Parses a log level from a string (case-insensitive).
     *
     * @param level the level string
     * @return the LogLevel, or INFO if not recognized
     */
    public static LogLevel fromString(String level) {
        if (level == null || level.isEmpty()) {
            return INFO;
        }
        try {
            return valueOf(level.toUpperCase());
        } catch (IllegalArgumentException e) {
            return INFO;
        }
    }
}
