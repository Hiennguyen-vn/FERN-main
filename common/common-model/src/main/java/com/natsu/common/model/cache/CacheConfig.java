package com.natsu.common.model.cache;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServiceDefinition;
import com.natsu.common.utils.services.ServicesRegistry;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Configuration for cache instances.
 * 
 * <p>
 * Implements {@link ServiceDefinition} for use with {@link ServicesRegistry}.
 */
public final class CacheConfig implements ServiceDefinition {

    /**
     * Eviction policy when cache is full.
     */
    public enum EvictionPolicy {
        /** Least Recently Used */
        LRU,
        /** Least Frequently Used */
        LFU,
        /** First In First Out */
        FIFO,
        /** Time-To-Live based only */
        TTL,
        /** No eviction (throws when full) */
        NONE
    }

    private final String name;
    private final long maxSize;
    private final Duration defaultTtl;
    private final Duration maxIdleTime;
    private final EvictionPolicy evictionPolicy;
    private final boolean recordStats;
    private final boolean softValues;
    private final boolean weakKeys;
    private final int concurrencyLevel;

    private CacheConfig(Builder builder) {
        this.name = builder.name;
        this.maxSize = builder.maxSize;
        this.defaultTtl = builder.defaultTtl;
        this.maxIdleTime = builder.maxIdleTime;
        this.evictionPolicy = builder.evictionPolicy;
        this.recordStats = builder.recordStats;
        this.softValues = builder.softValues;
        this.weakKeys = builder.weakKeys;
        this.concurrencyLevel = builder.concurrencyLevel;
    }

    /**
     * Creates a new builder.
     *
     * @param name the cache name
     * @return a new builder
     */
    public static Builder builder(String name) {
        return new Builder(name);
    }

    /**
     * Creates a default configuration.
     *
     * @param name the cache name
     * @return a default configuration
     */
    public static CacheConfig defaultConfig(String name) {
        return builder(name).build();
    }

    // Getters

    public String getName() {
        return name;
    }

    @Override
    public ServiceCategory getServiceCategory() {
        return ServiceCategory.CACHE;
    }

    @Override
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>(ServiceDefinition.super.toMap());
        map.put("maxSize", maxSize);
        map.put("defaultTtl", defaultTtl);
        map.put("evictionPolicy", evictionPolicy.name());
        return map;
    }

    public long getMaxSize() {
        return maxSize;
    }

    public Duration getDefaultTtl() {
        return defaultTtl;
    }

    public Duration getMaxIdleTime() {
        return maxIdleTime;
    }

    public EvictionPolicy getEvictionPolicy() {
        return evictionPolicy;
    }

    public boolean isRecordStats() {
        return recordStats;
    }

    public boolean isSoftValues() {
        return softValues;
    }

    public boolean isWeakKeys() {
        return weakKeys;
    }

    public int getConcurrencyLevel() {
        return concurrencyLevel;
    }

    @Override
    public String toString() {
        return "CacheConfig{" +
                "name='" + name + '\'' +
                ", maxSize=" + maxSize +
                ", defaultTtl=" + defaultTtl +
                ", evictionPolicy=" + evictionPolicy +
                ", recordStats=" + recordStats +
                '}';
    }

    /**
     * Builder for CacheConfig.
     */
    public static class Builder {
        private final String name;
        private long maxSize = 10_000;
        private Duration defaultTtl = Duration.ofMinutes(10);
        private Duration maxIdleTime = null;
        private EvictionPolicy evictionPolicy = EvictionPolicy.LRU;
        private boolean recordStats = true;
        private boolean softValues = false;
        private boolean weakKeys = false;
        private int concurrencyLevel = 16;

        private Builder(String name) {
            this.name = Objects.requireNonNull(name, "Cache name cannot be null");
        }

        /**
         * Sets the maximum cache size.
         *
         * @param maxSize the maximum number of entries
         * @return this builder
         */
        public Builder maxSize(long maxSize) {
            if (maxSize < 0) {
                throw new IllegalArgumentException("maxSize cannot be negative");
            }
            this.maxSize = maxSize;
            return this;
        }

        /**
         * Sets the default time-to-live for entries.
         *
         * @param ttl the default TTL
         * @return this builder
         */
        public Builder defaultTtl(Duration ttl) {
            if (ttl != null && ttl.isNegative()) {
                throw new IllegalArgumentException("defaultTtl cannot be negative");
            }
            this.defaultTtl = ttl;
            return this;
        }

        /**
         * Sets the maximum idle time for entries.
         * Entries not accessed within this time will be evicted.
         *
         * @param maxIdleTime the max idle time
         * @return this builder
         */
        public Builder maxIdleTime(Duration maxIdleTime) {
            this.maxIdleTime = maxIdleTime;
            return this;
        }

        /**
         * Sets the eviction policy.
         *
         * @param policy the eviction policy
         * @return this builder
         */
        public Builder evictionPolicy(EvictionPolicy policy) {
            this.evictionPolicy = policy;
            return this;
        }

        /**
         * Enables or disables statistics recording.
         *
         * @param recordStats true to record statistics
         * @return this builder
         */
        public Builder recordStats(boolean recordStats) {
            this.recordStats = recordStats;
            return this;
        }

        /**
         * Enables soft references for values (allows GC under memory pressure).
         *
         * @param softValues true to use soft references
         * @return this builder
         */
        public Builder softValues(boolean softValues) {
            this.softValues = softValues;
            return this;
        }

        /**
         * Enables weak references for keys.
         *
         * @param weakKeys true to use weak references
         * @return this builder
         */
        public Builder weakKeys(boolean weakKeys) {
            this.weakKeys = weakKeys;
            return this;
        }

        /**
         * Sets the concurrency level for internal locks.
         *
         * @param level the concurrency level
         * @return this builder
         */
        public Builder concurrencyLevel(int level) {
            if (level < 1) {
                throw new IllegalArgumentException("concurrencyLevel must be at least 1");
            }
            this.concurrencyLevel = level;
            return this;
        }

        /**
         * Builds the configuration.
         *
         * @return the cache configuration
         */
        public CacheConfig build() {
            return new CacheConfig(this);
        }
    }
}
