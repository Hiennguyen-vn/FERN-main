package com.natsu.common.utils.log.appender;

import com.natsu.common.utils.log.LogEvent;
import com.natsu.common.utils.log.LogFormatter;
import com.natsu.common.utils.log.LogLevel;

import java.io.PrintStream;

/**
 * Appender that writes log events to the console with optional ANSI color support.
 */
public class ConsoleLogAppender extends AbstractLogAppender {

    private final PrintStream outputStream;
    private final PrintStream errorStream;
    private volatile boolean colorEnabled;
    private volatile LogLevel errorThreshold;

    /**
     * Creates a new console appender with default settings.
     */
    public ConsoleLogAppender() {
        this("console");
    }

    /**
     * Creates a new console appender with the specified name.
     *
     * @param name the appender name
     */
    public ConsoleLogAppender(String name) {
        this(name, LogLevel.DEBUG, true);
    }

    /**
     * Creates a new console appender with full configuration.
     *
     * @param name the appender name
     * @param level the minimum log level
     * @param colorEnabled whether to use ANSI colors
     */
    public ConsoleLogAppender(String name, LogLevel level, boolean colorEnabled) {
        super(name, level);
        this.outputStream = System.out;
        this.errorStream = System.err;
        this.colorEnabled = colorEnabled;
        this.errorThreshold = LogLevel.ERROR;
    }

    /**
     * Creates a new console appender with custom streams.
     *
     * @param name the appender name
     * @param level the minimum log level
     * @param colorEnabled whether to use ANSI colors
     * @param outputStream the output stream for normal logs
     * @param errorStream the error stream for error logs
     */
    public ConsoleLogAppender(String name, LogLevel level, boolean colorEnabled,
                               PrintStream outputStream, PrintStream errorStream) {
        super(name, level);
        this.outputStream = outputStream;
        this.errorStream = errorStream;
        this.colorEnabled = colorEnabled;
        this.errorThreshold = LogLevel.ERROR;
    }

    @Override
    protected void doAppend(LogEvent event) {
        String formatted = LogFormatter.formatForConsole(event, colorEnabled);
        PrintStream stream = event.level().getSeverity() >= errorThreshold.getSeverity()
                ? errorStream
                : outputStream;

        stream.println(formatted);
    }

    @Override
    public void flush() {
        outputStream.flush();
        errorStream.flush();
    }

    /**
     * Checks if ANSI colors are enabled.
     *
     * @return true if colors are enabled
     */
    public boolean isColorEnabled() {
        return colorEnabled;
    }

    /**
     * Enables or disables ANSI colors.
     *
     * @param colorEnabled true to enable colors
     */
    public void setColorEnabled(boolean colorEnabled) {
        this.colorEnabled = colorEnabled;
    }

    /**
     * Gets the threshold level for using stderr vs stdout.
     *
     * @return the error threshold
     */
    public LogLevel getErrorThreshold() {
        return errorThreshold;
    }

    /**
     * Sets the threshold level for using stderr.
     * Logs at or above this level will go to stderr.
     *
     * @param errorThreshold the error threshold
     */
    public void setErrorThreshold(LogLevel errorThreshold) {
        this.errorThreshold = errorThreshold;
    }

    /**
     * Builder for ConsoleLogAppender.
     */
    public static class Builder {
        private String name = "console";
        private LogLevel level = LogLevel.DEBUG;
        private boolean colorEnabled = true;
        private PrintStream outputStream = System.out;
        private PrintStream errorStream = System.err;
        private LogLevel errorThreshold = LogLevel.ERROR;

        public Builder name(String name) {
            this.name = name;
            return this;
        }

        public Builder level(LogLevel level) {
            this.level = level;
            return this;
        }

        public Builder colorEnabled(boolean colorEnabled) {
            this.colorEnabled = colorEnabled;
            return this;
        }

        public Builder outputStream(PrintStream outputStream) {
            this.outputStream = outputStream;
            return this;
        }

        public Builder errorStream(PrintStream errorStream) {
            this.errorStream = errorStream;
            return this;
        }

        public Builder errorThreshold(LogLevel errorThreshold) {
            this.errorThreshold = errorThreshold;
            return this;
        }

        public ConsoleLogAppender build() {
            ConsoleLogAppender appender = new ConsoleLogAppender(name, level, colorEnabled, outputStream, errorStream);
            appender.setErrorThreshold(errorThreshold);
            appender.start();
            return appender;
        }
    }

    public static Builder builder() {
        return new Builder();
    }
}
