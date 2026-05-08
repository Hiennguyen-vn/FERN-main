package com.fern.common.idempotency;

import com.fern.common.idempotency.model.IdempotencyResult;
import com.fern.common.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.params.SetParams;
import redis.clients.jedis.util.Pool;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.time.Instant;
import java.util.HexFormat;
import java.util.function.Supplier;

/**
 * Two-tier idempotency enforcement.
 * L1 = Redis (fast duplicate drop), L2 = PostgreSQL (durable replay-safe guarantee).
 *
 * Usage:
 *   result = guard.execute("wallet", idemKey, requestBody, TtlPolicy.BET, () -> { ... });
 */
public class IdempotencyGuard {

    private final Pool<Jedis> redisPool;
    private final DataSource dataSource;
    private final ObjectMapper mapper;

    public IdempotencyGuard(Pool<Jedis> redisPool, DataSource dataSource) {
        this.redisPool = redisPool;
        this.dataSource = dataSource;
        this.mapper = new ObjectMapper();
    }

    public IdempotencyResult execute(String serviceName,
                                     String idempotencyKey,
                                     String requestBody,
                                     TtlPolicy ttl,
                                     Supplier<IdempotencyResult> handler) {

        String requestHash = sha256(requestBody);
        String redisKey = "idem:l1:" + serviceName + ":" + idempotencyKey;

        // ── L1 Redis fast-path ──
        try (var jedis = redisPool.getResource()) {
            String cached = jedis.get(redisKey);
            if (cached != null) {
                return replayFromCache(cached, requestHash);
            }
        } catch (Exception ignored) {
            // Redis down → fall through to L2
        }

        // ── L2 PostgreSQL durable check ──
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                IdempotencyResult existing = checkL2(conn, serviceName, idempotencyKey, requestHash);
                if (existing != null) {
                    conn.commit();
                    cacheInRedis(redisKey, requestHash, existing, ttl);
                    return existing;
                }

                insertL2Started(conn, serviceName, idempotencyKey, requestHash, ttl);
                conn.commit();
            } catch (SQLException e) {
                conn.rollback();
                // Unique constraint violation = concurrent insert. Poll for the winner's
                // result so the loser returns the cached response instead of double-executing.
                if ("23505".equals(e.getSQLState())) {
                    conn.setAutoCommit(true);
                    IdempotencyResult existing = null;
                    long backoffMs = 25;
                    for (int attempt = 0; attempt < 6 && existing == null; attempt++) {
                        existing = checkL2(conn, serviceName, idempotencyKey, requestHash);
                        if (existing == null) {
                            try { Thread.sleep(backoffMs); } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                throw new IdempotencyException("Interrupted while resolving idempotency race", ie);
                            }
                            backoffMs = Math.min(backoffMs * 2, 400);
                        }
                    }
                    if (existing != null) return existing;
                }
                throw e;
            }
        } catch (IdempotencyException e) {
            throw e;
        } catch (Exception e) {
            throw new IdempotencyException("L2 check failed", e);
        }

        // ── Execute business logic ──
        IdempotencyResult result;
        try {
            result = handler.get();
        } catch (Exception e) {
            updateL2Status(serviceName, idempotencyKey, "failed", null, 500, null);
            throw e;
        }

        // ── Persist result ──
        updateL2Status(serviceName, idempotencyKey, "completed",
                result.responseBody(), result.responseCode(), result.resourceId());
        cacheInRedis(redisKey, requestHash, result, ttl);

        return result;
    }

    private IdempotencyResult replayFromCache(String cached, String requestHash) {
        try {
            JsonNode node = mapper.readTree(cached);
            String storedHash = node.get("h").asText();
            if (!storedHash.equals(requestHash)) {
                throw new IdempotencyConflictException("Idempotency key reused with different payload");
            }
            return new IdempotencyResult(
                    true,
                    node.get("c").asInt(),
                    node.get("b").asText(),
                    node.has("r") ? node.get("r").asText() : null
            );
        } catch (IdempotencyConflictException e) {
            throw e;
        } catch (Exception e) {
            throw new IdempotencyException("Cache deserialization failed", e);
        }
    }

    private IdempotencyResult checkL2(Connection conn, String serviceName,
                                      String idempotencyKey, String requestHash) throws SQLException {
        String sql = "SELECT request_hash, status, response_code, response_body, resource_id " +
                "FROM idempotency_keys WHERE service_name = ? AND idempotency_key = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, serviceName);
            ps.setString(2, idempotencyKey);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                String storedHash = rs.getString("request_hash").trim();
                if (!storedHash.equals(requestHash)) {
                    throw new IdempotencyConflictException("Idempotency key reused with different payload");
                }
                String status = rs.getString("status");
                if ("started".equals(status)) {
                    throw new IdempotencyInProgressException("Idempotency key is already in progress");
                }
                return new IdempotencyResult(
                        true,
                        rs.getInt("response_code"),
                        rs.getString("response_body"),
                        rs.getString("resource_id")
                );
            }
        }
    }

    private void insertL2Started(Connection conn, String serviceName,
                                 String idempotencyKey, String requestHash, TtlPolicy ttl) throws SQLException {
        String sql = "INSERT INTO idempotency_keys (service_name, idempotency_key, request_hash, status, expires_at) " +
                "VALUES (?, ?, ?, 'started', ?)";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, serviceName);
            ps.setString(2, idempotencyKey);
            ps.setString(3, requestHash);
            ps.setTimestamp(4, Timestamp.from(Instant.now().plusSeconds(ttl.getSeconds())));
            ps.executeUpdate();
        }
    }

    private void updateL2Status(String serviceName, String idempotencyKey,
                                String status, String responseBody, int responseCode, String resourceId) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(
                     "UPDATE idempotency_keys SET status=?, response_code=?, response_body=?::jsonb, " +
                             "resource_id=?, updated_at=now() WHERE service_name=? AND idempotency_key=?")) {
            ps.setString(1, status);
            ps.setInt(2, responseCode);
            ps.setString(3, responseBody);
            ps.setString(4, resourceId);
            ps.setString(5, serviceName);
            ps.setString(6, idempotencyKey);
            ps.executeUpdate();
        } catch (SQLException e) {
            throw new IdempotencyException("L2 status update failed", e);
        }
    }

    private void cacheInRedis(String key, String requestHash, IdempotencyResult result, TtlPolicy ttl) {
        try (var jedis = redisPool.getResource()) {
            String json = mapper.writeValueAsString(new java.util.LinkedHashMap<>() {{
                put("h", requestHash);
                put("c", result.responseCode());
                put("b", result.responseBody());
                put("r", result.resourceId());
            }});
            jedis.set(key, json, SetParams.setParams().ex(ttl.getSeconds()));
        } catch (Exception ignored) {
            // Redis write failure is non-fatal
        }
    }

    /**
     * Recover stuck rows: any row that has been in {@code started} status for longer than
     * {@code stalenessSeconds} is considered orphaned (the owning process crashed between the
     * {@code INSERT status='started'} and the subsequent {@code UPDATE status='completed'}).
     * Such rows are transitioned to {@code failed} so that the next retry can proceed instead
     * of receiving {@link IdempotencyInProgressException} indefinitely until TTL expiry.
     *
     * @param stalenessSeconds minimum age of a {@code started} row (via {@code created_at})
     *                         before it is eligible for recovery; 300 (5 min) is a safe default.
     * @param batchSize        maximum number of rows to update per call.
     * @return number of rows transitioned to {@code failed}.
     */
    public int recoverStuck(int stalenessSeconds, int batchSize) {
        String sql = """
                WITH stuck AS (
                  SELECT service_name, idempotency_key
                  FROM idempotency_keys
                  WHERE status = 'started'
                    AND created_at < NOW() - (? * INTERVAL '1 second')
                  ORDER BY created_at
                  LIMIT ?
                )
                UPDATE idempotency_keys k
                   SET status = 'failed', updated_at = NOW()
                  FROM stuck
                 WHERE k.service_name   = stuck.service_name
                   AND k.idempotency_key = stuck.idempotency_key
                """;
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, stalenessSeconds);
            ps.setInt(2, batchSize);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new IdempotencyException("recoverStuck failed", e);
        }
    }

    private static String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 unavailable", e);
        }
    }
}
