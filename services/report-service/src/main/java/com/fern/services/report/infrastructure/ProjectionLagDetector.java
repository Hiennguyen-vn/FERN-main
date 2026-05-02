package com.fern.services.report.infrastructure;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Detects ClickHouse projection lag. Returns true if events lag exceeds threshold,
 * caller should fall back to Postgres path. Cached for short interval to avoid hot-path queries.
 */
@Component
@ConditionalOnProperty(name = "report.clickhouse.enabled", havingValue = "true")
public class ProjectionLagDetector {

  private static final Logger log = LoggerFactory.getLogger(ProjectionLagDetector.class);

  private final DataSource clickHouseDataSource;
  private final Duration lagThreshold;
  private final long checkIntervalMs;

  private volatile long lastCheckedAt = 0L;
  private volatile boolean lastResultLagged = true; // safe default — fall back

  public ProjectionLagDetector(
      @Qualifier("clickHouseDataSource") DataSource clickHouseDataSource,
      @Value("${report.clickhouse.lag-threshold-seconds:600}") long lagThresholdSeconds,
      @Value("${report.clickhouse.lag-check-interval-ms:30000}") long checkIntervalMs
  ) {
    this.clickHouseDataSource = clickHouseDataSource;
    this.lagThreshold = Duration.ofSeconds(lagThresholdSeconds);
    this.checkIntervalMs = checkIntervalMs;
  }

  public boolean isLagged() {
    long now = System.currentTimeMillis();
    if (now - lastCheckedAt < checkIntervalMs) return lastResultLagged;
    lastCheckedAt = now;
    try (Connection c = clickHouseDataSource.getConnection();
         Statement s = c.createStatement();
         ResultSet rs = s.executeQuery(
             "SELECT max(server_received_at) FROM fern.events_sale_completed")) {
      if (rs.next()) {
        java.sql.Timestamp ts = rs.getTimestamp(1);
        if (ts == null) {
          lastResultLagged = false; // empty table, accept
          return false;
        }
        Instant latest = ts.toInstant();
        Duration age = Duration.between(latest, Instant.now());
        boolean lagged = age.compareTo(lagThreshold) > 0;
        lastResultLagged = lagged;
        if (lagged) {
          log.warn("clickhouse projection lag {}s exceeds threshold {}s", age.toSeconds(), lagThreshold.toSeconds());
        }
        return lagged;
      }
    } catch (SQLException e) {
      log.warn("clickhouse lag check failed, assuming lagged: {}", e.getMessage());
      lastResultLagged = true;
      return true;
    }
    lastResultLagged = false;
    return false;
  }
}
