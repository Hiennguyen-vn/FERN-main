package com.natsu.common.model.cache;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Represents an entry in the cache with value, metadata, and expiration info.
 *
 * @param <V> the value type
 */
public final class CacheEntry<V> {

    private final V value;
    private final Instant createdAt;
    private final Instant expiresAt;
    private volatile Instant lastAccessedAt;
    private final AtomicLong accessCount = new AtomicLong();
    private final Map<String, Object> metadata;

    private CacheEntry(V value, Instant createdAt, Instant expiresAt, Map<String, Object> metadata) {
        this.value = value;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
        this.lastAccessedAt = createdAt;
        // accessCount is initialized to 0 by AtomicLong
        this.metadata = metadata;
    }

    /**
     * Creates a cache entry with no expiration.
     *
     * @param value the value
     * @param <V>   the value type
     * @return the cache entry
     */
    public static <V> CacheEntry<V> of(V value) {
        return new CacheEntry<>(value, Instant.now(), null, Map.of());
    }

    /**
     * Creates a cache entry with a TTL.
     *
     * @param value the value
     * @param ttl   the time-to-live
     * @param <V>   the value type
     * @return the cache entry
     */
    public static <V> CacheEntry<V> of(V value, Duration ttl) {
        Instant now = Instant.now();
        Instant expiresAt = ttl != null ? now.plus(ttl) : null;
        return new CacheEntry<>(value, now, expiresAt, Map.of());
    }

    /**
     * Creates a cache entry with expiration time.
     *
     * @param value     the value
     * @param expiresAt the expiration time
     * @param <V>       the value type
     * @return the cache entry
     */
    public static <V> CacheEntry<V> of(V value, Instant expiresAt) {
        return new CacheEntry<>(value, Instant.now(), expiresAt, Map.of());
    }

    /**
     * Creates a cache entry with metadata.
     *
     * @param value    the value
     * @param ttl      the time-to-live
     * @param metadata additional metadata
     * @param <V>      the value type
     * @return the cache entry
     */
    public static <V> CacheEntry<V> of(V value, Duration ttl, Map<String, Object> metadata) {
        Instant now = Instant.now();
        Instant expiresAt = ttl != null ? now.plus(ttl) : null;
        return new CacheEntry<>(value, now, expiresAt, metadata != null ? Map.copyOf(metadata) : Map.of());
    }

    /**
     * Creates a builder for cache entries.
     *
     * @param value the value
     * @param <V>   the value type
     * @return a new builder
     */
    public static <V> Builder<V> builder(V value) {
        return new Builder<>(value);
    }

    /**
     * Gets the cached value.
     *
     * @return the value
     */
    public V getValue() {
        return value;
    }

    /**
     * Gets when the entry was created.
     *
     * @return the creation time
     */
    public Instant getCreatedAt() {
        return createdAt;
    }

    /**
     * Gets when the entry expires.
     *
     * @return the expiration time, or null if no expiration
     */
    public Instant getExpiresAt() {
        return expiresAt;
    }

    /**
     * Gets when the entry was last accessed.
     *
     * @return the last access time
     */
    public Instant getLastAccessedAt() {
        return lastAccessedAt;
    }

    /**
     * Gets the access count.
     *
     * @return how many times this entry has been accessed
     */
    public long getAccessCount() {
        return accessCount.get();
    }

    /**
     * Gets the entry metadata.
     *
     * @return the metadata map
     */
    public Map<String, Object> getMetadata() {
        return metadata;
    }

    /**
     * Gets a metadata value.
     *
     * @param key the metadata key
     * @param <T> the value type
     * @return the metadata value, or null
     */
    @SuppressWarnings("unchecked")
    public <T> T getMetadata(String key) {
        return (T) metadata.get(key);
    }

    /**
     * Checks if this entry has expired.
     *
     * @return true if expired
     */
    public boolean isExpired() {
        return expiresAt != null && Instant.now().isAfter(expiresAt);
    }

    /**
     * Gets the remaining time-to-live.
     *
     * @return the remaining TTL, or null if no expiration
     */
    public Duration getRemainingTtl() {
        if (expiresAt == null) {
            return null;
        }
        Duration remaining = Duration.between(Instant.now(), expiresAt);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    /**
     * Records an access to this entry.
     * Updates lastAccessedAt and increments accessCount.
     */
    public void recordAccess() {
        this.lastAccessedAt = Instant.now();
        this.accessCount.incrementAndGet();
    }

    /**
     * Gets the age of this entry.
     *
     * @return the duration since creation
     */
    public Duration getAge() {
        return Duration.between(createdAt, Instant.now());
    }

    /**
     * Gets the time since last access.
     *
     * @return the duration since last access
     */
    public Duration getIdleTime() {
        return Duration.between(lastAccessedAt, Instant.now());
    }

    @Override
    public boolean equals(Object o) {
        if (this == o)
            return true;
        if (o == null || getClass() != o.getClass())
            return false;
        CacheEntry<?> that = (CacheEntry<?>) o;
        return Objects.equals(value, that.value) &&
                Objects.equals(createdAt, that.createdAt) &&
                Objects.equals(expiresAt, that.expiresAt);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value, createdAt, expiresAt);
    }

    @Override
    public String toString() {
        return "CacheEntry{" +
                "value=" + value +
                ", createdAt=" + createdAt +
                ", expiresAt=" + expiresAt +
                ", accessCount=" + accessCount.get() +
                '}';
    }

    /**
     * Builder for creating cache entries with custom settings.
     *
     * @param <V> the value type
     */
    public static class Builder<V> {
        private final V value;
        private Duration ttl;
        private Instant expiresAt;
        private java.util.Map<String, Object> metadata = new java.util.HashMap<>();

        private Builder(V value) {
            this.value = value;
        }

        /**
         * Sets the time-to-live.
         *
         * @param ttl the TTL
         * @return this builder
         */
        public Builder<V> ttl(Duration ttl) {
            this.ttl = ttl;
            return this;
        }

        /**
         * Sets the expiration time.
         *
         * @param expiresAt the expiration time
         * @return this builder
         */
        public Builder<V> expiresAt(Instant expiresAt) {
            this.expiresAt = expiresAt;
            return this;
        }

        /**
         * Adds metadata.
         *
         * @param key   the metadata key
         * @param value the metadata value
         * @return this builder
         */
        public Builder<V> metadata(String key, Object value) {
            this.metadata.put(key, value);
            return this;
        }

        /**
         * Adds all metadata.
         *
         * @param metadata the metadata map
         * @return this builder
         */
        public Builder<V> metadata(Map<String, Object> metadata) {
            this.metadata.putAll(metadata);
            return this;
        }

        /**
         * Builds the cache entry.
         *
         * @return the cache entry
         */
        public CacheEntry<V> build() {
            Instant now = Instant.now();
            Instant expires = this.expiresAt;
            if (expires == null && ttl != null) {
                expires = now.plus(ttl);
            }
            return new CacheEntry<>(value, now, expires, Map.copyOf(metadata));
        }
    }
}
