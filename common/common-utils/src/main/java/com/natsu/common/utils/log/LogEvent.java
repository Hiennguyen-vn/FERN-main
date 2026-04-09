package com.natsu.common.utils.log;

import java.time.Instant;

/**
 * Represents a single log event with all associated metadata.
 */
public record LogEvent(
        Instant timestamp,
        LogLevel level,
        String loggerName,
        String message,
        Object[] args,
        Throwable throwable,
        String threadName,
        long threadId
) {
    /**
     * Creates a new LogEvent with current timestamp and thread info.
     *
     * @param level the log level
     * @param loggerName the logger name
     * @param message the message (may contain {} placeholders)
     * @param args the message arguments
     * @param throwable optional throwable
     * @return a new LogEvent
     */
    public static LogEvent create(LogLevel level, String loggerName, String message, Object[] args, Throwable throwable) {
        Thread currentThread = Thread.currentThread();
        return new LogEvent(
                Instant.now(),
                level,
                loggerName,
                message,
                args,
                throwable,
                currentThread.getName(),
                currentThread.threadId()
        );
    }

    /**
     * Creates a new LogEvent without a throwable.
     */
    public static LogEvent create(LogLevel level, String loggerName, String message, Object[] args) {
        return create(level, loggerName, message, args, null);
    }

    /**
     * Gets the formatted message with arguments substituted.
     *
     * @return the formatted message
     */
    public String getFormattedMessage() {
        return LogFormatter.formatMessage(message, args);
    }
}
