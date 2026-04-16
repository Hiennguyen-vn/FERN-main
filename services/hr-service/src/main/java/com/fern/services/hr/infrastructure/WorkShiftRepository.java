package com.fern.services.hr.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.dorabets.common.middleware.ServiceException;
import java.sql.Date;
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
public class WorkShiftRepository extends BaseRepository {

  private static final Set<String> WORK_SHIFT_SORT_KEYS =
      Set.of("workDate", "createdAt", "userId", "outletId", "approvalStatus");

  public WorkShiftRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record WorkShiftRecord(
      long id,
      long shiftId,
      long userId,
      LocalDate workDate,
      String workRole,
      String scheduleStatus,
      String attendanceStatus,
      String approvalStatus,
      Instant actualStartTime,
      Instant actualEndTime,
      Long assignedByUserId,
      Long approvedByUserId,
      String note,
      Instant createdAt,
      Instant updatedAt,
      long outletId,
      String userFullName,
      String userUsername
  ) {
  }

  public void insert(
      long id,
      long shiftId,
      long userId,
      LocalDate workDate,
      String workRole,
      String scheduleStatus,
      String attendanceStatus,
      String approvalStatus,
      Long assignedByUserId,
      String note
  ) {
    execute(
        """
        INSERT INTO core.work_shift (
          id, shift_id, user_id, work_date, work_role, schedule_status, attendance_status,
          approval_status, assigned_by_user_id, note
        ) VALUES (?, ?, ?, ?, ?::core.work_role_enum, ?::shift_schedule_status_enum, ?::attendance_status_enum,
                  ?::approval_status_enum, ?, ?)
        """,
        id,
        shiftId,
        userId,
        Date.valueOf(workDate),
        workRole,
        scheduleStatus,
        attendanceStatus,
        approvalStatus,
        assignedByUserId,
        note
    );
  }

  public Optional<WorkShiftRecord> findById(long id) {
    return queryOne(
        """
        SELECT ws.id, ws.shift_id, ws.user_id, ws.work_date, ws.work_role, ws.schedule_status, ws.attendance_status,
               ws.approval_status, ws.actual_start_time, ws.actual_end_time, ws.assigned_by_user_id,
               ws.approved_by_user_id, ws.note, ws.created_at, ws.updated_at, s.outlet_id,
               u.full_name AS user_full_name, u.username AS user_username
        FROM core.work_shift ws
        JOIN core.shift s ON s.id = ws.shift_id
        LEFT JOIN core.app_user u ON u.id = ws.user_id
        WHERE ws.id = ? AND s.deleted_at IS NULL
        """,
        this::mapWorkShiftRecord,
        id
    );
  }

  public boolean existsAssignment(long shiftId, long userId, LocalDate workDate) {
    return queryOne(
        """
        SELECT COUNT(*)
        FROM core.work_shift
        WHERE shift_id = ? AND user_id = ? AND work_date = ?
        """,
        rs -> {
          try {
            return rs.getLong(1) > 0;
          } catch (SQLException e) {
            throw new IllegalStateException("Unable to read work shift assignment count", e);
          }
        },
        shiftId,
        userId,
        Date.valueOf(workDate)
    ).orElse(false);
  }

