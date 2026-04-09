package com.fern.services.masternode.infrastructure;

import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.stereotype.Component;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

@Component
public class ControlPlaneRedisStore {

  private static final String INSTANCE_KEY_PREFIX = "fern:control:instance:";
  private static final String SERVICE_SET_PREFIX = "fern:control:service:";

  private final JedisPool jedisPool;

  public ControlPlaneRedisStore(JedisPool jedisPool) {
    this.jedisPool = jedisPool;
  }

  public void touchInstance(String serviceName, long instanceId, int ttlSeconds) {
    try (Jedis jedis = jedisPool.getResource()) {
      jedis.setex(instanceKey(instanceId), ttlSeconds, "UP");
      jedis.sadd(serviceSetKey(serviceName), Long.toString(instanceId));
      jedis.expire(serviceSetKey(serviceName), Math.max(ttlSeconds * 4L, ttlSeconds));
    }
  }

  public boolean isAlive(long instanceId) {
    try (Jedis jedis = jedisPool.getResource()) {
      return jedis.exists(instanceKey(instanceId));
    }
  }

  public Set<Long> listActiveInstances(String serviceName) {
    try (Jedis jedis = jedisPool.getResource()) {
      Set<Long> instanceIds = new LinkedHashSet<>();
      for (String rawId : jedis.smembers(serviceSetKey(serviceName))) {
        long instanceId = Long.parseLong(rawId);
        if (jedis.exists(instanceKey(instanceId))) {
          instanceIds.add(instanceId);
        } else {
          jedis.srem(serviceSetKey(serviceName), rawId);
        }
      }
      return Set.copyOf(instanceIds);
    }
  }

  public void removeInstance(String serviceName, long instanceId) {
    try (Jedis jedis = jedisPool.getResource()) {
      jedis.del(instanceKey(instanceId));
      jedis.srem(serviceSetKey(serviceName), Long.toString(instanceId));
    }
  }

  private static String instanceKey(long instanceId) {
    return INSTANCE_KEY_PREFIX + instanceId;
  }

  private static String serviceSetKey(String serviceName) {
    return SERVICE_SET_PREFIX + serviceName;
  }
}
