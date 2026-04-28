package com.fern.common.idempotency;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fern.common.idempotency.model.IdempotencyResult;
import com.fern.common.idempotency.model.TtlPolicy;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

class IdempotencyGuardTest {

  @Test
  void redisReplayComparesRequestHashAndReturnsRawResponseBody() throws Exception {
    JedisPool redisPool = mock(JedisPool.class);
    Jedis jedis = mock(Jedis.class);
    when(redisPool.getResource()).thenReturn(jedis);

    String requestBody = "{\"saleId\":1001}";
    String responseBody = "{\"id\":\"1001\",\"status\":\"order_created\"}";
    String cached = new ObjectMapper().writeValueAsString(Map.of(
        "h", sha256(requestBody),
        "c", 201,
        "b", responseBody,
        "r", "1001"
    ));
    when(jedis.get("idem:l1:sales-service:key-1")).thenReturn(cached);

    IdempotencyGuard guard = new IdempotencyGuard(redisPool, mock(DataSource.class));
    IdempotencyResult result = guard.execute(
        "sales-service",
        "key-1",
        requestBody,
        TtlPolicy.BET,
        () -> IdempotencyResult.created("{}", "should-not-run")
    );

    assertEquals(true, result.replay());
    assertEquals(201, result.responseCode());
    assertEquals(responseBody, result.responseBody());
    assertEquals("1001", result.resourceId());
  }

  @Test
  void l2StartedRowThrowsRetryableInProgressWithoutRunningHandler() throws Exception {
    JedisPool redisPool = mock(JedisPool.class);
    when(redisPool.getResource()).thenThrow(new RuntimeException("redis down"));

    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:idempotency_started;DB_CLOSE_DELAY=-1");
    try (Connection conn = dataSource.getConnection()) {
      conn.createStatement().execute("""
          CREATE TABLE idempotency_keys (
            service_name VARCHAR(128) NOT NULL,
            idempotency_key VARCHAR(128) NOT NULL,
            request_hash VARCHAR(128) NOT NULL,
            status VARCHAR(32) NOT NULL,
            response_code INT,
            response_body VARCHAR,
            resource_id VARCHAR(128),
            expires_at TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (service_name, idempotency_key)
          )
          """);
      try (PreparedStatement ps = conn.prepareStatement("""
          INSERT INTO idempotency_keys
            (service_name, idempotency_key, request_hash, status, expires_at)
          VALUES (?, ?, ?, 'started', ?)
          """)) {
        ps.setString(1, "sales-service");
        ps.setString(2, "key-2");
        ps.setString(3, sha256("{\"saleId\":1002}"));
        ps.setTimestamp(4, Timestamp.from(Instant.now().plusSeconds(300)));
        ps.executeUpdate();
      }
    }

    IdempotencyGuard guard = new IdempotencyGuard(redisPool, dataSource);

    assertThrows(IdempotencyInProgressException.class, () -> guard.execute(
        "sales-service",
        "key-2",
        "{\"saleId\":1002}",
        TtlPolicy.BET,
        () -> {
          throw new AssertionError("handler must not run while idempotency key is in progress");
        }
    ));
  }

  private static String sha256(String input) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-256");
    return HexFormat.of().formatHex(md.digest(input.getBytes(StandardCharsets.UTF_8)));
  }
}
