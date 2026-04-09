package com.natsu.common.model.cache;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Factory for creating and managing cache instances.
 *
 * <p>
 * Can be used as either an instance-based manager (for isolation / testing)
 * or via the static convenience methods that delegate to a default singleton.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * // Static API (delegates to default instance)
 * Cache<String, User> userCache = CacheManager.getCache("users");
 *
 * // Instance API (for test isolation or multi-tenancy)
 * CacheManager mgr = new CacheManager();
 * Cache<String, Session> cache = mgr.getOrCreateCache("sessions");
 * }</pre>
 */
public final class CacheManager {

    private static final CacheManager DEFAULT = new CacheManager();

    private final Map<String, Cache<?, ?>> caches = new ConcurrentHashMap<>();
    private volatile Function<CacheConfig, Cache<?, ?>> cacheFactory = InMemoryCache::new;

    /**
     * Returns the default (global) CacheManager instance.
     *
     * @return the default instance
     */
    public static CacheManager getDefault() {
        return DEFAULT;
    }

    // ==================== Instance API ====================

    /**
     * Gets or creates a cache with the given name using default configuration.
     *
     * @param name the cache name
     * @param <K>  the key type
     * @param <V>  the value type
     * @return the cache instance
     */
    @SuppressWarnings("unchecked")
    public <K, V> Cache<K, V> getOrCreateCache(String name) {
        return (Cache<K, V>) caches.computeIfAbsent(name, n -> cacheFactory.apply(CacheConfig.defaultConfig(n)));
    }

    /**
     * Gets or creates a cache with the given configuration.
     *
     * @param config the cache configuration
     * @param <K>    the key type
     * @param <V>    the value type
     * @return the cache instance
     */
    @SuppressWarnings("unchecked")
    public <K, V> Cache<K, V> getOrCreateCache(CacheConfig config) {
        return (Cache<K, V>) caches.computeIfAbsent(config.getName(), n -> cacheFactory.apply(config));
    }

    /**
     * Gets an existing cache by name.
     *
     * @param name the cache name
     * @param <K>  the key type
     * @param <V>  the value type
     * @return the cache, or null if not found
     */
    @SuppressWarnings("unchecked")
    public <K, V> Cache<K, V> findCache(String name) {
        return (Cache<K, V>) caches.get(name);
    }

    /**
     * Checks if a cache exists.
     *
     * @param name the cache name
     * @return true if the cache exists
     */
    public boolean containsCache(String name) {
        return caches.containsKey(name);
    }

    /**
     * Removes a cache by name.
     *
     * @param name the cache name
     * @return true if the cache was removed
     */
    public boolean destroyCache(String name) {
        Cache<?, ?> cache = caches.remove(name);
        if (cache != null) {
            cache.close();
            return true;
        }
        return false;
    }

    /**
     * Clears all entries from a specific cache.
     *
     * @param name the cache name
     */
    public void clearCacheEntries(String name) {
        Cache<?, ?> cache = caches.get(name);
        if (cache != null) {
            cache.clear();
        }
    }

    /**
     * Clears all entries from all caches.
     */
    public void clearAllEntries() {
        for (Cache<?, ?> cache : caches.values()) {
            cache.clear();
        }
    }

    /**
     * Closes and removes all caches.
     */
    public void shutdownAll() {
        for (Cache<?, ?> cache : caches.values()) {
            try {
                cache.close();
            } catch (Exception e) {
                // Ignore
            }
        }
        caches.clear();
    }

    /**
     * Gets all cache names.
     *
     * @return the set of cache names
     */
    public Set<String> cacheNames() {
        return Set.copyOf(caches.keySet());
    }

    /**
     * Gets statistics for all caches.
     *
     * @return a map of cache name to statistics
     */
    public Map<String, CacheStats> allStats() {
        Map<String, CacheStats> allStats = new ConcurrentHashMap<>();
        for (Map.Entry<String, Cache<?, ?>> entry : caches.entrySet()) {
            CacheStats stats = entry.getValue().getStats();
            if (stats != null) {
                allStats.put(entry.getKey(), stats);
            }
        }
        return allStats;
    }

    /**
     * Sets a custom cache factory for creating cache instances.
     *
     * @param factory the cache factory function
     */
    public void setCacheFactoryFn(Function<CacheConfig, Cache<?, ?>> factory) {
        cacheFactory = factory;
    }

