package com.natsu.common.model.cache;

import java.time.Duration;
import java.util.*;
import java.util.function.Supplier;

/**
 * Redis-based cache implementation.
 * Requires a Redis client adapter to be provided.
 *
 * <p>
 * Usage:
 * 
 * <pre>
 * // With Jedis
 * RedisClientAdapter adapter = new JedisClientAdapter(jedisPool);
 * Cache&lt;String, User&gt; cache = new RedisCache&lt;&gt;("users", adapter, userSerializer);
 *
 * // With Lettuce
 * RedisClientAdapter adapter = new LettuceClientAdapter(redisClient);
 * Cache&lt;String, User&gt; cache = new RedisCache&lt;&gt;("users", adapter, userSerializer);
 * </pre>
 *
 * @param <V> the value type
 */
public class RedisCache<V> extends AbstractCache<String, V> {

    private final RedisClientAdapter redisClient;
    private final CacheSerializer<V> serializer;
    private final String keyPrefix;

    /**
     * Creates a Redis cache with default configuration.
     *
     * @param name        the cache name
     * @param redisClient the Redis client adapter
     * @param serializer  the value serializer
     */
    public RedisCache(String name, RedisClientAdapter redisClient, CacheSerializer<V> serializer) {
        super(name);
        this.redisClient = redisClient;
        this.serializer = serializer;
        this.keyPrefix = name + ":";
    }

    /**
     * Creates a Redis cache with custom configuration.
     *
     * @param config      the cache configuration
     * @param redisClient the Redis client adapter
     * @param serializer  the value serializer
     */
    public RedisCache(CacheConfig config, RedisClientAdapter redisClient, CacheSerializer<V> serializer) {
        super(config);
        this.redisClient = redisClient;
        this.serializer = serializer;
        this.keyPrefix = config.getName() + ":";
    }

    @Override
    public Optional<V> get(String key) {
        if (key == null) {
            recordMiss();
            return Optional.empty();
        }

        try {
            String fullKey = keyPrefix + key;
            byte[] data = redisClient.get(fullKey);

            if (data == null) {
                recordMiss();
                return Optional.empty();
            }

            V value = serializer.deserialize(data);
            recordHit();
            return Optional.ofNullable(value);
        } catch (Exception e) {
            recordMiss();
            throw new CacheException(name, key, "Failed to get from Redis", e);
        }
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

        try {
            String fullKey = keyPrefix + key;
            byte[] data = serializer.serialize(value);

            Duration effectiveTtl = ttl != null ? ttl : config.getDefaultTtl();
            if (effectiveTtl != null && !effectiveTtl.isZero() && !effectiveTtl.isNegative()) {
                redisClient.setex(fullKey, data, effectiveTtl.getSeconds());
            } else {
                redisClient.set(fullKey, data);
            }
            recordPut();
        } catch (Exception e) {
            throw new CacheException(name, key, "Failed to put to Redis", e);
        }
    }

    @Override
    public boolean putIfAbsent(String key, V value, Duration ttl) {
        if (key == null || value == null) {
            return false;
        }

        try {
            String fullKey = keyPrefix + key;
            byte[] data = serializer.serialize(value);

            Duration effectiveTtl = ttl != null ? ttl : config.getDefaultTtl();
            boolean success;
            if (effectiveTtl != null && !effectiveTtl.isZero()) {
                success = redisClient.setnx(fullKey, data, effectiveTtl.getSeconds());
            } else {
                success = redisClient.setnx(fullKey, data);
            }

            if (success) {
                recordPut();
            }
            return success;
        } catch (Exception e) {
            throw new CacheException(name, key, "Failed to putIfAbsent to Redis", e);
        }
    }

    @Override
    public boolean remove(String key) {
        if (key == null) {
            return false;
        }

        try {
            String fullKey = keyPrefix + key;
            return redisClient.del(fullKey) > 0;
        } catch (Exception e) {
            throw new CacheException(name, key, "Failed to remove from Redis", e);
        }
    }

    @Override
    public boolean exists(String key) {
        if (key == null) {
            return false;
        }

        try {
            String fullKey = keyPrefix + key;
            return redisClient.exists(fullKey);
        } catch (Exception e) {
            throw new CacheException(name, key, "Failed to check existence in Redis", e);
        }
    }

    @Override
    public Map<String, V> getAll(Set<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return Map.of();
        }

