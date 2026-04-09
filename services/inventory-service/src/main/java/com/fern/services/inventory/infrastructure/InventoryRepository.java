package com.fern.services.inventory.infrastructure;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.repository.BaseRepository;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.inventory.api.InventoryDtos;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.math.RoundingMode;
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
public class InventoryRepository extends BaseRepository {

  private static final Set<String> STOCK_BALANCE_SORT_KEYS = Set.of("itemId", "qtyOnHand", "lastCountDate", "updatedAt");
  private static final Set<String> TRANSACTION_SORT_KEYS = Set.of("txnTime", "businessDate", "itemId", "qtyChange", "txnType");
  private static final Set<String> STOCK_COUNT_SORT_KEYS = Set.of("countDate", "status", "createdAt", "varianceValue");

  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public InventoryRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
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
        this::mapStockBalance,
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
      sql.append(" ORDER BY ").append(resolveStockBalanceSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);

      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
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

  public PagedResult<InventoryDtos.InventoryTransactionView> listTransactions(
      long outletId,
      Long itemId,
      LocalDate dateFrom,
      LocalDate dateTo,
      String txnType,
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
            it.id,
            it.outlet_id,
            it.item_id,
            i.code AS item_code,
            i.name AS item_name,
            it.qty_change,
            it.business_date,
            it.txn_time,
            it.txn_type,
            it.unit_cost,
            it.created_by_user_id,
            wr.reason AS waste_reason,
            it.note,
            it.created_at,
            COUNT(*) OVER() AS total_count
          FROM core.inventory_transaction it
          LEFT JOIN core.item i ON i.id = it.item_id
          LEFT JOIN core.waste_record wr ON wr.inventory_transaction_id = it.id
          WHERE it.outlet_id = ?
          """
      );
      List<Object> params = new ArrayList<>();
      params.add(outletId);
      if (itemId != null) {
        sql.append(" AND it.item_id = ?");
        params.add(itemId);
      }
      if (dateFrom != null) {
        sql.append(" AND it.business_date >= ?");
        params.add(Date.valueOf(dateFrom));
      }
      if (dateTo != null) {
        sql.append(" AND it.business_date <= ?");
        params.add(Date.valueOf(dateTo));
      }
      if (txnType != null && !txnType.isBlank()) {
        sql.append(" AND it.txn_type = ?::inventory_txn_type_enum");
        params.add(txnType.trim());
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (i.code ILIKE ? OR i.name ILIKE ? OR COALESCE(it.note, '') ILIKE ? OR COALESCE(wr.reason, '') ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(" ORDER BY ").append(resolveTransactionSortClause(sortBy, sortDir)).append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<InventoryDtos.InventoryTransactionView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(mapTransaction(rs));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public PagedResult<InventoryDtos.StockCountSessionListItemView> listStockCountSessions(
      Set<Long> outletIds,
      String status,
      LocalDate dateFrom,
      LocalDate dateTo,
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
          SELECT grouped.*, COUNT(*) OVER() AS total_count
          FROM (
          SELECT
            scs.id,
            scs.location_id,
            scs.count_date,
            scs.status,
            scs.note,
            scs.counted_by_user_id,
            scs.approved_by_user_id,
            scs.created_at,
            scs.updated_at,
            COUNT(scl.id) AS total_items,
            COALESCE(SUM(CASE WHEN scl.actual_qty IS NOT NULL THEN 1 ELSE 0 END), 0) AS counted_items,
            COALESCE(SUM(CASE WHEN COALESCE(scl.variance_qty, 0) <> 0 THEN 1 ELSE 0 END), 0) AS variance_items,
            COALESCE(SUM(ABS(COALESCE(scl.variance_qty, 0)) * COALESCE(sb.unit_cost, 0)), 0) AS variance_value
          FROM core.stock_count_session scs
          LEFT JOIN core.stock_count_line scl ON scl.stock_count_session_id = scs.id
          LEFT JOIN core.stock_balance sb
                 ON sb.location_id = scs.location_id
                AND sb.item_id = scl.item_id
          WHERE 1 = 1
          """
      );
      List<Object> params = new ArrayList<>();
      appendOutletScope(sql, params, "scs.location_id", outletIds);
      if (status != null && !status.isBlank()) {
        sql.append(" AND scs.status = ?::stock_count_status_enum");
        params.add(status.trim());
      }
      if (dateFrom != null) {
        sql.append(" AND scs.count_date >= ?");
        params.add(Date.valueOf(dateFrom));
      }
      if (dateTo != null) {
        sql.append(" AND scs.count_date <= ?");
        params.add(Date.valueOf(dateTo));
      }
      if (q != null && !q.isBlank()) {
        sql.append(" AND (COALESCE(scs.note, '') ILIKE ? OR CAST(scs.id AS TEXT) ILIKE ?)");
        String pattern = "%" + q + "%";
        params.add(pattern);
        params.add(pattern);
      }
      sql.append(
          """
          GROUP BY
            scs.id,
            scs.location_id,
            scs.count_date,
            scs.status,
            scs.note,
            scs.counted_by_user_id,
            scs.approved_by_user_id,
            scs.created_at,
            scs.updated_at
          ) grouped
          ORDER BY 
          """
      );
      sql.append(resolveStockCountSessionSortClause(sortBy, sortDir));
      sql.append(" LIMIT ? OFFSET ?");
      params.add(limit);
      params.add(offset);
      try (PreparedStatement ps = conn.prepareStatement(sql.toString())) {
        bind(ps, params);
        try (ResultSet rs = ps.executeQuery()) {
          List<InventoryDtos.StockCountSessionListItemView> rows = new ArrayList<>();
          long totalCount = 0;
          while (rs.next()) {
            totalCount = rs.getLong("total_count");
            rows.add(new InventoryDtos.StockCountSessionListItemView(
                rs.getLong("id"),
                rs.getLong("location_id"),
                rs.getDate("count_date").toLocalDate(),
                rs.getString("status"),
                rs.getString("note"),
                rs.getObject("counted_by_user_id", Long.class),
                rs.getObject("approved_by_user_id", Long.class),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(),
                rs.getLong("total_items"),
                rs.getLong("counted_items"),
                rs.getLong("variance_items"),
                rs.getBigDecimal("variance_value")
            ));
          }
          return PagedResult.of(rows, limit, offset, totalCount);
        }
      }
    });
  }

  public InventoryDtos.WasteView createWaste(
      long outletId,
      long itemId,
      BigDecimal quantity,
      LocalDate businessDate,
      BigDecimal unitCost,
      String reason,
      String note,
      Long actorUserId
  ) {
    return executeInTransaction(conn -> {
      long transactionId = snowflakeIdGenerator.generateId();
      Instant now = Instant.now();
      insertInventoryTransaction(
          conn,
          transactionId,
          outletId,
          itemId,
          quantity.negate().setScale(4, RoundingMode.HALF_UP),
          businessDate,
          now,
          "waste_out",
          unitCost,
          actorUserId,
          note
      );
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.waste_record (
            inventory_transaction_id, reason, approved_by_user_id
          ) VALUES (?, ?, ?)
          """
      )) {
        ps.setLong(1, transactionId);
        ps.setString(2, reason);
        if (actorUserId == null) {
          ps.setNull(3, java.sql.Types.BIGINT);
        } else {
          ps.setLong(3, actorUserId);
        }
        ps.executeUpdate();
      }
      return loadWasteView(conn, transactionId)
          .orElseThrow(() -> new IllegalStateException("Waste record not found after create"));
    });
  }

  public InventoryDtos.StockCountSessionView createStockCountSession(
      long sessionId,
      InventoryDtos.CreateStockCountSessionRequest request,
      Long countedByUserId
  ) {
    return executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.stock_count_session (
            id, location_id, count_date, status, note, counted_by_user_id
          ) VALUES (?, ?, ?, 'draft', ?, ?)
          """
      )) {
        ps.setLong(1, sessionId);
        ps.setLong(2, request.outletId());
        ps.setDate(3, Date.valueOf(request.countDate()));
        ps.setString(4, request.note());
        if (countedByUserId == null) {
          ps.setNull(5, java.sql.Types.BIGINT);
        } else {
          ps.setLong(5, countedByUserId);
        }
        ps.executeUpdate();
      }

      for (InventoryDtos.StockCountLineRequest line : request.lines()) {
        BigDecimal systemQty = findStockBalance(request.outletId(), line.itemId())
            .map(InventoryDtos.StockBalanceView::qtyOnHand)
            .orElse(BigDecimal.ZERO);
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.stock_count_line (
              id, stock_count_session_id, item_id, system_qty, actual_qty, note
            ) VALUES (?, ?, ?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, snowflakeIdGenerator.generateId());
          ps.setLong(2, sessionId);
          ps.setLong(3, line.itemId());
          ps.setBigDecimal(4, systemQty);
          ps.setBigDecimal(5, line.actualQty());
          ps.setString(6, line.note());
          ps.executeUpdate();
        }
      }
      return findStockCountSessionTransactional(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Stock count session not found after create"));
    });
  }

  public Optional<InventoryDtos.StockCountSessionView> findStockCountSession(long sessionId) {
    return executeInTransaction(conn -> findStockCountSessionTransactional(conn, sessionId));
  }

  public InventoryDtos.StockCountSessionView postStockCountSession(long sessionId, Long approvedByUserId) {
    return executeInTransaction(conn -> {
      InventoryDtos.StockCountSessionView session = findStockCountSessionTransactional(conn, sessionId)
          .orElseThrow(() -> ServiceException.notFound("Stock count session not found: " + sessionId));
      Instant now = Instant.now();
      for (InventoryDtos.StockCountLineView line : session.lines()) {
        if (line.varianceQty().compareTo(BigDecimal.ZERO) == 0) {
          continue;
        }
        long transactionId = snowflakeIdGenerator.generateId();
        String txnType = line.varianceQty().signum() > 0 ? "stock_adjustment_in" : "stock_adjustment_out";
        insertInventoryTransaction(
            conn,
            transactionId,
            session.outletId(),
            line.itemId(),
            line.varianceQty().setScale(4, RoundingMode.HALF_UP),
            session.countDate(),
            now,
            txnType,
            currentUnitCost(conn, session.outletId(), line.itemId()),
            approvedByUserId,
            "Stock count adjustment"
        );
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.inventory_adjustment (
              inventory_transaction_id, stock_count_line_id, reason, approved_by_user_id
            ) VALUES (?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, transactionId);
          ps.setLong(2, line.id());
          ps.setString(3, "Stock count variance");
          if (approvedByUserId == null) {
            ps.setNull(4, java.sql.Types.BIGINT);
          } else {
            ps.setLong(4, approvedByUserId);
          }
          ps.executeUpdate();
        }
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          UPDATE core.stock_count_session
          SET status = 'posted',
              approved_by_user_id = ?,
              updated_at = NOW()
          WHERE id = ?
          """
      )) {
        if (approvedByUserId == null) {
          ps.setNull(1, java.sql.Types.BIGINT);
        } else {
          ps.setLong(1, approvedByUserId);
        }
        ps.setLong(2, sessionId);
        ps.executeUpdate();
      }
      return findStockCountSessionTransactional(conn, sessionId)
          .orElseThrow(() -> new IllegalStateException("Stock count session not found after post"));
    });
  }

  public int applySaleCompleted(
      long saleId,
      long outletId,
      LocalDate businessDate,
      Instant txnTime,
      List<SaleComponentMovement> movements
  ) {
    return executeInTransaction(conn -> {
      int inserted = 0;
      for (SaleComponentMovement movement : movements) {
        if (saleItemTransactionExists(conn, saleId, movement.productId(), movement.itemId())) {
          continue;
        }
        long transactionId = snowflakeIdGenerator.generateId();
        insertInventoryTransaction(
            conn,
            transactionId,
            outletId,
            movement.itemId(),
            movement.qtyChange(),
            businessDate,
            txnTime,
            "sale_usage",
            currentUnitCost(conn, outletId, movement.itemId()),
            null,
            "Sale " + saleId + " product " + movement.productId()
        );
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.sale_item_transaction (
              inventory_transaction_id, sale_id, product_id, item_id
            ) VALUES (?, ?, ?, ?)
            """
        )) {
          ps.setLong(1, transactionId);
          ps.setLong(2, saleId);
          ps.setLong(3, movement.productId());
          ps.setLong(4, movement.itemId());
          ps.executeUpdate();
        }
        inserted++;
      }
      return inserted;
    });
  }

  public int applyGoodsReceiptPosted(
      long goodsReceiptId,
      long outletId,
      LocalDate businessDate,
      Instant txnTime,
      List<GoodsReceiptMovement> movements
  ) {
    return executeInTransaction(conn -> {
      int inserted = 0;
      for (GoodsReceiptMovement movement : movements) {
        long transactionId = snowflakeIdGenerator.generateId();
        insertInventoryTransaction(
            conn,
            transactionId,
            outletId,
            movement.itemId(),
            movement.qtyReceived().setScale(4, RoundingMode.HALF_UP),
            businessDate,
            txnTime,
            "purchase_in",
            movement.unitCost(),
            null,
            "Goods receipt " + goodsReceiptId
        );
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.goods_receipt_transaction (
              inventory_transaction_id, goods_receipt_item_id
            ) VALUES (?, ?)
            """
        )) {
          ps.setLong(1, transactionId);
          ps.setLong(2, movement.goodsReceiptItemId());
          ps.executeUpdate();
        }
        inserted++;
      }
      return inserted;
    });
  }

  public Optional<RecipeView> findLatestActiveRecipe(long productId) {
    return executeInTransaction(conn -> {
      try (PreparedStatement header = conn.prepareStatement(
          """
          SELECT product_id, version, yield_qty
          FROM core.recipe
          WHERE product_id = ? AND status = 'active'
          ORDER BY created_at DESC, version DESC
          LIMIT 1
          """
      )) {
        header.setLong(1, productId);
        try (ResultSet rs = header.executeQuery()) {
          if (!rs.next()) {
            return Optional.empty();
          }
          String version = rs.getString("version");
          BigDecimal yieldQty = rs.getBigDecimal("yield_qty");
          try (PreparedStatement lines = conn.prepareStatement(
              """
              SELECT item_id, qty
              FROM core.recipe_item
              WHERE product_id = ? AND version = ?
              ORDER BY item_id
              """
          )) {
            lines.setLong(1, productId);
            lines.setString(2, version);
            try (ResultSet lineRs = lines.executeQuery()) {
              List<RecipeComponent> components = new ArrayList<>();
              while (lineRs.next()) {
                components.add(new RecipeComponent(
                    lineRs.getLong("item_id"),
                    lineRs.getBigDecimal("qty")
                ));
              }
              return Optional.of(new RecipeView(productId, version, yieldQty, components));
            }
          }
        }
      }
    });
  }

  public List<GoodsReceiptMovement> findGoodsReceiptMovements(long goodsReceiptId) {
    return queryList(
        """
        SELECT id, item_id, qty_received, unit_cost
        FROM core.goods_receipt_item
        WHERE receipt_id = ?
        ORDER BY id
        """,
        rs -> {
          try {
            return new GoodsReceiptMovement(
                rs.getLong("id"),
                rs.getLong("item_id"),
                rs.getBigDecimal("qty_received"),
                rs.getBigDecimal("unit_cost")
            );
          } catch (SQLException e) {
            throw new IllegalStateException("Failed to map goods receipt movement", e);
          }
        },
        goodsReceiptId
    );
  }

  public Optional<Long> findGoodsReceiptOutletId(long goodsReceiptId) {
    return queryOne(
        """
        SELECT po.outlet_id
        FROM core.goods_receipt gr
        JOIN core.purchase_order po ON po.id = gr.po_id
        WHERE gr.id = ?
        """,
        rs -> {
          try {
            return rs.getLong("outlet_id");
          } catch (SQLException e) {
            throw new IllegalStateException("Failed to map goods receipt outlet id", e);
          }
        },
        goodsReceiptId
    );
  }

  public Optional<LowStockState> findLowStockState(long outletId, long itemId) {
    return queryOne(
        """
        SELECT sb.qty_on_hand, i.min_stock_level
        FROM core.stock_balance sb
        JOIN core.item i ON i.id = sb.item_id
        WHERE sb.location_id = ? AND sb.item_id = ?
        """,
        rs -> {
          try {
            return new LowStockState(
                outletId,
                itemId,
                rs.getBigDecimal("qty_on_hand"),
                rs.getBigDecimal("min_stock_level")
            );
          } catch (SQLException e) {
            throw new IllegalStateException("Failed to map low stock state", e);
          }
        },
        outletId,
        itemId
    );
  }

  private Optional<InventoryDtos.WasteView> loadWasteView(Connection conn, long inventoryTransactionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT wr.inventory_transaction_id, wr.reason, wr.approved_by_user_id,
               it.id,
               it.outlet_id, it.item_id, i.code AS item_code, i.name AS item_name,
               it.qty_change, it.business_date, it.txn_time, it.txn_type,
               it.unit_cost, it.created_by_user_id, wr.reason AS waste_reason, it.note, it.created_at
        FROM core.waste_record wr
        JOIN core.inventory_transaction it ON it.id = wr.inventory_transaction_id
        LEFT JOIN core.item i ON i.id = it.item_id
        WHERE wr.inventory_transaction_id = ?
        """
    )) {
      ps.setLong(1, inventoryTransactionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new InventoryDtos.WasteView(
            rs.getLong("inventory_transaction_id"),
            rs.getString("reason"),
            rs.getObject("approved_by_user_id", Long.class),
            mapTransaction(rs)
        ));
      }
    }
  }

  private Optional<InventoryDtos.StockCountSessionView> findStockCountSessionTransactional(Connection conn, long sessionId)
      throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, location_id, count_date, status, note, counted_by_user_id, approved_by_user_id,
               created_at, updated_at
        FROM core.stock_count_session
        WHERE id = ?
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          return Optional.empty();
        }
        return Optional.of(new InventoryDtos.StockCountSessionView(
            rs.getLong("id"),
            rs.getLong("location_id"),
            rs.getDate("count_date").toLocalDate(),
            rs.getString("status"),
            rs.getString("note"),
            rs.getObject("counted_by_user_id", Long.class),
            rs.getObject("approved_by_user_id", Long.class),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("updated_at").toInstant(),
            loadStockCountLines(conn, sessionId)
        ));
      }
    }
  }

  private List<InventoryDtos.StockCountLineView> loadStockCountLines(Connection conn, long sessionId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, item_id, system_qty, actual_qty, variance_qty, note, created_at, updated_at
        FROM core.stock_count_line
        WHERE stock_count_session_id = ?
        ORDER BY item_id
        """
    )) {
      ps.setLong(1, sessionId);
      try (ResultSet rs = ps.executeQuery()) {
        List<InventoryDtos.StockCountLineView> rows = new ArrayList<>();
        while (rs.next()) {
          rows.add(new InventoryDtos.StockCountLineView(
              rs.getLong("id"),
              rs.getLong("item_id"),
              rs.getBigDecimal("system_qty"),
              rs.getBigDecimal("actual_qty"),
              rs.getBigDecimal("variance_qty"),
              rs.getString("note"),
              rs.getTimestamp("created_at").toInstant(),
              rs.getTimestamp("updated_at").toInstant()
          ));
        }
        return rows;
      }
    }
  }

  private void appendOutletScope(
      StringBuilder sql,
      List<Object> params,
      String qualifiedColumn,
      Set<Long> outletIds
  ) {
    if (outletIds == null) {
      return;
    }
    if (outletIds.isEmpty()) {
      sql.append(" AND 1 = 0");
      return;
    }
    sql.append(" AND ").append(qualifiedColumn).append(" IN (");
    int index = 0;
    for (Long outletId : outletIds) {
      if (index++ > 0) {
        sql.append(", ");
      }
      sql.append("?");
      params.add(outletId);
    }
    sql.append(")");
  }

  private void insertInventoryTransaction(
      Connection conn,
      long transactionId,
      long outletId,
      long itemId,
      BigDecimal qtyChange,
      LocalDate businessDate,
      Instant txnTime,
      String txnType,
      BigDecimal unitCost,
      Long createdByUserId,
      String note
  ) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        INSERT INTO core.inventory_transaction (
          id, outlet_id, item_id, qty_change, business_date, txn_time, txn_type,
          unit_cost, created_by_user_id, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?::inventory_txn_type_enum, ?, ?, ?)
        """
    )) {
      ps.setLong(1, transactionId);
      ps.setLong(2, outletId);
      ps.setLong(3, itemId);
      ps.setBigDecimal(4, qtyChange);
      ps.setDate(5, Date.valueOf(businessDate));
      ps.setTimestamp(6, Timestamp.from(txnTime));
      ps.setString(7, txnType);
      ps.setBigDecimal(8, unitCost);
      if (createdByUserId == null) {
        ps.setNull(9, java.sql.Types.BIGINT);
      } else {
        ps.setLong(9, createdByUserId);
      }
      ps.setString(10, note);
      ps.executeUpdate();
    }
  }

  private BigDecimal currentUnitCost(Connection conn, long outletId, long itemId) throws Exception {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT unit_cost
        FROM core.stock_balance
        WHERE location_id = ? AND item_id = ?
        """
    )) {
      ps.setLong(1, outletId);
      ps.setLong(2, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          return rs.getBigDecimal("unit_cost");
        }
        return null;
      }
    }
  }

  private String resolveStockBalanceSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, STOCK_BALANCE_SORT_KEYS, "itemId");
    String direction = normalizeSortDir(sortDir, "itemId".equals(key) ? "asc" : "desc");
    return switch (key) {
      case "itemId" -> "sb.item_id " + direction;
      case "qtyOnHand" -> "sb.qty_on_hand " + direction + ", sb.item_id ASC";
      case "lastCountDate" -> "sb.last_count_date " + direction + " NULLS LAST, sb.item_id ASC";
      case "updatedAt" -> "sb.updated_at " + direction + ", sb.item_id ASC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /inventory/stock-balances");
    };
  }

  private String resolveTransactionSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, TRANSACTION_SORT_KEYS, "txnTime");
    String direction = normalizeSortDir(sortDir, "txnTime".equals(key) ? "desc" : "asc");
    return switch (key) {
      case "txnTime" -> "it.txn_time " + direction + ", it.id DESC";
      case "businessDate" -> "it.business_date " + direction + ", it.txn_time DESC, it.id DESC";
      case "itemId" -> "it.item_id " + direction + ", it.txn_time DESC, it.id DESC";
      case "qtyChange" -> "it.qty_change " + direction + ", it.txn_time DESC, it.id DESC";
      case "txnType" -> "it.txn_type " + direction + ", it.txn_time DESC, it.id DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /inventory/transactions");
    };
  }

  private String resolveStockCountSessionSortClause(String sortBy, String sortDir) {
    String key = QueryConventions.normalizeSortBy(sortBy, STOCK_COUNT_SORT_KEYS, "createdAt");
    String direction = normalizeSortDir(sortDir, "createdAt".equals(key) ? "desc" : "asc");
    return switch (key) {
      case "countDate" -> "grouped.count_date " + direction + ", grouped.id DESC";
      case "status" -> "grouped.status " + direction + ", grouped.created_at DESC, grouped.id DESC";
      case "createdAt" -> "grouped.created_at " + direction + ", grouped.id DESC";
      case "varianceValue" -> "grouped.variance_value " + direction + ", grouped.created_at DESC, grouped.id DESC";
      default -> throw ServiceException.badRequest("Unsupported sortBy for /inventory/stock-count-sessions");
    };
  }

  private String normalizeSortDir(String sortDir, String defaultDirection) {
    if (sortDir == null || sortDir.isBlank()) {
      return defaultDirection;
    }
    return QueryConventions.normalizeSortDir(sortDir);
  }

  private InventoryDtos.StockBalanceView mapStockBalance(ResultSet rs) {
    try {
      return new InventoryDtos.StockBalanceView(
          rs.getLong("location_id"),
          rs.getLong("item_id"),
          rs.getString("item_code"),
          rs.getString("item_name"),
          rs.getString("category_code"),
          rs.getString("base_uom_code"),
          rs.getBigDecimal("qty_on_hand"),
          rs.getBigDecimal("unit_cost"),
          toLocalDate(rs.getDate("last_count_date")),
          rs.getTimestamp("updated_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to map stock balance", e);
    }
  }

  private InventoryDtos.InventoryTransactionView mapTransaction(ResultSet rs) {
    try {
      return new InventoryDtos.InventoryTransactionView(
          rs.getLong("id"),
          rs.getLong("outlet_id"),
          rs.getLong("item_id"),
          rs.getString("item_code"),
          rs.getString("item_name"),
          rs.getBigDecimal("qty_change"),
          rs.getDate("business_date").toLocalDate(),
          rs.getTimestamp("txn_time").toInstant(),
          rs.getString("txn_type"),
          rs.getBigDecimal("unit_cost"),
          rs.getObject("created_by_user_id", Long.class),
          rs.getString("waste_reason"),
          rs.getString("note"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to map inventory transaction", e);
    }
  }

  private void bind(PreparedStatement ps, List<Object> params) throws SQLException {
    for (int i = 0; i < params.size(); i++) {
      ps.setObject(i + 1, params.get(i));
    }
  }

  private static LocalDate toLocalDate(Date date) {
    return date == null ? null : date.toLocalDate();
  }

  public record RecipeView(
      long productId,
      String version,
      BigDecimal yieldQty,
      List<RecipeComponent> components
  ) {
  }

  public record RecipeComponent(long itemId, BigDecimal qty) {
  }

  public record SaleComponentMovement(long productId, long itemId, BigDecimal qtyChange) {
  }

  private boolean saleItemTransactionExists(Connection conn, long saleId, long productId, long itemId)
      throws SQLException {
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT 1
        FROM core.sale_item_transaction
        WHERE sale_id = ?
          AND product_id = ?
          AND item_id = ?
        """
    )) {
      ps.setLong(1, saleId);
      ps.setLong(2, productId);
      ps.setLong(3, itemId);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next();
      }
    }
  }

  public record GoodsReceiptMovement(long goodsReceiptItemId, long itemId, BigDecimal qtyReceived, BigDecimal unitCost) {
  }

  public record LowStockState(long outletId, long itemId, BigDecimal qtyOnHand, BigDecimal reorderThreshold) {
    public boolean isLow() {
      return reorderThreshold != null && qtyOnHand != null && qtyOnHand.compareTo(reorderThreshold) <= 0;
    }
  }
}
