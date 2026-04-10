package com.fern.services.payroll.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class PayrollRepository extends BaseRepository {

  private static final Set<String> PERIOD_SORT_KEYS = Set.of(
      "endDate", "startDate", "payDate", "name", "regionId", "createdAt", "updatedAt"
  );
  private static final Set<String> TIMESHEET_SORT_KEYS = Set.of(
      "updatedAt", "createdAt", "userId", "outletId", "payrollPeriodEndDate", "payrollPeriodStartDate",
      "workHours", "workDays", "overtimeHours"
  );
  private static final Set<String> PAYROLL_SORT_KEYS = Set.of(
      "createdAt", "updatedAt", "approvedAt", "status", "netSalary", "baseSalary", "payrollPeriodEndDate",
      "payrollPeriodStartDate", "userId", "outletId"
  );

  public PayrollRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record PayrollPeriodRecord(
      long id,
      long regionId,
      String name,
      LocalDate startDate,
      LocalDate endDate,
      LocalDate payDate,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollPeriodScopeRecord(
      long id,
      long regionId,
      String regionCode
  ) {
  }

  public record PayrollTimesheetRecord(
      long id,
      long payrollPeriodId,
      long userId,
      Long outletId,
      BigDecimal workDays,
      BigDecimal workHours,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate,
      int lateCount,
      BigDecimal absentDays,
      Long approvedByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollRecord(
      long id,
      long payrollTimesheetId,
      String currencyCode,
      BigDecimal baseSalaryAmount,
      BigDecimal netSalary,
      String status,
      Long approvedByUserId,
      Instant approvedAt,
      String paymentRef,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollTimesheetListItemRecord(
      long id,
      long payrollPeriodId,
      String payrollPeriodName,
      LocalDate payrollPeriodStartDate,
      LocalDate payrollPeriodEndDate,
      long userId,
      Long outletId,
      BigDecimal workDays,
      BigDecimal workHours,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate,
      int lateCount,
      BigDecimal absentDays,
      Long approvedByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollListItemRecord(
      long id,
      long payrollTimesheetId,
      long payrollPeriodId,
      String payrollPeriodName,
      long userId,
      Long outletId,
      String currencyCode,
      BigDecimal baseSalaryAmount,
      BigDecimal netSalary,
      String status,
      Long approvedByUserId,
      Instant approvedAt,
      String paymentRef,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollApprovalProjection(
      PayrollRecord payroll,
      long payrollPeriodId,
      long userId,
      Long outletId
  ) {
  }

  public void insertPeriod(
      long id,
      long regionId,
      String name,
      LocalDate startDate,
      LocalDate endDate,
      LocalDate payDate,
      String note
  ) {
    execute(
        """
        INSERT INTO core.payroll_period (id, region_id, name, start_date, end_date, pay_date, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        id,
        regionId,
        name,
        Date.valueOf(startDate),
        Date.valueOf(endDate),
        payDate == null ? null : Date.valueOf(payDate),
        note
    );
  }

  public Optional<PayrollPeriodRecord> findPeriod(long periodId) {
    return queryOne(
        """
        SELECT id, region_id, name, start_date, end_date, pay_date, note, created_at, updated_at
        FROM core.payroll_period
        WHERE id = ?
        """,
        this::mapPeriod,
        periodId
    );
  }

  public Optional<PayrollPeriodRecord> findPeriodByRegionAndWindow(long regionId, LocalDate startDate, LocalDate endDate) {
    return queryOne(
        """
        SELECT id, region_id, name, start_date, end_date, pay_date, note, created_at, updated_at
        FROM core.payroll_period
        WHERE region_id = ? AND start_date = ? AND end_date = ?
        """,
        this::mapPeriod,
        regionId,
        Date.valueOf(startDate),
        Date.valueOf(endDate)
    );
  }

  public Optional<PayrollPeriodScopeRecord> findPeriodScope(long periodId) {
    return queryOne(
        """
        SELECT pp.id, pp.region_id, r.code AS region_code
        FROM core.payroll_period pp
        JOIN core.region r ON r.id = pp.region_id
        WHERE pp.id = ?
        """,
        this::mapPeriodScope,
        periodId
    );
  }

  public PagedResult<PayrollPeriodRecord> listPeriods(
      Long regionId,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    StringBuilder sql = new StringBuilder(
        """
        SELECT id, region_id, name, start_date, end_date, pay_date, note, created_at, updated_at,
               COUNT(*) OVER() AS total_count
        FROM core.payroll_period
        WHERE 1 = 1
        """
    );
    List<Object> params = new ArrayList<>();
    if (regionId != null) {
      sql.append(" AND region_id = ?");
      params.add(regionId);
    }
    if (startDate != null) {
      sql.append(" AND end_date >= ?");
      params.add(Date.valueOf(startDate));
    }
    if (endDate != null) {
      sql.append(" AND start_date <= ?");
      params.add(Date.valueOf(endDate));
    }
    if (q != null) {
      sql.append(
          " AND (name ILIKE ? OR COALESCE(note, '') ILIKE ? OR CAST(id AS TEXT) ILIKE ? OR CAST(region_id AS TEXT) ILIKE ?)"
      );
      String pattern = "%" + q + "%";
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
    }
    sql.append(" ORDER BY ").append(periodOrderBy(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
    params.add(limit);
    params.add(offset);
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<PayrollPeriodRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPeriod(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public void insertTimesheet(
      long id,
      long payrollPeriodId,
      long userId,
      Long outletId,
      BigDecimal workDays,
      BigDecimal workHours,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate,
      int lateCount,
      BigDecimal absentDays,
      Long approvedByUserId
  ) {
    execute(
        """
        INSERT INTO core.payroll_timesheet (
          id, payroll_period_id, user_id, outlet_id, work_days, work_hours,
          overtime_hours, overtime_rate, late_count, absent_days, approved_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        id,
        payrollPeriodId,
        userId,
        outletId,
        workDays,
        workHours,
        overtimeHours,
        overtimeRate,
        lateCount,
        absentDays,
        approvedByUserId
    );
  }

  public Optional<PayrollTimesheetRecord> findTimesheet(long timesheetId) {
    return queryOne(
        """
        SELECT id, payroll_period_id, user_id, outlet_id, work_days, work_hours, overtime_hours,
               overtime_rate, late_count, absent_days, approved_by_user_id, created_at, updated_at
        FROM core.payroll_timesheet
        WHERE id = ?
        """,
        this::mapTimesheet,
        timesheetId
    );
  }

  public Optional<PayrollTimesheetRecord> findTimesheetByPeriodAndUser(long payrollPeriodId, long userId) {
    return queryOne(
        """
        SELECT id, payroll_period_id, user_id, outlet_id, work_days, work_hours, overtime_hours,
               overtime_rate, late_count, absent_days, approved_by_user_id, created_at, updated_at
        FROM core.payroll_timesheet
        WHERE payroll_period_id = ? AND user_id = ?
        """,
        this::mapTimesheet,
        payrollPeriodId,
        userId
    );
  }

  public boolean outletBelongsToRegionScope(long outletId, long regionId) {
    return queryOne(
        """
        WITH RECURSIVE region_scope AS (
          SELECT id
          FROM core.region
          WHERE id = ?
          UNION ALL
          SELECT child.id
          FROM core.region child
          JOIN region_scope scope ON child.parent_region_id = scope.id
        )
        SELECT EXISTS(
          SELECT 1
          FROM core.outlet o
          JOIN region_scope scope ON scope.id = o.region_id
          WHERE o.id = ? AND o.deleted_at IS NULL
        ) AS allowed
        """,
        rs -> mapBoolean(rs, "allowed", "Unable to map payroll outlet scope check"),
        regionId,
        outletId
    ).orElse(false);
  }

  public boolean userHasOutletScope(long userId, long outletId) {
    return queryOne(
        """
        SELECT EXISTS(
          SELECT 1
          FROM core.user_role
          WHERE user_id = ? AND outlet_id = ?
          UNION
          SELECT 1
          FROM core.user_permission
          WHERE user_id = ? AND outlet_id = ?
        ) AS allowed
        """,
        rs -> mapBoolean(rs, "allowed", "Unable to map payroll user scope check"),
        userId,
        outletId,
        userId,
        outletId
    ).orElse(false);
  }

  public PagedResult<PayrollTimesheetListItemRecord> listTimesheets(
      Long payrollPeriodId,
      Long userId,
      Long outletId,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    StringBuilder sql = new StringBuilder(
        """
        SELECT pt.id, pt.payroll_period_id, pp.name AS payroll_period_name, pp.start_date, pp.end_date,
               pt.user_id, pt.outlet_id, pt.work_days, pt.work_hours, pt.overtime_hours,
               pt.overtime_rate, pt.late_count, pt.absent_days, pt.approved_by_user_id, pt.created_at, pt.updated_at,
               COUNT(*) OVER() AS total_count
        FROM core.payroll_timesheet pt
        JOIN core.payroll_period pp ON pp.id = pt.payroll_period_id
        WHERE 1 = 1
        """
    );
    List<Object> params = new ArrayList<>();
    if (payrollPeriodId != null) {
      sql.append(" AND pt.payroll_period_id = ?");
      params.add(payrollPeriodId);
    }
    if (userId != null) {
      sql.append(" AND pt.user_id = ?");
      params.add(userId);
    }
    if (outletId != null) {
      sql.append(" AND pt.outlet_id = ?");
      params.add(outletId);
    }
    if (q != null) {
      sql.append(
          " AND (pp.name ILIKE ? OR CAST(pt.user_id AS TEXT) ILIKE ? OR CAST(pt.outlet_id AS TEXT) ILIKE ? OR CAST(pt.payroll_period_id AS TEXT) ILIKE ? OR CAST(pt.id AS TEXT) ILIKE ?)"
      );
      String pattern = "%" + q + "%";
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
    }
    sql.append(" ORDER BY ").append(timesheetOrderBy(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
    params.add(limit);
    params.add(offset);
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<PayrollTimesheetListItemRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapTimesheetListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public Optional<PayrollRecord> findPayroll(long payrollId) {
    return queryOne(
        """
        SELECT id, payroll_timesheet_id, currency_code, base_salary_amount, net_salary, status,
               approved_by_user_id, approved_at, payment_ref, note, created_at, updated_at
        FROM core.payroll
        WHERE id = ?
        """,
        this::mapPayroll,
        payrollId
    );
  }

  public PagedResult<PayrollListItemRecord> listPayroll(
      Long payrollPeriodId,
      Long userId,
      Long outletId,
      String status,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    StringBuilder sql = new StringBuilder(
        """
        SELECT p.id, p.payroll_timesheet_id, pt.payroll_period_id, pp.name AS payroll_period_name,
               pt.user_id, pt.outlet_id, p.currency_code, p.base_salary_amount, p.net_salary,
               p.status, p.approved_by_user_id, p.approved_at, p.payment_ref, p.note, p.created_at, p.updated_at,
               COUNT(*) OVER() AS total_count
        FROM core.payroll p
        JOIN core.payroll_timesheet pt ON pt.id = p.payroll_timesheet_id
        JOIN core.payroll_period pp ON pp.id = pt.payroll_period_id
        WHERE 1 = 1
        """
    );
    List<Object> params = new ArrayList<>();
    if (payrollPeriodId != null) {
      sql.append(" AND pt.payroll_period_id = ?");
      params.add(payrollPeriodId);
    }
    if (userId != null) {
      sql.append(" AND pt.user_id = ?");
      params.add(userId);
    }
    if (outletId != null) {
      sql.append(" AND pt.outlet_id = ?");
      params.add(outletId);
    }
    if (status != null && !status.isBlank()) {
      sql.append(" AND p.status = ?::payroll_status_enum");
      params.add(status.trim());
    }
    if (q != null) {
      sql.append(
          " AND (CAST(p.id AS TEXT) ILIKE ? OR CAST(pt.user_id AS TEXT) ILIKE ? OR CAST(pt.outlet_id AS TEXT) ILIKE ? OR COALESCE(p.payment_ref, '') ILIKE ? OR COALESCE(p.note, '') ILIKE ? OR p.status::text ILIKE ?)"
      );
      String pattern = "%" + q + "%";
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
    }
    sql.append(" ORDER BY ").append(payrollOrderBy(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
    params.add(limit);
    params.add(offset);
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<PayrollListItemRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapPayrollListItem(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public Optional<PayrollRecord> findPayrollByTimesheetId(long payrollTimesheetId) {
    return queryOne(
        """
        SELECT id, payroll_timesheet_id, currency_code, base_salary_amount, net_salary, status,
               approved_by_user_id, approved_at, payment_ref, note, created_at, updated_at
        FROM core.payroll
        WHERE payroll_timesheet_id = ?
        """,
        this::mapPayroll,
        payrollTimesheetId
    );
  }

  public PayrollRecord insertPayroll(
      long payrollId,
      long payrollTimesheetId,
      String currencyCode,
      BigDecimal baseSalaryAmount,
      BigDecimal netSalary,
      String note
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.payroll (
            id, payroll_timesheet_id, currency_code, base_salary_amount, net_salary, status, note
          ) VALUES (?, ?, ?, ?, ?, 'draft', ?)
          """
      )) {
        ps.setLong(1, payrollId);
        ps.setLong(2, payrollTimesheetId);
        ps.setString(3, currencyCode);
        ps.setBigDecimal(4, baseSalaryAmount);
        ps.setBigDecimal(5, netSalary);
        ps.setString(6, note);
        ps.executeUpdate();
      }
      return findPayrollTransactional(conn, payrollId)
          .orElseThrow(() -> new IllegalStateException("Payroll not found after create: " + payrollId));
    });
  }

  public PayrollApprovalProjection approvePayroll(long payrollId, Long approvedByUserId) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.payroll
          SET status = 'approved',
              approved_by_user_id = ?,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        if (approvedByUserId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, approvedByUserId);
        }
        ps.setLong(2, payrollId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT p.id, p.payroll_timesheet_id, p.currency_code, p.base_salary_amount, p.net_salary, p.status,
                 p.approved_by_user_id, p.approved_at, p.payment_ref, p.note, p.created_at, p.updated_at,
                 pt.payroll_period_id, pt.user_id, pt.outlet_id
          FROM core.payroll p
          JOIN core.payroll_timesheet pt ON pt.id = p.payroll_timesheet_id
          WHERE p.id = ?
          """
      )) {
        ps.setLong(1, payrollId);
        try (ResultSet rs = ps.executeQuery()) {
          if (!rs.next()) {
            throw new IllegalStateException("Payroll not found after approval: " + payrollId);
          }
          return new PayrollApprovalProjection(
              mapPayroll(rs),
              rs.getLong("payroll_period_id"),
              rs.getLong("user_id"),
              rs.getObject("outlet_id", Long.class)
          );
        }
      }
    });
  }

  private Optional<PayrollRecord> findPayrollTransactional(Connection conn, long payrollId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, payroll_timesheet_id, currency_code, base_salary_amount, net_salary, status,
               approved_by_user_id, approved_at, payment_ref, note, created_at, updated_at
        FROM core.payroll
        WHERE id = ?
        """
    )) {
      ps.setLong(1, payrollId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapPayroll(rs));
        }
        return Optional.empty();
      }
    }
  }

  private PayrollPeriodRecord mapPeriod(ResultSet rs) {
    try {
      return new PayrollPeriodRecord(
          rs.getLong("id"),
          rs.getLong("region_id"),
          rs.getString("name"),
          rs.getDate("start_date").toLocalDate(),
          rs.getDate("end_date").toLocalDate(),
          rs.getDate("pay_date") == null ? null : rs.getDate("pay_date").toLocalDate(),
          rs.getString("note"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map payroll period", e);
    }
  }

  private PayrollPeriodScopeRecord mapPeriodScope(ResultSet rs) {
    try {
      return new PayrollPeriodScopeRecord(
          rs.getLong("id"),
          rs.getLong("region_id"),
          rs.getString("region_code")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map payroll period scope", e);
    }
  }

  private PayrollTimesheetRecord mapTimesheet(ResultSet rs) {
    try {
      return new PayrollTimesheetRecord(
          rs.getLong("id"),
          rs.getLong("payroll_period_id"),
          rs.getLong("user_id"),
          rs.getObject("outlet_id", Long.class),
          rs.getBigDecimal("work_days"),
          rs.getBigDecimal("work_hours"),
          rs.getBigDecimal("overtime_hours"),
          rs.getBigDecimal("overtime_rate"),
          rs.getInt("late_count"),
          rs.getBigDecimal("absent_days"),
          rs.getObject("approved_by_user_id", Long.class),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map payroll timesheet", e);
    }
  }

  private PayrollTimesheetListItemRecord mapTimesheetListItem(ResultSet rs) {
    try {
      return new PayrollTimesheetListItemRecord(
          rs.getLong("id"),
          rs.getLong("payroll_period_id"),
          rs.getString("payroll_period_name"),
          rs.getDate("start_date").toLocalDate(),
          rs.getDate("end_date").toLocalDate(),
          rs.getLong("user_id"),
          rs.getObject("outlet_id", Long.class),
          rs.getBigDecimal("work_days"),
          rs.getBigDecimal("work_hours"),
          rs.getBigDecimal("overtime_hours"),
          rs.getBigDecimal("overtime_rate"),
          rs.getInt("late_count"),
          rs.getBigDecimal("absent_days"),
          rs.getObject("approved_by_user_id", Long.class),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map payroll timesheet list item", e);
    }
  }

  private PayrollRecord mapPayroll(ResultSet rs) {
    try {
      Timestamp approvedAt = rs.getTimestamp("approved_at");
      return new PayrollRecord(
          rs.getLong("id"),
          rs.getLong("payroll_timesheet_id"),
          rs.getString("currency_code"),
          rs.getBigDecimal("base_salary_amount"),
          rs.getBigDecimal("net_salary"),
          rs.getString("status"),
          rs.getObject("approved_by_user_id", Long.class),
          approvedAt == null ? null : approvedAt.toInstant(),
          rs.getString("payment_ref"),
          rs.getString("note"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map payroll", e);
    }
  }

  private PayrollListItemRecord mapPayrollListItem(ResultSet rs) {
    try {
      Timestamp approvedAt = rs.getTimestamp("approved_at");
      return new PayrollListItemRecord(
          rs.getLong("id"),
          rs.getLong("payroll_timesheet_id"),
          rs.getLong("payroll_period_id"),
          rs.getString("payroll_period_name"),
          rs.getLong("user_id"),
          rs.getObject("outlet_id", Long.class),
          rs.getString("currency_code"),
          rs.getBigDecimal("base_salary_amount"),
          rs.getBigDecimal("net_salary"),
          rs.getString("status"),
          rs.getObject("approved_by_user_id", Long.class),
          approvedAt == null ? null : approvedAt.toInstant(),
          rs.getString("payment_ref"),
          rs.getString("note"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map payroll list item", e);
    }
  }

  private boolean mapBoolean(ResultSet rs, String columnName, String errorMessage) {
    try {
      return rs.getBoolean(columnName);
    } catch (SQLException e) {
      throw new IllegalStateException(errorMessage, e);
    }
  }

  private String periodOrderBy(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PERIOD_SORT_KEYS, "endDate");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "startDate" -> "start_date " + direction + ", id DESC";
      case "payDate" -> "pay_date " + direction + " NULLS LAST, id DESC";
      case "name" -> "name " + direction + ", id DESC";
      case "regionId" -> "region_id " + direction + ", end_date DESC, id DESC";
      case "createdAt" -> "created_at " + direction + ", id DESC";
      case "updatedAt" -> "updated_at " + direction + ", id DESC";
      case "endDate" -> "end_date " + direction + ", start_date DESC, id DESC";
      default -> throw new IllegalStateException("Unsupported sort key");
    };
  }

  private String timesheetOrderBy(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, TIMESHEET_SORT_KEYS, "payrollPeriodEndDate");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "updatedAt" -> "pt.updated_at " + direction + ", pt.id DESC";
      case "createdAt" -> "pt.created_at " + direction + ", pt.id DESC";
      case "userId" -> "pt.user_id " + direction + ", pp.end_date DESC, pt.id DESC";
      case "outletId" -> "pt.outlet_id " + direction + " NULLS LAST, pp.end_date DESC, pt.id DESC";
      case "payrollPeriodStartDate" -> "pp.start_date " + direction + ", pt.updated_at DESC, pt.id DESC";
      case "workHours" -> "pt.work_hours " + direction + ", pp.end_date DESC, pt.id DESC";
      case "workDays" -> "pt.work_days " + direction + ", pp.end_date DESC, pt.id DESC";
      case "overtimeHours" -> "pt.overtime_hours " + direction + ", pp.end_date DESC, pt.id DESC";
      case "payrollPeriodEndDate" -> "pp.end_date " + direction + ", pt.updated_at DESC, pt.id DESC";
      default -> throw new IllegalStateException("Unsupported sort key");
    };
  }

  private String payrollOrderBy(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, PAYROLL_SORT_KEYS, "createdAt");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "updatedAt" -> "p.updated_at " + direction + ", p.id DESC";
      case "approvedAt" -> "p.approved_at " + direction + " NULLS LAST, p.created_at DESC, p.id DESC";
      case "status" -> "p.status " + direction + ", p.created_at DESC, p.id DESC";
      case "netSalary" -> "p.net_salary " + direction + ", p.created_at DESC, p.id DESC";
      case "baseSalary" -> "p.base_salary_amount " + direction + ", p.created_at DESC, p.id DESC";
      case "payrollPeriodEndDate" -> "pp.end_date " + direction + ", p.created_at DESC, p.id DESC";
      case "payrollPeriodStartDate" -> "pp.start_date " + direction + ", p.created_at DESC, p.id DESC";
      case "userId" -> "pt.user_id " + direction + ", p.created_at DESC, p.id DESC";
      case "outletId" -> "pt.outlet_id " + direction + " NULLS LAST, p.created_at DESC, p.id DESC";
      case "createdAt" -> "p.created_at " + direction + ", p.id DESC";
      default -> throw new IllegalStateException("Unsupported sort key");
    };
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }
}