        try {
            String[] fullKeys = keys.stream()
                    .map(k -> keyPrefix + k)
                    .toArray(String[]::new);

            List<byte[]> values = redisClient.mget(fullKeys);
            Map<String, V> result = new HashMap<>();

            int i = 0;
            for (String key : keys) {
                byte[] data = values.get(i++);
                if (data != null) {
                    result.put(key, serializer.deserialize(data));
                    recordHit();
                } else {
                    recordMiss();
                }
            }

            return result;
        } catch (Exception e) {
            throw new CacheException(name, "Failed to getAll from Redis", e);
        }
    }

    @Override
    public void putAll(Map<String, V> entries, Duration ttl) {
        if (entries == null || entries.isEmpty()) {
            return;
        }

        try {
            Duration effectiveTtl = ttl != null ? ttl : config.getDefaultTtl();
            boolean hasTtl = effectiveTtl != null && !effectiveTtl.isZero() && !effectiveTtl.isNegative();

            for (Map.Entry<String, V> entry : entries.entrySet()) {
                String fullKey = keyPrefix + entry.getKey();
                byte[] data = serializer.serialize(entry.getValue());
                // Use individual SETEX calls to ensure each key is atomically
                // stored with its TTL — prevents orphaned keys without TTL
                // if the process crashes mid-operation.
                if (hasTtl) {
                    redisClient.setex(fullKey, data, effectiveTtl.getSeconds());
                } else {
                    redisClient.set(fullKey, data);
                }
            }

            if (stats != null) {
                stats.recordPuts(entries.size());
            }
        } catch (Exception e) {
            throw new CacheException(name, "Failed to putAll to Redis", e);
        }
    }

    @Override
    public int removeAll(Set<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return 0;
        }

        try {
            String[] fullKeys = keys.stream()
                    .map(k -> keyPrefix + k)
                    .toArray(String[]::new);

            return (int) redisClient.del(fullKeys);
        } catch (Exception e) {
            throw new CacheException(name, "Failed to removeAll from Redis", e);
        }
    }

    @Override
    public void clear() {
        try {
            // Use SCAN (cursor-based) instead of KEYS to avoid blocking the
            // Redis event loop on large keyspaces.
            Set<String> keys = redisClient.scan(keyPrefix + "*", 100);
            if (!keys.isEmpty()) {
                redisClient.del(keys.toArray(new String[0]));
            }
        } catch (Exception e) {
            throw new CacheException(name, "Failed to clear Redis cache", e);
        }
    }

    @Override
    public long size() {
        try {
            // Use SCAN (cursor-based) instead of KEYS to avoid blocking the
            // Redis event loop on large keyspaces.
            Set<String> keys = redisClient.scan(keyPrefix + "*", 100);
            return keys.size();
        } catch (Exception e) {
            throw new CacheException(name, "Failed to get size from Redis", e);
        }
    }

    @Override
    public void close() {
        // Redis client lifecycle is managed externally
    }

    /**
     * Gets the key prefix used for this cache.
     *
     * @return the key prefix
     */
    public String getKeyPrefix() {
        return keyPrefix;
    }

    /**
     * Gets the underlying Redis client adapter.
     *
     * @return the Redis client adapter
     */
    public RedisClientAdapter getRedisClient() {
        return redisClient;
    }

    /**
     * Sets the TTL for an existing key.
     *
     * @param key the cache key
     * @param ttl the new TTL
     * @return true if the TTL was set
     */
    public boolean expire(String key, Duration ttl) {
        if (key == null || ttl == null) {
            return false;
        }

        try {
            String fullKey = keyPrefix + key;
            return redisClient.expire(fullKey, ttl.getSeconds());
        } catch (Exception e) {
            throw new CacheException(name, key, "Failed to set expiry in Redis", e);
        }
    }

    /**
     * Gets the remaining TTL for a key.
     *
     * @param key the cache key
     * @return the remaining TTL, or null if the key doesn't exist or has no TTL
     */
    public Duration getTtl(String key) {
        if (key == null) {
            return null;
        }

        try {
            String fullKey = keyPrefix + key;
            long seconds = redisClient.ttl(fullKey);
            if (seconds < 0) {
                return null; // Key doesn't exist or has no TTL
            }
            return Duration.ofSeconds(seconds);
        } catch (Exception e) {
            throw new CacheException(name, key, "Failed to get TTL from Redis", e);
        }
    }
}
