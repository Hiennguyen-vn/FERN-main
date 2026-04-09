package com.natsu.common.model.cache;

import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * In-memory cache implementation with LRU eviction, TTL support, and
 * statistics.
 *
 * <p>
 * Extends {@link AbstractCache} to inherit common functionality such as
 * stats recording, bulk operations, and default TTL handling.
 *
 * <p>
 * Thread-safety is provided via a {@link ReentrantReadWriteLock}. All reads
 * and writes to the underlying storage and access-order map are guarded by the
 * appropriate lock level to prevent data races.
 *
 * <p>
 * Usage:
 * 
 * <pre>
 * CacheConfig config = CacheConfig.builder("users")
 *         .maxSize(1000)
 *         .defaultTtl(Duration.ofMinutes(10))
 *         .evictionPolicy(EvictionPolicy.LRU)
 *         .build();
 *
 * Cache&lt;String, User&gt; cache = new InMemoryCache&lt;&gt;(config);
 * cache.put("user:123", user);
 * Optional&lt;User&gt; user = cache.get("user:123");
 * </pre>
 *
 * @param <K> the key type
 * @param <V> the value type
 */
public class InMemoryCache<K, V> extends AbstractCache<K, V> {

    private final Map<K, CacheEntry<V>> storage;
    private final LinkedHashMap<K, Long> accessOrder;
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private final ScheduledExecutorService cleanupExecutor;

