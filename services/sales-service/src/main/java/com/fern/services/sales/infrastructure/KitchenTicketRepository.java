package com.fern.services.sales.infrastructure;

import com.fern.common.middleware.ServiceException;
import com.fern.common.repository.BaseRepository;
import com.fern.common.sync.LocalSyncOutboxWriter;
import com.fern.common.sync.SyncPayloadSchemas;
import com.fern.services.sales.api.kitchen.KitchenDtos;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

@Repository
public class KitchenTicketRepository extends BaseRepository {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

  private final LocalSyncOutboxWriter localSyncOutboxWriter;

  @Autowired
  public KitchenTicketRepository(DataSource dataSource, LocalSyncOutboxWriter localSyncOutboxWriter) {
    super(dataSource);
    this.localSyncOutboxWriter = localSyncOutboxWriter;
  }

  public KitchenTicketRepository(DataSource dataSource) {
    this(dataSource, null);
  }

  public record NewTicketItem(
      long productId,
      String productName,
      BigDecimal qty,
      Map<String, Object> modifiers,
      String notes
  ) {}

  public record NewTicket(
      long saleId,
      long outletId,
      Long orderingTableId,
      String orderingTableCode,
      String orderingTableName,
      String orderType,
      String notes,
      int prepSlaSeconds,
      List<NewTicketItem> items
  ) {}

  /**
   * Insert a new ticket + items. Returns existing ticket id if a row already exists for the sale
   * (idempotent, driven by uq_kitchen_ticket_sale).
   */
  public long createTicket(NewTicket newTicket) {
    return executeInTransaction(conn -> {
      Optional<Long> existing = findTicketIdBySale(conn, newTicket.saleId());
      if (existing.isPresent()) {
        return existing.get();
      }
      long ticketId = insertTicketRow(conn, newTicket);
      insertTicketItems(conn, ticketId, newTicket.items());
      appendKitchenTicketSyncOutbox(conn, "KITCHEN_TICKET_CREATED", ticketId);
      return ticketId;
    });
  }

