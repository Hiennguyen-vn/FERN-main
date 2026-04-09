package com.natsu.common.model.cache;

import java.time.Instant;
import java.util.concurrent.atomic.LongAdder;

/**
 * Cache statistics for monitoring cache performance.
 */
public class CacheStats {

    private final LongAdder hits = new LongAdder();
    private final LongAdder misses = new LongAdder();
    private final LongAdder puts = new LongAdder();
    private final LongAdder evictions = new LongAdder();
    private final LongAdder expirations = new LongAdder();
    private final Instant startTime;

    public CacheStats() {
        this.startTime = Instant.now();
    }

    /**
     * Creates an immutable snapshot of the current stats.
     *
     * @return a snapshot record
     */
    public Snapshot snapshot() {
        return new Snapshot(
                hits.sum(),
                misses.sum(),
                puts.sum(),
                evictions.sum(),
                expirations.sum(),
                startTime
        );
    }

    /**
     * Records a cache hit.
     */
    public void recordHit() {
        hits.increment();
    }

    /**
     * Records multiple cache hits.
     *
     * @param count the number of hits
     */
    public void recordHits(long count) {
        hits.add(count);
    }

    /**
     * Records a cache miss.
     */
    public void recordMiss() {
        misses.increment();
    }

    /**
     * Records multiple cache misses.
     *
     * @param count the number of misses
     */
    public void recordMisses(long count) {
        misses.add(count);
    }

    /**
     * Records a cache put.
     */
    public void recordPut() {
        puts.increment();
    }

    /**
     * Records multiple cache puts.
     *
     * @param count the number of puts
     */
    public void recordPuts(long count) {
        puts.add(count);
    }

    /**
     * Records an eviction.
     */
    public void recordEviction() {
        evictions.increment();
    }

    /**
     * Records multiple evictions.
     *
     * @param count the number of evictions
     */
    public void recordEvictions(long count) {
        evictions.add(count);
    }

    /**
     * Records an expiration.
     */
    public void recordExpiration() {
        expirations.increment();
    }

    /**
     * Records multiple expirations.
     *
     * @param count the number of expirations
     */
    public void recordExpirations(long count) {
        expirations.add(count);
    }

    /**
     * Resets all statistics.
     */
    public void reset() {
        hits.reset();
        misses.reset();
        puts.reset();
        evictions.reset();
        expirations.reset();
    }

    // Quick accessors

    public long getHits() {
        return hits.sum();
    }

    public long getMisses() {
        return misses.sum();
    }

    public long getPuts() {
        return puts.sum();
    }

    public long getEvictions() {
        return evictions.sum();
    }

    public long getExpirations() {
        return expirations.sum();
    }

    public long getTotalRequests() {
        return hits.sum() + misses.sum();
    }

    public double getHitRate() {
        long total = getTotalRequests();
        return total == 0 ? 0.0 : (double) hits.sum() / total;
    }

    public double getMissRate() {
        long total = getTotalRequests();
        return total == 0 ? 0.0 : (double) misses.sum() / total;
    }

    /**
     * Immutable snapshot of cache statistics.
     */
    public record Snapshot(
            long hits,
            long misses,
            long puts,
            long evictions,
            long expirations,
            Instant startTime
    ) {
        /**
         * Gets the total number of requests (hits + misses).
         *
         * @return total requests
         */
        public long totalRequests() {
            return hits + misses;
        }

        /**
         * Gets the hit rate (0.0 to 1.0).
         *
         * @return the hit rate
         */
        public double hitRate() {
            long total = totalRequests();
            return total == 0 ? 0.0 : (double) hits / total;
        }

        /**
         * Gets the miss rate (0.0 to 1.0).
         *
         * @return the miss rate
         */
        public double missRate() {
            long total = totalRequests();
            return total == 0 ? 0.0 : (double) misses / total;
        }

        /**
         * Gets the hit rate as a percentage string.
         *
         * @return the hit rate formatted as percentage
         */
        public String hitRatePercent() {
            return String.format("%.2f%%", hitRate() * 100);
        }

        @Override
        public String toString() {
            return String.format(
                    "CacheStats{hits=%d, misses=%d, hitRate=%s, puts=%d, evictions=%d, expirations=%d}",
                    hits, misses, hitRatePercent(), puts, evictions, expirations
            );
        }
    }
}
