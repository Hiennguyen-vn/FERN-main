package com.natsu.common.model.cache;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

/**
 * Abstract cache interface supporting key-value caching with optional parameters.
 * Implementations can provide in-memory, Redis, or custom caching backends.
 *
 * <p>Usage:
 * <pre>
 * Cache&lt;String, User&gt; userCache = CacheManager.getCache("users");
 *
 * // Simple key-value
 * userCache.put("user:123", user);
 * Optional&lt;User&gt; user = userCache.get("user:123");
 *
 * // With TTL
 * userCache.put("session:abc", session, Duration.ofMinutes(30));
 *
 * // Parameterized keys
 * userCache.put(CacheKey.of("user", userId, "profile"), profile);
 *
 * // Get or compute
 * User user = userCache.getOrCompute("user:123", () -&gt; userService.findById(123));
 * </pre>
 *
 * @param <K> the key type
 * @param <V> the value type
 */
public interface Cache<K, V> {

    /**
     * Gets the cache name.
     *
     * @return the cache name
     */
    String getName();

    // ==================== Basic Operations ====================

    /**
     * Gets a value from the cache.
     *
     * @param key the cache key
     * @return an Optional containing the value if present
     */
    Optional<V> get(K key);

    /**
     * Gets a value or returns the default if not present.
     *
     * @param key the cache key
     * @param defaultValue the default value
     * @return the cached value or default
     */
    default V getOrDefault(K key, V defaultValue) {
        return get(key).orElse(defaultValue);
    }

    /**
     * Gets a value or computes it if not present.
     * The computed value is automatically cached.
     *
     * @param key the cache key
     * @param loader the function to compute the value
     * @return the cached or computed value
     */
    V getOrCompute(K key, Supplier<V> loader);

    /**
     * Gets a value or computes it with a custom TTL.
     *
     * @param key the cache key
     * @param loader the function to compute the value
     * @param ttl the time-to-live for the computed value
     * @return the cached or computed value
     */
    V getOrCompute(K key, Supplier<V> loader, Duration ttl);

    /**
     * Puts a value into the cache with default TTL.
     *
     * @param key the cache key
     * @param value the value to cache
     */
    void put(K key, V value);

    /**
     * Puts a value into the cache with a custom TTL.
     *
     * @param key the cache key
     * @param value the value to cache
     * @param ttl the time-to-live
     */
    void put(K key, V value, Duration ttl);

    /**
     * Puts a value only if the key doesn't exist.
     *
     * @param key the cache key
     * @param value the value to cache
     * @return true if the value was put, false if key already exists
     */
    boolean putIfAbsent(K key, V value);

    /**
     * Puts a value only if the key doesn't exist, with custom TTL.
     *
     * @param key the cache key
     * @param value the value to cache
     * @param ttl the time-to-live
     * @return true if the value was put, false if key already exists
     */
    boolean putIfAbsent(K key, V value, Duration ttl);

    /**
     * Removes a value from the cache.
     *
     * @param key the cache key
     * @return true if the value was removed
     */
    boolean remove(K key);

    /**
     * Checks if a key exists in the cache.
     *
     * @param key the cache key
     * @return true if the key exists
     */
    boolean exists(K key);

    // ==================== Bulk Operations ====================

    /**
     * Gets multiple values from the cache.
     *
     * @param keys the cache keys
     * @return a map of key to value for found entries
     */
    Map<K, V> getAll(Set<K> keys);

    /**
     * Puts multiple values into the cache.
     *
     * @param entries the entries to cache
     */
    void putAll(Map<K, V> entries);

    /**
     * Puts multiple values with custom TTL.
     *
     * @param entries the entries to cache
     * @param ttl the time-to-live
     */
    void putAll(Map<K, V> entries, Duration ttl);

    /**
     * Removes multiple keys from the cache.
     *
     * @param keys the keys to remove
     * @return the number of keys removed
     */
    int removeAll(Set<K> keys);

    // ==================== Async Operations ====================

    /**
     * Gets a value asynchronously.
     *
     * @param key the cache key
     * @return a CompletableFuture with the optional value
     */
    default CompletableFuture<Optional<V>> getAsync(K key) {
        return CompletableFuture.supplyAsync(() -> get(key));
    }

    /**
     * Gets or computes a value asynchronously.
     *
     * @param key the cache key
     * @param loader the async loader function
     * @return a CompletableFuture with the value
     */
    default CompletableFuture<V> getOrComputeAsync(K key, Supplier<CompletableFuture<V>> loader) {
        return getAsync(key).thenCompose(opt -> {
            if (opt.isPresent()) {
                return CompletableFuture.completedFuture(opt.get());
            }
            return loader.get().thenApply(value -> {
                put(key, value);
                return value;
            });
        });
    }

    /**
     * Puts a value asynchronously.
     *
     * @param key the cache key
     * @param value the value to cache
     * @return a CompletableFuture that completes when done
     */
    default CompletableFuture<Void> putAsync(K key, V value) {
        return CompletableFuture.runAsync(() -> put(key, value));
    }

    /**
     * Removes a value asynchronously.
     *
     * @param key the cache key
     * @return a CompletableFuture with the result
     */
    default CompletableFuture<Boolean> removeAsync(K key) {
        return CompletableFuture.supplyAsync(() -> remove(key));
    }

    // ==================== Cache Management ====================

    /**
     * Clears all entries from the cache.
     */
    void clear();

    /**
     * Gets the number of entries in the cache.
     *
     * @return the cache size
     */
    long size();

    /**
     * Gets cache statistics.
     *
     * @return the cache statistics
     */
    CacheStats getStats();

    /**
     * Refreshes a key by reloading from the original source.
     * Only works if the cache supports value loaders.
     *
     * @param key the key to refresh
     */
    default void refresh(K key) {
        // Default no-op, implementations may override
    }

    /**
     * Evicts expired entries from the cache.
     * This is typically called automatically but can be triggered manually.
     */
    default void evictExpired() {
        // Default no-op, implementations may override
    }

    /**
     * Closes the cache and releases resources.
     */
    default void close() {
        // Default no-op, implementations may override
    }
}
