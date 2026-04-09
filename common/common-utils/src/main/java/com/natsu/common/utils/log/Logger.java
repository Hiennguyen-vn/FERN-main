package com.natsu.common.utils.log;

import com.natsu.common.utils.log.appender.LogAppender;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * A logger instance that formats and dispatches log messages to appenders.
 * Supports {} placeholder syntax for message formatting.
 *
 * <p>Usage:
 * <pre>
 * Logger logger = LoggerFactory.getLogger(MyClass.class);
 *
 * logger.info("Hello, world!");
 * logger.debug("Processing {} items", count);
 * logger.error("Failed to process", exception);
 * </pre>
 */
public class Logger {

    private final String name;
    private volatile LogLevel level;
    private final List<LogAppender> appenders;
    private final Logger parent;

    /**
     * Creates a new logger.
     *
     * @param name the logger name
     */
    Logger(String name) {
        this(name, null, null);
    }

    /**
     * Creates a new logger with a parent.
     *
     * @param name the logger name
     * @param level the log level (null to inherit from parent)
     * @param parent the parent logger
     */
    Logger(String name, LogLevel level, Logger parent) {
        this.name = name;
        this.level = level;
        this.parent = parent;
        this.appenders = new CopyOnWriteArrayList<>();
    }

    /**
     * Gets the logger name.
     *
     * @return the name
     */
    public String getName() {
        return name;
    }

    /**
     * Gets the effective log level (inheriting from parent if not set).
     *
     * @return the effective log level
     */
    public LogLevel getLevel() {
        if (level != null) {
            return level;
        }
        if (parent != null) {
            return parent.getLevel();
        }
        return LogLevel.DEBUG;
    }

    /**
     * Sets the log level for this logger.
     *
     * @param level the log level (null to inherit from parent)
     */
    public void setLevel(LogLevel level) {
        this.level = level;
    }

    /**
     * Adds an appender to this logger.
     *
     * @param appender the appender to add
     */
    public void addAppender(LogAppender appender) {
        if (appender != null && !appenders.contains(appender)) {
            appenders.add(appender);
        }
    }

    /**
     * Removes an appender from this logger.
     *
     * @param appender the appender to remove
     */
    public void removeAppender(LogAppender appender) {
        appenders.remove(appender);
    }

    /**
     * Gets all appenders attached to this logger.
     *
     * @return list of appenders
     */
    public List<LogAppender> getAppenders() {
        return List.copyOf(appenders);
    }

    /**
     * Checks if a log level is enabled.
     *
     * @param level the level to check
     * @return true if the level is enabled
     */
    public boolean isEnabled(LogLevel level) {
        return level.isEnabledFor(getLevel());
    }

    public boolean isTraceEnabled() {
        return isEnabled(LogLevel.TRACE);
    }

    public boolean isDebugEnabled() {
        return isEnabled(LogLevel.DEBUG);
    }

    public boolean isInfoEnabled() {
        return isEnabled(LogLevel.INFO);
    }

    public boolean isWarnEnabled() {
        return isEnabled(LogLevel.WARN);
    }

    public boolean isErrorEnabled() {
        return isEnabled(LogLevel.ERROR);
    }

    // ---- TRACE ----

    public void trace(String message) {
        log(LogLevel.TRACE, message, (Object[]) null, null);
    }

    public void trace(String message, Object... args) {
        log(LogLevel.TRACE, message, args, null);
    }

    public void trace(String message, Throwable throwable) {
        log(LogLevel.TRACE, message, null, throwable);
    }

    // ---- DEBUG ----

    public void debug(String message) {
        log(LogLevel.DEBUG, message, (Object[]) null, null);
    }

    public void debug(String message, Object... args) {
        log(LogLevel.DEBUG, message, args, null);
    }

    public void debug(String message, Throwable throwable) {
        log(LogLevel.DEBUG, message, null, throwable);
    }

    // ---- INFO ----

    public void info(String message) {
        log(LogLevel.INFO, message, (Object[]) null, null);
    }

    public void info(String message, Object... args) {
        log(LogLevel.INFO, message, args, null);
    }

    public void info(String message, Throwable throwable) {
        log(LogLevel.INFO, message, null, throwable);
    }

    // ---- WARN ----

    public void warn(String message) {
        log(LogLevel.WARN, message, (Object[]) null, null);
    }

    public void warn(String message, Object... args) {
        log(LogLevel.WARN, message, args, null);
    }

    public void warn(String message, Throwable throwable) {
        log(LogLevel.WARN, message, null, throwable);
    }

    // ---- ERROR ----

    public void error(String message) {
        log(LogLevel.ERROR, message, (Object[]) null, null);
    }

    public void error(String message, Object... args) {
        log(LogLevel.ERROR, message, args, null);
    }

    public void error(String message, Throwable throwable) {
        log(LogLevel.ERROR, message, null, throwable);
    }

    public void error(String message, Object arg1, Throwable throwable) {
        log(LogLevel.ERROR, message, new Object[]{arg1}, throwable);
    }

    // ---- Core logging ----

    /**
     * Logs a message at the specified level.
     *
     * @param level the log level
     * @param message the message (may contain {} placeholders)
     * @param args the message arguments
     * @param throwable optional throwable
     */
    public void log(LogLevel level, String message, Object[] args, Throwable throwable) {
        if (!isEnabled(level)) {
            return;
        }

        // Extract throwable from args if last arg is Throwable
        if (throwable == null && args != null && args.length > 0) {
            Object lastArg = args[args.length - 1];
            if (lastArg instanceof Throwable) {
                throwable = (Throwable) lastArg;
                // Create new args array without the throwable
                Object[] newArgs = new Object[args.length - 1];
                System.arraycopy(args, 0, newArgs, 0, newArgs.length);
                args = newArgs;
            }
        }

        LogEvent event = LogEvent.create(level, name, message, args, throwable);
        dispatchEvent(event);
    }

    private void dispatchEvent(LogEvent event) {
        // Dispatch to this logger's appenders
        for (LogAppender appender : appenders) {
            try {
                appender.append(event);
            } catch (Exception e) {
                System.err.println("Error in log appender " + appender.getName() + ": " + e.getMessage());
            }
        }

        // Dispatch to parent's appenders (additive logging)
        if (parent != null) {
            parent.dispatchEvent(event);
        }
    }

    @Override
    public String toString() {
        return "Logger{name='" + name + "', level=" + level + ", appenders=" + appenders.size() + "}";
    }
}
