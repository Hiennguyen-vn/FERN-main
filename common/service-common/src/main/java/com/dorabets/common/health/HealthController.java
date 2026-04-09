package com.dorabets.common.health;

import io.javalin.Javalin;
import redis.clients.jedis.JedisPool;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.LinkedHashMap;
import java.util.Map;

public class HealthController {

    private final String serviceName;
    private final DataSource dataSource;
    private final JedisPool redisPool;

    public HealthController(String serviceName, DataSource dataSource, JedisPool redisPool) {
        this.serviceName = serviceName;
        this.dataSource = dataSource;
        this.redisPool = redisPool;
    }

    public void register(Javalin app) {
        app.get("/health", ctx -> {
            Map<String, Object> health = new LinkedHashMap<>();
            health.put("service", serviceName);
            health.put("status", "UP");
            health.put("timestamp", System.currentTimeMillis());

            Map<String, String> checks = new LinkedHashMap<>();
            checks.put("database", checkDatabase());
            checks.put("redis", checkRedis());
            health.put("checks", checks);

            boolean allUp = checks.values().stream().allMatch("UP"::equals);
            health.put("status", allUp ? "UP" : "DEGRADED");
            ctx.status(allUp ? 200 : 503).json(health);
        });

        app.get("/health/live", ctx -> ctx.json(Map.of("status", "UP")));
        app.get("/health/ready", ctx -> {
            boolean dbUp = "UP".equals(checkDatabase());
            ctx.status(dbUp ? 200 : 503).json(Map.of("status", dbUp ? "UP" : "DOWN"));
        });
    }

    private String checkDatabase() {
        if (dataSource == null) return "NOT_CONFIGURED";
        try (Connection c = dataSource.getConnection()) {
            c.createStatement().execute("SELECT 1");
            return "UP";
        } catch (Exception e) {
            return "DOWN";
        }
    }

    private String checkRedis() {
        if (redisPool == null) return "NOT_CONFIGURED";
        try (var jedis = redisPool.getResource()) {
            return "PONG".equals(jedis.ping()) ? "UP" : "DOWN";
        } catch (Exception e) {
            return "DOWN";
        }
    }
}
