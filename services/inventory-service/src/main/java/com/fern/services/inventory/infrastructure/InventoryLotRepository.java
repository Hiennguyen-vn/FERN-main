package com.fern.services.inventory.infrastructure;

import com.fern.common.repository.BaseRepository;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import com.fern.services.inventory.api.InventoryDtos;
import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

/**
 * FIFO lot management — list and insert stock_lot rows.
 * Separated from InventoryRepository to keep god-class boundary.
 */
@Repository
public class InventoryLotRepository extends BaseRepository {

  private final SnowflakeIdGenerator snowflakeIdGenerator;

  public InventoryLotRepository(DataSource dataSource, SnowflakeIdGenerator snowflakeIdGenerator) {
    super(dataSource);
    this.snowflakeIdGenerator = snowflakeIdGenerator;
  }

  public List<InventoryDtos.StockLotView> listStockLots(Long itemId, Long locationId, String status, int limit, int offset) {
    StringBuilder sql = new StringBuilder(
        "SELECT id, item_id, location_id, batch_no, lot_code, received_at, expires_at, " +
        "qty_received, qty_remaining, unit_cost, supplier_id, goods_receipt_id, status, notes, created_at " +
        "FROM core.stock_lot WHERE 1=1 ");
    List<Object> params = new ArrayList<>();
    if (itemId != null) { sql.append("AND item_id = ? "); params.add(itemId); }
    if (locationId != null) { sql.append("AND location_id = ? "); params.add(locationId); }
    if (status != null && !status.isBlank()) { sql.append("AND status = ? "); params.add(status); }
    sql.append("ORDER BY expires_at NULLS LAST, received_at LIMIT ? OFFSET ?");
    params.add(limit);
    params.add(offset);
    return queryList(sql.toString(), rs -> {
      try {
        java.sql.Date exp = rs.getDate("expires_at");
        return new InventoryDtos.StockLotView(
            rs.getLong("id"),
            rs.getLong("item_id"),
            rs.getLong("location_id"),
            rs.getString("batch_no"),
            rs.getString("lot_code"),
            rs.getTimestamp("received_at") != null ? rs.getTimestamp("received_at").toInstant() : null,
            exp != null ? exp.toLocalDate() : null,
            rs.getBigDecimal("qty_received"),
            rs.getBigDecimal("qty_remaining"),
            rs.getBigDecimal("unit_cost"),
            rs.getObject("supplier_id") != null ? rs.getLong("supplier_id") : null,
            rs.getObject("goods_receipt_id") != null ? rs.getLong("goods_receipt_id") : null,
            rs.getString("status"),
            rs.getString("notes"),
            rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null
        );
      } catch (SQLException e) { throw new RuntimeException(e); }
    }, params.toArray());
  }

  public InventoryDtos.StockLotView createStockLot(InventoryDtos.CreateStockLotRequest req) {
    long id = snowflakeIdGenerator.generateId();
    BigDecimal cost = req.unitCost() != null ? req.unitCost() : BigDecimal.ZERO;
    execute(
        "INSERT INTO core.stock_lot (id, item_id, location_id, batch_no, lot_code, expires_at, " +
        "qty_received, qty_remaining, unit_cost, supplier_id, goods_receipt_id, notes) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        id, req.itemId(), req.locationId(), req.batchNo(), req.lotCode(),
        req.expiresAt() != null ? java.sql.Date.valueOf(req.expiresAt()) : null,
        req.qtyReceived(), req.qtyReceived(), cost,
        req.supplierId(), req.goodsReceiptId(), req.notes()
    );
    return listStockLots(req.itemId(), req.locationId(), null, 1, 0)
        .stream().filter(l -> l.id() == id).findFirst()
        .orElseGet(() -> listStockLots(null, null, null, 1, 0).get(0));
  }
}
