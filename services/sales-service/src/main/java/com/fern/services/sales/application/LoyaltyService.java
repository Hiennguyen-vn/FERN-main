package com.fern.services.sales.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Loyalty MVP. Rules (intentionally simple, thesis-scope):
 *   earn  : floor(saleTotal / 10000) points
 *   redeem: 100 points = 20000 VND voucher
 * No tier system. OTP is mocked: any 6-digit submission accepted in dev (configurable).
 */
@Service
public class LoyaltyService {

  public static final int POINTS_DIVISOR_VND = 10_000;
  public static final int REDEEM_POINTS = 100;
  public static final BigDecimal REDEEM_VOUCHER_VND = new BigDecimal("20000");
  private static final String MOCK_OTP_DEFAULT = "123456";

  private final DataSource dataSource;
  private final SnowflakeIdGenerator idGenerator;
  private final Clock clock;
  private final boolean mockOtpEnabled;
  private final String mockOtpCode;

  public LoyaltyService(
      DataSource dataSource,
      SnowflakeIdGenerator idGenerator,
      Clock clock,
      @Value("${fern.loyalty.mock-otp:true}") boolean mockOtpEnabled,
      @Value("${fern.loyalty.mock-otp-code:123456}") String mockOtpCode
  ) {
    this.dataSource = dataSource;
    this.idGenerator = idGenerator;
    this.clock = clock;
    this.mockOtpEnabled = mockOtpEnabled;
    this.mockOtpCode = mockOtpCode == null || mockOtpCode.isBlank() ? MOCK_OTP_DEFAULT : mockOtpCode;
  }

  public record CustomerView(
      long id, String phone, String fullName, LocalDate birthday,
      int pointsBalance, boolean phoneVerified,
      boolean consentMarketing, boolean consentDataProcessing
  ) {}

  public record CreateCustomerRequest(
      String phone, String fullName, LocalDate birthday,
      Boolean consentMarketing, Boolean consentDataProcessing
  ) {}

