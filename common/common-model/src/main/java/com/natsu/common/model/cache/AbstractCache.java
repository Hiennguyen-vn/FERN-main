package com.natsu.common.model.cache;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Abstract base class for cache implementations.
 * Provides common functionality and default implementations.
 *
 * @param <K> the key type
 * @param <V> the value type
 */
public abstract class AbstractCache<K, V> implements Cache<K, V> {

    protected final String name;
    protected final CacheConfig config;
    protected final CacheStats stats;

    /**
     * Tracks in-flight computations to prevent cache stampede.
     * When multiple threads call getOrCompute() for the same missing key,
     * only the first thread executes the loader; the rest wait on the same future.
     */
    private final ConcurrentHashMap<K, CompletableFuture<V>> inFlight = new ConcurrentHashMap<>();

    protected AbstractCache(CacheConfig config) {
        this.name = config.getName();
        this.config = config;
        this.stats = config.isRecordStats() ? new CacheStats() : null;
    }

    protected AbstractCache(String name) {
        this(CacheConfig.defaultConfig(name));
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public V getOrDefault(K key, V defaultValue) {
        return get(key).orElse(defaultValue);
    }

    @Override
    public V getOrCompute(K key, Supplier<V> loader) {
        return getOrCompute(key, loader, config.getDefaultTtl());
    }

    @Override
    public V getOrCompute(K key, Supplier<V> loader, Duration ttl) {
        Optional<V> cached = get(key);
        if (cached.isPresent()) {
            return cached.get();
        }

        // Single-flight: only one thread computes, others wait on the same future.
        CompletableFuture<V> future = inFlight.computeIfAbsent(key, k -> {
            CompletableFuture<V> f = new CompletableFuture<>();
            try {
                V value = loader.get();
                if (value != null) {
                    put(key, value, ttl);
                }
                f.complete(value);
            } catch (Exception e) {
                f.completeExceptionally(e);
            }
            return f;
        });

        try {
            return future.join();
        } catch (java.util.concurrent.CompletionException e) {
            if (e.getCause() instanceof RuntimeException re)
                throw re;
            throw new RuntimeException(e.getCause());
        } finally {
            // Clean up the in-flight entry after the computation completes.
            // Must be outside computeIfAbsent to avoid recursive update.
            inFlight.remove(key, future);
        }
    }

    @Override
    public void put(K key, V value) {
        put(key, value, config.getDefaultTtl());
    }

    @Override
    public boolean putIfAbsent(K key, V value) {
        return putIfAbsent(key, value, config.getDefaultTtl());
    }

    @Override
    public Map<K, V> getAll(Set<K> keys) {
        Map<K, V> result = new HashMap<>();
        for (K key : keys) {
            get(key).ifPresent(v -> result.put(key, v));
        }
        return result;
    }

    @Override
    public void putAll(Map<K, V> entries) {
        putAll(entries, config.getDefaultTtl());
    }

    @Override
    public void putAll(Map<K, V> entries, Duration ttl) {
        for (Map.Entry<K, V> entry : entries.entrySet()) {
            put(entry.getKey(), entry.getValue(), ttl);
        }
    }

    @Override
    public int removeAll(Set<K> keys) {
        int count = 0;
        for (K key : keys) {
            if (remove(key)) {
                count++;
            }
        }
        return count;
    }

    @Override
    public CacheStats getStats() {
        return stats;
    }

    protected void recordHit() {
        if (stats != null) {
            stats.recordHit();
        }
    }

    protected void recordMiss() {
        if (stats != null) {
            stats.recordMiss();
        }
    }

    protected void recordPut() {
        if (stats != null) {
            stats.recordPut();
        }
    }

    protected void recordEviction() {
        if (stats != null) {
            stats.recordEviction();
        }
    }

    protected void recordExpiration() {
        if (stats != null) {
            stats.recordExpiration();
        }
    }

    protected CacheConfig getConfig() {
        return config;
    }
}