  private Optional<Long> findTicketIdBySale(Connection conn, long saleId) throws Exception {
    String sql = "SELECT id FROM core.kitchen_ticket WHERE sale_id = ?";
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) return Optional.of(rs.getLong(1));
        return Optional.empty();
      }
    }
  }

  private long insertTicketRow(Connection conn, NewTicket t) throws Exception {
    String sql = """
        INSERT INTO core.kitchen_ticket
          (sale_id, outlet_id, ordering_table_id, ordering_table_code, ordering_table_name,
           order_type, status, prep_sla_seconds, notes)
        VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)
        RETURNING id
        """;
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, t.saleId());
      ps.setLong(2, t.outletId());
      if (t.orderingTableId() == null) ps.setNull(3, Types.BIGINT); else ps.setLong(3, t.orderingTableId());
      ps.setString(4, t.orderingTableCode());
      ps.setString(5, t.orderingTableName());
      ps.setString(6, t.orderType());
      ps.setInt(7, t.prepSlaSeconds());
      ps.setString(8, t.notes());
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) throw new IllegalStateException("kitchen_ticket insert returned no row");
        return rs.getLong(1);
      }
    }
  }

  private void insertTicketItems(Connection conn, long ticketId, List<NewTicketItem> items) throws Exception {
    if (items == null || items.isEmpty()) return;
    String sql = """
        INSERT INTO core.kitchen_ticket_item
          (ticket_id, product_id, product_name, qty, status, modifiers, notes)
        VALUES (?, ?, ?, ?, 'new', ?::jsonb, ?)
        """;
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
      for (NewTicketItem item : items) {
        ps.setLong(1, ticketId);
        ps.setLong(2, item.productId());
        ps.setString(3, item.productName());
        ps.setBigDecimal(4, item.qty());
        ps.setString(5, item.modifiers() == null ? null : writeJson(item.modifiers()));
        ps.setString(6, item.notes());
        ps.addBatch();
      }
      ps.executeBatch();
    }
  }

  private static String writeJson(Map<String, Object> value) {
    try {
      return MAPPER.writeValueAsString(value);
    } catch (Exception e) {
      return "{}";
    }
  }

  public List<KitchenDtos.TicketView> listOpenTickets(long outletId) {
    String sql = """
        SELECT id, sale_id, outlet_id, ordering_table_id, ordering_table_code, ordering_table_name,
               order_type, status, prep_sla_seconds, notes, sla_breached_at,
               created_at, started_at, ready_at, served_at
        FROM core.kitchen_ticket
        WHERE outlet_id = ? AND status IN ('new','in_progress','ready')
        ORDER BY created_at ASC
        """;
    List<TicketRow> rows = queryList(sql, KitchenTicketRepository::mapTicketRow, outletId);
    if (rows.isEmpty()) return List.of();
    Map<Long, List<KitchenDtos.TicketItemView>> itemsByTicket = loadItemsByTicket(rows);
    List<KitchenDtos.TicketView> result = new ArrayList<>(rows.size());
    for (TicketRow row : rows) {
      result.add(row.toView(itemsByTicket.getOrDefault(row.id, List.of())));
    }
    return result;
  }

  public Optional<KitchenDtos.TicketView> findTicket(long ticketId) {
    String sql = """
        SELECT id, sale_id, outlet_id, ordering_table_id, ordering_table_code, ordering_table_name,
               order_type, status, prep_sla_seconds, notes, sla_breached_at,
               created_at, started_at, ready_at, served_at
        FROM core.kitchen_ticket
        WHERE id = ?
        """;
    Optional<TicketRow> row = queryOne(sql, KitchenTicketRepository::mapTicketRow, ticketId);
    if (row.isEmpty()) return Optional.empty();
    Map<Long, List<KitchenDtos.TicketItemView>> items = loadItemsByTicket(List.of(row.get()));
    return Optional.of(row.get().toView(items.getOrDefault(ticketId, List.of())));
  }

  public Optional<Long> findOutletForTicket(long ticketId) {
    return queryOne("SELECT outlet_id FROM core.kitchen_ticket WHERE id = ?",
        rs -> {
          try { return rs.getLong(1); }
          catch (Exception e) { throw new IllegalStateException(e); }
        }, ticketId);
  }

  public Optional<Long> findTicketIdForItem(long itemId) {
    return queryOne("SELECT ticket_id FROM core.kitchen_ticket_item WHERE id = ?",
        rs -> {
          try { return rs.getLong(1); }
          catch (Exception e) { throw new IllegalStateException(e); }
        }, itemId);
  }

  /**
   * Update an item status with state-machine guard. Returns the new ticket-level rollup status.
   */
  public String advanceItemStatus(long itemId, String newStatus) {
    return executeInTransaction(conn -> {
      // Lock the item row and load current state.
      String currentStatus;
      long ticketId;
      try (PreparedStatement ps = conn.prepareStatement(
          "SELECT ticket_id, status FROM core.kitchen_ticket_item WHERE id = ? FOR UPDATE")) {
        ps.setLong(1, itemId);
        try (ResultSet rs = ps.executeQuery()) {
          if (!rs.next()) throw ServiceException.notFound("Kitchen ticket item not found: " + itemId);
          ticketId = rs.getLong(1);
          currentStatus = rs.getString(2);
        }
      }
      assertItemTransition(currentStatus, newStatus);
      String tsColumn = switch (newStatus) {
        case "preparing" -> "started_at";
        case "ready"     -> "ready_at";
        case "served"    -> "served_at";
        default          -> null;
      };
      String updateSql = "UPDATE core.kitchen_ticket_item SET status = ?, updated_at = NOW()"
          + (tsColumn == null ? "" : ", " + tsColumn + " = NOW()")
          + " WHERE id = ?";
      try (PreparedStatement ps = conn.prepareStatement(updateSql)) {
        ps.setString(1, newStatus);
        ps.setLong(2, itemId);
        ps.executeUpdate();
      }
      String rolled = rollupTicket(conn, ticketId);
      appendKitchenTicketSyncOutbox(conn, "KITCHEN_TICKET_UPDATED", ticketId);
      return rolled;
    });
  }

  /**
   * Manual ticket-level transition (e.g. cancel). Skips item rollup.
   */
  public void setTicketStatus(long ticketId, String newStatus) {
    executeInTransaction(conn -> {
      String tsColumn = switch (newStatus) {
        case "in_progress" -> "started_at";
        case "ready"       -> "ready_at";
        case "served"      -> "served_at";
        default            -> null;
      };
      String sql = "UPDATE core.kitchen_ticket SET status = ?, updated_at = NOW()"
          + (tsColumn == null ? "" : ", " + tsColumn + " = COALESCE(" + tsColumn + ", NOW())")
          + " WHERE id = ?";
      try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setString(1, newStatus);
        ps.setLong(2, ticketId);
        if (ps.executeUpdate() == 0) {
          throw ServiceException.notFound("Kitchen ticket not found: " + ticketId);
        }
      }
      appendKitchenTicketSyncOutbox(conn, "KITCHEN_TICKET_UPDATED", ticketId);
      return null;
    });
  }

  /**
   * Find tickets that have just breached SLA (created_at + prep_sla > now AND not yet flagged).
   * Returns ticket ids and marks them flagged so we don't re-broadcast.
   */
  public List<Long> claimSlaBreaches() {
    return executeInTransaction(conn -> {
      List<Long> ids = new ArrayList<>();
      String sql = """
          UPDATE core.kitchen_ticket
          SET sla_breached_at = NOW(), updated_at = NOW()
          WHERE status IN ('new','in_progress')
            AND sla_breached_at IS NULL
            AND created_at + (prep_sla_seconds * INTERVAL '1 second') <= NOW()
          RETURNING id
          """;
      try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery(sql)) {
        while (rs.next()) ids.add(rs.getLong(1));
      }
      return ids;
    });
  }

  /**
   * Cancel the kitchen ticket bound to a sale when the sale is cancelled/voided/refunded.
   * Idempotent and safe: no-op when no ticket exists or the ticket is already terminal
   * (served/cancelled). Also cancels any non-terminal items so all-day rollups stay
   * consistent. Returns the affected ticket id, or empty when nothing changed.
   */
  public Optional<Long> cancelTicketBySale(long saleId) {
    return executeInTransaction(conn -> {
      Long ticketId = null;
      String status = null;
      try (PreparedStatement ps = conn.prepareStatement(
          "SELECT id, status FROM core.kitchen_ticket WHERE sale_id = ? FOR UPDATE")) {
        ps.setLong(1, saleId);
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next()) {
            ticketId = rs.getLong(1);
            status = rs.getString(2);
          }
        }
      }
      if (ticketId == null) return Optional.<Long>empty();
      if ("served".equals(status) || "cancelled".equals(status)) return Optional.<Long>empty();
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.kitchen_ticket SET status = 'cancelled', updated_at = NOW() WHERE id = ?")) {
        ps.setLong(1, ticketId);
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement(
          "UPDATE core.kitchen_ticket_item SET status = 'cancelled', updated_at = NOW()"
          + " WHERE ticket_id = ? AND status NOT IN ('served','cancelled')")) {
        ps.setLong(1, ticketId);
        ps.executeUpdate();
      }
      appendKitchenTicketSyncOutbox(conn, "KITCHEN_TICKET_UPDATED", ticketId);
      return Optional.of(ticketId);
    });
  }

  private void appendKitchenTicketSyncOutbox(Connection conn, String eventType, long ticketId) throws Exception {
    if (localSyncOutboxWriter == null) {
      return;
    }
    SyncPayloadSchemas.KitchenTicketPayload payload = loadKitchenTicketPayload(conn, ticketId);
    String eventId = "KITCHEN_TICKET_CREATED".equals(eventType)
        ? eventType + ":" + ticketId
        : eventType + ":" + ticketId + ":" + System.currentTimeMillis();
    localSyncOutboxWriter.append(
        conn,
        eventId,
        eventType,
        "KITCHEN_TICKET",
        Long.toString(ticketId),
        payload
    );
  }

  private SyncPayloadSchemas.KitchenTicketPayload loadKitchenTicketPayload(Connection conn, long ticketId)
      throws Exception {
    TicketRow row;
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, sale_id, outlet_id, ordering_table_id, ordering_table_code, ordering_table_name,
               order_type, status, prep_sla_seconds, notes, sla_breached_at,
               created_at, started_at, ready_at, served_at
        FROM core.kitchen_ticket
        WHERE id = ?
        """
    )) {
      ps.setLong(1, ticketId);
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw ServiceException.notFound("Kitchen ticket not found: " + ticketId);
        }
        row = mapTicketRow(rs);
      }
    }
    List<SyncPayloadSchemas.KitchenTicketItemPayload> items = new ArrayList<>();
    try (PreparedStatement ps = conn.prepareStatement(
        """
        SELECT id, product_id, product_name, qty, status, notes
        FROM core.kitchen_ticket_item
        WHERE ticket_id = ?
        ORDER BY id ASC
        """
    )) {
      ps.setLong(1, ticketId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          items.add(new SyncPayloadSchemas.KitchenTicketItemPayload(
              rs.getLong("id"),
              rs.getLong("product_id"),
              rs.getString("product_name"),
              rs.getBigDecimal("qty"),
              rs.getString("status"),
              rs.getString("notes")
          ));
        }
      }
    }
    return new SyncPayloadSchemas.KitchenTicketPayload(
        row.id,
        row.saleId,
        row.outletId,
        row.orderingTableId,
        row.orderingTableCode,
        row.orderingTableName,
        row.orderType,
        row.status,
        row.prepSlaSeconds,
        row.notes,
        items,
        Instant.now()
    );
  }

  private String rollupTicket(Connection conn, long ticketId) throws Exception {
    String statusSql = """
        WITH s AS (
          SELECT
            COUNT(*) FILTER (WHERE status <> 'cancelled') AS active_count,
            COUNT(*) FILTER (WHERE status = 'served') AS served_count,
            COUNT(*) FILTER (WHERE status IN ('ready','served')) AS ready_or_served_count,
            COUNT(*) FILTER (WHERE status IN ('preparing','ready','served')) AS started_count
          FROM core.kitchen_ticket_item
          WHERE ticket_id = ?
        )
        SELECT
          CASE
            WHEN active_count = 0 THEN 'cancelled'
            WHEN served_count = active_count THEN 'served'
            WHEN ready_or_served_count = active_count THEN 'ready'
            WHEN started_count > 0 THEN 'in_progress'
            ELSE 'new'
          END AS rolled
        FROM s
        """;
    String rolled;
    try (PreparedStatement ps = conn.prepareStatement(statusSql)) {
      ps.setLong(1, ticketId);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        rolled = rs.getString(1);
      }
    }
    String tsColumn = switch (rolled) {
      case "in_progress" -> "started_at";
      case "ready"       -> "ready_at";
      case "served"      -> "served_at";
      default            -> null;
    };
    String updateSql = "UPDATE core.kitchen_ticket SET status = ?, updated_at = NOW()"
        + (tsColumn == null ? "" : ", " + tsColumn + " = COALESCE(" + tsColumn + ", NOW())")
        + " WHERE id = ?";
    try (PreparedStatement ps = conn.prepareStatement(updateSql)) {
      ps.setString(1, rolled);
      ps.setLong(2, ticketId);
      ps.executeUpdate();
    }
    return rolled;
  }

  private static void assertItemTransition(String current, String next) {
    boolean ok = switch (current) {
      case "new"       -> next.equals("preparing") || next.equals("cancelled");
      case "preparing" -> next.equals("ready") || next.equals("cancelled");
      case "ready"     -> next.equals("served") || next.equals("cancelled");
      case "served", "cancelled" -> false;
      default -> false;
    };
    if (!ok) {
      throw ServiceException.conflict("Invalid kitchen item transition: " + current + " → " + next);
    }
  }

  private Map<Long, List<KitchenDtos.TicketItemView>> loadItemsByTicket(List<TicketRow> rows) {
    if (rows.isEmpty()) return Map.of();
    StringBuilder placeholders = new StringBuilder();
    Object[] ids = new Object[rows.size()];
    for (int i = 0; i < rows.size(); i++) {
      if (i > 0) placeholders.append(',');
      placeholders.append('?');
      ids[i] = rows.get(i).id;
    }
    String sql = "SELECT id, ticket_id, product_id, product_name, qty, status, modifiers,"
        + " notes, started_at, ready_at, served_at"
        + " FROM core.kitchen_ticket_item WHERE ticket_id IN (" + placeholders + ")"
        + " ORDER BY id ASC";
    List<Object[]> items = queryList(sql, rs -> {
      try {
        long id = rs.getLong("id");
        long ticketId = rs.getLong("ticket_id");
        long productId = rs.getLong("product_id");
        String productName = rs.getString("product_name");
        BigDecimal qty = rs.getBigDecimal("qty");
        String status = rs.getString("status");
        String modifiersJson = rs.getString("modifiers");
        Map<String, Object> modifiers = modifiersJson == null
            ? null
            : MAPPER.readValue(modifiersJson, MAP_TYPE);
        String notes = rs.getString("notes");
        Instant startedAt = toInstant(rs.getTimestamp("started_at"));
        Instant readyAt = toInstant(rs.getTimestamp("ready_at"));
        Instant servedAt = toInstant(rs.getTimestamp("served_at"));
        KitchenDtos.TicketItemView view = new KitchenDtos.TicketItemView(
            id, productId, productName, qty, status, modifiers, notes,
            startedAt, readyAt, servedAt);
        return new Object[] {ticketId, view};
      } catch (Exception e) {
        throw new IllegalStateException(e);
      }
    }, ids);
    Map<Long, List<KitchenDtos.TicketItemView>> grouped = new LinkedHashMap<>();
    for (Object[] tuple : items) {
      long ticketId = (long) tuple[0];
      KitchenDtos.TicketItemView view = (KitchenDtos.TicketItemView) tuple[1];
      grouped.computeIfAbsent(ticketId, k -> new ArrayList<>()).add(view);
    }
    grouped.replaceAll((k, v) -> Collections.unmodifiableList(v));
    return grouped;
  }

  private static TicketRow mapTicketRow(ResultSet rs) {
    try {
      TicketRow row = new TicketRow();
      row.id = rs.getLong("id");
      row.saleId = rs.getLong("sale_id");
      row.outletId = rs.getLong("outlet_id");
      long otid = rs.getLong("ordering_table_id");
      row.orderingTableId = rs.wasNull() ? null : otid;
      row.orderingTableCode = rs.getString("ordering_table_code");
      row.orderingTableName = rs.getString("ordering_table_name");
      row.orderType = rs.getString("order_type");
      row.status = rs.getString("status");
      row.prepSlaSeconds = rs.getInt("prep_sla_seconds");
      row.notes = rs.getString("notes");
      row.slaBreached = rs.getTimestamp("sla_breached_at") != null;
      row.createdAt = toInstant(rs.getTimestamp("created_at"));
      row.startedAt = toInstant(rs.getTimestamp("started_at"));
      row.readyAt = toInstant(rs.getTimestamp("ready_at"));
      row.servedAt = toInstant(rs.getTimestamp("served_at"));
      return row;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static Instant toInstant(Timestamp ts) {
    return ts == null ? null : ts.toInstant();
  }

  private static class TicketRow {
    long id;
    long saleId;
    long outletId;
    Long orderingTableId;
    String orderingTableCode;
    String orderingTableName;
    String orderType;
    String status;
    int prepSlaSeconds;
    String notes;
    boolean slaBreached;
    Instant createdAt;
    Instant startedAt;
    Instant readyAt;
    Instant servedAt;

    KitchenDtos.TicketView toView(List<KitchenDtos.TicketItemView> items) {
      return new KitchenDtos.TicketView(id, saleId, outletId, orderingTableId,
          orderingTableCode, orderingTableName, orderType, status, prepSlaSeconds, notes,
          slaBreached, createdAt, startedAt, readyAt, servedAt, items);
    }
  }
}
