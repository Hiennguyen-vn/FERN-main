package com.fern.services.hr.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.dorabets.common.middleware.ServiceException;
import java.math.BigDecimal;
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
public class EmployeeContractRepository extends BaseRepository {

  private static final Set<String> CONTRACT_SORT_KEYS = Set.of("startDate", "endDate", "status", "createdAt", "userId");

  public EmployeeContractRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record ContractRecord(
      long id,
      long userId,
      String employmentType,
      String salaryType,
      BigDecimal baseSalary,
      String currencyCode,
      String regionCode,
      String taxCode,
      String bankAccount,
      LocalDate hireDate,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      Long createdByUserId,
      Instant deletedAt,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public void insert(
      long id,
      long userId,
      String employmentType,
      String salaryType,
      BigDecimal baseSalary,
      String currencyCode,
      String regionCode,
      String taxCode,
      String bankAccount,
      LocalDate hireDate,
      LocalDate startDate,
      LocalDate endDate,
      String status,
      Long createdByUserId
  ) {
    execute(
        """
        INSERT INTO core.employee_contract (
          id, user_id, employment_type, salary_type, base_salary, currency_code, region_code,
          tax_code, bank_account, hire_date, start_date, end_date, status, created_by_user_id
        ) VALUES (?, ?, ?::employment_type_enum, ?::salary_type_enum, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?::contract_status_enum, ?)
        """,
        id,
        userId,
        employmentType,
        salaryType,
        baseSalary,
        currencyCode,
        regionCode,
        taxCode,
        bankAccount,
        hireDate == null ? null : Date.valueOf(hireDate),
        Date.valueOf(startDate),
        endDate == null ? null : Date.valueOf(endDate),
        status,
        createdByUserId
    );
  }

  public Optional<ContractRecord> findById(long id) {
    return queryOne(
        """
        SELECT id, user_id, employment_type, salary_type, base_salary, currency_code, region_code,
               tax_code, bank_account, hire_date, start_date, end_date, status, created_by_user_id,
               deleted_at, created_at, updated_at
        FROM core.employee_contract
        WHERE id = ? AND deleted_at IS NULL
        """,
        this::mapContractRecord,
        id
    );
  }

  public List<ContractRecord> findByUserId(long userId) {
    return queryList(
        """
        SELECT id, user_id, employment_type, salary_type, base_salary, currency_code, region_code,
               tax_code, bank_account, hire_date, start_date, end_date, status, created_by_user_id,
               deleted_at, created_at, updated_at
        FROM core.employee_contract
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY start_date DESC, created_at DESC
        """,
        this::mapContractRecord,
        userId
    );
  }

  public PagedResult<ContractRecord> findContracts(
      Long userId,
      Long outletId,
      Set<Long> scopedOutletIds,
      Set<String> scopedRegionCodes,
      String status,
      LocalDate startDateFrom,
      LocalDate startDateTo,
      LocalDate endDateFrom,
      LocalDate endDateTo,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, user_id, employment_type, salary_type, base_salary, currency_code, region_code,
                 tax_code, bank_account, hire_date, start_date, end_date, status, created_by_user_id,
                 deleted_at, created_at, updated_at, COUNT(*) OVER() AS total_count
          FROM core.employee_contract
          WHERE deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      if (userId != null) {
        sql.append(" AND user_id = ?");
        params.add(userId);
      }
      if (status != null && !status.isBlank()) {
        sql.append(" AND status = ?::contract_status_enum");
        params.add(status.trim());
      }
      if (startDateFrom != null) {
        sql.append(" AND start_date >= ?");
        params.add(Date.valueOf(startDateFrom));
      }
      if (startDateTo != null) {
        sql.append(" AND start_date <= ?");
        params.add(Date.valueOf(startDateTo));
      }
      if (endDateFrom != null) {
        sql.append(" AND end_date IS NOT NULL AND end_date >= ?");
        params.add(Date.valueOf(endDateFrom));
      }
      if (endDateTo != null) {
        sql.append(" AND end_date IS NOT NULL AND end_date <= ?");
        params.add(Date.valueOf(endDateTo));
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (CAST(user_id AS TEXT) ILIKE ? OR COALESCE(tax_code, '') ILIKE ? OR COALESCE(bank_account, '') ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      if (outletId != null) {
        sql.append(
            """
             AND (
               EXISTS (
                 SELECT 1
                 FROM core.user_role ur
                 WHERE ur.user_id = employee_contract.user_id
                   AND ur.outlet_id = ?
               )
               OR EXISTS (
                 SELECT 1
                 FROM core.user_permission up
                 WHERE up.user_id = employee_contract.user_id
                   AND up.outlet_id = ?
               )
             )
            """
        );
        params.add(outletId);
        params.add(outletId);
      }
      appendScopeFilter(sql, params, scopedOutletIds, scopedRegionCodes);
      sql.append(" ORDER BY ").append(resolveSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        for (int i = 0; i < params.size(); i++) {
          ps.setObject(i + 1, params.get(i));
        }
        try (ResultSet rs = ps.executeQuery()) {
          List<ContractRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapContractRecord(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public List<ContractRecord> findActiveContracts(Set<Long> scopedOutletIds, Set<String> scopedRegionCodes) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT id, user_id, employment_type, salary_type, base_salary, currency_code, region_code,
                 tax_code, bank_account, hire_date, start_date, end_date, status, created_by_user_id,
                 deleted_at, created_at, updated_at
          FROM core.employee_contract
          WHERE status = 'active' AND deleted_at IS NULL
          """
      );
      List<Object> params = new ArrayList<>();
      appendScopeFilter(sql, params, scopedOutletIds, scopedRegionCodes);
      sql.append(" ORDER BY user_id, start_date DESC");
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        for (int i = 0; i < params.size(); i++) {
          ps.setObject(i + 1, params.get(i));
        }
        try (ResultSet rs = ps.executeQuery()) {
          List<ContractRecord> rows = new ArrayList<>();
          while (rs.next()) {
            rows.add(mapContractRecord(rs));
          }
          return rows;
        }
      }
    });
  }

  public Optional<ContractRecord> findLatestActiveByUserId(long userId) {
    return queryOne(
        """
        SELECT id, user_id, employment_type, salary_type, base_salary, currency_code, region_code,
               tax_code, bank_account, hire_date, start_date, end_date, status, created_by_user_id,
               deleted_at, created_at, updated_at
        FROM core.employee_contract
        WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL
        ORDER BY start_date DESC, created_at DESC
        LIMIT 1
        """,
        this::mapContractRecord,
        userId
    );
  }

  public void update(
      long id,
      String employmentType,
      String salaryType,
      BigDecimal baseSalary,
      String currencyCode,
      String regionCode,
      String taxCode,
      String bankAccount,
      LocalDate hireDate,
      LocalDate startDate,
      LocalDate endDate,
      String status
  ) {
    execute(
        """
        UPDATE core.employee_contract
        SET employment_type = COALESCE(?::employment_type_enum, employment_type),
            salary_type = COALESCE(?::salary_type_enum, salary_type),
            base_salary = COALESCE(?, base_salary),
            currency_code = COALESCE(?, currency_code),
            region_code = COALESCE(?, region_code),
            tax_code = COALESCE(?, tax_code),
            bank_account = COALESCE(?, bank_account),
            hire_date = COALESCE(?, hire_date),
            start_date = COALESCE(?, start_date),
            end_date = COALESCE(?, end_date),
            status = COALESCE(?::contract_status_enum, status),
            updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
        """,
        employmentType,
        salaryType,
        baseSalary,
        currencyCode,
        regionCode,
        taxCode,
        bankAccount,
        hireDate == null ? null : Date.valueOf(hireDate),
        startDate == null ? null : Date.valueOf(startDate),
        endDate == null ? null : Date.valueOf(endDate),
        status,
        id
    );
  }

  public void terminate(long id, LocalDate endDate) {
    execute(
        """
        UPDATE core.employee_contract
        SET status = 'terminated',
            end_date = COALESCE(?, end_date),
            updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
        """,
        endDate == null ? null : Date.valueOf(endDate),
        id
    );
  }

  private ContractRecord mapContractRecord(ResultSet rs) {
    try {
      return new ContractRecord(
          rs.getLong("id"),
          rs.getLong("user_id"),
          rs.getString("employment_type"),
          rs.getString("salary_type"),
          rs.getBigDecimal("base_salary"),
          rs.getString("currency_code"),
          rs.getString("region_code"),
          rs.getString("tax_code"),
          rs.getString("bank_account"),
          toLocalDate(rs.getDate("hire_date")),
          rs.getDate("start_date").toLocalDate(),
          toLocalDate(rs.getDate("end_date")),
          rs.getString("status"),
          rs.getObject("created_by_user_id", Long.class),
          toInstant(rs.getTimestamp("deleted_at")),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map contract row", e);
    }
  }

  private static LocalDate toLocalDate(Date value) {
    return value == null ? null : value.toLocalDate();
  }

  private static Instant toInstant(Timestamp value) {
    return value == null ? null : value.toInstant();
  }

  private void appendScopeFilter(
      StringBuilder sql,
      List<Object> params,
      Set<Long> scopedOutletIds,
      Set<String> scopedRegionCodes
  ) {
    if (scopedOutletIds == null && scopedRegionCodes == null) {
      return;
    }
    boolean hasOutletScope = scopedOutletIds != null && !scopedOutletIds.isEmpty();
    boolean hasRegionScope = scopedRegionCodes != null && !scopedRegionCodes.isEmpty();
    if (!hasOutletScope && !hasRegionScope) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND (");
    boolean appended = false;
    if (hasRegionScope) {
      sql.append(" region_code IN (");
      appendPlaceholders(sql, scopedRegionCodes.size());
      sql.append(')');
      params.addAll(scopedRegionCodes);
      appended = true;
    }
    if (hasOutletScope) {
      if (appended) {
        sql.append(" OR ");
      }
      sql.append(
          """
          EXISTS (
            SELECT 1
            FROM (
              SELECT ur.outlet_id
              FROM core.user_role ur
              WHERE ur.user_id = employee_contract.user_id
              UNION
              SELECT up.outlet_id
              FROM core.user_permission up
              WHERE up.user_id = employee_contract.user_id
            ) scoped_outlets
            WHERE scoped_outlets.outlet_id IN (
          """
      );
      appendPlaceholders(sql, scopedOutletIds.size());
      sql.append("))");
      params.addAll(scopedOutletIds);
    }
    sql.append(')');
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
    String key = QueryConventions.normalizeSortBy(sortBy, CONTRACT_SORT_KEYS, "startDate");
    String direction = normalizeSortDir(sortDir, "desc");
    return switch (key) {
      case "startDate" -> "start_date " + direction + ", created_at DESC";
      case "endDate" -> "end_date " + direction + " NULLS LAST, created_at DESC";
      case "status" -> "status " + direction + ", start_date DESC, created_at DESC";
      case "createdAt" -> "created_at " + direction + ", id DESC";
      case "userId" -> "user_id " + direction + ", start_date DESC, created_at DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /hr/contracts");
    };
  }

  private String normalizeSortDir(String sortDir, String defaultDirection) {
    if (sortDir == null || sortDir.isBlank()) {
      return defaultDirection;
    }
    return QueryConventions.normalizeSortDir(sortDir);
  }
}