    /**
     * Resets the cache factory to the default (InMemoryCache).
     */
    public void resetCacheFactoryFn() {
        cacheFactory = InMemoryCache::new;
    }

    /**
     * Registers an existing cache instance.
     *
     * @param cache the cache to register
     * @param <K>   the key type
     * @param <V>   the value type
     */
    public <K, V> void addCache(Cache<K, V> cache) {
        caches.put(cache.getName(), cache);
    }

    // ==================== ServicesRegistry Integration ====================

    /**
     * Gets or creates a cache from a configuration registered in ServicesRegistry.
     *
     * @param name the configuration name in the registry
     * @param <K>  the key type
     * @param <V>  the value type
     * @return the cache instance
     */
    @SuppressWarnings("unchecked")
    public <K, V> Cache<K, V> getCacheFromRegistryInstance(String name) {
        Cache<?, ?> existing = caches.get(name);
        if (existing != null) {
            return (Cache<K, V>) existing;
        }

        CacheConfig config = ServicesRegistry.getConfig(name, ServiceCategory.CACHE);
        return getOrCreateCache(config);
    }

    /**
     * Creates all caches from configurations registered in ServicesRegistry.
     */
    public void createAllFromRegistryInstance() {
        for (CacheConfig config : ServicesRegistry.<CacheConfig>getAllConfigs(ServiceCategory.CACHE)) {
            getOrCreateCache(config);
        }
    }

    // ==================== Static Delegates (backwards compatible)
    // ====================

    /**
     * Gets or creates a cache with the given name using default configuration.
     * Delegates to the default instance.
     */
    public static <K, V> Cache<K, V> getCache(String name) {
        return DEFAULT.getOrCreateCache(name);
    }

    /**
     * Gets or creates a cache with the given configuration.
     * Delegates to the default instance.
     */
    public static <K, V> Cache<K, V> getCache(CacheConfig config) {
        return DEFAULT.getOrCreateCache(config);
    }

    /**
     * Gets an existing cache by name.
     * Delegates to the default instance.
     */
    public static <K, V> Cache<K, V> getExistingCache(String name) {
        return DEFAULT.findCache(name);
    }

    /** Checks if a cache exists. Delegates to the default instance. */
    public static boolean hasCache(String name) {
        return DEFAULT.containsCache(name);
    }

    /** Removes a cache by name. Delegates to the default instance. */
    public static boolean removeCache(String name) {
        return DEFAULT.destroyCache(name);
    }

    /**
     * Clears all entries from a specific cache. Delegates to the default instance.
     */
    public static void clearCache(String name) {
        DEFAULT.clearCacheEntries(name);
    }

    /** Clears all entries from all caches. Delegates to the default instance. */
    public static void clearAll() {
        DEFAULT.clearAllEntries();
    }

    /** Closes and removes all caches. Delegates to the default instance. */
    public static void shutdown() {
        DEFAULT.shutdownAll();
    }

    /** Gets all cache names. Delegates to the default instance. */
    public static Set<String> getCacheNames() {
        return DEFAULT.cacheNames();
    }

    /** Gets statistics for all caches. Delegates to the default instance. */
    public static Map<String, CacheStats> getAllStats() {
        return DEFAULT.allStats();
    }

    /** Sets a custom cache factory. Delegates to the default instance. */
    public static void setCacheFactory(Function<CacheConfig, Cache<?, ?>> factory) {
        DEFAULT.setCacheFactoryFn(factory);
    }

    /** Resets the cache factory to default. Delegates to the default instance. */
    public static void resetCacheFactory() {
        DEFAULT.resetCacheFactoryFn();
    }

    /** Registers an existing cache instance. Delegates to the default instance. */
    public static <K, V> void registerCache(Cache<K, V> cache) {
        DEFAULT.addCache(cache);
    }

    /**
     * Gets or creates a cache from the registry. Delegates to the default instance.
     */
    public static <K, V> Cache<K, V> getCacheFromRegistry(String name) {
        return DEFAULT.getCacheFromRegistryInstance(name);
    }

    /** Creates all caches from registry. Delegates to the default instance. */
    public static void createAllFromRegistry() {
        DEFAULT.createAllFromRegistryInstance();
    }
}
