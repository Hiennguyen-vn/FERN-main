package com.fern.services.report.infrastructure;

import com.fern.common.repository.BaseRepository;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.common.middleware.ServiceException;
import com.fern.services.report.api.ReportDtos;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Repository;

@Repository
public class ReportRepository extends BaseRepository {

  private static final Set<String> SALES_SORT_KEYS = Set.of("businessDate", "totalAmount", "saleCount");
  private static final Set<String> EXPENSE_SORT_KEYS = Set.of("businessDate", "sourceType", "totalAmount", "expenseCount");
  private static final Set<String> INVENTORY_MOVEMENT_SORT_KEYS = Set.of("businessDate", "itemId", "txnType", "netQuantityChange");
  private static final Set<String> LOW_STOCK_SORT_KEYS = Set.of("qtyOnHand", "itemCode", "itemName", "minStockLevel");

  public ReportRepository(@Qualifier("replicaDataSource") DataSource dataSource) {
    super(dataSource);
  }

  public PagedResult<ReportDtos.SalesSummary> salesSummary(
      long outletId,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT sales_rows.*, COUNT(*) OVER() AS total_count
          FROM (
            SELECT sr.outlet_id,
                   ((sr.created_at AT TIME ZONE r.timezone_name - INTERVAL '3 hours')::date) AS business_date,
                   COUNT(*) AS sale_count,
                   COALESCE(SUM(sr.subtotal), 0) AS subtotal,
                   COALESCE(SUM(sr.discount), 0) AS discount,
                   COALESCE(SUM(sr.tax_amount), 0) AS tax_amount,
                   COALESCE(SUM(sr.total_amount), 0) AS total_amount
            FROM core.sale_record sr
            JOIN core.outlet o ON o.id = sr.outlet_id
            JOIN core.region r ON r.id = o.region_id
            WHERE sr.outlet_id = ?
              AND sr.status IN (
                'completed'::sale_order_status_enum,
                'payment_done'::sale_order_status_enum
              )
              AND sr.created_at >= ?
              AND sr.created_at < (?::date + INTERVAL '1 day')
            GROUP BY sr.outlet_id, ((sr.created_at AT TIME ZONE r.timezone_name - INTERVAL '3 hours')::date)
          ) sales_rows
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      params.add(Date.valueOf(startDate));
      params.add(Date.valueOf(endDate));
      if (q != null && !q.isBlank()) {
        sql.append(" AND CAST(sales_rows.business_date AS TEXT) ILIKE ?");
        params.add("%" + q + "%");
      }
      sql.append(" ORDER BY ").append(resolveSalesSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.SalesSummary> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapSalesSummary(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public PagedResult<ReportDtos.ExpenseSummary> expenseSummary(
      long outletId,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
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
            SELECT outlet_id,
                   business_date,
                   source_type,
                   COUNT(*) AS expense_count,
                   COALESCE(SUM(amount), 0) AS total_amount
            FROM core.expense_record
            WHERE outlet_id = ?
              AND business_date BETWEEN ? AND ?
            GROUP BY outlet_id, business_date, source_type
          ) expense_rows
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      params.add(Date.valueOf(startDate));
      params.add(Date.valueOf(endDate));
      if (q != null && !q.isBlank()) {
        sql.append(" AND expense_rows.source_type ILIKE ?");
        params.add("%" + q + "%");
      }
      sql.append(" ORDER BY ").append(resolveExpenseSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.ExpenseSummary> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapExpenseSummary(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public PagedResult<ReportDtos.InventoryMovementSummary> inventoryMovementSummary(
      long outletId,
      Long itemId,
      java.time.LocalDate startDate,
      java.time.LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    return executeInTransaction(conn -> {
      StringBuilder sql = new StringBuilder(
          """
          SELECT movement_rows.*, COUNT(*) OVER() AS total_count
          FROM (
            SELECT it.outlet_id,
                   it.item_id,
                   it.business_date,
                   it.txn_type,
                   COALESCE(SUM(it.qty_change), 0) AS net_quantity_change
            FROM core.inventory_transaction it
            LEFT JOIN core.item i ON i.id = it.item_id
            WHERE it.outlet_id = ?
              AND it.business_date BETWEEN ? AND ?
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      params.add(Date.valueOf(startDate));
      params.add(Date.valueOf(endDate));
      if (itemId != null) {
        sql.append(" AND it.item_id = ?");
        params.add(itemId);
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (i.code ILIKE ? OR i.name ILIKE ? OR CAST(it.item_id AS TEXT) ILIKE ? OR it.txn_type ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(
          """
            GROUP BY it.outlet_id, it.item_id, it.business_date, it.txn_type
          ) movement_rows
          ORDER BY 
          """
      );
      sql.append(resolveInventoryMovementSortClause(sortBy, sortDir));
      sql.append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.InventoryMovementSummary> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapInventoryMovementSummary(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public PagedResult<ReportDtos.LowStockSnapshot> lowStock(
      long outletId,
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
            sb.location_id AS outlet_id,
            sb.item_id,
            i.code AS item_code,
            i.name AS item_name,
            sb.qty_on_hand,
            i.min_stock_level,
            COUNT(*) OVER() AS total_count
          FROM core.stock_balance sb
          JOIN core.item i ON i.id = sb.item_id
          WHERE sb.location_id = ?
            AND i.min_stock_level IS NOT NULL
            AND sb.qty_on_hand <= i.min_stock_level
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      if (q != null && !q.isBlank()) {
        sql.append(" AND (i.code ILIKE ? OR i.name ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveLowStockSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.LowStockSnapshot> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapLowStockSnapshot(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  private ReportDtos.SalesSummary mapSalesSummary(ResultSet rs) {
    try {
      return new ReportDtos.SalesSummary(
          rs.getLong("outlet_id"),
          rs.getDate("business_date").toLocalDate(),
          rs.getLong("sale_count"),
          rs.getBigDecimal("subtotal"),
          rs.getBigDecimal("discount"),
          rs.getBigDecimal("tax_amount"),
          rs.getBigDecimal("total_amount")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map sales summary row", e);
    }
  }

  private ReportDtos.ExpenseSummary mapExpenseSummary(ResultSet rs) {
    try {
      return new ReportDtos.ExpenseSummary(
          rs.getLong("outlet_id"),
          rs.getDate("business_date").toLocalDate(),
          rs.getString("source_type"),
          rs.getLong("expense_count"),
          rs.getBigDecimal("total_amount")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map expense summary row", e);
    }
  }

  private ReportDtos.InventoryMovementSummary mapInventoryMovementSummary(ResultSet rs) {
    try {
      return new ReportDtos.InventoryMovementSummary(
          rs.getLong("outlet_id"),
          rs.getLong("item_id"),
          rs.getDate("business_date").toLocalDate(),
          rs.getString("txn_type"),
          rs.getBigDecimal("net_quantity_change")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map inventory movement row", e);
    }
  }

  private ReportDtos.LowStockSnapshot mapLowStockSnapshot(ResultSet rs) {
    try {
      return new ReportDtos.LowStockSnapshot(
          rs.getLong("outlet_id"),
          rs.getLong("item_id"),
          rs.getString("item_code"),
          rs.getString("item_name"),
          rs.getBigDecimal("qty_on_hand"),
          rs.getBigDecimal("min_stock_level")
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map low-stock row", e);
    }
  }

  private String resolveSalesSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, SALES_SORT_KEYS, "businessDate");
    String direction = normalizeSortDir(sortDir, "desc");
    return switch (key) {
      case "businessDate" -> "sales_rows.business_date " + direction;
      case "totalAmount" -> "sales_rows.total_amount " + direction + ", sales_rows.business_date DESC";
      case "saleCount" -> "sales_rows.sale_count " + direction + ", sales_rows.business_date DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /reports/sales");
    };
  }

  private String resolveExpenseSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, EXPENSE_SORT_KEYS, "businessDate");
    String direction = normalizeSortDir(sortDir, "desc");
    return switch (key) {
      case "businessDate" -> "expense_rows.business_date " + direction + ", expense_rows.source_type ASC";
      case "sourceType" -> "expense_rows.source_type " + direction + ", expense_rows.business_date DESC";
      case "totalAmount" -> "expense_rows.total_amount " + direction + ", expense_rows.business_date DESC";
      case "expenseCount" -> "expense_rows.expense_count " + direction + ", expense_rows.business_date DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /reports/expenses");
    };
  }

  private String resolveInventoryMovementSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, INVENTORY_MOVEMENT_SORT_KEYS, "businessDate");
    String direction = normalizeSortDir(sortDir, "desc");
    return switch (key) {
      case "businessDate" -> "movement_rows.business_date " + direction + ", movement_rows.item_id ASC";
      case "itemId" -> "movement_rows.item_id " + direction + ", movement_rows.business_date DESC";
      case "txnType" -> "movement_rows.txn_type " + direction + ", movement_rows.business_date DESC";
      case "netQuantityChange" -> "movement_rows.net_quantity_change " + direction + ", movement_rows.business_date DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /reports/inventory-movements");
    };
  }

  private String resolveLowStockSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, LOW_STOCK_SORT_KEYS, "qtyOnHand");
    String direction = normalizeSortDir(sortDir, "asc");
    return switch (key) {
      case "qtyOnHand" -> "sb.qty_on_hand " + direction + ", i.name ASC";
      case "itemCode" -> "i.code " + direction + ", sb.qty_on_hand ASC";
      case "itemName" -> "i.name " + direction + ", sb.qty_on_hand ASC";
      case "minStockLevel" -> "i.min_stock_level " + direction + ", sb.qty_on_hand ASC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /reports/low-stock");
    };
  }

  private String normalizeSortDir(String sortDir, String defaultDirection) {
    if (sortDir == null || sortDir.isBlank()) {
      return defaultDirection;
    }
    return QueryConventions.normalizeSortDir(sortDir);
  }

  private void bind(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  public List<ReportDtos.DailyPnl> dailyPnl(long outletId, java.time.LocalDate startDate, java.time.LocalDate endDate) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          WITH s AS (
            SELECT sr.outlet_id,
                   ((sr.created_at AT TIME ZONE r.timezone_name - INTERVAL '3 hours')::date) AS business_date,
                   COALESCE(SUM(sr.total_amount), 0) AS sales_total
            FROM core.sale_record sr
            JOIN core.outlet o ON o.id = sr.outlet_id
            JOIN core.region r ON r.id = o.region_id
            WHERE sr.outlet_id = ?
              AND sr.status IN ('completed'::sale_order_status_enum, 'payment_done'::sale_order_status_enum)
              AND sr.created_at >= ? AND sr.created_at < (?::date + INTERVAL '1 day')
            GROUP BY sr.outlet_id, ((sr.created_at AT TIME ZONE r.timezone_name - INTERVAL '3 hours')::date)
          ), e AS (
            SELECT outlet_id, business_date, COALESCE(SUM(amount), 0) AS expense_total
            FROM core.expense_record
            WHERE outlet_id = ? AND business_date BETWEEN ? AND ?
            GROUP BY outlet_id, business_date
          )
          SELECT COALESCE(s.outlet_id, e.outlet_id) AS outlet_id,
                 COALESCE(s.business_date, e.business_date) AS business_date,
                 COALESCE(s.sales_total, 0) AS sales_total,
                 COALESCE(e.expense_total, 0) AS expense_total,
                 COALESCE(s.sales_total, 0) - COALESCE(e.expense_total, 0) AS gross_profit
          FROM s FULL OUTER JOIN e ON s.outlet_id = e.outlet_id AND s.business_date = e.business_date
          ORDER BY business_date
          """
      )) {
        ps.setLong(1, outletId);
        ps.setObject(2, startDate);
        ps.setObject(3, endDate);
        ps.setLong(4, outletId);
        ps.setObject(5, startDate);
        ps.setObject(6, endDate);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.DailyPnl> rows = new ArrayList<>();
          while (rs.next()) {
            rows.add(new ReportDtos.DailyPnl(
                rs.getLong("outlet_id"),
                rs.getDate("business_date").toLocalDate(),
                rs.getBigDecimal("sales_total"),
                rs.getBigDecimal("expense_total"),
                rs.getBigDecimal("gross_profit")
            ));
          }
          return rows;
        }
      }
    });
  }

  public List<ReportDtos.TopSku> topSkus(long outletId, java.time.LocalDate startDate, java.time.LocalDate endDate, int limit) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT sr.outlet_id, si.product_id, p.code AS product_code, p.name AS product_name,
                 SUM(si.qty) AS total_quantity, SUM(si.line_total) AS total_revenue
          FROM core.sale_item si
          JOIN core.sale_record sr ON sr.id = si.sale_id
          JOIN core.product p ON p.id = si.product_id
          WHERE sr.outlet_id = ?
            AND sr.status IN ('completed'::sale_order_status_enum, 'payment_done'::sale_order_status_enum)
            AND sr.created_at >= ? AND sr.created_at < (?::date + INTERVAL '1 day')
          GROUP BY sr.outlet_id, si.product_id, p.code, p.name
          ORDER BY total_revenue DESC
          LIMIT ?
          """
      )) {
        ps.setLong(1, outletId);
        ps.setObject(2, startDate);
        ps.setObject(3, endDate);
        ps.setInt(4, limit);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.TopSku> rows = new ArrayList<>();
          while (rs.next()) {
            rows.add(new ReportDtos.TopSku(
                rs.getLong("outlet_id"), rs.getLong("product_id"),
                rs.getString("product_code"), rs.getString("product_name"),
                rs.getBigDecimal("total_quantity"), rs.getBigDecimal("total_revenue")));
          }
          return rows;
        }
      }
    });
  }

  public List<ReportDtos.StaffKpi> staffKpi(long outletId, java.time.LocalDate startDate, java.time.LocalDate endDate) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT sr.outlet_id, ps.manager_id AS actor_user_id, u.username,
                 COUNT(*) AS sale_count, COALESCE(SUM(sr.total_amount), 0) AS total_revenue
          FROM core.sale_record sr
          LEFT JOIN core.pos_session ps ON ps.id = sr.pos_session_id
          LEFT JOIN core.app_user u ON u.id = ps.manager_id
          WHERE sr.outlet_id = ?
            AND sr.status IN ('completed'::sale_order_status_enum, 'payment_done'::sale_order_status_enum)
            AND sr.created_at >= ? AND sr.created_at < (?::date + INTERVAL '1 day')
          GROUP BY sr.outlet_id, ps.manager_id, u.username
          ORDER BY total_revenue DESC
          """
      )) {
        ps.setLong(1, outletId);
        ps.setObject(2, startDate);
        ps.setObject(3, endDate);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.StaffKpi> rows = new ArrayList<>();
          while (rs.next()) {
            long actor = rs.getLong("actor_user_id");
            rows.add(new ReportDtos.StaffKpi(
                rs.getLong("outlet_id"),
                rs.wasNull() ? null : actor,
                rs.getString("username"),
                rs.getLong("sale_count"),
                rs.getBigDecimal("total_revenue")));
          }
          return rows;
        }
      }
    });
  }

  public List<ReportDtos.CrossOutletCompare> crossOutletCompare(long regionId, java.time.LocalDate startDate, java.time.LocalDate endDate) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT o.region_id, sr.outlet_id, o.code AS outlet_code, o.name AS outlet_name,
                 COALESCE(SUM(sr.total_amount), 0) AS sales_total,
                 COUNT(*) AS sale_count,
                 CASE WHEN COUNT(*) = 0 THEN 0
                      ELSE COALESCE(SUM(sr.total_amount), 0) / COUNT(*) END AS avg_ticket
          FROM core.sale_record sr
          JOIN core.outlet o ON o.id = sr.outlet_id
          WHERE o.region_id = ?
            AND sr.status IN ('completed'::sale_order_status_enum, 'payment_done'::sale_order_status_enum)
            AND sr.created_at >= ? AND sr.created_at < (?::date + INTERVAL '1 day')
          GROUP BY o.region_id, sr.outlet_id, o.code, o.name
          ORDER BY sales_total DESC
          """
      )) {
        ps.setLong(1, regionId);
        ps.setObject(2, startDate);
        ps.setObject(3, endDate);
        try (ResultSet rs = ps.executeQuery()) {
          List<ReportDtos.CrossOutletCompare> rows = new ArrayList<>();
          while (rs.next()) {
            rows.add(new ReportDtos.CrossOutletCompare(
                rs.getLong("region_id"), rs.getLong("outlet_id"),
                rs.getString("outlet_code"), rs.getString("outlet_name"),
                rs.getBigDecimal("sales_total"), rs.getLong("sale_count"),
                rs.getBigDecimal("avg_ticket")));
          }
          return rows;
        }
      }
    });
  }
}
