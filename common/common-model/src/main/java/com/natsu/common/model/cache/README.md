# Cache Module

A flexible caching abstraction supporting in-memory, Redis, and tiered caching with configurable eviction policies and TTL.

## Overview

The cache module provides:
- **Multiple Backends**: In-memory (Caffeine-like), Redis, Tiered (L1+L2)
- **Eviction Policies**: LRU, LFU, FIFO, TTL-based
- **TTL Support**: Per-entry and default time-to-live
- **Statistics**: Hit/miss rates, eviction counts
- **Unified Configuration**: `CacheConfig` with ServicesRegistry integration
- **Annotations**: `@Cacheable`, `@CacheEvict`, `@CachePut` for declarative caching

## Architecture

```
cache/
├── Cache.java              # Core cache interface
├── AbstractCache.java      # Base implementation
├── CacheConfig.java        # Configuration (implements ServiceConfig)
├── CacheManager.java       # Factory and registry
├── CacheEntry.java         # Cache entry wrapper
├── CacheKey.java           # Key abstraction
├── CacheStats.java         # Statistics
├── CacheSerializer.java    # Serialization for distributed caches
├── CacheException.java     # Cache-specific exception
├── InMemoryCache.java      # Local in-memory implementation
├── RedisCache.java         # Redis-backed implementation
├── RedisClientAdapter.java # Redis client adapter interface
├── TieredCache.java        # L1 (local) + L2 (distributed) cache
└── annotation/             # Caching annotations
    ├── Cacheable.java
    ├── CacheEvict.java
    ├── CachePut.java
    └── CacheConfig.java
```

## Quick Start

### Basic Usage

```java
// Get or create a cache
Cache<String, User> userCache = CacheManager.getCache("users");

// Put and get
userCache.put("user:123", user);
User cached = userCache.get("user:123");

// Get with loader (compute if absent)
User user = userCache.get("user:456", key -> userService.findById("456"));

// Check and remove
boolean exists = userCache.containsKey("user:123");
userCache.remove("user:123");

// Bulk operations
Map<String, User> users = userCache.getAll(Set.of("user:1", "user:2", "user:3"));
userCache.putAll(Map.of("user:1", user1, "user:2", user2));

// Clear
userCache.clear();
```

### With Configuration

```java
CacheConfig config = CacheConfig.builder("sessions")
    .maxSize(10000)
    .defaultTtl(Duration.ofMinutes(30))
    .maxIdleTime(Duration.ofMinutes(10))
    .evictionPolicy(EvictionPolicy.LRU)
    .recordStats(true)
    .build();

Cache<String, Session> sessionCache = CacheManager.getCache(config);
```

## Configuration

### CacheConfig

```java
CacheConfig config = CacheConfig.builder("myCache")
    // Size limits
    .maxSize(10000)                              // Max entries
    
    // Time-to-live
    .defaultTtl(Duration.ofMinutes(30))          // Default TTL
    .maxIdleTime(Duration.ofMinutes(10))         // Evict if not accessed
    
    // Eviction policy
    .evictionPolicy(EvictionPolicy.LRU)          // LRU, LFU, FIFO, TTL, NONE
    
    // Reference types (for memory-sensitive caching)
    .softValues(true)                            // Use soft references for values
    .weakKeys(false)                             // Use weak references for keys
    
    // Performance
    .concurrencyLevel(16)                        // Internal lock striping
    .recordStats(true)                           // Enable statistics
    
    .build();
```

### Eviction Policies

```java
// Least Recently Used (default)
.evictionPolicy(EvictionPolicy.LRU)

// Least Frequently Used
.evictionPolicy(EvictionPolicy.LFU)

// First In First Out
.evictionPolicy(EvictionPolicy.FIFO)

// TTL-based only (no size eviction)
.evictionPolicy(EvictionPolicy.TTL)

// No eviction (throws when full)
.evictionPolicy(EvictionPolicy.NONE)
```

## ServicesRegistry Integration

```java
// Register configuration
ServicesRegistry.register(CacheConfig.builder("session")
    .maxSize(10000)
    .defaultTtl(Duration.ofMinutes(30))
    .build());

// Create from registry
Cache<String, Session> cache = CacheManager.getCacheFromRegistry("session");

// Create all registered caches
CacheManager.createAllFromRegistry();
```

## CacheManager

```java
// Get or create with default config
Cache<String, User> cache = CacheManager.getCache("users");

// Get or create with custom config
Cache<String, Session> cache = CacheManager.getCache(config);

// Get existing only (returns null if not found)
Cache<String, User> cache = CacheManager.getExistingCache("users");

// Check existence
boolean exists = CacheManager.hasCache("users");

// Remove cache
CacheManager.removeCache("users");
CacheManager.clearCache("users");  // Clear entries only

// Clear all
CacheManager.clearAll();
CacheManager.shutdown();

// Custom factory (e.g., for Redis)
CacheManager.setCacheFactory(config -> new RedisCache<>(config, redisAdapter));
CacheManager.resetCacheFactory();  // Back to InMemoryCache

// Get all stats
Map<String, CacheStats> allStats = CacheManager.getAllStats();
```

## Cache Implementations

### InMemoryCache

```java
// Default - uses CacheManager
Cache<String, User> cache = CacheManager.getCache("users");

// Direct creation
InMemoryCache<String, User> cache = new InMemoryCache<>(config);
```

### RedisCache

