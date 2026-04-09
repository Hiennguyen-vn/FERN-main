package com.natsu.common.model.cache;

import java.time.Duration;
import java.util.*;
import java.util.function.Supplier;

/**
 * A two-level cache that uses a local in-memory cache backed by Redis.
 * Provides fast local access with distributed consistency via Redis.
 *
 * <p>Read pattern:
 * <ol>
 *   <li>Check local cache first (fast)</li>
 *   <li>If miss, check Redis (network call)</li>
 *   <li>If found in Redis, populate local cache</li>
 * </ol>
 *
 * <p>Write pattern:
 * <ol>
 *   <li>Write to Redis (source of truth)</li>
 *   <li>Update local cache</li>
 * </ol>
 *
 * <p>Usage:
 * <pre>
 * RedisClientAdapter redis = ...;
 * CacheSerializer&lt;User&gt; serializer = ...;
 *
 * Cache&lt;String, User&gt; cache = TieredCache.&lt;User&gt;builder("users")
 *     .localMaxSize(1000)
 *     .localTtl(Duration.ofMinutes(1))
 *     .redisTtl(Duration.ofHours(1))
 *     .redisClient(redis)
 *     .serializer(serializer)
 *     .build();
 * </pre>
 *
 * @param <V> the value type
 */
public class TieredCache<V> extends AbstractCache<String, V> {

    private final InMemoryCache<String, V> localCache;
    private final RedisCache<V> redisCache;
    private final Duration localTtl;

    private TieredCache(Builder<V> builder) {
        super(CacheConfig.builder(builder.name)
                .defaultTtl(builder.redisTtl)
                .recordStats(true)
                .build());

        CacheConfig localConfig = CacheConfig.builder(builder.name + "-local")
                .maxSize(builder.localMaxSize)
                .defaultTtl(builder.localTtl)
                .evictionPolicy(CacheConfig.EvictionPolicy.LRU)
                .recordStats(true)
                .build();

        this.localCache = new InMemoryCache<>(localConfig);
        this.localTtl = builder.localTtl;

        CacheConfig redisConfig = CacheConfig.builder(builder.name)
                .defaultTtl(builder.redisTtl)
                .recordStats(true)
                .build();

        this.redisCache = new RedisCache<>(redisConfig, builder.redisClient, builder.serializer);
    }

    /**
     * Creates a new builder.
     *
     * @param name the cache name
     * @param <V> the value type
     * @return a new builder
     */
    public static <V> Builder<V> builder(String name) {
        return new Builder<>(name);
    }

    @Override
    public Optional<V> get(String key) {
        // Try local cache first
        Optional<V> local = localCache.get(key);
        if (local.isPresent()) {
            recordHit();
            return local;
        }

        // Try Redis
        Optional<V> remote = redisCache.get(key);
        if (remote.isPresent()) {
            // Populate local cache
            localCache.put(key, remote.get(), localTtl);
            recordHit();
            return remote;
        }

        recordMiss();
        return Optional.empty();
    }

    @Override
    public V getOrCompute(String key, Supplier<V> loader, Duration ttl) {
        Optional<V> cached = get(key);
        if (cached.isPresent()) {
            return cached.get();
        }

        V value = loader.get();
        if (value != null) {
            put(key, value, ttl);
        }
        return value;
    }

    @Override
    public void put(String key, V value, Duration ttl) {
        if (key == null || value == null) {
            return;
        }

        // Write to Redis first (source of truth)
        redisCache.put(key, value, ttl);

        // Update local cache with shorter TTL
        Duration effectiveLocalTtl = localTtl;
        if (ttl != null && ttl.compareTo(localTtl) < 0) {
            effectiveLocalTtl = ttl;
        }
        localCache.put(key, value, effectiveLocalTtl);

        recordPut();
    }

    @Override
    public boolean putIfAbsent(String key, V value, Duration ttl) {
        if (key == null || value == null) {
            return false;
        }

        // Try Redis first
        boolean success = redisCache.putIfAbsent(key, value, ttl);
        if (success) {
            localCache.put(key, value, localTtl);
            recordPut();
        }
        return success;
    }

    @Override
    public boolean remove(String key) {
        if (key == null) {
            return false;
        }

        // Remove from both caches
        localCache.remove(key);
        return redisCache.remove(key);
    }

