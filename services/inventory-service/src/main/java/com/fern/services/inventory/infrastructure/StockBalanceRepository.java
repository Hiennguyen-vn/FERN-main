package com.fern.services.inventory.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.common.repository.BaseRepository;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.services.inventory.api.InventoryDtos;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

/**
 * Read-only repository for stock_balance + low-stock detection.
 * Pure queries, no writes — sole writer remains InventoryRepository (sync_stock_balance trigger path).
 */
@Repository
public class StockBalanceRepository extends BaseRepository {

  private static final Set<String> STOCK_BALANCE_SORT_KEYS =
      Set.of("itemId", "qtyOnHand", "lastCountDate", "updatedAt");

  public StockBalanceRepository(DataSource dataSource) {
    super(dataSource);
  }

  public Optional<InventoryDtos.StockBalanceView> findStockBalance(long outletId, long itemId) {
    return queryOne(
        """
        SELECT sb.location_id, sb.item_id, i.code AS item_code, i.name AS item_name,
               i.category_code, i.base_uom_code, sb.qty_on_hand, sb.unit_cost,
               sb.last_count_date, sb.updated_at
        FROM core.stock_balance sb
        JOIN core.item i ON i.id = sb.item_id
        WHERE sb.location_id = ? AND sb.item_id = ?
        """,
        StockBalanceRepository::mapStockBalance,
        outletId,
        itemId
    );
  }

  public PagedResult<InventoryDtos.StockBalanceView> listStockBalances(
      long outletId,
      boolean lowOnly,
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
            sb.location_id,
            sb.item_id,
            i.code AS item_code,
            i.name AS item_name,
            i.category_code,
            i.base_uom_code,
            sb.qty_on_hand,
            sb.unit_cost,
            sb.last_count_date,
            sb.updated_at,
            COUNT(*) OVER() AS total_count
          FROM core.stock_balance sb
          JOIN core.item i ON i.id = sb.item_id
          WHERE sb.location_id = ?
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      if (lowOnly) {
        sql.append(" AND i.min_stock_level IS NOT NULL AND sb.qty_on_hand <= i.min_stock_level");
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (i.code ILIKE ? OR i.name ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
        try (ResultSet rs = ps.executeQuery()) {
          List<InventoryDtos.StockBalanceView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapStockBalance(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public Optional<InventoryRepository.LowStockState> findLowStockState(long outletId, long itemId) {
    return queryOne(
        """
        SELECT sb.qty_on_hand, i.min_stock_level
        FROM core.stock_balance sb
        JOIN core.item i ON i.id = sb.item_id
        WHERE sb.location_id = ? AND sb.item_id = ?
        """,
        rs -> {
          try {
            BigDecimal qty = rs.getBigDecimal("qty_on_hand");
            BigDecimal threshold = rs.getBigDecimal("min_stock_level");
            return new InventoryRepository.LowStockState(outletId, itemId, qty, threshold);
          } catch (SQLException e) {
            throw new IllegalStateException("Failed to map low stock state", e);
          }
        },
        outletId, itemId
    );
  }

  private static String resolveSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, STOCK_BALANCE_SORT_KEYS, "itemId");
    String direction = (sortDir == null || sortDir.isBlank())
        ? ("itemId".equals(key) ? "asc" : "desc")
        : QueryConventions.normalizeSortDir(sortDir);
    return switch (key) {
      case "itemId" -> "sb.item_id " + direction;
      case "qtyOnHand" -> "sb.qty_on_hand " + direction + ", sb.item_id ASC";
      case "lastCountDate" -> "sb.last_count_date " + direction + " NULLS LAST, sb.item_id ASC";
      case "updatedAt" -> "sb.updated_at " + direction + ", sb.item_id ASC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /inventory/stock-balances");
    };
  }

  private static InventoryDtos.StockBalanceView mapStockBalance(ResultSet rs) {
    try {
      Date lastCount = rs.getDate("last_count_date");
      return new InventoryDtos.StockBalanceView(
          rs.getLong("location_id"),
          rs.getLong("item_id"),
          rs.getString("item_code"),
          rs.getString("item_name"),
          rs.getString("category_code"),
          rs.getString("base_uom_code"),
          rs.getBigDecimal("qty_on_hand"),
          rs.getBigDecimal("unit_cost"),
          lastCount == null ? null : lastCount.toLocalDate(),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to map stock balance", e);
    }
  }
}
