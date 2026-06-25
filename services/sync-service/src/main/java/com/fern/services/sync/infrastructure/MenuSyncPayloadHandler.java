package com.fern.services.sync.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.stereotype.Component;

@Component
public class MenuSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public MenuSyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.MENU && eventType == EventType.MENU_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    long menuId = PayloadJson.longValue(payload, "menuId", Long.parseLong(event.aggregateId()));
    String code = PayloadJson.text(payload, "code", event.aggregateId());
    String name = PayloadJson.text(payload, "name", code);
    String description = PayloadJson.text(payload, "description", null);
    String status = normalizeStatus(PayloadJson.text(payload, "status", "active"));
    String scopeType = normalizeScope(PayloadJson.text(payload, "scopeType", "corporate"));
    Long scopeId = PayloadJson.longValue(payload, "scopeId", null);
    boolean deleted = Boolean.TRUE.equals(PayloadJson.bool(payload, "deleted", false));

    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.menu (
            id, code, name, description, status, scope_type, scope_id,
            created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE
          SET code = EXCLUDED.code,
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              status = EXCLUDED.status,
              scope_type = EXCLUDED.scope_type,
              scope_id = EXCLUDED.scope_id,
              updated_at = EXCLUDED.updated_at,
              deleted_at = EXCLUDED.deleted_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, menuId);
        ps.setString(2, code);
        ps.setString(3, name);
        ps.setString(4, description);
        ps.setString(5, status);
        ps.setString(6, scopeType);
        if (scopeId == null) {
          ps.setNull(7, java.sql.Types.BIGINT);
        } else {
          ps.setLong(7, scopeId);
        }
        ps.setTimestamp(8, now);
        ps.setTimestamp(9, now);
        ps.setTimestamp(10, deleted ? now : null);
        ps.executeUpdate();
      }
      applyMenuTree(conn, menuId, payload);
      return null;
    });
  }

  private void applyMenuTree(java.sql.Connection conn, long menuId, JsonNode payload) throws Exception {
    JsonNode categories = payload.get("categories");
    if (categories == null || !categories.isArray()) {
      return;
    }
    try (PreparedStatement deleteExclusions = conn.prepareStatement(
        """
        DELETE FROM core.menu_item_exclusion mie
        USING core.menu_item mi, core.menu_category mc
        WHERE mie.menu_item_id = mi.id
          AND mi.menu_category_id = mc.id
          AND mc.menu_id = ?
        """
    )) {
      deleteExclusions.setLong(1, menuId);
      deleteExclusions.executeUpdate();
    }
    try (PreparedStatement deleteItems = conn.prepareStatement(
        """
        DELETE FROM core.menu_item mi
        USING core.menu_category mc
        WHERE mi.menu_category_id = mc.id
          AND mc.menu_id = ?
        """
    )) {
      deleteItems.setLong(1, menuId);
      deleteItems.executeUpdate();
    }
    try (PreparedStatement deleteCategories = conn.prepareStatement(
        "DELETE FROM core.menu_category WHERE menu_id = ?"
    )) {
      deleteCategories.setLong(1, menuId);
      deleteCategories.executeUpdate();
    }
    for (JsonNode category : categories) {
      long categoryId = PayloadJson.longValue(category, "categoryId", 0L);
      if (categoryId <= 0L) {
        continue;
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.menu_category (id, menu_id, code, name, display_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE
          SET menu_id = EXCLUDED.menu_id,
              code = EXCLUDED.code,
              name = EXCLUDED.name,
              display_order = EXCLUDED.display_order
          """
      )) {
        ps.setLong(1, categoryId);
        ps.setLong(2, menuId);
        ps.setString(3, PayloadJson.text(category, "code", Long.toString(categoryId)));
        ps.setString(4, PayloadJson.text(category, "name", Long.toString(categoryId)));
        ps.setInt(5, PayloadJson.intValue(category, "displayOrder", 0));
        ps.setTimestamp(6, Timestamp.from(clock.instant()));
        ps.executeUpdate();
      }
      for (JsonNode item : menuItems(category)) {
        long itemId = PayloadJson.longValue(item, "menuItemId", 0L);
        Long productId = PayloadJson.longValue(item, "productId", null);
        if (itemId <= 0L || productId == null) {
          continue;
        }
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.menu_item (
              id, menu_category_id, product_id, display_order, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE
            SET menu_category_id = EXCLUDED.menu_category_id,
                product_id = EXCLUDED.product_id,
                display_order = EXCLUDED.display_order,
                is_active = EXCLUDED.is_active
            """
        )) {
          ps.setLong(1, itemId);
          ps.setLong(2, categoryId);
          ps.setLong(3, productId);
          ps.setInt(4, PayloadJson.intValue(item, "displayOrder", 0));
          ps.setBoolean(5, Boolean.TRUE.equals(PayloadJson.bool(item, "active", true)));
          ps.setTimestamp(6, Timestamp.from(clock.instant()));
          ps.executeUpdate();
        }
      }
    }
  }

  private static List<JsonNode> menuItems(JsonNode category) {
    JsonNode items = category.get("items");
    if (items == null || !items.isArray()) {
      return List.of();
    }
    List<JsonNode> result = new ArrayList<>();
    items.forEach(result::add);
    return result;
  }

  private static String normalizeStatus(String status) {
    return switch (status == null ? "active" : status.trim().toLowerCase()) {
      case "draft", "inactive" -> status.trim().toLowerCase();
      default -> "active";
    };
  }

  private static String normalizeScope(String scopeType) {
    return switch (scopeType == null ? "corporate" : scopeType.trim().toLowerCase()) {
      case "region", "outlet" -> scopeType.trim().toLowerCase();
      default -> "corporate";
    };
  }
}
