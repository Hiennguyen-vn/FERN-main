package com.natsu.common.model.cache;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for CacheManager.
 */
class CacheManagerTest {

    @BeforeEach
    void setUp() {
        CacheManager.shutdown();
        CacheManager.resetCacheFactory();
    }

    @AfterEach
    void tearDown() {
        CacheManager.shutdown();
    }

    @Test
    void testGetCache() {
        Cache<String, String> cache = CacheManager.getCache("test");
        
        assertNotNull(cache);
        assertEquals("test", cache.getName());
    }

    @Test
    void testGetCacheSameInstance() {
        Cache<String, String> cache1 = CacheManager.getCache("test");
        Cache<String, String> cache2 = CacheManager.getCache("test");
        
        assertSame(cache1, cache2);
    }

    @Test
    void testGetCacheWithConfig() {
        CacheConfig config = CacheConfig.builder("custom")
                .maxSize(500)
                .defaultTtl(Duration.ofMinutes(30))
                .build();
        
        Cache<String, String> cache = CacheManager.getCache(config);
        
        assertNotNull(cache);
        assertEquals("custom", cache.getName());
    }

    @Test
    void testHasCache() {
        assertFalse(CacheManager.hasCache("test"));
        
        CacheManager.getCache("test");
        
        assertTrue(CacheManager.hasCache("test"));
    }

    @Test
    void testRemoveCache() {
        CacheManager.getCache("test");
        assertTrue(CacheManager.hasCache("test"));
        
        assertTrue(CacheManager.removeCache("test"));
        assertFalse(CacheManager.hasCache("test"));
        
        assertFalse(CacheManager.removeCache("test")); // Already removed
    }

    @Test
    void testClearCache() {
        Cache<String, String> cache = CacheManager.getCache("test");
        cache.put("key1", "value1");
        
        assertEquals(1, cache.size());
        
        CacheManager.clearCache("test");
        
        assertEquals(0, cache.size());
    }

    @Test
    void testClearAll() {
        Cache<String, String> cache1 = CacheManager.getCache("test1");
        Cache<String, String> cache2 = CacheManager.getCache("test2");
        
        cache1.put("key1", "value1");
        cache2.put("key2", "value2");
        
        CacheManager.clearAll();
        
        assertEquals(0, cache1.size());
        assertEquals(0, cache2.size());
    }

    @Test
    void testGetCacheNames() {
        CacheManager.getCache("cache1");
        CacheManager.getCache("cache2");
        CacheManager.getCache("cache3");
        
        var names = CacheManager.getCacheNames();
        
        assertEquals(3, names.size());
        assertTrue(names.contains("cache1"));
        assertTrue(names.contains("cache2"));
        assertTrue(names.contains("cache3"));
    }

    @Test
    void testGetExistingCache() {
        assertNull(CacheManager.getExistingCache("test"));
        
        CacheManager.getCache("test");
        
        assertNotNull(CacheManager.getExistingCache("test"));
    }

    @Test
    void testRegisterCache() {
        Cache<String, String> customCache = new InMemoryCache<>("custom");
        
        CacheManager.registerCache(customCache);
        
        assertSame(customCache, CacheManager.getExistingCache("custom"));
    }

    @Test
    void testGetAllStats() {
        Cache<String, String> cache1 = CacheManager.getCache("cache1");
        Cache<String, String> cache2 = CacheManager.getCache("cache2");
        
        cache1.put("key", "value");
        cache1.get("key");
        cache2.get("missing");
        
        var allStats = CacheManager.getAllStats();
        
        assertEquals(2, allStats.size());
        assertNotNull(allStats.get("cache1"));
        assertNotNull(allStats.get("cache2"));
    }

    @Test
    void testShutdown() {
        CacheManager.getCache("test1");
        CacheManager.getCache("test2");
        
        CacheManager.shutdown();
        
        assertTrue(CacheManager.getCacheNames().isEmpty());
    }
}
