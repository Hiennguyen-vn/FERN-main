package com.fern.services.sales.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CashMovementService {

  private static final Set<String> TYPES = Set.of(
      "OPEN_FLOAT", "PAID_IN", "PAID_OUT", "SALE_CASH", "DROP", "CLOSE_COUNT");

  private final DataSource dataSource;
  private final SnowflakeIdGenerator idGenerator;
  private final Clock clock;

  public CashMovementService(DataSource dataSource, SnowflakeIdGenerator idGenerator, Clock clock) {
    this.dataSource = dataSource;
    this.idGenerator = idGenerator;
    this.clock = clock;
  }

  public record CashMovementRequest(
      String type, BigDecimal amount, String reason, Long referenceSaleId, Long approvedByUserId
  ) {}

  public record CashMovementView(
      long id, long sessionId, long outletId, String type, BigDecimal amount,
      String reason, Long referenceSaleId, Long createdByUserId, Long approvedByUserId, Instant createdAt
  ) {}

  @Transactional
  public CashMovementView record(long sessionId, CashMovementRequest req) {
    if (req == null || req.type == null || !TYPES.contains(req.type)) {
      throw ServiceException.badRequest("Invalid cash movement type");
    }
    if (req.amount == null || req.amount.signum() < 0) {
      throw ServiceException.badRequest("Amount must be >= 0");
    }
    SessionRow session = lockSession(sessionId);
    RequestUserContext ctx = RequestUserContextHolder.get();
    Long userId = ctx == null ? null : ctx.userId();
    long id = idGenerator.generateId();
    Instant now = clock.instant();
    String sql = """
        INSERT INTO core.cash_movement
          (id, session_id, outlet_id, type, amount, reason, reference_sale_id,
           created_by_user_id, approved_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, id);
      ps.setLong(2, sessionId);
      ps.setLong(3, session.outletId);
      ps.setString(4, req.type);
      ps.setBigDecimal(5, req.amount);
      ps.setString(6, req.reason);
      if (req.referenceSaleId == null) ps.setNull(7, Types.BIGINT); else ps.setLong(7, req.referenceSaleId);
      if (userId == null) ps.setNull(8, Types.BIGINT); else ps.setLong(8, userId);
      if (req.approvedByUserId == null) ps.setNull(9, Types.BIGINT); else ps.setLong(9, req.approvedByUserId);
      ps.setTimestamp(10, java.sql.Timestamp.from(now));
      ps.executeUpdate();
      return new CashMovementView(id, sessionId, session.outletId, req.type, req.amount,
          req.reason, req.referenceSaleId, userId, req.approvedByUserId, now);
    } catch (SQLException e) {
      throw new IllegalStateException("record cash_movement", e);
    }
  }

  public List<CashMovementView> list(long sessionId) {
    String sql = """
        SELECT id, session_id, outlet_id, type, amount, reason, reference_sale_id,
               created_by_user_id, approved_by_user_id, created_at
          FROM core.cash_movement
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        List<CashMovementView> out = new ArrayList<>();
        while (rs.next()) {
          long ref = rs.getLong("reference_sale_id"); boolean refNull = rs.wasNull();
          long createdBy = rs.getLong("created_by_user_id"); boolean cbNull = rs.wasNull();
          long approvedBy = rs.getLong("approved_by_user_id"); boolean abNull = rs.wasNull();
          out.add(new CashMovementView(
              rs.getLong("id"), rs.getLong("session_id"), rs.getLong("outlet_id"),
              rs.getString("type"), rs.getBigDecimal("amount"), rs.getString("reason"),
              refNull ? null : ref, cbNull ? null : createdBy, abNull ? null : approvedBy,
              rs.getTimestamp("created_at").toInstant()));
        }
        return out;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("list cash_movement", e);
    }
  }

  public Map<String, Object> summary(long sessionId) {
    String sql = """
        SELECT session_id, outlet_id, business_date, open_float, sales_cash,
               paid_in, paid_out, drops, counted, expected_total, variance
          FROM core.cash_session_summary
         WHERE session_id = ?
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) throw ServiceException.notFound("Session not found: " + sessionId);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("sessionId", rs.getLong("session_id"));
        row.put("outletId", rs.getLong("outlet_id"));
        java.sql.Date bd = rs.getDate("business_date");
        row.put("businessDate", bd == null ? null : bd.toString());
        row.put("openFloat", rs.getBigDecimal("open_float"));
        row.put("salesCash", rs.getBigDecimal("sales_cash"));
        row.put("paidIn", rs.getBigDecimal("paid_in"));
        row.put("paidOut", rs.getBigDecimal("paid_out"));
        row.put("drops", rs.getBigDecimal("drops"));
        row.put("counted", rs.getBigDecimal("counted"));
        row.put("expectedTotal", rs.getBigDecimal("expected_total"));
        row.put("variance", rs.getBigDecimal("variance"));
        return row;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("cash summary", e);
    }
  }

  private record SessionRow(long id, long outletId, String status) {}

  private SessionRow lockSession(long sessionId) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             "SELECT id, outlet_id, status FROM core.pos_session WHERE id = ?")) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) throw ServiceException.notFound("Session not found: " + sessionId);
        return new SessionRow(rs.getLong(1), rs.getLong(2), rs.getString(3));
      }
    } catch (SQLException e) {
      throw new IllegalStateException("lockSession", e);
    }
  }
}
