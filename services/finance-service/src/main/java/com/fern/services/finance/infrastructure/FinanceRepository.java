package com.fern.services.finance.infrastructure;

import com.fern.common.outbox.OutboxWriter;
import com.fern.common.repository.BaseRepository;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.events.finance.ExpenseRecordCreatedEvent;
import com.fern.services.finance.api.FinanceDtos;
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

  private final OutboxWriter outboxWriter;

  public FinanceRepository(DataSource dataSource, OutboxWriter outboxWriter) {
    super(dataSource);
    this.outboxWriter = outboxWriter;
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

  public record ExpenseDocumentRecord(
      long id,
      long expenseRecordId,
      String documentType,
      String fileName,
      String contentType,
      String objectKey,
      String storageUrl,
      Long createdByUserId,
      Instant createdAt
  ) {
  }

  public Optional<ExpenseRecord> findExpense(long expenseId) {
    return queryOne(baseExpenseSql() + " WHERE er.id = ?", this::mapExpense, expenseId);
  }

  public Optional<ExpenseDocumentRecord> findExpenseDocument(long documentId) {
    return queryOne(
        """
        SELECT id, expense_record_id, document_type, file_name, content_type,
               object_key, storage_url, created_by_user_id, created_at
        FROM core.expense_document
        WHERE id = ?
        """,
        this::mapExpenseDocument,
        documentId
    );
  }

  public List<ExpenseDocumentRecord> listExpenseDocuments(long expenseId) {
    return queryList(
        """
        SELECT id, expense_record_id, document_type, file_name, content_type,
               object_key, storage_url, created_by_user_id, created_at
        FROM core.expense_document
        WHERE expense_record_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        this::mapExpenseDocument,
        expenseId
    );
  }

  public Optional<FinanceDtos.SupplierInvoiceExpenseDetailView> findSupplierInvoiceExpenseDetail(long expenseId) {
    return listSupplierInvoiceExpenseDetails(expenseId).stream().findFirst();
  }

  public Optional<FinanceDtos.InventoryReceiptExpenseDetailView> findInventoryReceiptExpenseDetail(long expenseId) {
    return executeInTransaction(conn -> {
      FinanceDtos.InventoryReceiptExpenseDetailView header;
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT gr.id AS goods_receipt_id,
                 gr.po_id,
                 po.status::text AS purchase_order_status,
                 po.supplier_id,
                 sp.supplier_code,
                 sp.name AS supplier_name,
                 gr.currency_code,
                 gr.status::text AS receipt_status,
                 gr.receipt_time,
                 gr.business_date AS receipt_business_date,
                 gr.total_price AS receipt_total,
                 gr.supplier_lot_number
          FROM core.expense_inventory_purchase eip
          JOIN core.goods_receipt gr ON gr.id = eip.goods_receipt_id
          JOIN core.purchase_order po ON po.id = gr.po_id
          LEFT JOIN core.supplier_procurement sp ON sp.id = po.supplier_id
          WHERE eip.expense_record_id = ?
          """
      )) {
        ps.setLong(1, expenseId);
        try (ResultSet rs = ps.executeQuery()) {
          if (!rs.next()) {
            return Optional.empty();
          }
          header = new FinanceDtos.InventoryReceiptExpenseDetailView(
              rs.getLong("goods_receipt_id"),
              rs.getLong("po_id"),
              rs.getString("purchase_order_status"),
              rs.getObject("supplier_id", Long.class),
              rs.getString("supplier_code"),
              rs.getString("supplier_name"),
              rs.getString("currency_code"),
              rs.getString("receipt_status"),
              toInstant(rs.getTimestamp("receipt_time")),
              toLocalDate(rs.getDate("receipt_business_date")),
              rs.getBigDecimal("receipt_total"),
              rs.getString("supplier_lot_number"),
              List.of()
          );
        }
      }
      return Optional.of(new FinanceDtos.InventoryReceiptExpenseDetailView(
          header.goodsReceiptId(),
          header.purchaseOrderId(),
          header.purchaseOrderStatus(),
          header.supplierId(),
          header.supplierCode(),
          header.supplierName(),
          header.currencyCode(),
          header.receiptStatus(),
          header.receiptTime(),
          header.receiptBusinessDate(),
          header.receiptTotal(),
          header.supplierLotNumber(),
          loadInventoryReceiptExpenseLines(conn, header.goodsReceiptId())
      ));
    });
  }

  public List<FinanceDtos.SupplierInvoiceExpenseDetailView> listSupplierInvoiceExpenseDetails(long expenseId) {
    return executeInTransaction(conn -> {
      List<FinanceDtos.SupplierInvoiceExpenseDetailView> headers = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT si.id AS invoice_id,
                 si.invoice_number,
                 si.supplier_id,
                 sp.supplier_code,
                 sp.name AS supplier_name,
                 si.currency_code,
                 si.invoice_date,
                 si.due_date,
                 si.subtotal,
                 si.tax_amount,
                 si.total_amount,
                 si.status::text AS invoice_status,
                 si.note AS invoice_note,
                 si.created_by_user_id,
                 si.approved_by_user_id,
                 si.approved_at,
                 si.created_at AS invoice_created_at,
                 si.updated_at AS invoice_updated_at,
                 gr.id AS goods_receipt_id,
                 gr.po_id,
                 po.status::text AS purchase_order_status,
                 gr.status::text AS receipt_status,
                 gr.receipt_time,
                 gr.business_date AS receipt_business_date,
                 gr.total_price AS receipt_total,
                 gr.supplier_lot_number
          FROM core.expense_inventory_purchase eip
          JOIN core.goods_receipt gr ON gr.id = eip.goods_receipt_id
          JOIN core.purchase_order po ON po.id = gr.po_id
          LEFT JOIN core.supplier_invoice_receipt sir ON sir.receipt_id = gr.id
          LEFT JOIN core.supplier_invoice si ON si.id = sir.invoice_id
          LEFT JOIN core.supplier_procurement sp ON sp.id = si.supplier_id
          WHERE eip.expense_record_id = ?
            AND si.id IS NOT NULL
          ORDER BY si.invoice_date DESC NULLS LAST, si.id DESC NULLS LAST
          """
      )) {
        ps.setLong(1, expenseId);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            long invoiceId = rs.getLong("invoice_id");
            headers.add(new FinanceDtos.SupplierInvoiceExpenseDetailView(
                invoiceId,
                rs.getString("invoice_number"),
                rs.getObject("supplier_id", Long.class),
                rs.getString("supplier_code"),
                rs.getString("supplier_name"),
                rs.getString("currency_code"),
                toLocalDate(rs.getDate("invoice_date")),
                toLocalDate(rs.getDate("due_date")),
                rs.getBigDecimal("subtotal"),
                rs.getBigDecimal("tax_amount"),
                rs.getBigDecimal("total_amount"),
                rs.getString("invoice_status"),
                rs.getString("invoice_note"),
                rs.getObject("created_by_user_id", Long.class),
                rs.getObject("approved_by_user_id", Long.class),
                toInstant(rs.getTimestamp("approved_at")),
                toInstant(rs.getTimestamp("invoice_created_at")),
                toInstant(rs.getTimestamp("invoice_updated_at")),
                rs.getLong("goods_receipt_id"),
                rs.getLong("po_id"),
                rs.getString("purchase_order_status"),
                rs.getString("receipt_status"),
                toInstant(rs.getTimestamp("receipt_time")),
                toLocalDate(rs.getDate("receipt_business_date")),
                rs.getBigDecimal("receipt_total"),
                rs.getString("supplier_lot_number"),
                List.of()
            ));
          }
        }
      }
      List<FinanceDtos.SupplierInvoiceExpenseDetailView> details = new ArrayList<>();
      for (FinanceDtos.SupplierInvoiceExpenseDetailView header : headers) {
        details.add(new FinanceDtos.SupplierInvoiceExpenseDetailView(
            header.invoiceId(),
            header.invoiceNumber(),
            header.supplierId(),
            header.supplierCode(),
            header.supplierName(),
            header.currencyCode(),
            header.invoiceDate(),
            header.dueDate(),
            header.subtotal(),
            header.taxAmount(),
            header.totalAmount(),
            header.status(),
            header.note(),
            header.createdByUserId(),
            header.approvedByUserId(),
            header.approvedAt(),
            header.createdAt(),
            header.updatedAt(),
            header.goodsReceiptId(),
            header.purchaseOrderId(),
            header.purchaseOrderStatus(),
            header.receiptStatus(),
            header.receiptTime(),
            header.receiptBusinessDate(),
            header.receiptTotal(),
            header.supplierLotNumber(),
            loadSupplierInvoiceExpenseLines(conn, header.invoiceId())
        ));
      }
      return details;
    });
  }

  public ExpenseDocumentRecord createExpenseDocument(
      long documentId,
      long expenseId,
      String documentType,
      String fileName,
      String contentType,
      String objectKey,
      String storageUrl,
      Long createdByUserId
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.expense_document (
            id, expense_record_id, document_type, file_name, content_type,
            object_key, storage_url, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """
      )) {
        ps.setLong(1, documentId);
        ps.setLong(2, expenseId);
        ps.setString(3, documentType);
        ps.setString(4, fileName);
        ps.setString(5, contentType);
        ps.setString(6, objectKey);
        ps.setString(7, storageUrl);
        if (createdByUserId == null) {
          ps.setNull(8, java.sql.Types.BIGINT);
        } else {
          ps.setLong(8, createdByUserId);
        }
        ps.executeUpdate();
      }
      return findExpenseDocumentTransactional(conn, documentId)
          .orElseThrow(() -> new IllegalStateException("Expense document not found after create: " + documentId));
    });
  }

  public PagedResult<ExpenseRecord> listExpenses(
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate,
      String sourceType,
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
          SELECT expense_rows.*, COUNT(*) OVER() AS total_count
          FROM (
          """
      );
      sql.append(baseExpenseSql()).append(" WHERE 1 = 1");
      List<Object> params = new ArrayList<>();
      appendExpenseFilters(sql, params, outletIds, startDate, endDate, sourceType, q);
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

  public List<FinanceDtos.ExpenseSummaryRow> expenseSummary(
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate,
      String sourceType,
      String q
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return List.of();
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            er.source_type::text AS source_type,
            COUNT(*) AS record_count,
            COALESCE(SUM(er.amount), 0) AS amount,
            MIN(er.currency_code) AS currency_code
          FROM core.expense_record er
          LEFT JOIN core.expense_operating eo ON eo.expense_record_id = er.id
          LEFT JOIN core.expense_other eot ON eot.expense_record_id = er.id
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendExpenseFilters(sql, params, outletIds, startDate, endDate, sourceType, q);
      sql.append(" GROUP BY er.source_type ORDER BY er.source_type");

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<FinanceDtos.ExpenseSummaryRow> rows = new ArrayList<>();
          while (rs.next()) {
            BigDecimal amount = rs.getBigDecimal("amount");
            rows.add(new FinanceDtos.ExpenseSummaryRow(
                rs.getString("source_type"),
                rs.getLong("record_count"),
                amount == null ? BigDecimal.ZERO : amount,
                rs.getString("currency_code")
            ));
          }
          return rows;
        }
      }
    });
  }

  public List<FinanceDtos.MonthlyExpenseRow> monthlyExpenses(
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate
  ) {
    if (outletIds != null && outletIds.isEmpty()) {
      return List.of();
    }
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT
            er.outlet_id,
            to_char(date_trunc('month', er.business_date), 'YYYY-MM') AS month,
            er.source_type::text AS source_type,
            COUNT(*) AS record_count,
            COALESCE(SUM(er.amount), 0) AS amount,
            MIN(er.currency_code) AS currency_code
          FROM core.expense_record er
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletFilter(sql, params, "er.outlet_id", outletIds);
      if (startDate != null) {
        sql.append(" AND er.business_date >= ?");
        params.add(Date.valueOf(startDate));
      }
      if (endDate != null) {
        sql.append(" AND er.business_date <= ?");
        params.add(Date.valueOf(endDate));
      }
      sql.append(" GROUP BY er.outlet_id, date_trunc('month', er.business_date), er.source_type");
      sql.append(" ORDER BY er.outlet_id, month, source_type");

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bindParams(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<FinanceDtos.MonthlyExpenseRow> rows = new ArrayList<>();
          while (rs.next()) {
            BigDecimal amount = rs.getBigDecimal("amount");
            rows.add(new FinanceDtos.MonthlyExpenseRow(
                rs.getLong("outlet_id"),
                rs.getString("month"),
                rs.getString("source_type"),
                rs.getLong("record_count"),
                amount == null ? BigDecimal.ZERO : amount,
                rs.getString("currency_code")
            ));
          }
          return rows;
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

  private void appendOutletFilter(StringBuilder sql, List<Object> params, String column, Set<Long> outletIds) {
    if (outletIds == null) {
      return;
    }
    if (outletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND ").append(column).append(" IN (");
    int index = 0;
    for (Long outletId : outletIds.stream().sorted().toList()) {
      if (index++ > 0) {
        sql.append(", ");
      }
      sql.append("?");
      params.add(outletId);
    }
    sql.append(")");
  }

  private void appendExpenseFilters(
      StringBuilder sql,
      List<Object> params,
      Set<Long> outletIds,
      LocalDate startDate,
      LocalDate endDate,
      String sourceType,
      String q
  ) {
    appendOutletFilter(sql, params, "er.outlet_id", outletIds);
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
  }

  public boolean isBusinessDateInClosedPeriod(long outletId, LocalDate businessDate) {
    return queryOne(
        """
        SELECT EXISTS (
          SELECT 1
          FROM core.outlet o
          JOIN core.payroll_period pp
            ON pp.region_id = o.region_id
          WHERE o.id = ?
            AND ? BETWEEN pp.start_date AND pp.end_date
            AND pp.status = 'closed'
        ) AS closed
        """,
        rs -> {
          try {
            return rs.getBoolean("closed");
          } catch (SQLException e) {
            throw new IllegalStateException("Unable to check closed finance period", e);
          }
        },
        outletId,
        Date.valueOf(businessDate)
    ).orElse(false);
  }

  public ExpenseRecord createOperatingExpense(
      long expenseId,
      long outletId,
      LocalDate businessDate,
      String currencyCode,
      BigDecimal amount,
      String note,
      Long createdByUserId,
      String description,
      ExpenseRecordCreatedEvent event
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
      ExpenseRecord record = findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
      outboxWriter.append(conn, "expense_record", expenseId,
          "fern.finance.expense-record-created", Long.toString(expenseId), event);
      return record;
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
      String description,
      ExpenseRecordCreatedEvent event
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
      ExpenseRecord record = findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
      outboxWriter.append(conn, "expense_record", expenseId,
          "fern.finance.expense-record-created", Long.toString(expenseId), event);
      return record;
    });
  }

  public ExpenseRecord createInventoryPurchaseExpense(
      long expenseId,
      GoodsReceiptExpenseCandidate candidate,
      Long createdByUserId,
      String note,
      ExpenseRecordCreatedEvent event
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
      ExpenseRecord record = findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
      outboxWriter.append(conn, "expense_record", expenseId,
          "fern.finance.expense-record-created", Long.toString(expenseId), event);
      return record;
    });
  }

  public ExpenseRecord createPayrollExpense(
      long expenseId,
      PayrollExpenseCandidate candidate,
      Long createdByUserId,
      String note,
      ExpenseRecordCreatedEvent event
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
      ExpenseRecord record = findExpenseTransactional(conn, expenseId)
          .orElseThrow(() -> new IllegalStateException("Expense not found after create: " + expenseId));
      outboxWriter.append(conn, "expense_record", expenseId,
          "fern.finance.expense-record-created", Long.toString(expenseId), event);
      return record;
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

  private Optional<ExpenseDocumentRecord> findExpenseDocumentTransactional(Connection conn, long documentId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, expense_record_id, document_type, file_name, content_type,
               object_key, storage_url, created_by_user_id, created_at
        FROM core.expense_document
        WHERE id = ?
        """
    )) {
      ps.setLong(1, documentId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return Optional.of(mapExpenseDocument(rs));
        }
        return Optional.empty();
      }
    }
  }

  private List<FinanceDtos.SupplierInvoiceExpenseLineView> loadSupplierInvoiceExpenseLines(
      Connection conn,
      long invoiceId
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT sii.line_number,
               sii.line_type::text AS line_type,
               sii.goods_receipt_item_id,
               gri.item_id,
               item.code AS item_code,
               item.name AS item_name,
               gri.uom_code,
               sii.qty_invoiced,
               sii.unit_price,
               sii.tax_percent,
               sii.tax_amount,
               sii.line_total,
               gri.qty_received,
               gri.unit_cost AS receipt_unit_cost,
               gri.line_total AS receipt_line_total,
               sii.description,
               sii.note
        FROM core.supplier_invoice_item sii
        LEFT JOIN core.goods_receipt_item gri ON gri.id = sii.goods_receipt_item_id
        LEFT JOIN core.item item ON item.id = gri.item_id
        WHERE sii.invoice_id = ?
        ORDER BY sii.line_number
        """
    )) {
      ps.setLong(1, invoiceId);
      try (ResultSet rs = ps.executeQuery()) {
        List<FinanceDtos.SupplierInvoiceExpenseLineView> lines = new ArrayList<>();
        while (rs.next()) {
          lines.add(new FinanceDtos.SupplierInvoiceExpenseLineView(
              rs.getInt("line_number"),
              rs.getString("line_type"),
              rs.getObject("goods_receipt_item_id", Long.class),
              rs.getObject("item_id", Long.class),
              rs.getString("item_code"),
              rs.getString("item_name"),
              rs.getString("uom_code"),
              rs.getBigDecimal("qty_invoiced"),
              rs.getBigDecimal("unit_price"),
              rs.getBigDecimal("tax_percent"),
              rs.getBigDecimal("tax_amount"),
              rs.getBigDecimal("line_total"),
              rs.getBigDecimal("qty_received"),
              rs.getBigDecimal("receipt_unit_cost"),
              rs.getBigDecimal("receipt_line_total"),
              rs.getString("description"),
              rs.getString("note")
          ));
        }
        return lines;
      }
    }
  }

  private List<FinanceDtos.InventoryReceiptExpenseLineView> loadInventoryReceiptExpenseLines(
      Connection conn,
      long goodsReceiptId
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT gri.id AS goods_receipt_item_id,
               gri.item_id,
               item.code AS item_code,
               item.name AS item_name,
               gri.uom_code,
               gri.qty_received,
               gri.unit_cost,
               gri.line_total,
               gri.manufacture_date,
               gri.expiry_date,
               gri.note
        FROM core.goods_receipt_item gri
        LEFT JOIN core.item item ON item.id = gri.item_id
        WHERE gri.receipt_id = ?
        ORDER BY gri.id
        """
    )) {
      ps.setLong(1, goodsReceiptId);
      try (ResultSet rs = ps.executeQuery()) {
        List<FinanceDtos.InventoryReceiptExpenseLineView> lines = new ArrayList<>();
        while (rs.next()) {
          lines.add(new FinanceDtos.InventoryReceiptExpenseLineView(
              rs.getLong("goods_receipt_item_id"),
              rs.getObject("item_id", Long.class),
              rs.getString("item_code"),
              rs.getString("item_name"),
              rs.getString("uom_code"),
              rs.getBigDecimal("qty_received"),
              rs.getBigDecimal("unit_cost"),
              rs.getBigDecimal("line_total"),
              toLocalDate(rs.getDate("manufacture_date")),
              toLocalDate(rs.getDate("expiry_date")),
              rs.getString("note")
          ));
        }
        return lines;
      }
    }
  }

  private static LocalDate toLocalDate(Date value) {
    return value == null ? null : value.toLocalDate();
  }

  private static Instant toInstant(Timestamp value) {
    return value == null ? null : value.toInstant();
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

  private ExpenseDocumentRecord mapExpenseDocument(ResultSet rs) {
    try {
      Timestamp createdAt = rs.getTimestamp("created_at");
      return new ExpenseDocumentRecord(
          rs.getLong("id"),
          rs.getLong("expense_record_id"),
          rs.getString("document_type"),
          rs.getString("file_name"),
          rs.getString("content_type"),
          rs.getString("object_key"),
          rs.getString("storage_url"),
          rs.getObject("created_by_user_id", Long.class),
          createdAt == null ? null : createdAt.toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map expense document row", e);
    }
  }

  private void bindParams(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }
}
