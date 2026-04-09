package com.natsu.common.model.database;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Statistics for database operations.
 */
public class DatabaseStats {

    private final String databaseName;
    private final AtomicLong totalQueries = new AtomicLong();
    private final AtomicLong successfulQueries = new AtomicLong();
    private final AtomicLong failedQueries = new AtomicLong();
    private final AtomicLong totalLatencyNanos = new AtomicLong();
    private final AtomicLong activeConnections = new AtomicLong();
    private final AtomicLong totalConnections = new AtomicLong();

    public DatabaseStats(String databaseName) {
        this.databaseName = databaseName;
    }

    public void recordQuery(long latencyNanos, boolean success) {
        totalQueries.incrementAndGet();
        totalLatencyNanos.addAndGet(latencyNanos);
        if (success) {
            successfulQueries.incrementAndGet();
        } else {
            failedQueries.incrementAndGet();
        }
    }

    public void recordConnectionOpened() {
        activeConnections.incrementAndGet();
        totalConnections.incrementAndGet();
    }

    public void recordConnectionClosed() {
        activeConnections.decrementAndGet();
    }

    // Getters

    public String getDatabaseName() {
        return databaseName;
    }

    public long getTotalQueries() {
        return totalQueries.get();
    }

    public long getSuccessfulQueries() {
        return successfulQueries.get();
    }

    public long getFailedQueries() {
        return failedQueries.get();
    }

    public long getActiveConnections() {
        return activeConnections.get();
    }

    public long getTotalConnections() {
        return totalConnections.get();
    }

    public double getAverageLatencyMillis() {
        long total = totalQueries.get();
        if (total == 0) return 0;
        return (totalLatencyNanos.get() / total) / 1_000_000.0;
    }

    public double getSuccessRate() {
        long total = totalQueries.get();
        if (total == 0) return 1.0;
        return (double) successfulQueries.get() / total;
    }

    public void reset() {
        totalQueries.set(0);
        successfulQueries.set(0);
        failedQueries.set(0);
        totalLatencyNanos.set(0);
    }

    @Override
    public String toString() {
        return String.format("DatabaseStats{db=%s, queries=%d, success=%.2f%%, avgLatency=%.2fms, connections=%d}",
                databaseName, totalQueries.get(), getSuccessRate() * 100, 
                getAverageLatencyMillis(), activeConnections.get());
    }
}
