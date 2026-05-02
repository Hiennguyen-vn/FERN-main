package com.fern.services.inventory.application;

import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Append-only stock reservation layer. Reservations don't lock stock_balance —
 * they shift contention from write to read (the stock_available view subtracts unsettled
 * reservations from balance). The hard deduction still happens at sale-approve time via
 * inventory_transaction.
 */
@Service
public class StockReservationService {

  private final DataSource dataSource;
  private final SnowflakeIdGenerator idGenerator;
  private final Clock clock;

  public StockReservationService(DataSource dataSource, SnowflakeIdGenerator idGenerator, Clock clock) {
    this.dataSource = dataSource;
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  public record ReserveLine(long itemId, BigDecimal qty) {}

  public record ReservationView(
      long id, long locationId, long itemId, BigDecimal qty, Long saleId,
      Instant reservedAt, Instant expiresAt
  ) {}

  /** Reserves qty per line, single transaction, append-only. Returns created reservations. */
  public List<ReservationView> reserve(long locationId, Long saleId, List<ReserveLine> lines, Duration ttl) {
    if (lines == null || lines.isEmpty()) return List.of();
    Instant now = clock.instant();
    Instant expires = ttl == null ? null : now.plus(ttl);
    List<ReservationView> out = new ArrayList<>();
    String sql = """
        INSERT INTO core.stock_reservation
          (id, location_id, item_id, qty, sale_id, reserved_at, expires_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'sale')
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      for (ReserveLine line : lines) {
        long id = idGenerator.generateId();
        ps.setLong(1, id);
        ps.setLong(2, locationId);
        ps.setLong(3, line.itemId());
        ps.setBigDecimal(4, line.qty());
        if (saleId == null) ps.setNull(5, Types.BIGINT); else ps.setLong(5, saleId);
        ps.setTimestamp(6, Timestamp.from(now));
        if (expires == null) ps.setNull(7, Types.TIMESTAMP_WITH_TIMEZONE);
        else ps.setTimestamp(7, Timestamp.from(expires));
        ps.executeUpdate();
        out.add(new ReservationView(id, locationId, line.itemId(), line.qty(), saleId, now, expires));
      }
      return out;
    } catch (SQLException e) {
      throw new IllegalStateException("reserve stock", e);
    }
  }

  public Map<Long, BigDecimal> available(long locationId, List<Long> itemIds) {
    if (itemIds == null || itemIds.isEmpty()) return Map.of();
    StringBuilder placeholders = new StringBuilder();
    for (int i = 0; i < itemIds.size(); i++) { if (i > 0) placeholders.append(','); placeholders.append('?'); }
    String sql = """
        SELECT item_id, available_qty
          FROM core.stock_available
         WHERE location_id = ?
           AND item_id IN (%s)
        """.formatted(placeholders.toString());
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, locationId);
      int idx = 2;
      for (Long id : itemIds) ps.setLong(idx++, id);
      try (ResultSet rs = ps.executeQuery()) {
        Map<Long, BigDecimal> result = new LinkedHashMap<>();
        while (rs.next()) result.put(rs.getLong(1), rs.getBigDecimal(2));
        return result;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("read stock_available", e);
    }
  }

  public int settleForSale(long saleId) {
    String sql = """
        UPDATE core.stock_reservation
           SET settled_at = NOW()
         WHERE sale_id = ?
           AND settled_at IS NULL
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, saleId);
      return ps.executeUpdate();
    } catch (SQLException e) {
      throw new IllegalStateException("settleForSale", e);
    }
  }

  /** Confirm reservation when sale-approved consumer applies movements. Terminal state. */
  public int confirmForSale(long saleId) {
    return settleForSale(saleId);
  }

  /** Release reservation when sale-cancelled. Terminal state, no movement applied. */
  public int releaseForSale(long saleId) {
    return settleForSale(saleId);
  }

  /** Periodic compaction: settle reservations that are clearly stale (expired or older than 24h with sale advanced). */
  @Scheduled(fixedDelayString = "${fern.inventory.reservation-sweep-ms:60000}")
  @SchedulerLock(name = "stock-reservation-sweep", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
  public int sweepExpired() {
    String sql = """
        UPDATE core.stock_reservation
           SET settled_at = NOW()
         WHERE settled_at IS NULL
           AND (
             (expires_at IS NOT NULL AND expires_at <= NOW())
             OR reserved_at < NOW() - INTERVAL '24 hours'
           )
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      return ps.executeUpdate();
    } catch (SQLException e) {
      // best-effort sweep; do not propagate to scheduler
      return 0;
    }
  }
}
