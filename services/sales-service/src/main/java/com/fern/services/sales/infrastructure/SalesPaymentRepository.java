package com.fern.services.sales.infrastructure;

import com.fern.common.repository.BaseRepository;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.application.PaymentStateMachine;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class SalesPaymentRepository extends BaseRepository {

  private final Clock clock;

  public SalesPaymentRepository(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  public Optional<SalesDtos.PaymentView> loadPayment(long saleId) {
    return queryOne(
        """
        SELECT sale_id, payment_method, amount, status, payment_time, transaction_ref, note
        FROM core.payment
        WHERE sale_id = ?
        """,
        this::mapPayment,
        saleId
    );
  }

  Optional<SalesDtos.PaymentView> loadPaymentTransactional(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT sale_id, payment_method, amount, status, payment_time, transaction_ref, note
        FROM core.payment
        WHERE sale_id = ?
        """
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPayment(rs));
        }
        return Optional.empty();
      }
    }
  }

  Optional<String> loadPaymentStateTransactional(Connection conn, long saleId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        "SELECT state FROM core.payment WHERE sale_id = ? FOR UPDATE"
    )) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.ofNullable(rs.getString("state"));
        }
        return Optional.empty();
      }
    }
  }

  Map<String, BigDecimal> loadExpectedPaymentTotalsByMethod(Connection conn, long sessionId) throws Exception {
    Map<String, BigDecimal> totals = new LinkedHashMap<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT payment_method, COALESCE(SUM(amount), 0) AS total_amount
        FROM core.payment
        WHERE pos_session_id = ?
          AND status = 'success'::payment_txn_status_enum
        GROUP BY payment_method
        ORDER BY payment_method
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          totals.put(
              rs.getString("payment_method"),
              money(rs.getBigDecimal("total_amount")).setScale(2, RoundingMode.HALF_UP)
          );
        }
      }
    }
    return totals;
  }

  void upsertPayment(
      Connection conn,
      long saleId,
      long outletId,
      Instant saleCreatedAt,
      Long posSessionId,
      SalesDtos.MarkPaymentDoneRequest payment,
      BigDecimal totalAmount,
      Instant paymentTime,
      Long resolvedDeviceId,
      Instant offlineCapturedAt,
      boolean fromOfflineSync
  ) throws Exception {
    Instant now = clock.instant();
    String currentState = loadPaymentStateTransactional(conn, saleId).orElse(null);
    String targetState = PaymentStateMachine.transition(
        currentState,
        fromOfflineSync ? "RECONCILED" : "COMPLETED"
    );
    boolean paymentExists = currentState != null;
    if (paymentExists) {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.payment
          SET pos_session_id = ?,
              payment_method = ?::payment_method_enum,
              amount = ?,
              status = 'success'::payment_txn_status_enum,
              payment_time = ?,
              transaction_ref = ?,
              note = ?,
              state = ?,
              offline_captured_at = ?,
              reconciled_at = ?,
              device_id = ?,
              updated_at = ?
          WHERE sale_id = ? AND sale_created_at = ?
          """
      )) {
        if (posSessionId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, posSessionId);
        }
        ps.setString(2, payment.paymentMethod().trim());
        ps.setBigDecimal(3, totalAmount);
        ps.setTimestamp(4, Timestamp.from(paymentTime));
        ps.setString(5, trimToNull(payment.transactionRef()));
        ps.setString(6, trimToNull(payment.note()));
        ps.setString(7, targetState);
        if (offlineCapturedAt == null) {
          ps.setNull(8, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
        } else {
          ps.setTimestamp(8, Timestamp.from(offlineCapturedAt));
        }
        if (fromOfflineSync) {
          ps.setTimestamp(9, Timestamp.from(now));
        } else {
          ps.setNull(9, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
        }
        if (resolvedDeviceId == null) {
          ps.setNull(10, java.sql.Types.BIGINT);
        } else {
          ps.setLong(10, resolvedDeviceId);
        }
        ps.setTimestamp(11, Timestamp.from(now));
        ps.setLong(12, saleId);
        ps.setTimestamp(13, Timestamp.from(saleCreatedAt));
        ps.executeUpdate();
      }
      return;
    }
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.payment (
          sale_id, sale_created_at, outlet_id, pos_session_id,
          payment_method, amount, status, payment_time, transaction_ref, note,
          state, offline_captured_at, reconciled_at, device_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?::payment_method_enum, ?, ?::payment_txn_status_enum, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
    )) {
      ps.setLong(1, saleId);
      ps.setTimestamp(2, Timestamp.from(saleCreatedAt));
      ps.setLong(3, outletId);
      if (posSessionId == null) {
        ps.setNull(4, java.sql.Types.BIGINT);
      } else {
        ps.setLong(4, posSessionId);
      }
      ps.setString(5, payment.paymentMethod().trim());
      ps.setBigDecimal(6, totalAmount);
      ps.setString(7, "success");
      ps.setTimestamp(8, Timestamp.from(paymentTime));
      ps.setString(9, trimToNull(payment.transactionRef()));
      ps.setString(10, trimToNull(payment.note()));
      ps.setString(11, targetState);
      if (offlineCapturedAt == null) {
        ps.setNull(12, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
      } else {
        ps.setTimestamp(12, Timestamp.from(offlineCapturedAt));
      }
      if (fromOfflineSync) {
        ps.setTimestamp(13, Timestamp.from(now));
      } else {
        ps.setNull(13, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
      }
      if (resolvedDeviceId == null) {
        ps.setNull(14, java.sql.Types.BIGINT);
      } else {
        ps.setLong(14, resolvedDeviceId);
      }
      ps.setTimestamp(15, Timestamp.from(now));
      ps.setTimestamp(16, Timestamp.from(now));
      ps.executeUpdate();
    }
  }

  private SalesDtos.PaymentView mapPayment(ResultSet rs) {
    try {
      return new SalesDtos.PaymentView(
          Long.toString(rs.getLong("sale_id")),
          rs.getString("payment_method"),
          rs.getBigDecimal("amount"),
          rs.getString("status"),
          rs.getTimestamp("payment_time").toInstant(),
          rs.getString("transaction_ref"),
          rs.getString("note")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map payment", e);
    }
  }

  private static BigDecimal money(BigDecimal value) {
    return value == null ? BigDecimal.ZERO : value;
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
