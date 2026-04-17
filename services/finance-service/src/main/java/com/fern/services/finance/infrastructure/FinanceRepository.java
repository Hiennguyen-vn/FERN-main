package com.fern.services.finance.infrastructure;

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
public class FinanceRepository extends BaseRepository {

  private static final Set<String> EXPENSE_SORT_KEYS = Set.of("businessDate", "createdAt", "amount", "sourceType", "id");

  public FinanceRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record ExpenseRecord(
      long id,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount,
      String sourceType,
      String note,
      Long createdByUserId,
      Instant createdAt,
      Instant updatedAt,
      String subtype,
      String description
  ) {
  }

  public record GoodsReceiptExpenseCandidate(
      long goodsReceiptId,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal totalPrice
  ) {
  }

  public record PayrollExpenseCandidate(
      long payrollId,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount
  ) {
  }

  public Optional<ExpenseRecord> findExpense(long expenseId) {
    return queryOne(baseExpenseSql() + " WHERE er.id = ?", this::mapExpense, expenseId);
  }

  public PagedResult<ExpenseRecord> listExpenses(
      Long outletId,
      LocalDate startDate,
      LocalDate endDate,
      String sourceType,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT expense_rows.*, COUNT(*) OVER() AS total_count
          FROM (
          """
      );
      sql.append(baseExpenseSql()).append(" WHERE 1 = 1");
      List<Object> params = new ArrayList<>();
      if (outletId != null) {
        sql.append(" AND er.outlet_id = ?");
        params.add(outletId);
      }
      if (startDate != null) {
        sql.append(" AND er.business_date >= ?");
        params.add(Date.valueOf(startDate));
      }
      if (endDate != null) {
        sql.append(" AND er.business_date <= ?");
        params.add(Date.valueOf(endDate));
      }
      if (sourceType != null && !sourceType.isBlank()) {
        sql.append(" AND er.source_type = ?::expense_source_type_enum");
        params.add(sourceType.trim());
      }
      if (q != null && !q.isBlank()) {
        String pattern = "%" + q + "%";
        sql.append(
            """
             AND (
               er.id::text ILIKE ?
               OR er.currency_code ILIKE ?
               OR er.source_type::text ILIKE ?
               OR COALESCE(eo.description, eot.description, '') ILIKE ?
               OR COALESCE(er.note, '') ILIKE ?
             )
            """
        );
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(") expense_rows ORDER BY ")
          .append(resolveExpenseSortClause(sortBy, sortDir))
          .append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ExpenseRecord> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapExpense(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  private String resolveExpenseSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, EXPENSE_SORT_KEYS, "businessDate");
    String direction = QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "createdAt" -> "expense_rows.created_at " + direction + ", expense_rows.id " + direction;
      case "amount" -> "expense_rows.amount " + direction + ", expense_rows.id " + direction;
      case "sourceType" -> "expense_rows.source_type " + direction + ", expense_rows.id " + direction;
      case "id" -> "expense_rows.id " + direction;
      case "businessDate" -> "expense_rows.business_date " + direction + ", expense_rows.created_at " + direction + ", expense_rows.id " + direction;
      default -> throw new IllegalArgumentException("Unsupported expense sort key");
    };
  }

  public ExpenseRecord createOperatingExpense(
      long expenseId,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount,
      String note,
      Long createdByUserId,
      String description
  ) {
    return executeInTransaction(conn -> {
      insertExpenseRecord(conn, expenseId, outletId, businessDate, currencyCode, amount, "operating_expense", note, createdByUserId);
      try (PreparedStatement ps = conn.prepareStatement(
          "INSERT INTO core.expense_operating (expense_record_id, description) VALUES (?, ?)"
      )) {
        ps.setLong(1, expenseId);
        ps.setString(2, description);
        ps.executeUpdate();
      }
      return findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
    });
  }

  public ExpenseRecord createOtherExpense(
      long expenseId,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount,
      String note,
      Long createdByUserId,
      String description
  ) {
    return executeInTransaction(conn -> {
      insertExpenseRecord(conn, expenseId, outletId, businessDate, currencyCode, amount, "other", note, createdByUserId);
      try (PreparedStatement ps = conn.prepareStatement(
          "INSERT INTO core.expense_other (expense_record_id, description) VALUES (?, ?)"
      )) {
        ps.setLong(1, expenseId);
        ps.setString(2, description);
        ps.executeUpdate();
      }
      return findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
    });
  }

  public ExpenseRecord createInventoryPurchaseExpense(
      long expenseId,
      GoodsReceiptExpenseCandidate candidate,
      Long createdByUserId,
      String note
  ) {
    return executeInTransaction(conn -> {
      insertExpenseRecord(
          conn,
          expenseId,
          candidate.outletId(),
          candidate.businessDate(),
          candidate.currencyCode(),
          candidate.totalPrice(),
          "inventory_purchase",
          note,
          createdByUserId
      );
      try (PreparedStatement ps = conn.prepareStatement(
          "INSERT INTO core.expense_inventory_purchase (expense_record_id, goods_receipt_id) VALUES (?, ?)"
      )) {
        ps.setLong(1, expenseId);
        ps.setLong(2, candidate.goodsReceiptId());
        ps.executeUpdate();
      }
      return findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
    });
  }

  public ExpenseRecord createPayrollExpense(
      long expenseId,
      PayrollExpenseCandidate candidate,
      Long createdByUserId,
      String note
  ) {
    return executeInTransaction(conn -> {
      insertExpenseRecord(
          conn,
          expenseId,
          candidate.outletId(),
          candidate.businessDate(),
          candidate.currencyCode(),
          candidate.amount(),
          "payroll",
          note,
          createdByUserId
      );
      try (PreparedStatement ps = conn.prepareStatement(
          "INSERT INTO core.expense_payroll (expense_record_id, payroll_id) VALUES (?, ?)"
      )) {
        ps.setLong(1, expenseId);
        ps.setLong(2, candidate.payrollId());
        ps.executeUpdate();
      }
      return findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
    });
  }

  public Optional<GoodsReceiptExpenseCandidate> findGoodsReceiptExpenseCandidate(long goodsReceiptId) {
    return queryOne(
        """
        SELECT gr.id AS goods_receipt_id, po.outlet_id, gr.business_date, gr.currency_code, gr.total_price
        FROM core.goods_receipt gr
        JOIN core.purchase_order po ON po.id = gr.po_id
        WHERE gr.id = ?
        """,
        rs -> {
          try {
            return new GoodsReceiptExpenseCandidate(
                rs.getLong("goods_receipt_id"),
                rs.getLong("outlet_id"),
                rs.getDate("business_date").toLocalDate(),
                rs.getString("currency_code"),
                rs.getBigDecimal("total_price")
            );
          } catch (SQLException e) {
            throw new IllegalStateException("Unable to map goods receipt expense candidate", e);
          }
        },
        goodsReceiptId
    );
  }

  public Optional<PayrollExpenseCandidate> findPayrollExpenseCandidate(long payrollId) {
    return queryOne(
        """
        SELECT p.id AS payroll_id,
               COALESCE(pt.outlet_id,
                 (SELECT o.id FROM core.outlet o WHERE o.region_id = pp.region_id ORDER BY o.id LIMIT 1)
               ) AS outlet_id,
               COALESCE(pp.pay_date, pp.end_date) AS business_date,
               p.currency_code,
               p.net_salary
        FROM core.payroll p
        JOIN core.payroll_timesheet pt ON pt.id = p.payroll_timesheet_id
        JOIN core.payroll_period pp ON pp.id = pt.payroll_period_id
        WHERE p.id = ?
        """,
        rs -> {
          try {
            return new PayrollExpenseCandidate(
                rs.getLong("payroll_id"),
                rs.getLong("outlet_id"),
                rs.getDate("business_date").toLocalDate(),
                rs.getString("currency_code"),
                rs.getBigDecimal("net_salary")
            );
          } catch (SQLException e) {
            throw new IllegalStateException("Unable to map payroll expense candidate", e);
          }
        },
        payrollId
    );
  }

  private Optional<ExpenseRecord> findExpenseTransactional(Connection conn, long expenseId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(baseExpenseSql() + " WHERE er.id = ?")) {
      ps.setLong(1, expenseId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapExpense(rs));
        }
        return Optional.empty();
      }
    }
  }

  private void insertExpenseRecord(
      Connection conn,
      long expenseId,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount,
      String sourceType,
      String note,
      Long createdByUserId
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.expense_record (
          id, outlet_id, business_date, currency_code, amount, source_type, note, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?::expense_source_type_enum, ?, ?)
        """
    )) {
      ps.setLong(1, expenseId);
      ps.setLong(2, outletId);
      ps.setDate(3, Date.valueOf(businessDate));
      ps.setString(4, currencyCode);
      ps.setBigDecimal(5, amount);
      ps.setString(6, sourceType);
      ps.setString(7, note);
      if (createdByUserId == null) {
        ps.setNull(8, java.sql.Types.BIGINT);
      } else {
        ps.setLong(8, createdByUserId);
      }
      ps.executeUpdate();
    }
  }

  private String baseExpenseSql() {
    return """
        SELECT er.id, er.outlet_id, er.business_date, er.currency_code, er.amount, er.source_type, er.note,
               er.created_by_user_id, er.created_at, er.updated_at,
               CASE
                 WHEN eip.expense_record_id IS NOT NULL THEN 'inventory_purchase'
                 WHEN eo.expense_record_id IS NOT NULL THEN 'operating'
                 WHEN eot.expense_record_id IS NOT NULL THEN 'other'
                 WHEN ep.expense_record_id IS NOT NULL THEN 'payroll'
                 ELSE 'base'
               END AS subtype,
               COALESCE(eo.description, eot.description) AS description
        FROM core.expense_record er
        LEFT JOIN core.expense_inventory_purchase eip ON eip.expense_record_id = er.id
        LEFT JOIN core.expense_operating eo ON eo.expense_record_id = er.id
        LEFT JOIN core.expense_other eot ON eot.expense_record_id = er.id
        LEFT JOIN core.expense_payroll ep ON ep.expense_record_id = er.id
        """;
  }

  private ExpenseRecord mapExpense(ResultSet rs) {
    try {
      return new ExpenseRecord(
          rs.getLong("id"),
          rs.getLong("outlet_id"),
          rs.getDate("business_date").toLocalDate(),
          rs.getString("currency_code"),
          rs.getBigDecimal("amount"),
          rs.getString("source_type"),
          rs.getString("note"),
          rs.getObject("created_by_user_id", Long.class),
          rs.getTimestamp("created_at").toInstant(),
          rs.getTimestamp("updated_at").toInstant(),
          rs.getString("subtype"),
          rs.getString("description")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map expense row", e);
    }
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }
}
