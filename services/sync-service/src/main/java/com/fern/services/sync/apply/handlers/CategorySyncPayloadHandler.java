package com.fern.services.sync.apply.handlers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.apply.PayloadJson;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.apply.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import javax.sql.DataSource;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

@Component
@Primary
public class CategorySyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public CategorySyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.CATEGORY && eventType == EventType.CATEGORY_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    String code = PayloadJson.text(payload, "code", event.aggregateId());
    String name = PayloadJson.text(payload, "name", code);
    boolean active = Boolean.TRUE.equals(PayloadJson.bool(payload, "active", true));
    String description = PayloadJson.text(payload, "description", null);
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.product_category (code, name, is_active, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (code) DO UPDATE
          SET name = EXCLUDED.name,
              is_active = EXCLUDED.is_active,
              description = EXCLUDED.description,
              updated_at = EXCLUDED.updated_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setString(1, code);
        ps.setString(2, name);
        ps.setBoolean(3, active);
        ps.setString(4, description);
        ps.setTimestamp(5, now);
        ps.setTimestamp(6, now);
        ps.executeUpdate();
      }
      return null;
    });
  }
}