    @Override
    public boolean exists(String key) {
        if (key == null) {
            return false;
        }

        // Check local first
        if (localCache.exists(key)) {
            return true;
        }

        // Check Redis
        return redisCache.exists(key);
    }

    @Override
    public Map<String, V> getAll(Set<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return Map.of();
        }

        Map<String, V> result = new HashMap<>();
        Set<String> missingKeys = new HashSet<>();

        // Check local cache first
        for (String key : keys) {
            Optional<V> local = localCache.get(key);
            if (local.isPresent()) {
                result.put(key, local.get());
            } else {
                missingKeys.add(key);
            }
        }

        // Get missing from Redis
        if (!missingKeys.isEmpty()) {
            Map<String, V> remote = redisCache.getAll(missingKeys);
            result.putAll(remote);

            // Populate local cache
            for (Map.Entry<String, V> entry : remote.entrySet()) {
                localCache.put(entry.getKey(), entry.getValue(), localTtl);
            }
        }

        return result;
    }

    @Override
    public void putAll(Map<String, V> entries, Duration ttl) {
        if (entries == null || entries.isEmpty()) {
            return;
        }

        // Write to Redis
        redisCache.putAll(entries, ttl);

        // Update local cache
        Duration effectiveLocalTtl = localTtl;
        if (ttl != null && ttl.compareTo(localTtl) < 0) {
            effectiveLocalTtl = ttl;
        }
        localCache.putAll(entries, effectiveLocalTtl);
    }

    @Override
    public int removeAll(Set<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return 0;
        }

        localCache.removeAll(keys);
        return redisCache.removeAll(keys);
    }

    @Override
    public void clear() {
        localCache.clear();
        redisCache.clear();
    }

    @Override
    public long size() {
        // Return Redis size as source of truth
        return redisCache.size();
    }

    /**
     * Gets the local cache size.
     *
     * @return the local cache size
     */
    public long localSize() {
        return localCache.size();
    }

    /**
     * Clears only the local cache.
     */
    public void clearLocal() {
        localCache.clear();
    }

    /**
     * Gets statistics for the local cache.
     *
     * @return local cache stats
     */
    public CacheStats getLocalStats() {
        return localCache.getStats();
    }

    /**
     * Gets statistics for the Redis cache.
     *
     * @return Redis cache stats
     */
    public CacheStats getRedisStats() {
        return redisCache.getStats();
    }

    @Override
    public void close() {
        localCache.close();
        // Redis client lifecycle managed externally
    }

    /**
     * Builder for TieredCache.
     *
     * @param <V> the value type
     */
    public static class Builder<V> {
        private final String name;
        private long localMaxSize = 1000;
        private Duration localTtl = Duration.ofMinutes(1);
        private Duration redisTtl = Duration.ofHours(1);
        private RedisClientAdapter redisClient;
        private CacheSerializer<V> serializer;

        private Builder(String name) {
            this.name = name;
        }

        /**
         * Sets the local cache max size.
         *
         * @param size the max size
         * @return this builder
         */
        public Builder<V> localMaxSize(long size) {
            this.localMaxSize = size;
            return this;
        }

        /**
         * Sets the local cache TTL.
         *
         * @param ttl the TTL
         * @return this builder
         */
        public Builder<V> localTtl(Duration ttl) {
            this.localTtl = ttl;
            return this;
        }

        /**
         * Sets the Redis TTL.
         *
         * @param ttl the TTL
         * @return this builder
         */
        public Builder<V> redisTtl(Duration ttl) {
            this.redisTtl = ttl;
            return this;
        }

        /**
         * Sets the Redis client adapter.
         *
         * @param client the Redis client
         * @return this builder
         */
        public Builder<V> redisClient(RedisClientAdapter client) {
            this.redisClient = client;
            return this;
        }

        /**
         * Sets the value serializer.
         *
         * @param serializer the serializer
         * @return this builder
         */
        public Builder<V> serializer(CacheSerializer<V> serializer) {
            this.serializer = serializer;
            return this;
        }

        /**
         * Builds the tiered cache.
         *
         * @return the tiered cache
         */
        public TieredCache<V> build() {
            Objects.requireNonNull(redisClient, "Redis client is required");
            Objects.requireNonNull(serializer, "Serializer is required");
            return new TieredCache<>(this);
        }
    }
}
