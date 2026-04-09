package com.dorabets.common.spring.cache;

import com.natsu.common.model.cache.RedisClientAdapter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.params.SetParams;
import redis.clients.jedis.params.ScanParams;
import redis.clients.jedis.resps.ScanResult;

public class JedisRedisClientAdapter implements RedisClientAdapter {

  private final JedisPool jedisPool;

  public JedisRedisClientAdapter(JedisPool jedisPool) {
    this.jedisPool = jedisPool;
  }

  @Override
  public byte[] get(String key) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.get(key.getBytes());
    }
  }

  @Override
  public void set(String key, byte[] value) {
    try (Jedis jedis = jedisPool.getResource()) {
      jedis.set(key.getBytes(), value);
    }
  }

  @Override
  public void setex(String key, byte[] value, long seconds) {
    try (Jedis jedis = jedisPool.getResource()) {
      jedis.setex(key.getBytes(), seconds, value);
    }
  }

  @Override
  public boolean setnx(String key, byte[] value) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.set(key.getBytes(), value, SetParams.setParams().nx()) != null;
    }
  }

  @Override
  public boolean setnx(String key, byte[] value, long seconds) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.set(key.getBytes(), value, SetParams.setParams().nx().ex(seconds)) != null;
    }
  }

  @Override
  public List<byte[]> mget(String... keys) {
    if (keys == null || keys.length == 0) {
      return List.of();
    }
    try (Jedis jedis = jedisPool.getResource()) {
      byte[][] rawKeys = new byte[keys.length][];
      for (int i = 0; i < keys.length; i++) {
        rawKeys[i] = keys[i].getBytes();
      }
      return new ArrayList<>(jedis.mget(rawKeys));
    }
  }

  @Override
  public void mset(Map<String, byte[]> entries) {
    if (entries == null || entries.isEmpty()) {
      return;
    }
    try (Jedis jedis = jedisPool.getResource()) {
      byte[][] rawEntries = new byte[entries.size() * 2][];
      int index = 0;
      for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
        rawEntries[index++] = entry.getKey().getBytes();
        rawEntries[index++] = entry.getValue();
      }
      jedis.mset(rawEntries);
    }
  }

  @Override
  public long del(String key) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.del(key);
    }
  }

  @Override
  public long del(String... keys) {
    if (keys == null || keys.length == 0) {
      return 0;
    }
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.del(keys);
    }
  }

  @Override
  public boolean exists(String key) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.exists(key);
    }
  }

  @Override
  public boolean expire(String key, long seconds) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.expire(key, seconds) == 1L;
    }
  }

  @Override
  public long ttl(String key) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.ttl(key);
    }
  }

  @Override
  public Set<String> keys(String pattern) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.keys(pattern);
    }
  }

  @Override
  public Set<String> scan(String pattern, int count) {
    try (Jedis jedis = jedisPool.getResource()) {
      Set<String> keys = new HashSet<>();
      String cursor = ScanParams.SCAN_POINTER_START;
      ScanParams params = new ScanParams().match(pattern).count(count);
      do {
        ScanResult<String> result = jedis.scan(cursor, params);
        keys.addAll(result.getResult());
        cursor = result.getCursor();
      } while (!ScanParams.SCAN_POINTER_START.equals(cursor));
      return keys;
    }
  }

  @Override
  public byte[] hget(String key, String field) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.hget(key.getBytes(), field.getBytes());
    }
  }

  @Override
  public void hset(String key, String field, byte[] value) {
    try (Jedis jedis = jedisPool.getResource()) {
      jedis.hset(key.getBytes(), field.getBytes(), value);
    }
  }

  @Override
  public Map<String, byte[]> hgetall(String key) {
    try (Jedis jedis = jedisPool.getResource()) {
      Map<byte[], byte[]> raw = jedis.hgetAll(key.getBytes());
      Map<String, byte[]> values = new HashMap<>();
      raw.forEach((field, value) -> values.put(new String(field), value));
      return values;
    }
  }

  @Override
  public long hdel(String key, String... fields) {
    try (Jedis jedis = jedisPool.getResource()) {
      byte[][] raw = new byte[fields.length][];
      for (int i = 0; i < fields.length; i++) {
        raw[i] = fields[i].getBytes();
      }
      return jedis.hdel(key.getBytes(), raw);
    }
  }

  @Override
  public long publish(String channel, byte[] message) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.publish(channel.getBytes(), message);
    }
  }

  @Override
  public String ping() {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.ping();
    }
  }

  @Override
  public void close() {
    jedisPool.close();
  }
}
