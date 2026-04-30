package com.fern.services.sales.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.common.repository.BaseRepository;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.sales.api.SalesDtos;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class SalesSessionRepository extends BaseRepository {

  private static final Set<String> POS_SESSION_SORT_KEYS =
      Set.of("openedAt", "businessDate", "status", "managerId", "id");

  private final SnowflakeIdGenerator snowflakeIdGenerator;
  private final Clock clock;
  private final SalesPaymentRepository paymentRepository;

  public SalesSessionRepository(
      DataSource dataSource,
      SnowflakeIdGenerator snowflakeIdGenerator,
      Clock clock,
      SalesPaymentRepository paymentRepository
  ) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
    this.clock = clock;
    this.paymentRepository = paymentRepository;
  }

  public SalesDtos.PosSessionView openPosSession(SalesDtos.OpenPosSessionRequest request) {
    return openPosSession(request, null);
  }

  public SalesDtos.PosSessionView openPosSession(
      SalesDtos.OpenPosSessionRequest request,
      Long overrideSessionId
  ) {
    return executeInTransaction(conn -> openPosSession(conn, request, overrideSessionId));
  }

  SalesDtos.PosSessionView openPosSession(
      Connection conn,
      SalesDtos.OpenPosSessionRequest request,
      Long overrideSessionId
  ) throws Exception {
    if (overrideSessionId != null) {
      lockSyncEntity(conn, overrideSessionId);
      Optional<SalesDtos.PosSessionView> existing = findPosSession(conn, overrideSessionId);
      if (existing.isPresent()) {
        return existing.get();
      }
    }
    long sessionId = overrideSessionId != null ? overrideSessionId : snowflakeIdGenerator.generateId();
    Instant now = clock.instant();
    Long resolvedDeviceId = resolveRegisteredDeviceId(conn, request.deviceId(), request.outletId());
    if (resolvedDeviceId != null) {
      Optional<Long> openForDevice = findOpenPosSessionIdForOutletAndDeviceTx(conn, request.outletId(), resolvedDeviceId);
      if (openForDevice.isPresent() && !openForDevice.get().equals(overrideSessionId)) {
        throw ServiceException.conflict("Device already has an open POS session");
      }
    }
    Long resolvedManagerId = request.managerId();
    if (overrideSessionId != null && resolvedManagerId != null && !appUserExists(conn, resolvedManagerId)) {
      resolvedManagerId = null;
    }
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.pos_session (
          id, session_code, outlet_id, currency_code, manager_id, device_id, register_code,
          opened_by_username, opened_at, business_date, status, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::pos_session_status_enum, ?, ?, ?)
        """
    )) {
      ps.setLong(1, sessionId);
      ps.setString(2, request.sessionCode().trim());
      ps.setLong(3, request.outletId());
      ps.setString(4, request.currencyCode().trim());
      if (resolvedManagerId == null) {
        ps.setNull(5, Types.BIGINT);
      } else {
        ps.setLong(5, resolvedManagerId);
      }
      if (resolvedDeviceId == null) {
        ps.setNull(6, Types.BIGINT);
      } else {
        ps.setLong(6, resolvedDeviceId);
      }
      ps.setString(7, trimToNull(request.registerCode()));
      ps.setString(8, trimToNull(request.openedByUsername()));
      ps.setTimestamp(9, Timestamp.from(now));
      ps.setObject(10, request.businessDate());
      ps.setString(11, "open");
      ps.setString(12, trimToNull(request.note()));
      ps.setTimestamp(13, Timestamp.from(now));
      ps.setTimestamp(14, Timestamp.from(now));
      ps.executeUpdate();
    } catch (SQLException e) {
      if ("23505".equals(e.getSQLState())) {
        if (String.valueOf(e.getMessage()).contains("uq_pos_session_open_per_device")) {
          throw ServiceException.conflict("Device already has an open POS session");
        }
        throw ServiceException.conflict("Session code already exists");
      }
      throw e;
    }
    return findPosSession(conn, sessionId)
        .orElseThrow(() -> new IllegalStateException("Created session not found"));
  }

  public SalesDtos.PosSessionView closePosSession(long sessionId, String note) {
    return executeInTransaction(conn -> {
      LockedPosSessionRecord locked = lockPosSession(conn, sessionId)
          .orElseThrow(() -> ServiceException.notFound("POS session not found: " + sessionId));
      if (!"open".equalsIgnoreCase(locked.status())) {
        throw ServiceException.conflict("Only open sessions can be closed");
      }
      try (PreparedStatement chk = conn.prepareStatement(
          """
          SELECT COUNT(*) FROM core.sale_record
          WHERE pos_session_id = ?
            AND public_token IS NULL
            AND status <> 'cancelled'::sale_order_status_enum
            AND payment_status IN ('unpaid'::payment_status_enum, 'partially_paid'::payment_status_enum)
          """
      )) {
        chk.setLong(1, sessionId);
        try (ResultSet rs = chk.executeQuery()) {
          if (rs.next()) {
            int count = rs.getInt(1);
            if (count > 0) {
              throw ServiceException.conflict("SESSION_HAS_UNPAID_ORDERS:" + count);
            }
          }
        }
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.pos_session
          SET status = ?::pos_session_status_enum,
              closed_at = ?,
              note = COALESCE(?, note),
              updated_at = ?
          WHERE id = ?
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setString(1, "closed");
        ps.setTimestamp(2, now);
        ps.setString(3, trimToNull(note));
        ps.setTimestamp(4, now);
        ps.setLong(5, sessionId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("POS session not found: " + sessionId);
        }
      }
      return findPosSession(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Closed session not found"));
    });
  }

  public SalesDtos.PosSessionReconciliationView reconcilePosSession(
      long sessionId,
      SalesDtos.ReconcilePosSessionRequest request,
      Long actorUserId
  ) {
    return executeInTransaction(conn -> {
      LockedPosSessionRecord lockedSession = lockPosSession(conn, sessionId)
          .orElseThrow(() -> ServiceException.notFound("POS session not found: " + sessionId));
      String sessionStatus = lockedSession.status().toLowerCase(Locale.ROOT);
      if ("open".equals(sessionStatus)) {
        throw ServiceException.conflict("Only closed sessions can be reconciled");
      }
      if ("cancelled".equals(sessionStatus)) {
        throw ServiceException.conflict("Cancelled sessions cannot be reconciled");
      }
      if (!"closed".equals(sessionStatus) && !"reconciled".equals(sessionStatus)) {
        throw ServiceException.conflict("Session status does not allow reconciliation: " + lockedSession.status());
      }

      Instant now = clock.instant();
      Map<String, BigDecimal> expectedByMethod = paymentRepository.loadExpectedPaymentTotalsByMethod(conn, sessionId);
      Map<String, BigDecimal> actualByMethod = resolveActualPaymentTotals(
          request == null ? List.of() : request.lines(),
          expectedByMethod
      );
      List<SalesDtos.PosSessionReconciliationLineView> lines = buildReconciliationLines(expectedByMethod, actualByMethod);
      BigDecimal expectedTotal = lines.stream()
          .map(SalesDtos.PosSessionReconciliationLineView::expectedAmount)
          .reduce(BigDecimal.ZERO, BigDecimal::add)
          .setScale(2, RoundingMode.HALF_UP);
      BigDecimal actualTotal = lines.stream()
          .map(SalesDtos.PosSessionReconciliationLineView::actualAmount)
          .reduce(BigDecimal.ZERO, BigDecimal::add)
          .setScale(2, RoundingMode.HALF_UP);
      BigDecimal discrepancyTotal = actualTotal.subtract(expectedTotal).setScale(2, RoundingMode.HALF_UP);
      String reconciliationNote = mergeReconciliationNote(lockedSession.note(), request == null ? null : request.note());

      upsertPosSessionReconciliation(
          conn,
          sessionId,
          actorUserId,
          now,
          expectedTotal,
          actualTotal,
          discrepancyTotal,
          reconciliationNote,
          lines
      );

      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.pos_session
          SET status = 'reconciled'::pos_session_status_enum,
              closed_at = COALESCE(closed_at, ?),
              note = COALESCE(?, note),
              updated_at = ?
          WHERE id = ?
          """
      )) {
        Timestamp nowTs = Timestamp.from(now);
        ps.setTimestamp(1, nowTs);
        ps.setString(2, reconciliationNote);
        ps.setTimestamp(3, nowTs);
        ps.setLong(4, sessionId);
        ps.executeUpdate();
      }

      return loadPosSessionReconciliation(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Reconciled session payload not found"));
    });
  }

  public Optional<SalesDtos.PosSessionView> findPosSession(long sessionId) {
    return executeInTransaction(conn -> findPosSession(conn, sessionId));
  }

  Optional<SalesDtos.PosSessionView> findPosSession(Connection conn, long sessionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, session_code, outlet_id, currency_code, manager_id, device_id, register_code, opened_by_username,
               opened_at, closed_at, business_date, status, note
        FROM core.pos_session
        WHERE id = ?
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPosSession(rs));
        }
        return Optional.empty();
      }
    }
  }

  public Optional<SalesDtos.PosSessionView> findOpenPosSessionForOutlet(long outletId, LocalDate businessDate) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT id, session_code, outlet_id, currency_code, manager_id, device_id, register_code, opened_by_username,
                 opened_at, closed_at, business_date, status, note
          FROM core.pos_session
          WHERE outlet_id = ?
            AND business_date = ?
            AND status = 'open'::pos_session_status_enum
          LIMIT 1
          """
      )) {
        ps.setLong(1, outletId);
        ps.setObject(2, businessDate);
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            return Optional.of(mapPosSession(rs));
          }
          return Optional.empty();
        }
      }
    });
  }

  public Optional<Long> findOpenPosSessionIdForOutletAndDevice(long outletId, long deviceId) {
    return executeInTransaction(conn -> findOpenPosSessionIdForOutletAndDeviceTx(conn, outletId, deviceId));
  }

  Optional<Long> findOpenPosSessionIdForOutlet(Connection conn, long outletId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id FROM core.pos_session
        WHERE outlet_id = ? AND status = 'open'::pos_session_status_enum
        ORDER BY opened_at DESC
        LIMIT 1
        """
    )) {
      ps.setLong(1, outletId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(rs.getLong(1));
        }
        return Optional.empty();
      }
    }
  }

  Optional<Long> findOpenPosSessionIdForOutletAndDeviceTx(
      Connection conn,
      long outletId,
      long deviceId
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id FROM core.pos_session
        WHERE outlet_id = ?
          AND device_id = ?
          AND status = 'open'::pos_session_status_enum
        ORDER BY opened_at DESC
        LIMIT 1
        """
    )) {
      ps.setLong(1, outletId);
      ps.setLong(2, deviceId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(rs.getLong(1));
        }
        return Optional.empty();
      }
    }
  }

  public PagedResult<SalesDtos.PosSessionListItemView> listPosSessions(
      Set<Long> outletIds,
      LocalDate businessDate,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      Long managerId,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return PagedResult.of(List.of(), limit, offset, 0);
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          WITH page AS (
            SELECT ps.id, ps.session_code, ps.outlet_id, ps.currency_code, ps.manager_id,
                   ps.device_id, ps.register_code, ps.opened_by_username,
                   ps.opened_at, ps.closed_at, ps.business_date, ps.status, ps.note,
                   COUNT(*) OVER() AS total_count
            FROM core.pos_session ps
            WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletScope(sql, params, "ps.outlet_id", outletIds);
      if (businessDate != null) {
        sql.append(" AND ps.business_date = ?");
        params.add(businessDate);
      }
      if (startDate != null) {
        sql.append(" AND ps.opened_at >= ?");
        params.add(Timestamp.from(startDate.atStartOfDay(java.time.ZoneOffset.UTC).toInstant()));
      }
      if (endDate != null) {
        sql.append(" AND ps.opened_at < ?");
        params.add(Timestamp.from(endDate.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant()));
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND ps.status = ?::pos_session_status_enum ");
        params.add(status.trim());
      }
      if (managerId != null) {
        sql.append(" AND ps.manager_id = ?");
        params.add(managerId);
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               ps.id::text ILIKE ?
               OR ps.session_code ILIKE ?
               OR ps.currency_code ILIKE ?
               OR ps.status::text ILIKE ?
               OR COALESCE(ps.note, '') ILIKE ?
               OR COALESCE(ps.manager_id::text, '') ILIKE ?
               OR COALESCE(ps.register_code, '') ILIKE ?
               OR COALESCE(ps.opened_by_username, '') ILIKE ?
             )
            """
        );
        for (int i = 0; i < 8; i++) {
          params.add(pattern);
        }
      }

      String sortClause = resolvePosSessionSortClause(sortBy, sortDir);
      sql.append(" ORDER BY ").append(sortClause).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      sql.append(
          """
          )
          SELECT ps.id, ps.session_code, ps.outlet_id, ps.currency_code, ps.manager_id,
                 ps.device_id, ps.register_code, ps.opened_by_username,
                 ps.opened_at, ps.closed_at, ps.business_date, ps.status, ps.note,
                 COALESCE(agg.order_count, 0) AS order_count,
                 COALESCE(agg.total_revenue, 0) AS total_revenue,
                 ps.total_count
          FROM page ps
          LEFT JOIN LATERAL (
            SELECT COUNT(*) AS order_count,
                   COALESCE(SUM(CASE WHEN sr.status IN ('payment_done', 'completed') THEN sr.total_amount ELSE 0 END), 0) AS total_revenue
            FROM core.sale_record sr
            WHERE sr.pos_session_id = ps.id
          ) agg ON true
          """
      );
      sql.append(" ORDER BY ").append(sortClause);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<SalesDtos.PosSessionListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPosSessionListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  private Optional<LockedPosSessionRecord> lockPosSession(Connection conn, long sessionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, outlet_id, session_code, business_date, opened_at, closed_at, status, note
        FROM core.pos_session
        WHERE id = ?
        FOR UPDATE
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Timestamp closedAt = rs.getTimestamp("closed_at");
        return Optional.of(new LockedPosSessionRecord(
            rs.getLong("id"),
            rs.getLong("outlet_id"),
            rs.getString("session_code"),
            rs.getObject("business_date", LocalDate.class),
            rs.getTimestamp("opened_at").toInstant(),
            closedAt == null ? null : closedAt.toInstant(),
            rs.getString("status"),
            rs.getString("note")
        ));
      }
    }
  }

  private Map<String, BigDecimal> resolveActualPaymentTotals(
      List<SalesDtos.ReconcilePosSessionLineRequest> requestLines,
      Map<String, BigDecimal> expectedByMethod
  ) {
    Map<String, BigDecimal> actualByMethod = new LinkedHashMap<>();
    if (requestLines == null || requestLines.isEmpty()) {
      actualByMethod.putAll(expectedByMethod);
      return actualByMethod;
    }
    for (SalesDtos.ReconcilePosSessionLineRequest line : requestLines) {
      String paymentMethod = normalizePaymentMethod(line.paymentMethod());
      if (actualByMethod.containsKey(paymentMethod)) {
        throw ServiceException.badRequest("Duplicate payment method in reconciliation payload: " + paymentMethod);
      }
      actualByMethod.put(paymentMethod, money(line.actualAmount()).setScale(2, RoundingMode.HALF_UP));
    }
    for (Map.Entry<String, BigDecimal> entry : expectedByMethod.entrySet()) {
      actualByMethod.putIfAbsent(entry.getKey(), entry.getValue().setScale(2, RoundingMode.HALF_UP));
    }
    return actualByMethod;
  }

  private List<SalesDtos.PosSessionReconciliationLineView> buildReconciliationLines(
      Map<String, BigDecimal> expectedByMethod,
      Map<String, BigDecimal> actualByMethod
  ) {
    Set<String> methods = new TreeSet<>();
    methods.addAll(expectedByMethod.keySet());
    methods.addAll(actualByMethod.keySet());
    List<SalesDtos.PosSessionReconciliationLineView> lines = new ArrayList<>();
    for (String method : methods) {
      BigDecimal expectedAmount = money(expectedByMethod.get(method)).setScale(2, RoundingMode.HALF_UP);
      BigDecimal actualAmount = money(actualByMethod.get(method)).setScale(2, RoundingMode.HALF_UP);
      BigDecimal discrepancyAmount = actualAmount.subtract(expectedAmount).setScale(2, RoundingMode.HALF_UP);
      lines.add(new SalesDtos.PosSessionReconciliationLineView(
          method,
          expectedAmount,
          actualAmount,
          discrepancyAmount
      ));
    }
    return List.copyOf(lines);
  }

  private void upsertPosSessionReconciliation(
      Connection conn,
      long sessionId,
      Long actorUserId,
      Instant reconciledAt,
      BigDecimal expectedTotal,
      BigDecimal actualTotal,
      BigDecimal discrepancyTotal,
      String note,
      List<SalesDtos.PosSessionReconciliationLineView> lines
  ) throws Exception {
    Timestamp now = Timestamp.from(reconciledAt);
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.pos_session_reconciliation (
          session_id, reconciled_by_user_id, reconciled_at, expected_total, actual_total, discrepancy_total, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id)
        DO UPDATE SET
          reconciled_by_user_id = EXCLUDED.reconciled_by_user_id,
          reconciled_at = EXCLUDED.reconciled_at,
          expected_total = EXCLUDED.expected_total,
          actual_total = EXCLUDED.actual_total,
          discrepancy_total = EXCLUDED.discrepancy_total,
          note = EXCLUDED.note,
          updated_at = EXCLUDED.updated_at
        """
    )) {
      ps.setLong(1, sessionId);
      if (actorUserId == null) {
        ps.setNull(2, Types.BIGINT);
      } else {
        ps.setLong(2, actorUserId);
      }
      ps.setTimestamp(3, now);
      ps.setBigDecimal(4, expectedTotal);
      ps.setBigDecimal(5, actualTotal);
      ps.setBigDecimal(6, discrepancyTotal);
      ps.setString(7, note);
      ps.setTimestamp(8, now);
      ps.setTimestamp(9, now);
      ps.executeUpdate();
    }

    try (PreparedStatement ps = conn.prepareStatement(
        "DELETE FROM core.pos_session_reconciliation_line WHERE session_id = ?"
    )) {
      ps.setLong(1, sessionId);
      ps.executeUpdate();
    }

    for (SalesDtos.PosSessionReconciliationLineView line : lines) {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.pos_session_reconciliation_line (
            session_id, payment_method, expected_amount, actual_amount, discrepancy_amount, created_at, updated_at
          ) VALUES (?, ?::payment_method_enum, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, sessionId);
        ps.setString(2, line.paymentMethod());
        ps.setBigDecimal(3, line.expectedAmount());
        ps.setBigDecimal(4, line.actualAmount());
        ps.setBigDecimal(5, line.discrepancyAmount());
        ps.setTimestamp(6, now);
        ps.setTimestamp(7, now);
        ps.executeUpdate();
      }
    }
  }

  private Optional<SalesDtos.PosSessionReconciliationView> loadPosSessionReconciliation(
      Connection conn,
      long sessionId
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT
          ps.id,
          ps.session_code,
          ps.outlet_id,
          ps.business_date,
          ps.status,
          ps.opened_at,
          ps.closed_at,
          ps.note AS session_note,
          pr.reconciled_at,
          pr.expected_total,
          pr.actual_total,
          pr.discrepancy_total,
          pr.note AS reconciliation_note
        FROM core.pos_session ps
        LEFT JOIN core.pos_session_reconciliation pr ON pr.session_id = ps.id
        WHERE ps.id = ?
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        Timestamp closedAt = rs.getTimestamp("closed_at");
        Timestamp reconciledAt = rs.getTimestamp("reconciled_at");
        String note = rs.getString("reconciliation_note");
        if (note == null) {
          note = rs.getString("session_note");
        }
        return Optional.of(new SalesDtos.PosSessionReconciliationView(
            Long.toString(rs.getLong("id")),
            rs.getString("session_code"),
            rs.getLong("outlet_id"),
            rs.getObject("business_date", LocalDate.class),
            rs.getString("status"),
            rs.getTimestamp("opened_at").toInstant(),
            closedAt == null ? null : closedAt.toInstant(),
            reconciledAt == null ? null : reconciledAt.toInstant(),
            money(rs.getBigDecimal("expected_total")).setScale(2, RoundingMode.HALF_UP),
            money(rs.getBigDecimal("actual_total")).setScale(2, RoundingMode.HALF_UP),
            money(rs.getBigDecimal("discrepancy_total")).setScale(2, RoundingMode.HALF_UP),
            note,
            loadPosSessionReconciliationLines(conn, sessionId)
        ));
      }
    }
  }

  private List<SalesDtos.PosSessionReconciliationLineView> loadPosSessionReconciliationLines(
      Connection conn,
      long sessionId
  ) throws Exception {
    List<SalesDtos.PosSessionReconciliationLineView> lines = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT payment_method, expected_amount, actual_amount, discrepancy_amount
        FROM core.pos_session_reconciliation_line
        WHERE session_id = ?
        ORDER BY payment_method
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          lines.add(new SalesDtos.PosSessionReconciliationLineView(
              rs.getString("payment_method"),
              money(rs.getBigDecimal("expected_amount")).setScale(2, RoundingMode.HALF_UP),
              money(rs.getBigDecimal("actual_amount")).setScale(2, RoundingMode.HALF_UP),
              money(rs.getBigDecimal("discrepancy_amount")).setScale(2, RoundingMode.HALF_UP)
          ));
        }
      }
    }
    return List.copyOf(lines);
  }

  private String resolvePosSessionSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, POS_SESSION_SORT_KEYS, "openedAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "businessDate" -> "ps.business_date " + direction + ", ps.opened_at DESC, ps.id DESC";
      case "status" -> "ps.status " + direction + ", ps.opened_at DESC, ps.id DESC";
      case "managerId" -> "ps.manager_id " + direction + " NULLS LAST, ps.opened_at DESC, ps.id DESC";
      case "id" -> "ps.id " + direction;
      case "openedAt" -> "ps.opened_at " + direction + ", ps.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported pos session sort key");
    };
  }

  private void appendOutletScope(
      StringBuilder sql,
      List<Object> params,
      String column,
      Set<Long> outletIds
  ) {
    if (outletIds == null) {
      return;
    }
    sql.append(" AND ").append(column).append(" IN (");
    boolean first = true;
    for (Long outletId : outletIds) {
      if (!first) {
        sql.append(", ");
      }
      sql.append("?");
      params.add(outletId);
      first = false;
    }
    sql.append(")");
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws Exception {
    for (int i = 0; i < params.size(); i++) {
      Object value = params.get(i);
      if (value instanceof Long longValue) {
        ps.setLong(i + 1, longValue);
      } else if (value instanceof Integer integerValue) {
        ps.setInt(i + 1, integerValue);
      } else if (value instanceof String stringValue) {
        ps.setString(i + 1, stringValue);
      } else if (value instanceof Timestamp timestamp) {
        ps.setTimestamp(i + 1, timestamp);
      } else if (value instanceof LocalDate localDate) {
        ps.setObject(i + 1, localDate);
      } else {
        ps.setObject(i + 1, value);
      }
    }
  }

  private SalesDtos.PosSessionView mapPosSession(ResultSet rs) {
    try {
      Timestamp closedAt = rs.getTimestamp("closed_at");
      Object deviceId = rs.getObject("device_id");
      return new SalesDtos.PosSessionView(
          Long.toString(rs.getLong("id")),
          rs.getString("session_code"),
          rs.getLong("outlet_id"),
          rs.getString("currency_code"),
          rs.getLong("manager_id"),
          deviceId == null ? null : ((Number) deviceId).longValue(),
          rs.getString("register_code"),
          rs.getString("opened_by_username"),
          rs.getTimestamp("opened_at").toInstant(),
          closedAt == null ? null : closedAt.toInstant(),
          rs.getObject("business_date", LocalDate.class),
          rs.getString("status"),
          rs.getString("note")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map POS session", e);
    }
  }

  private SalesDtos.PosSessionListItemView mapPosSessionListItem(ResultSet rs) {
    try {
      Timestamp closedAt = rs.getTimestamp("closed_at");
      Object deviceId = rs.getObject("device_id");
      return new SalesDtos.PosSessionListItemView(
          Long.toString(rs.getLong("id")),
          rs.getString("session_code"),
          rs.getLong("outlet_id"),
          rs.getString("currency_code"),
          rs.getLong("manager_id"),
          deviceId == null ? null : ((Number) deviceId).longValue(),
          rs.getString("register_code"),
          rs.getString("opened_by_username"),
          rs.getTimestamp("opened_at").toInstant(),
          closedAt == null ? null : closedAt.toInstant(),
          rs.getObject("business_date", LocalDate.class),
          rs.getString("status"),
          rs.getString("note"),
          rs.getLong("order_count"),
          rs.getBigDecimal("total_revenue")
      );
    } catch (Exception e) {
      throw new IllegalStateException("Unable to map POS session list item", e);
    }
  }

  private boolean appUserExists(Connection conn, long userId) throws SQLException {
    try (PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM core.app_user WHERE id = ?")) {
      ps.setLong(1, userId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  private Long resolveRegisteredDeviceId(Connection conn, Long deviceId, long outletId) throws Exception {
    if (deviceId == null) {
      return null;
    }
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id
        FROM core.device_registry
        WHERE id = ?
          AND outlet_id = ?
          AND revoked_at IS NULL
        """
    )) {
      ps.setLong(1, deviceId);
      ps.setLong(2, outletId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? deviceId : null;
      }
    }
  }

  private void lockSyncEntity(Connection conn, long entityId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
      ps.setLong(1, entityId);
      ps.executeQuery();
    }
  }

  private static String normalizePaymentMethod(String paymentMethod) {
    if (paymentMethod == null || paymentMethod.isBlank()) {
      throw ServiceException.badRequest("paymentMethod is required");
    }
    String normalized = paymentMethod.trim().toLowerCase(Locale.ROOT)
        .replace('-', '_')
        .replace(' ', '_');
    return switch (normalized) {
      case "cash" -> "cash";
      case "card" -> "card";
      case "ewallet", "e_wallet" -> "ewallet";
      case "bank_transfer", "banktransfer" -> "bank_transfer";
      case "voucher" -> "voucher";
      default -> throw ServiceException.badRequest("Unsupported paymentMethod: " + paymentMethod);
    };
  }

  private static String mergeReconciliationNote(String existingNote, String reconciliationNote) {
    String incoming = trimToNull(reconciliationNote);
    if (incoming == null) {
      return null;
    }
    String existing = trimToNull(existingNote);
    if (existing == null) {
      return incoming;
    }
    if (existing.equals(incoming)) {
      return existing;
    }
    return existing + " | Reconciliation: " + incoming;
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

  private record LockedPosSessionRecord(
      long id,
      long outletId,
      String sessionCode,
      LocalDate businessDate,
      Instant openedAt,
      Instant closedAt,
      String status,
      String note
  ) {
  }
}
