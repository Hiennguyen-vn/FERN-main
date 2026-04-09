package com.natsu.common.model.cache;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * Tests for CacheKey.
 */
class CacheKeyTest {

    @Test
    void testSimpleKey() {
        CacheKey key = CacheKey.of("users");
        
        assertEquals("users", key.toKeyString());
        assertEquals("users", key.getNamespace());
    }

    @Test
    void testKeyWithParams() {
        CacheKey key = CacheKey.of("users", 123);
        
        assertEquals("users:123", key.toKeyString());
    }

    @Test
    void testKeyWithMultipleParams() {
        CacheKey key = CacheKey.of("users", 123, "profile", "avatar");
        
        assertEquals("users:123:profile:avatar", key.toKeyString());
    }

    @Test
    void testKeyBuilder() {
        CacheKey key = CacheKey.builder("orders")
                .param("user", 123)
                .param("status", "pending")
                .param("page", 1)
                .build();
        
        assertEquals("orders:user=123:status=pending:page=1", key.toKeyString());
    }

    @Test
    void testKeyBuilderSimpleParams() {
        CacheKey key = CacheKey.builder("products")
                .param("electronics")
                .param(42)
                .build();
        
        assertEquals("products:electronics:42", key.toKeyString());
    }

    @Test
    void testKeyAppend() {
        CacheKey base = CacheKey.of("users", 123);
        CacheKey extended = base.append("profile", "settings");
        
        assertEquals("users:123", base.toKeyString());
        assertEquals("users:123:profile:settings", extended.toKeyString());
    }

    @Test
    void testKeyEquality() {
        CacheKey key1 = CacheKey.of("users", 123);
        CacheKey key2 = CacheKey.of("users", 123);
        CacheKey key3 = CacheKey.of("users", 456);
        
        assertEquals(key1, key2);
        assertNotEquals(key1, key3);
        assertEquals(key1.hashCode(), key2.hashCode());
    }

    @Test
    void testKeyToString() {
        CacheKey key = CacheKey.of("users", 123);
        
        assertEquals("users:123", key.toString());
    }

    @Test
    void testKeyGetParams() {
        CacheKey key = CacheKey.of("users", 123, "profile");
        
        Object[] params = key.getParams();
        assertEquals(2, params.length);
        assertEquals(123, params[0]);
        assertEquals("profile", params[1]);
    }

    @Test
    void testCustomSeparator() {
        CacheKey key = CacheKey.builder("users")
                .separator("/")
                .param(123)
                .param("profile")
                .build();
        
        assertEquals("users/123/profile", key.toKeyString());
    }
}