  @Transactional
  public CustomerView register(CreateCustomerRequest req) {
    if (req == null || req.phone == null) throw ServiceException.badRequest("phone required");
    if (req.consentDataProcessing == null || !req.consentDataProcessing) {
      throw ServiceException.badRequest("consentDataProcessing must be true (PDPL)");
    }
    Optional<CustomerView> existing = findByPhone(req.phone);
    if (existing.isPresent()) return existing.get();
    long id = idGenerator.generateId();
    Instant now = clock.instant();
    String sql = """
        INSERT INTO crm.customer
          (id, phone, full_name, birthday, consent_marketing, consent_data_processing,
           points_balance, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, id);
      ps.setString(2, req.phone);
      ps.setString(3, req.fullName);
      if (req.birthday == null) ps.setNull(4, Types.DATE); else ps.setDate(4, java.sql.Date.valueOf(req.birthday));
      ps.setBoolean(5, Boolean.TRUE.equals(req.consentMarketing));
      ps.setBoolean(6, true);
      ps.setTimestamp(7, Timestamp.from(now));
      ps.setTimestamp(8, Timestamp.from(now));
      ps.executeUpdate();
    } catch (SQLException e) {
      throw new IllegalStateException("register customer", e);
    }
    return new CustomerView(id, req.phone, req.fullName, req.birthday, 0, false,
        Boolean.TRUE.equals(req.consentMarketing), true);
  }

  public Optional<CustomerView> findByPhone(String phone) {
    String sql = """
        SELECT id, phone, full_name, birthday, points_balance, phone_verified_at,
               consent_marketing, consent_data_processing
          FROM crm.customer
         WHERE phone = ? AND deleted_at IS NULL
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setString(1, phone);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) return Optional.empty();
        return Optional.of(map(rs));
      }
    } catch (SQLException e) {
      throw new IllegalStateException("findByPhone", e);
    }
  }

  public Optional<CustomerView> findById(long id) {
    String sql = """
        SELECT id, phone, full_name, birthday, points_balance, phone_verified_at,
               consent_marketing, consent_data_processing
          FROM crm.customer
         WHERE id = ? AND deleted_at IS NULL
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, id);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? Optional.of(map(rs)) : Optional.empty();
      }
    } catch (SQLException e) {
      throw new IllegalStateException("findById", e);
    }
  }

  /** Soft-delete for PDPL right-to-erasure. */
  @Transactional
  public void erase(long customerId) {
    String sql = """
        UPDATE crm.customer
           SET deleted_at = NOW(),
               full_name = NULL,
               birthday = NULL,
               consent_marketing = FALSE,
               updated_at = NOW()
         WHERE id = ? AND deleted_at IS NULL
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, customerId);
      if (ps.executeUpdate() == 0) throw ServiceException.notFound("Customer not found: " + customerId);
    } catch (SQLException e) {
      throw new IllegalStateException("erase", e);
    }
  }

  /** Computes points from sale total. */
  public static int pointsFor(BigDecimal saleTotalVnd) {
    if (saleTotalVnd == null || saleTotalVnd.signum() <= 0) return 0;
    return saleTotalVnd.divide(new BigDecimal(POINTS_DIVISOR_VND), 0, java.math.RoundingMode.FLOOR).intValue();
  }

  @Transactional
  public int earn(long customerId, Long saleId, BigDecimal saleTotalVnd) {
    int delta = pointsFor(saleTotalVnd);
    if (delta == 0) return 0;
    return appendLedger(customerId, saleId, delta, "earn:sale");
  }

  @Transactional
  public int redeem(long customerId, Long saleId) {
    return appendLedger(customerId, saleId, -REDEEM_POINTS, "redeem:voucher");
  }

  private int appendLedger(long customerId, Long saleId, int delta, String reason) {
    try (Connection conn = dataSource.getConnection()) {
      conn.setAutoCommit(false);
      try {
        int balance;
        try (PreparedStatement ps = conn.prepareStatement(
            "SELECT points_balance FROM crm.customer WHERE id = ? AND deleted_at IS NULL FOR UPDATE")) {
          ps.setLong(1, customerId);
          try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) throw ServiceException.notFound("Customer not found: " + customerId);
            balance = rs.getInt(1);
          }
        }
        int newBalance = balance + delta;
        if (newBalance < 0) throw ServiceException.conflict("Insufficient points");
        try (PreparedStatement ps = conn.prepareStatement(
            "UPDATE crm.customer SET points_balance = ?, updated_at = NOW() WHERE id = ?")) {
          ps.setInt(1, newBalance);
          ps.setLong(2, customerId);
          ps.executeUpdate();
        }
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO crm.points_ledger (id, customer_id, sale_id, delta, reason, balance_after, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            """)) {
          ps.setLong(1, idGenerator.generateId());
          ps.setLong(2, customerId);
          if (saleId == null) ps.setNull(3, Types.BIGINT); else ps.setLong(3, saleId);
          ps.setInt(4, delta);
          ps.setString(5, reason);
          ps.setInt(6, newBalance);
          ps.executeUpdate();
        }
        conn.commit();
        return newBalance;
      } catch (RuntimeException | SQLException e) {
        conn.rollback();
        if (e instanceof RuntimeException re) throw re;
        throw new IllegalStateException("appendLedger", e);
      } finally {
        conn.setAutoCommit(true);
      }
    } catch (SQLException e) {
      throw new IllegalStateException("appendLedger:txn", e);
    }
  }

  public List<Map<String, Object>> ledger(long customerId, int limit) {
    int lim = Math.min(Math.max(limit, 1), 500);
    String sql = """
        SELECT id, sale_id, delta, reason, balance_after, created_at
          FROM crm.points_ledger
         WHERE customer_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, customerId);
      ps.setInt(2, lim);
      try (ResultSet rs = ps.executeQuery()) {
        List<Map<String, Object>> out = new ArrayList<>();
        while (rs.next()) {
          long sale = rs.getLong("sale_id"); boolean saleNull = rs.wasNull();
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("id", rs.getLong("id"));
          row.put("saleId", saleNull ? null : sale);
          row.put("delta", rs.getInt("delta"));
          row.put("reason", rs.getString("reason"));
          row.put("balanceAfter", rs.getInt("balance_after"));
          row.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
          out.add(row);
        }
        return out;
      }
    } catch (SQLException e) {
      throw new IllegalStateException("ledger", e);
    }
  }

  // ── OTP (mocked for thesis scope) ─────────────────────────────────────

  @Transactional
  public Map<String, Object> requestOtp(String phone) {
    if (phone == null || phone.isBlank()) throw ServiceException.badRequest("phone required");
    String code = mockOtpEnabled ? mockOtpCode : generateRandomOtp();
    long id = idGenerator.generateId();
    Instant now = clock.instant();
    Instant expires = now.plus(5, ChronoUnit.MINUTES);
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             """
             INSERT INTO crm.otp_request (id, phone, code_hash, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?)
             """)) {
      ps.setLong(1, id);
      ps.setString(2, phone);
      ps.setString(3, sha256(code));
      ps.setTimestamp(4, Timestamp.from(expires));
      ps.setTimestamp(5, Timestamp.from(now));
      ps.executeUpdate();
    } catch (SQLException e) {
      throw new IllegalStateException("requestOtp", e);
    }
    Map<String, Object> r = new LinkedHashMap<>();
    r.put("requestId", id);
    r.put("expiresAt", expires.toString());
    if (mockOtpEnabled) r.put("debugCode", code);
    return r;
  }

  @Transactional
  public boolean verifyOtp(String phone, String code) {
    String hash = sha256(code);
    Instant now = clock.instant();
    String sql = """
        UPDATE crm.otp_request
           SET consumed_at = NOW()
         WHERE id = (
           SELECT id FROM crm.otp_request
            WHERE phone = ? AND code_hash = ?
              AND consumed_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
         )
        """;
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setString(1, phone);
      ps.setString(2, hash);
      ps.setTimestamp(3, Timestamp.from(now));
      int affected = ps.executeUpdate();
      if (affected == 0) return false;
    } catch (SQLException e) {
      throw new IllegalStateException("verifyOtp", e);
    }
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
             "UPDATE crm.customer SET phone_verified_at = NOW(), updated_at = NOW() "
             + "WHERE phone = ? AND deleted_at IS NULL")) {
      ps.setString(1, phone);
      ps.executeUpdate();
    } catch (SQLException e) {
      throw new IllegalStateException("mark verified", e);
    }
    return true;
  }

  private static String generateRandomOtp() {
    int n = (int) (Math.random() * 1_000_000);
    return String.format("%06d", n);
  }

  private static String sha256(String s) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] h = md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder();
      for (byte b : h) sb.append(String.format("%02x", b));
      return sb.toString();
    } catch (Exception e) {
      throw new IllegalStateException("sha256", e);
    }
  }

  private static CustomerView map(ResultSet rs) throws SQLException {
    java.sql.Date bd = rs.getDate("birthday");
    Timestamp v = rs.getTimestamp("phone_verified_at");
    return new CustomerView(
        rs.getLong("id"),
        rs.getString("phone"),
        rs.getString("full_name"),
        bd == null ? null : bd.toLocalDate(),
        rs.getInt("points_balance"),
        v != null,
        rs.getBoolean("consent_marketing"),
        rs.getBoolean("consent_data_processing")
    );
  }
}
