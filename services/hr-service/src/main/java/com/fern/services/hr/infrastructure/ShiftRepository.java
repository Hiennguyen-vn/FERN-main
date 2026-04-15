package com.fern.services.hr.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.dorabets.common.middleware.ServiceException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class ShiftRepository extends BaseRepository {

  private static final Set<String> SHIFT_SORT_KEYS = Set.of("name", "code", "startTime", "outletId", "updatedAt");

  public ShiftRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record ShiftRecord(
      long id,
      long outletId,
      String code,
      String name,
      LocalTime startTime,
      LocalTime endTime,
      int breakMinutes,
      Instant deletedAt,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public void insert(
      long id,
      long outletId,
      String code,
      String name,
      LocalTime startTime,
      LocalTime endTime,
      int breakMinutes
  ) {
    execute(
        """
        INSERT INTO core.shift (id, outlet_id, code, name, start_time, end_time, break_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        id,
        outletId,
        code,
        name,
        Time.valueOf(startTime),
        Time.valueOf(endTime),
        breakMinutes
    );
  }

  public Optional<ShiftRecord> findById(long id) {
    return queryOne(
        """
        SELECT id, outlet_id, code, name, start_time, end_time, break_minutes, deleted_at, created_at, updated_at
        FROM core.shift
        WHERE id = ? AND deleted_at IS NULL
        """,
        this::mapShiftRecord,
        id
    );
  }

  public PagedResult<ShiftRecord> findByOutletId(
      Long outletId,
      Set<Long> scopedOutletIds,
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
            id, outlet_id, code, name, start_time, end_time, break_minutes, deleted_at, created_at, updated_at,
            COUNT(*) OVER() AS total_count
          FROM core.shift
          WHERE deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (outletId != null) {
        sql.append(" AND outlet_id = ?");
        params.add(outletId);
      }
      if (scopedOutletIds != null) {
        appendScopedOutletFilter(sql, params, scopedOutletIds);
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (COALESCE(code, '') ILIKE ? OR name ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (java.sql.PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (java.sql.ResultSet rs = ps.executeQuery()) {
          List<ShiftRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapShiftRecord(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public boolean existsByOutletIdAndCode(long outletId, String code) {
    return queryOne(
        """
        SELECT COUNT(*)
        FROM core.shift
        WHERE outlet_id = ? AND code = ? AND deleted_at IS NULL
        """,
        rs -> getLong(rs, 1) > 0,
        outletId,
        code
    ).orElse(false);
  }

  public boolean existsByOutletIdAndCodeExcluding(long outletId, String code, long excludeId) {
    return queryOne(
        """
        SELECT COUNT(*)
        FROM core.shift
        WHERE outlet_id = ? AND code = ? AND id <> ? AND deleted_at IS NULL
        """,
        rs -> getLong(rs, 1) > 0,
        outletId,
        code,
        excludeId
    ).orElse(false);
  }

  public void update(
      long id,
      String code,
      String name,
      LocalTime startTime,
      LocalTime endTime,
      Integer breakMinutes
  ) {
    execute(
        """
        UPDATE core.shift
        SET code = COALESCE(?, code),
            name = COALESCE(?, name),
            start_time = COALESCE(?, start_time),
            end_time = COALESCE(?, end_time),
            break_minutes = COALESCE(?, break_minutes),
            updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
        """,
        code,
        name,
        startTime == null ? null : Time.valueOf(startTime),
        endTime == null ? null : Time.valueOf(endTime),
        breakMinutes,
        id
    );
  }

  public void delete(long id) {
    execute("UPDATE core.shift SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?", id);
  }

  public List<ShiftRecord> findAssignedByOutletAndDate(long outletId, LocalDate date) {
    return queryList(
        """
        SELECT DISTINCT s.id, s.outlet_id, s.code, s.name, s.start_time, s.end_time,
               s.break_minutes, s.deleted_at, s.created_at, s.updated_at
        FROM core.shift s
        JOIN core.work_shift ws ON ws.shift_id = s.id
        WHERE s.outlet_id = ? AND ws.work_date = ? AND s.deleted_at IS NULL
        ORDER BY s.start_time
        """,
        this::mapShiftRecord,
        outletId,
        java.sql.Date.valueOf(date)
    );
  }

  private ShiftRecord mapShiftRecord(ResultSet rs) {
    try {
      return new ShiftRecord(
          rs.getLong("id"),
          rs.getLong("outlet_id"),
          rs.getString("code"),
          rs.getString("name"),
          rs.getTime("start_time").toLocalTime(),
          rs.getTime("end_time").toLocalTime(),
          rs.getInt("break_minutes"),
          toInstant(rs.getTimestamp("deleted_at")),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map shift row", e);
    }
  }

  private static long getLong(ResultSet rs, int column) {
    try {
      return rs.getLong(column);
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to read numeric column " + column, e);
    }
  }

  private static Instant toInstant(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toInstant();
  }

  private void bind(java.sql.PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  private void appendScopedOutletFilter(StringBuilder sql, List<Object> params, Set<Long> scopedOutletIds) {
    if (scopedOutletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND outlet_id IN (");
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

  private String resolveSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SHIFT_SORT_KEYS, "name");
    String direction = normalizeSortDir(sortDir, "asc");
    return switch (key) {
      case "name" -> "name " + direction + ", id ASC";
      case "code" -> "code " + direction + " NULLS LAST, name ASC, id ASC";
      case "startTime" -> "start_time " + direction + ", name ASC, id ASC";
      case "outletId" -> "outlet_id " + direction + ", name ASC, id ASC";
      case "updatedAt" -> "updated_at " + direction + ", id DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /hr/shifts");
    };
  }

  private String normalizeSortDir(String sortDir, String defaultDirection) {
    if (sortDir == null || sortDir.isBlank()) {
      return defaultDirection;
    }
    return QueryConventions.normalizeSortDir(sortDir);
  }
}