```java
// Create Redis adapter
RedisClientAdapter adapter = new JedisAdapter(jedisPool);

// Create Redis cache
RedisCache<String, User> cache = new RedisCache<>(config, adapter);

// Or set as default factory
CacheManager.setCacheFactory(cfg -> new RedisCache<>(cfg, adapter));
```

### TieredCache

Combines local L1 cache with distributed L2 cache:

```java
Cache<String, User> l1 = new InMemoryCache<>(CacheConfig.builder("l1")
    .maxSize(1000)
    .defaultTtl(Duration.ofMinutes(5))
    .build());

Cache<String, User> l2 = new RedisCache<>(CacheConfig.builder("l2")
    .defaultTtl(Duration.ofHours(1))
    .build(), redisAdapter);

TieredCache<String, User> tiered = new TieredCache<>(l1, l2);

// Gets check L1 first, then L2, populating L1 on L2 hit
User user = tiered.get("user:123");
```

## Statistics

```java
CacheStats stats = cache.getStats();

// Hit/miss metrics
long hits = stats.getHitCount();
long misses = stats.getMissCount();
double hitRate = stats.getHitRate();

// Load metrics
long loadSuccessCount = stats.getLoadSuccessCount();
long loadFailureCount = stats.getLoadFailureCount();
long totalLoadTime = stats.getTotalLoadTime();
double avgLoadPenalty = stats.getAverageLoadPenalty();

// Eviction metrics
long evictionCount = stats.getEvictionCount();

// Size
long size = cache.size();
long estimatedSize = cache.estimatedSize();

// Reset stats
stats.reset();
```

## Annotations (Declarative Caching)

### @Cacheable

```java
@Cacheable(cacheName = "users", key = "#userId")
public User findUser(String userId) {
    // Only called on cache miss
    return userRepository.findById(userId);
}

@Cacheable(cacheName = "users", key = "#user.id", condition = "#user.isActive()")
public UserProfile getProfile(User user) {
    return profileService.loadProfile(user);
}
```

### @CacheEvict

```java
@CacheEvict(cacheName = "users", key = "#userId")
public void deleteUser(String userId) {
    userRepository.deleteById(userId);
}

@CacheEvict(cacheName = "users", allEntries = true)
public void refreshAllUsers() {
    // Clears entire cache
}
```

### @CachePut

```java
@CachePut(cacheName = "users", key = "#user.id")
public User updateUser(User user) {
    // Always executes and updates cache
    return userRepository.save(user);
}
```

## Redis Client Adapter

```java
public class JedisAdapter implements RedisClientAdapter {
    private final JedisPool pool;
    
    @Override
    public String get(String key) {
        try (Jedis jedis = pool.getResource()) {
            return jedis.get(key);
        }
    }
    
    @Override
    public void set(String key, String value, long ttlSeconds) {
        try (Jedis jedis = pool.getResource()) {
            jedis.setex(key, ttlSeconds, value);
        }
    }
    
    @Override
    public void delete(String key) {
        try (Jedis jedis = pool.getResource()) {
            jedis.del(key);
        }
    }
    
    @Override
    public boolean exists(String key) {
        try (Jedis jedis = pool.getResource()) {
            return jedis.exists(key);
        }
    }
    
    @Override
    public Set<String> keys(String pattern) {
        try (Jedis jedis = pool.getResource()) {
            return jedis.keys(pattern);
        }
    }
}
```

## Serialization

```java
// JSON serializer (default for RedisCache)
CacheSerializer serializer = CacheSerializer.json();

// Custom serializer
CacheSerializer custom = new CacheSerializer() {
    @Override
    public String serialize(Object value) {
        // Custom serialization
    }
    
    @Override
    public <T> T deserialize(String data, Class<T> type) {
        // Custom deserialization
    }
};
```

## Exception Handling

```java
try {
    User user = cache.get("user:123", key -> {
        throw new UserNotFoundException(key);
    });
} catch (CacheException e) {
    if (e.getCause() instanceof UserNotFoundException) {
        // Handle missing user
    }
}
```

## Cache Comparison

| Feature | InMemoryCache | RedisCache | TieredCache |
|---------|---------------|------------|-------------|
| Speed | Fastest | Fast | Fast (L1) / Fast (L2) |
| Distributed | No | Yes | Yes (L2) |
| Persistence | No | Optional | Optional (L2) |
| Memory | JVM Heap | External | Both |
| Use Case | Single JVM | Distributed | High-perf Distributed |

## Best Practices

1. **Choose appropriate TTL**: Balance freshness vs. cache hit rate
2. **Size limits**: Always set `maxSize` to prevent OOM
3. **Use soft references**: For memory-sensitive caching with `softValues(true)`
4. **Monitor stats**: Enable `recordStats(true)` and monitor hit rates
5. **Use tiered caching**: L1 in-memory + L2 Redis for best performance

## Testing

```java
@BeforeEach
void setUp() {
    CacheManager.shutdown();
    CacheManager.resetCacheFactory();
}

@Test
void testCacheHit() {
    Cache<String, String> cache = CacheManager.getCache("test");
    
    cache.put("key", "value");
    assertEquals("value", cache.get("key"));
    
    CacheStats stats = cache.getStats();
    assertEquals(1, stats.getHitCount());
}

@Test
void testCacheMiss() {
    Cache<String, String> cache = CacheManager.getCache("test");
    
    assertNull(cache.get("missing"));
    
    CacheStats stats = cache.getStats();
    assertEquals(1, stats.getMissCount());
}
```

## Thread Safety

- All cache implementations are thread-safe
- Concurrent reads and writes are supported
- Use `computeIfAbsent` pattern for atomic get-or-load operations
