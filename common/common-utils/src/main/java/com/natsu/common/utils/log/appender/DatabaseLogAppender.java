package com.natsu.common.utils.log.appender;

import com.natsu.common.utils.log.LogEvent;
import com.natsu.common.utils.log.LogFormatter;
import com.natsu.common.utils.log.LogLevel;

import java.time.Instant;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Abstract base class for database log appenders.
 * Provides async buffering to avoid blocking application threads on database writes.
 *
 * <p>Implementations should override:
 * <ul>
 *   <li>{@link #doInsert(LogRecord)} - Insert a single log record</li>
 *   <li>{@link #doConnect()} - Establish database connection</li>
 *   <li>{@link #doDisconnect()} - Close database connection</li>
 * </ul>
 *
 * <p>Example implementation for JDBC:
 * <pre>
 * public class JdbcLogAppender extends DatabaseLogAppender {
 *     private final DataSource dataSource;
 *     private Connection connection;
 *
 *     protected void doConnect() throws Exception {
 *         connection = dataSource.getConnection();
 *     }
 *
 *     protected void doInsert(LogRecord record) throws Exception {
 *         try (PreparedStatement stmt = connection.prepareStatement(
 *                 "INSERT INTO logs (timestamp, level, logger, message, thread, exception) VALUES (?, ?, ?, ?, ?, ?)")) {
 *             stmt.setTimestamp(1, Timestamp.from(record.timestamp()));
 *             stmt.setString(2, record.level());
 *             stmt.setString(3, record.loggerName());
 *             stmt.setString(4, record.message());
 *             stmt.setString(5, record.threadName());
 *             stmt.setString(6, record.exception());
 *             stmt.executeUpdate();
 *         }
 *     }
 *
 *     protected void doDisconnect() throws Exception {
 *         if (connection != null) connection.close();
 *     }
 * }
 * </pre>
 */
public abstract class DatabaseLogAppender extends AbstractLogAppender {

    /**
     * Record structure for database insertion.
     */
    public record LogRecord(
            Instant timestamp,
            String level,
            String loggerName,
            String message,
            String threadName,
            long threadId,
            String exception
    ) {
        /**
         * Creates a LogRecord from a LogEvent.
         */
        public static LogRecord from(LogEvent event) {
            String exceptionStr = event.throwable() != null
                    ? LogFormatter.formatThrowable(event.throwable())
                    : null;
            return new LogRecord(
                    event.timestamp(),
                    event.level().getLabel(),
                    event.loggerName(),
                    event.getFormattedMessage(),
                    event.threadName(),
                    event.threadId(),
                    exceptionStr
            );
        }
    }

    private final BlockingQueue<LogRecord> queue;
    private final int batchSize;
    private final long flushIntervalMs;
    private volatile Thread writerThread;
    private volatile boolean running;

    /**
     * Creates a database appender with default settings.
     *
     * @param name the appender name
     */
    protected DatabaseLogAppender(String name) {
        this(name, LogLevel.DEBUG, 1000, 100, 5000);
    }

    /**
     * Creates a database appender with custom settings.
     *
     * @param name the appender name
     * @param level the minimum log level
     * @param queueCapacity the buffer queue capacity
     * @param batchSize the number of records to batch before writing
     * @param flushIntervalMs the maximum time between flushes in milliseconds
     */
    protected DatabaseLogAppender(String name, LogLevel level, int queueCapacity, int batchSize, long flushIntervalMs) {
        super(name, level);
        this.queue = new LinkedBlockingQueue<>(queueCapacity);
        this.batchSize = batchSize;
        this.flushIntervalMs = flushIntervalMs;
    }

    @Override
    public void start() {
        if (started.compareAndSet(false, true)) {
            try {
                doConnect();
            } catch (Exception e) {
                started.set(false);
                throw new RuntimeException("Failed to connect database for logging", e);
            }

            running = true;
            writerThread = new Thread(this::writeLoop, "log-db-writer-" + name);
            writerThread.setDaemon(true);
            writerThread.start();
        }
    }

    @Override
    protected void doAppend(LogEvent event) {
        if (!isStarted()) {
            return;
        }

        LogRecord record = LogRecord.from(event);
        if (!queue.offer(record)) {
            // Queue is full, drop the log or handle overflow
            System.err.println("Database log queue full, dropping log entry");
        }
    }

    @Override
    public void flush() {
        // Force process remaining items
        processQueue(true);
    }

    @Override
    public void close() {
        if (started.compareAndSet(true, false)) {
            running = false;

            // Interrupt and wait for writer thread
            if (writerThread != null) {
                writerThread.interrupt();
                try {
                    writerThread.join(5000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }

            // Flush remaining items
            processQueue(true);

            // Disconnect
            try {
                doDisconnect();
            } catch (Exception e) {
                System.err.println("Failed to disconnect database logger: " + e.getMessage());
            }
        }
    }

    private void writeLoop() {
        java.util.List<LogRecord> batch = new java.util.ArrayList<>(batchSize);
        long lastFlush = System.currentTimeMillis();

        while (running || !queue.isEmpty()) {
            try {
                LogRecord record = queue.poll(100, TimeUnit.MILLISECONDS);
                if (record != null) {
                    batch.add(record);
                }

                long now = System.currentTimeMillis();
                boolean shouldFlush = batch.size() >= batchSize ||
                        (now - lastFlush >= flushIntervalMs && !batch.isEmpty());

                if (shouldFlush) {
                    writeBatch(batch);
                    batch.clear();
                    lastFlush = now;
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }

        // Final flush
        if (!batch.isEmpty()) {
            writeBatch(batch);
        }
    }

    private void processQueue(boolean all) {
        java.util.List<LogRecord> batch = new java.util.ArrayList<>();
        LogRecord record;
        while ((record = queue.poll()) != null) {
            batch.add(record);
            if (!all && batch.size() >= batchSize) {
                break;
            }
        }
        if (!batch.isEmpty()) {
            writeBatch(batch);
        }
    }

    private void writeBatch(java.util.List<LogRecord> batch) {
        for (LogRecord record : batch) {
            try {
                doInsert(record);
            } catch (Exception e) {
                System.err.println("Failed to insert log record to database: " + e.getMessage());
            }
        }
    }

    /**
     * Establishes the database connection.
     * Called when the appender starts.
     *
     * @throws Exception if connection fails
     */
    protected abstract void doConnect() throws Exception;

    /**
     * Inserts a log record into the database.
     *
     * @param record the log record to insert
     * @throws Exception if insertion fails
     */
    protected abstract void doInsert(LogRecord record) throws Exception;

    /**
     * Closes the database connection.
     * Called when the appender stops.
     *
     * @throws Exception if disconnection fails
     */
    protected abstract void doDisconnect() throws Exception;

    /**
     * Gets the current queue size.
     *
     * @return the number of pending log records
     */
    public int getQueueSize() {
        return queue.size();
    }
}
