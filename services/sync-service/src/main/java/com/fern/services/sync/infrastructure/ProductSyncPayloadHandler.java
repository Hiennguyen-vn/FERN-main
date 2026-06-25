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
import javax.sql.DataSource;
import org.springframework.stereotype.Component;

@Component
public class ProductSyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public ProductSyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.PRODUCT
        && (eventType == EventType.PRODUCT_CREATED || eventType == EventType.PRODUCT_UPDATED);
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    long productId = PayloadJson.longValue(payload, "productId", parseLong(event.aggregateId()));
    String code = PayloadJson.text(payload, "code", event.aggregateId());
    String name = PayloadJson.text(payload, "name", code);
    String categoryCode = PayloadJson.text(payload, "categoryCode", null);
    String categoryName = PayloadJson.text(payload, "categoryName", categoryCode);
    String status = normalizeStatus(PayloadJson.text(payload, "status", "active"));
    String imageUrl = PayloadJson.text(payload, "imageUrl", null);
    String description = PayloadJson.text(payload, "description", null);
    boolean deleted = Boolean.TRUE.equals(PayloadJson.bool(payload, "deleted", false));

    executeInTransaction(conn -> {
      if (categoryCode != null) {
        try (PreparedStatement ps = conn.prepareStatement(
            """
            INSERT INTO core.product_category (code, name, is_active, created_at, updated_at)
            VALUES (?, ?, TRUE, ?, ?)
            ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name,
                is_active = TRUE,
                updated_at = EXCLUDED.updated_at
            """
        )) {
          Timestamp now = Timestamp.from(clock.instant());
          ps.setString(1, categoryCode);
          ps.setString(2, categoryName == null ? categoryCode : categoryName);
          ps.setTimestamp(3, now);
          ps.setTimestamp(4, now);
          ps.executeUpdate();
        }
      }
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.product (
            id, code, name, category_code, status, image_url, description,
            deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?::product_status_enum, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE
          SET code = EXCLUDED.code,
              name = EXCLUDED.name,
              category_code = EXCLUDED.category_code,
              status = EXCLUDED.status,
              image_url = EXCLUDED.image_url,
              description = EXCLUDED.description,
              deleted_at = EXCLUDED.deleted_at,
              updated_at = EXCLUDED.updated_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, productId);
        ps.setString(2, code);
        ps.setString(3, name);
        ps.setString(4, categoryCode);
        ps.setString(5, status);
        ps.setString(6, imageUrl);
        ps.setString(7, description);
        ps.setTimestamp(8, deleted ? now : null);
        ps.setTimestamp(9, now);
        ps.setTimestamp(10, now);
        ps.executeUpdate();
      }
      return null;
    });
  }

  private static long parseLong(String value) {
    return Long.parseLong(value);
  }

  private static String normalizeStatus(String status) {
    return switch (status == null ? "active" : status.trim().toLowerCase()) {
      case "draft", "inactive", "discontinued" -> status.trim().toLowerCase();
      default -> "active";
    };
  }
}
