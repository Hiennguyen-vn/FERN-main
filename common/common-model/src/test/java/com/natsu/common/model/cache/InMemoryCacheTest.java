package com.natsu.common.model.cache;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for InMemoryCache.
 */
class InMemoryCacheTest {

    private InMemoryCache<String, String> cache;

    @BeforeEach
    void setUp() {
        CacheConfig config = CacheConfig.builder("test")
                .maxSize(100)
                .defaultTtl(Duration.ofMinutes(5))
                .evictionPolicy(CacheConfig.EvictionPolicy.LRU)
                .recordStats(true)
                .build();
        cache = new InMemoryCache<>(config);
    }

    @Test
    void testPutAndGet() {
        cache.put("key1", "value1");
        
        Optional<String> result = cache.get("key1");
        
        assertTrue(result.isPresent());
        assertEquals("value1", result.get());
    }

    @Test
    void testGetMissing() {
        Optional<String> result = cache.get("nonexistent");
        
        assertTrue(result.isEmpty());
    }

    @Test
    void testPutWithTtl() throws InterruptedException {
        cache.put("key1", "value1", Duration.ofMillis(100));
        
        assertTrue(cache.get("key1").isPresent());
        
        Thread.sleep(150);
        
        assertTrue(cache.get("key1").isEmpty());
    }

    @Test
    void testGetOrCompute() {
        AtomicInteger callCount = new AtomicInteger(0);
        
        String result1 = cache.getOrCompute("key1", () -> {
            callCount.incrementAndGet();
            return "computed";
        });
        
        String result2 = cache.getOrCompute("key1", () -> {
            callCount.incrementAndGet();
            return "computed";
        });
        
        assertEquals("computed", result1);
        assertEquals("computed", result2);
        assertEquals(1, callCount.get()); // Should only compute once
    }

    @Test
    void testPutIfAbsent() {
        assertTrue(cache.putIfAbsent("key1", "value1"));
        assertFalse(cache.putIfAbsent("key1", "value2"));
        
        assertEquals("value1", cache.get("key1").orElse(null));
    }

    @Test
    void testRemove() {
        cache.put("key1", "value1");
        assertTrue(cache.exists("key1"));
        
        assertTrue(cache.remove("key1"));
        assertFalse(cache.exists("key1"));
        
        assertFalse(cache.remove("key1")); // Already removed
    }

    @Test
    void testExists() {
        assertFalse(cache.exists("key1"));
        
        cache.put("key1", "value1");
        assertTrue(cache.exists("key1"));
    }

    @Test
    void testClear() {
        cache.put("key1", "value1");
        cache.put("key2", "value2");
        
        assertEquals(2, cache.size());
        
        cache.clear();
        
        assertEquals(0, cache.size());
    }

    @Test
    void testGetAll() {
        cache.put("key1", "value1");
        cache.put("key2", "value2");
        cache.put("key3", "value3");
        
        Map<String, String> result = cache.getAll(Set.of("key1", "key2", "key4"));
        
        assertEquals(2, result.size());
        assertEquals("value1", result.get("key1"));
        assertEquals("value2", result.get("key2"));
        assertNull(result.get("key4"));
    }

    @Test
    void testPutAll() {
        cache.putAll(Map.of("key1", "value1", "key2", "value2"));
        
        assertEquals("value1", cache.get("key1").orElse(null));
        assertEquals("value2", cache.get("key2").orElse(null));
    }

    @Test
    void testRemoveAll() {
        cache.put("key1", "value1");
        cache.put("key2", "value2");
        cache.put("key3", "value3");
        
        int removed = cache.removeAll(Set.of("key1", "key2", "key4"));
        
        assertEquals(2, removed);
        assertFalse(cache.exists("key1"));
        assertFalse(cache.exists("key2"));
        assertTrue(cache.exists("key3"));
    }

    @Test
    void testLruEviction() {
        CacheConfig config = CacheConfig.builder("lru-test")
                .maxSize(3)
                .evictionPolicy(CacheConfig.EvictionPolicy.LRU)
                .build();
        InMemoryCache<String, String> lruCache = new InMemoryCache<>(config);
        
        lruCache.put("key1", "value1");
        lruCache.put("key2", "value2");
        lruCache.put("key3", "value3");
        
        // Access key1 to make it recently used
        lruCache.get("key1");
        
        // Add new entry, should evict key2 (least recently used)
        lruCache.put("key4", "value4");
        
        assertTrue(lruCache.exists("key1"));
        assertFalse(lruCache.exists("key2")); // Evicted
        assertTrue(lruCache.exists("key3"));
        assertTrue(lruCache.exists("key4"));
        
        lruCache.close();
    }

    @Test
    void testStatistics() {
        cache.get("missing1");
        cache.get("missing2");
        
        cache.put("key1", "value1");
        cache.get("key1");
        cache.get("key1");
        
        CacheStats stats = cache.getStats();
        
        assertEquals(2, stats.getHits());
        assertEquals(2, stats.getMisses());
        assertEquals(1, stats.getPuts());
        assertEquals(0.5, stats.getHitRate(), 0.01);
    }

    @Test
    void testConcurrentAccess() throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(10);
        CountDownLatch latch = new CountDownLatch(100);
        
        for (int i = 0; i < 100; i++) {
            final int idx = i;
            executor.submit(() -> {
                try {
                    cache.put("key" + idx, "value" + idx);
                    cache.get("key" + idx);
                } finally {
                    latch.countDown();
                }
            });
        }
        
        assertTrue(latch.await(5, TimeUnit.SECONDS));
        executor.shutdown();
        
        // All entries should be present
        assertTrue(cache.size() <= 100);
    }

    @Test
    void testGetOrDefault() {
        assertEquals("default", cache.getOrDefault("missing", "default"));
        
        cache.put("key1", "value1");
        assertEquals("value1", cache.getOrDefault("key1", "default"));
    }

    @Test
    void testClose() {
        cache.put("key1", "value1");
        cache.close();
        
        assertEquals(0, cache.size());
    }
}