  public PagedResult<WorkShiftRecord> search(
      Long userId,
      Long outletId,
      Set<Long> scopedOutletIds,
      LocalDate startDate,
      LocalDate endDate,
      String scheduleStatus,
      String attendanceStatus,
      String approvalStatus,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            ws.id, ws.shift_id, ws.user_id, ws.work_date, ws.work_role, ws.schedule_status, ws.attendance_status,
            ws.approval_status, ws.actual_start_time, ws.actual_end_time, ws.assigned_by_user_id,
            ws.approved_by_user_id, ws.note, ws.created_at, ws.updated_at, s.outlet_id,
            u.full_name AS user_full_name, u.username AS user_username,
            COUNT(*) OVER() AS total_count
          FROM core.work_shift ws
          JOIN core.shift s ON s.id = ws.shift_id
          LEFT JOIN core.app_user u ON u.id = ws.user_id
          WHERE s.deleted_at IS NULL
            AND ws.work_date BETWEEN ? AND ?
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(Date.valueOf(startDate));
      params.add(Date.valueOf(endDate));
      if (userId != null) {
        sql.append(" AND ws.user_id = ?");
        params.add(userId);
      }
      if (outletId != null) {
        sql.append(" AND s.outlet_id = ?");
        params.add(outletId);
      }
      if (scopedOutletIds != null) {
        appendScopedOutletFilter(sql, params, "s.outlet_id", scopedOutletIds);
      }
      if (scheduleStatus != null && !scheduleStatus.isBlank()) {
        sql.append(" AND ws.schedule_status = ?::shift_schedule_status_enum");
        params.add(scheduleStatus.trim());
      }
      if (attendanceStatus != null && !attendanceStatus.isBlank()) {
        sql.append(" AND ws.attendance_status = ?::attendance_status_enum");
        params.add(attendanceStatus.trim());
      }
      if (approvalStatus != null && !approvalStatus.isBlank()) {
        sql.append(" AND ws.approval_status = ?::approval_status_enum");
        params.add(approvalStatus.trim());
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (COALESCE(ws.note, '') ILIKE ? OR CAST(ws.user_id AS TEXT) ILIKE ? OR CAST(ws.id AS TEXT) ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);

      try (java.sql.PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (java.sql.ResultSet rs = ps.executeQuery()) {
          List<WorkShiftRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapWorkShiftRecord(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public List<WorkShiftRecord> findByUserIdAndDateRange(long userId, LocalDate startDate, LocalDate endDate) {
    return queryList(
        """
        SELECT ws.id, ws.shift_id, ws.user_id, ws.work_date, ws.work_role, ws.schedule_status, ws.attendance_status,
               ws.approval_status, ws.actual_start_time, ws.actual_end_time, ws.assigned_by_user_id,
               ws.approved_by_user_id, ws.note, ws.created_at, ws.updated_at, s.outlet_id,
               u.full_name AS user_full_name, u.username AS user_username
        FROM core.work_shift ws
        JOIN core.shift s ON s.id = ws.shift_id
        LEFT JOIN core.app_user u ON u.id = ws.user_id
        WHERE ws.user_id = ? AND ws.work_date BETWEEN ? AND ? AND s.deleted_at IS NULL
        ORDER BY ws.work_date DESC, ws.created_at DESC
        """,
        this::mapWorkShiftRecord,
        userId,
        Date.valueOf(startDate),
        Date.valueOf(endDate)
    );
  }

  public List<WorkShiftRecord> findByOutletIdAndDate(long outletId, LocalDate date) {
    return queryList(
        """
        SELECT ws.id, ws.shift_id, ws.user_id, ws.work_date, ws.work_role, ws.schedule_status, ws.attendance_status,
               ws.approval_status, ws.actual_start_time, ws.actual_end_time, ws.assigned_by_user_id,
               ws.approved_by_user_id, ws.note, ws.created_at, ws.updated_at, s.outlet_id,
               u.full_name AS user_full_name, u.username AS user_username
        FROM core.work_shift ws
        JOIN core.shift s ON s.id = ws.shift_id
        LEFT JOIN core.app_user u ON u.id = ws.user_id
        WHERE s.outlet_id = ? AND ws.work_date = ? AND s.deleted_at IS NULL
        ORDER BY ws.created_at DESC
        """,
        this::mapWorkShiftRecord,
        outletId,
        Date.valueOf(date)
    );
  }

  /** Distinct staff who have ever worked at this outlet — used for assign dropdowns */
  public List<StaffSummary> findDistinctStaffByOutlet(long outletId) {
    return queryList(
        """
        SELECT DISTINCT u.id, u.full_name, u.username, u.employee_code, u.email, u.status
        FROM core.work_shift ws
        JOIN core.shift s ON s.id = ws.shift_id
        JOIN core.app_user u ON u.id = ws.user_id
        WHERE s.outlet_id = ?
          AND s.deleted_at IS NULL
          AND u.status = 'active'
        ORDER BY u.full_name NULLS LAST, u.username
        """,
        rs -> {
          try {
            return new StaffSummary(
                rs.getLong("id"),
                rs.getString("full_name"),
                rs.getString("username"),
                rs.getString("employee_code"),
                rs.getString("email"),
                rs.getString("status")
            );
          } catch (SQLException e) {
            throw new IllegalStateException("Unable to map staff summary row", e);
          }
        },
        outletId
    );
  }

  public record StaffSummary(
      long id,
      String fullName,
      String username,
      String employeeCode,
      String email,
      String status
  ) {}

  public void updateAttendance(
      long id,
      String attendanceStatus,
      Instant actualStartTime,
      Instant actualEndTime,
      String note
  ) {
    execute(
        """
        UPDATE core.work_shift
        SET attendance_status = COALESCE(?::attendance_status_enum, attendance_status),
            actual_start_time = COALESCE(?, actual_start_time),
            actual_end_time = COALESCE(?, actual_end_time),
            note = COALESCE(?, note),
            updated_at = NOW()
        WHERE id = ?
        """,
        attendanceStatus,
        actualStartTime == null ? null : Timestamp.from(actualStartTime),
        actualEndTime == null ? null : Timestamp.from(actualEndTime),
        note,
        id
    );
  }

  public void approve(long id, Long approvedByUserId) {
    execute(
        """
        UPDATE core.work_shift
        SET approval_status = 'approved',
            approved_by_user_id = ?,
            updated_at = NOW()
        WHERE id = ?
        """,
        approvedByUserId,
        id
    );
  }

  public void reject(long id, Long approvedByUserId, String reason) {
    execute(
        """
        UPDATE core.work_shift
        SET approval_status = 'rejected',
            approved_by_user_id = ?,
            note = CASE
                WHEN ? IS NULL THEN note
                WHEN note IS NULL OR note = '' THEN ?
                ELSE note || E'\n\nRejection: ' || ?
              END,
            updated_at = NOW()
        WHERE id = ?
        """,
        approvedByUserId,
        reason,
        reason == null ? null : "Rejection: " + reason,
        reason,
        id
    );
  }

  private WorkShiftRecord mapWorkShiftRecord(ResultSet rs) {
    try {
      return new WorkShiftRecord(
          rs.getLong("id"),
          rs.getLong("shift_id"),
          rs.getLong("user_id"),
          rs.getDate("work_date").toLocalDate(),
          rs.getString("work_role"),
          rs.getString("schedule_status"),
          rs.getString("attendance_status"),
          rs.getString("approval_status"),
          toInstant(rs.getTimestamp("actual_start_time")),
          toInstant(rs.getTimestamp("actual_end_time")),
          rs.getObject("assigned_by_user_id", Long.class),
          rs.getObject("approved_by_user_id", Long.class),
          rs.getString("note"),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant(),
          rs.getLong("outlet_id"),
          rs.getString("user_full_name"),
          rs.getString("user_username")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map work shift row", e);
    }
  }

  private static Instant toInstant(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toInstant();
  }

  private String resolveSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, WORK_SHIFT_SORT_KEYS, "workDate");
    String direction = normalizeSortDir(sortDir, "workDate".equals(key) ? "desc" : "asc");
    return switch (key) {
      case "workDate" -> "ws.work_date " + direction + ", ws.created_at DESC, ws.id DESC";
      case "createdAt" -> "ws.created_at " + direction + ", ws.id DESC";
      case "userId" -> "ws.user_id " + direction + ", ws.work_date DESC, ws.id DESC";
      case "outletId" -> "s.outlet_id " + direction + ", ws.work_date DESC, ws.id DESC";
      case "approvalStatus" -> "ws.approval_status " + direction + ", ws.work_date DESC, ws.id DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /hr/work-shifts");
    };
  }

  private String normalizeSortDir(String sortDir, String defaultDirection) {
    if (sortDir == null || sortDir.isBlank()) {
      return defaultDirection;
    }
    return QueryConventions.normalizeSortDir(sortDir);
  }

  private void bind(java.sql.PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  private void appendScopedOutletFilter(
      StringBuilder sql,
      List<Object> params,
      String column,
      Set<Long> scopedOutletIds
  ) {
    if (scopedOutletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND ").append(column).append(" IN (");
    appendPlaceholders(sql, scopedOutletIds.size());
    sql.append(')');
    params.addAll(scopedOutletIds);
  }

  private void appendPlaceholders(StringBuilder sql, int count) {
    for (int i = 0; i < count; i++) {
      if (i > 0) {
        sql.append(", ");
      }
      sql.append('?');
    }
  }
}
