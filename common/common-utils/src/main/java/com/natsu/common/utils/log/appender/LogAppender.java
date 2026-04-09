package com.natsu.common.utils.log.appender;

import com.natsu.common.utils.log.LogEvent;
import com.natsu.common.utils.log.LogLevel;

/**
 * Interface for log output destinations.
 * Appenders receive log events and write them to various targets
 * such as console, files, databases, or remote services.
 */
public interface LogAppender extends AutoCloseable {

    /**
     * Gets the name of this appender.
     *
     * @return the appender name
     */
    String getName();

    /**
     * Appends a log event to this appender's destination.
     *
     * @param event the log event to append
     */
    void append(LogEvent event);

    /**
     * Gets the minimum log level for this appender.
     * Events below this level will not be appended.
     *
     * @return the minimum log level
     */
    LogLevel getLevel();

    /**
     * Sets the minimum log level for this appender.
     *
     * @param level the minimum log level
     */
    void setLevel(LogLevel level);

    /**
     * Checks if this appender will log events at the given level.
     *
     * @param level the level to check
     * @return true if the level is enabled
     */
    default boolean isEnabled(LogLevel level) {
        return level.isEnabledFor(getLevel());
    }

    /**
     * Flushes any buffered output.
     */
    default void flush() {
        // Default implementation does nothing
    }

    /**
     * Starts this appender.
     */
    default void start() {
        // Default implementation does nothing
    }

    /**
     * Checks if this appender is started.
     *
     * @return true if started
     */
    default boolean isStarted() {
        return true;
    }

    /**
     * Closes this appender and releases resources.
     */
    @Override
    default void close() {
        // Default implementation does nothing
    }
}