    /**
     * Creates a cache with the given configuration.
     *
     * @param config the cache configuration
     */
    public InMemoryCache(CacheConfig config) {
        super(config);
        this.storage = new ConcurrentHashMap<>();
        this.accessOrder = new LinkedHashMap<>(16, 0.75f, true);

        // Start cleanup scheduler
        this.cleanupExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "cache-cleanup-" + name);
            t.setDaemon(true);
            return t;
        });

        // Schedule periodic cleanup every minute
        cleanupExecutor.scheduleAtFixedRate(this::evictExpired, 1, 1, TimeUnit.MINUTES);
    }

    /**
     * Creates a cache with default configuration.
     *
     * @param name the cache name
     */
    public InMemoryCache(String name) {
        this(CacheConfig.defaultConfig(name));
    }

    @Override
    public Optional<V> get(K key) {
        if (key == null) {
            return Optional.empty();
        }

        lock.writeLock().lock();
        try {
            CacheEntry<V> entry = storage.get(key);
            if (entry == null) {
                recordMiss();
                return Optional.empty();
            }

            if (entry.isExpired()) {
                storage.remove(key);
                accessOrder.remove(key);
                recordExpiration();
                recordMiss();
                return Optional.empty();
            }

            // Check idle time
            if (config.getMaxIdleTime() != null && entry.getIdleTime().compareTo(config.getMaxIdleTime()) > 0) {
                storage.remove(key);
                accessOrder.remove(key);
                recordMiss();
                return Optional.empty();
            }

            entry.recordAccess();
            accessOrder.put(key, System.nanoTime());
            recordHit();
            return Optional.of(entry.getValue());
        } finally {
            lock.writeLock().unlock();
        }
    }

    @Override
    public void put(K key, V value, Duration ttl) {
        if (key == null) {
            return;
        }

        lock.writeLock().lock();
        try {
            // Evict if at capacity
            while (storage.size() >= config.getMaxSize()) {
                evictOne();
            }

            CacheEntry<V> entry = CacheEntry.of(value, ttl);
            storage.put(key, entry);
            accessOrder.put(key, System.nanoTime());
            recordPut();
        } finally {
            lock.writeLock().unlock();
        }
    }

    @Override
    public boolean putIfAbsent(K key, V value, Duration ttl) {
        if (key == null) {
            return false;
        }

        lock.writeLock().lock();
        try {
            if (existsInternal(key)) {
                return false;
            }
            // Evict if at capacity
            while (storage.size() >= config.getMaxSize()) {
                evictOne();
            }
            CacheEntry<V> entry = CacheEntry.of(value, ttl);
            storage.put(key, entry);
            accessOrder.put(key, System.nanoTime());
            recordPut();
            return true;
        } finally {
            lock.writeLock().unlock();
        }
    }

    @Override
    public boolean remove(K key) {
        if (key == null) {
            return false;
        }

        lock.writeLock().lock();
        try {
            CacheEntry<V> removed = storage.remove(key);
            accessOrder.remove(key);
            return removed != null;
        } finally {
            lock.writeLock().unlock();
        }
    }

    @Override
    public boolean exists(K key) {
        if (key == null) {
            return false;
        }

        lock.readLock().lock();
        try {
            return existsInternal(key);
        } finally {
            lock.readLock().unlock();
        }
    }

    @Override
    public void clear() {
        lock.writeLock().lock();
        try {
            storage.clear();
            accessOrder.clear();
        } finally {
            lock.writeLock().unlock();
        }
    }

    @Override
    public long size() {
        lock.readLock().lock();
        try {
            return storage.size();
        } finally {
            lock.readLock().unlock();
        }
    }

    @Override
    public void evictExpired() {
        lock.writeLock().lock();
        try {
            Iterator<Map.Entry<K, CacheEntry<V>>> it = storage.entrySet().iterator();
            int evicted = 0;
            while (it.hasNext()) {
                Map.Entry<K, CacheEntry<V>> entry = it.next();
                if (entry.getValue().isExpired()) {
                    it.remove();
                    accessOrder.remove(entry.getKey());
                    evicted++;
                }
            }
            if (stats != null && evicted > 0) {
                stats.recordExpirations(evicted);
            }
        } finally {
            lock.writeLock().unlock();
        }
    }

    @Override
    public void close() {
        cleanupExecutor.shutdown();
        try {
            cleanupExecutor.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        clear();
    }

    // ==================== Internal helpers ====================

    /**
     * Checks existence without acquiring extra locks (caller must hold read or
     * write lock).
     */
    private boolean existsInternal(K key) {
        CacheEntry<V> entry = storage.get(key);
        if (entry == null) {
            return false;
        }
        if (entry.isExpired()) {
            // Lazy clean up — but only if we already hold the write lock
            if (lock.isWriteLockedByCurrentThread()) {
                storage.remove(key);
                accessOrder.remove(key);
                recordExpiration();
            }
            return false;
        }
        return true;
    }

    private void evictOne() {
        switch (config.getEvictionPolicy()) {
            case LRU -> evictLru();
            case FIFO -> evictFifo();
            case LFU -> evictLfu();
            default -> evictLru();
        }
    }

    private void evictLru() {
        if (accessOrder.isEmpty()) {
            return;
        }

        // Get the least recently used key
        K lruKey = accessOrder.keySet().iterator().next();
        storage.remove(lruKey);
        accessOrder.remove(lruKey);
        recordEviction();
    }

    private void evictFifo() {
        if (storage.isEmpty()) {
            return;
        }

        // Find oldest entry by creation time
        K oldestKey = null;
        Instant oldestTime = Instant.MAX;

        for (Map.Entry<K, CacheEntry<V>> entry : storage.entrySet()) {
            if (entry.getValue().getCreatedAt().isBefore(oldestTime)) {
                oldestTime = entry.getValue().getCreatedAt();
                oldestKey = entry.getKey();
            }
        }

        if (oldestKey != null) {
            storage.remove(oldestKey);
            accessOrder.remove(oldestKey);
            recordEviction();
        }
    }

    private void evictLfu() {
        if (storage.isEmpty()) {
            return;
        }

        // Find least frequently used entry
        K lfuKey = null;
        long minAccess = Long.MAX_VALUE;

        for (Map.Entry<K, CacheEntry<V>> entry : storage.entrySet()) {
            if (entry.getValue().getAccessCount() < minAccess) {
                minAccess = entry.getValue().getAccessCount();
                lfuKey = entry.getKey();
            }
        }

        if (lfuKey != null) {
            storage.remove(lfuKey);
            accessOrder.remove(lfuKey);
            recordEviction();
        }
    }
}
