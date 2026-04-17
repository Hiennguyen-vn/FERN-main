package com.fern.services.hr.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class HrEmployeeRepository extends BaseRepository {

  private static final Set<String> SORT_KEYS = Set.of("fullName", "username", "employeeCode", "status", "createdAt");

  public HrEmployeeRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record EmployeeRecord(
      long id,
      String username,
      String fullName,
      String employeeCode,
      String email,
      String phone,
      String status,
      String gender,
      LocalDate dob,
      Instant createdAt,
      // Latest active contract fields (nullable)
      Long contractId,
      String employmentType,
      String salaryType,
      BigDecimal baseSalary,
      String currencyCode,
      String regionCode,
      LocalDate contractStartDate,
      LocalDate contractEndDate,
      String contractStatus
  ) {}

  public PagedResult<EmployeeRecord> findEmployees(
      String searchQuery,
      String status,
      Set<Long> outletIds,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    String effectiveSortBy = QueryConventions.normalizeSortBy(sortBy, SORT_KEYS, "fullName");
    String effectiveSortDir = QueryConventions.normalizeSortDir(sortDir);

    String sortColumn = switch (effectiveSortBy) {
      case "username" -> "u.username";
      case "employeeCode" -> "u.employee_code";
      case "status" -> "u.status";
      case "createdAt" -> "u.created_at";
      default -> "u.full_name";
    };

    StringBuilder where = new StringBuilder("WHERE u.deleted_at IS NULL");
    List<Object> params = new ArrayList<>();

    if (searchQuery != null && !searchQuery.isBlank()) {
      where.append(" AND (u.full_name ILIKE ? OR u.username ILIKE ? OR u.employee_code ILIKE ? OR u.email ILIKE ?)");
      String pattern = "%" + searchQuery.trim() + "%";
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
    }

    if (status != null && !status.isBlank()) {
      where.append(" AND u.status = ?");
      params.add(status.trim());
    }

    if (outletIds != null && !outletIds.isEmpty()) {
      // Employee contracts do not carry outlet_id directly, so outlet membership must be inferred
      // from outlet-scoped role/permission assignments or from actual work-shift history.
      where.append(" AND (");
      where.append(
          """
          EXISTS (
            SELECT 1
            FROM (
              SELECT ur.outlet_id
              FROM core.user_role ur
              WHERE ur.user_id = u.id
              UNION
              SELECT up.outlet_id
              FROM core.user_permission up
              WHERE up.user_id = u.id
            ) scoped_outlets
            WHERE scoped_outlets.outlet_id IN (
          """
      );
      appendPlaceholders(where, outletIds.size());
      where.append("))");
      outletIds.forEach(params::add);
      where.append(
          """
           OR EXISTS (
            SELECT 1
            FROM core.work_shift ws
            JOIN core.shift s ON s.id = ws.shift_id
            WHERE ws.user_id = u.id
              AND s.deleted_at IS NULL
              AND s.outlet_id IN (
          """
      );
      appendPlaceholders(where, outletIds.size());
      where.append(")))");
      outletIds.forEach(params::add);
    }

    // Count query
    String countSql = "SELECT COUNT(*) FROM core.app_user u " + where;
    long total = queryCount(countSql, params.toArray());

    // Main query with LEFT JOIN on latest active contract
    String dataSql = """
        SELECT u.id, u.username, u.full_name, u.employee_code, u.email, u.phone, u.status, u.gender, u.dob, u.created_at,
               c.id AS contract_id, c.employment_type, c.salary_type, c.base_salary, c.currency_code, c.region_code,
               c.start_date AS contract_start_date, c.end_date AS contract_end_date, c.status AS contract_status
        FROM core.app_user u
        LEFT JOIN LATERAL (
            SELECT ec.id, ec.employment_type, ec.salary_type, ec.base_salary, ec.currency_code, ec.region_code,
                   ec.start_date, ec.end_date, ec.status
            FROM core.employee_contract ec
            WHERE ec.user_id = u.id AND ec.deleted_at IS NULL AND ec.status = 'active'
            ORDER BY ec.start_date DESC
            LIMIT 1
        ) c ON true
        """ + where + " ORDER BY " + sortColumn + " " + effectiveSortDir + " NULLS LAST LIMIT ? OFFSET ?";

    List<Object> dataParams = new ArrayList<>(params);
    dataParams.add(limit);
    dataParams.add(offset);

    List<EmployeeRecord> items = queryList(dataSql, this::mapEmployee, dataParams.toArray());
    return new PagedResult<>(items, limit, offset, total, offset + limit < total);
  }

  public Optional<EmployeeRecord> findById(long userId) {
    return queryOne(
        """
        SELECT u.id, u.username, u.full_name, u.employee_code, u.email, u.phone, u.status, u.gender, u.dob, u.created_at,
               c.id AS contract_id, c.employment_type, c.salary_type, c.base_salary, c.currency_code, c.region_code,
               c.start_date AS contract_start_date, c.end_date AS contract_end_date, c.status AS contract_status
        FROM core.app_user u
        LEFT JOIN LATERAL (
            SELECT ec.id, ec.employment_type, ec.salary_type, ec.base_salary, ec.currency_code, ec.region_code,
                   ec.start_date, ec.end_date, ec.status
            FROM core.employee_contract ec
            WHERE ec.user_id = u.id AND ec.deleted_at IS NULL AND ec.status = 'active'
            ORDER BY ec.start_date DESC
            LIMIT 1
        ) c ON true
        WHERE u.id = ? AND u.deleted_at IS NULL
        """,
        this::mapEmployee,
        userId
    );
  }

  private EmployeeRecord mapEmployee(ResultSet rs) {
    try {
      Long contractId = rs.getObject("contract_id") != null ? rs.getLong("contract_id") : null;
      return new EmployeeRecord(
          rs.getLong("id"),
          rs.getString("username"),
          rs.getString("full_name"),
          rs.getString("employee_code"),
          rs.getString("email"),
          rs.getString("phone"),
          rs.getString("status"),
          rs.getString("gender"),
          rs.getObject("dob") != null ? rs.getDate("dob").toLocalDate() : null,
          rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null,
          contractId,
          contractId != null ? rs.getString("employment_type") : null,
          contractId != null ? rs.getString("salary_type") : null,
          contractId != null ? rs.getBigDecimal("base_salary") : null,
          contractId != null ? rs.getString("currency_code") : null,
          contractId != null ? rs.getString("region_code") : null,
          contractId != null && rs.getDate("contract_start_date") != null ? rs.getDate("contract_start_date").toLocalDate() : null,
          contractId != null && rs.getDate("contract_end_date") != null ? rs.getDate("contract_end_date").toLocalDate() : null,
          contractId != null ? rs.getString("contract_status") : null
      );
    } catch (java.sql.SQLException e) {
      throw new RuntimeException("Failed to map employee record", e);
    }
  }

  private long queryCount(String sql, Object... params) {
    return queryOne(sql, rs -> {
      try {
        return rs.getLong(1);
      } catch (java.sql.SQLException e) {
        throw new RuntimeException(e);
      }
    }, params).orElse(0L);
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
