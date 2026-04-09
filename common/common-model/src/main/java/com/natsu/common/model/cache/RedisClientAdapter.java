package com.natsu.common.model.cache;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Adapter interface for Redis clients.
 * Implementations can wrap Jedis, Lettuce, or other Redis clients.
 *
 * <p>Example Jedis implementation:
 * <pre>
 * public class JedisClientAdapter implements RedisClientAdapter {
 *     private final JedisPool pool;
 *
 *     public byte[] get(String key) {
 *         try (Jedis jedis = pool.getResource()) {
 *             return jedis.get(key.getBytes());
 *         }
 *     }
 *     // ... other methods
 * }
 * </pre>
 */
public interface RedisClientAdapter {

    // ==================== String Operations ====================

    /**
     * Gets a value by key.
     *
     * @param key the key
     * @return the value bytes, or null if not found
     */
    byte[] get(String key);

    /**
     * Sets a value.
     *
     * @param key the key
     * @param value the value bytes
     */
    void set(String key, byte[] value);

    /**
     * Sets a value with expiration.
     *
     * @param key the key
     * @param value the value bytes
     * @param seconds the TTL in seconds
     */
    void setex(String key, byte[] value, long seconds);

    /**
     * Sets a value only if it doesn't exist.
     *
     * @param key the key
     * @param value the value bytes
     * @return true if the value was set
     */
    boolean setnx(String key, byte[] value);

    /**
     * Sets a value with NX (not exists) and expiration.
     *
     * @param key the key
     * @param value the value bytes
     * @param seconds the TTL in seconds
     * @return true if the value was set
     */
    boolean setnx(String key, byte[] value, long seconds);

    /**
     * Gets multiple values.
     *
     * @param keys the keys
     * @return list of values (null for missing keys)
     */
    List<byte[]> mget(String... keys);

    /**
     * Sets multiple values.
     *
     * @param entries map of key to value bytes
     */
    void mset(Map<String, byte[]> entries);

    // ==================== Key Operations ====================

    /**
     * Deletes a key.
     *
     * @param key the key
     * @return 1 if deleted, 0 if not found
     */
    long del(String key);

    /**
     * Deletes multiple keys.
     *
     * @param keys the keys
     * @return number of keys deleted
     */
    long del(String... keys);

    /**
     * Checks if a key exists.
     *
     * @param key the key
     * @return true if exists
     */
    boolean exists(String key);

    /**
     * Sets a key's TTL.
     *
     * @param key the key
     * @param seconds the TTL in seconds
     * @return true if the timeout was set
     */
    boolean expire(String key, long seconds);

    /**
     * Gets a key's remaining TTL.
     *
     * @param key the key
     * @return TTL in seconds, -1 if no TTL, -2 if key doesn't exist
     */
    long ttl(String key);

    /**
     * Finds all keys matching a pattern.
     * Note: Use with caution in production, prefer SCAN.
     *
     * @param pattern the pattern (e.g., "prefix:*")
     * @return the matching keys
     */
    Set<String> keys(String pattern);

    /**
     * Scans for keys matching a pattern.
     * More efficient than KEYS for large datasets.
     *
     * @param pattern the pattern
     * @param count hint for number of keys to return per scan
     * @return the matching keys
     */
    default Set<String> scan(String pattern, int count) {
        return keys(pattern); // Default fallback to keys()
    }

    // ==================== Hash Operations ====================

    /**
     * Gets a hash field value.
     *
     * @param key the hash key
     * @param field the field name
     * @return the field value, or null
     */
    default byte[] hget(String key, String field) {
        throw new UnsupportedOperationException("Hash operations not supported");
    }

    /**
     * Sets a hash field value.
     *
     * @param key the hash key
     * @param field the field name
     * @param value the value bytes
     */
    default void hset(String key, String field, byte[] value) {
        throw new UnsupportedOperationException("Hash operations not supported");
    }

    /**
     * Gets all fields from a hash.
     *
     * @param key the hash key
     * @return map of field to value
     */
    default Map<String, byte[]> hgetall(String key) {
        throw new UnsupportedOperationException("Hash operations not supported");
    }

    /**
     * Deletes hash fields.
     *
     * @param key the hash key
     * @param fields the fields to delete
     * @return number of fields deleted
     */
    default long hdel(String key, String... fields) {
        throw new UnsupportedOperationException("Hash operations not supported");
    }

    // ==================== Pub/Sub Operations ====================

    /**
     * Publishes a message to a channel.
     *
     * @param channel the channel name
     * @param message the message bytes
     * @return number of subscribers that received the message
     */
    default long publish(String channel, byte[] message) {
        throw new UnsupportedOperationException("Pub/Sub operations not supported");
    }

    // ==================== Connection ====================

    /**
     * Pings the Redis server.
     *
     * @return "PONG" if successful
     */
    String ping();

    /**
     * Closes the connection/pool.
     */
    void close();

    /**
     * Checks if the client is connected and healthy.
     *
     * @return true if healthy
     */
    default boolean isHealthy() {
        try {
            return "PONG".equals(ping());
        } catch (Exception e) {
            return false;
        }
    }
}
