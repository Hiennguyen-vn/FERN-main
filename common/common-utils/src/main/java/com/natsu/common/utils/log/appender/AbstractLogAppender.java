package com.natsu.common.utils.log.appender;

import com.natsu.common.utils.log.LogEvent;
import com.natsu.common.utils.log.LogLevel;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Base implementation for log appenders with common functionality.
 * Uses template method pattern - subclasses implement doAppend().
 */
public abstract class AbstractLogAppender implements LogAppender {

    protected final String name;
    protected volatile LogLevel level;
    protected final AtomicBoolean started = new AtomicBoolean(false);

    protected AbstractLogAppender(String name, LogLevel level) {
        this.name = name;
        this.level = level != null ? level : LogLevel.DEBUG;
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public LogLevel getLevel() {
        return level;
    }

    @Override
    public void setLevel(LogLevel level) {
        this.level = level != null ? level : LogLevel.DEBUG;
    }

    @Override
    public void start() {
        started.set(true);
    }

    @Override
    public boolean isStarted() {
        return started.get();
    }

    @Override
    public void close() {
        started.set(false);
    }

    @Override
    public void append(LogEvent event) {
        if (event == null || !event.level().isEnabledFor(level)) {
            return;
        }
        doAppend(event);
    }

    /**
     * Subclasses implement this to handle the actual appending.
     *
     * @param event the log event (never null, already level-checked)
     */
    protected abstract void doAppend(LogEvent event);
}
