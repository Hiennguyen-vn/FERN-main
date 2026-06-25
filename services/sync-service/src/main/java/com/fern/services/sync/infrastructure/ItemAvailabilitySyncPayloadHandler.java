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
public class ItemAvailabilitySyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public ItemAvailabilitySyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.ITEM_AVAILABILITY
        && eventType == EventType.ITEM_AVAILABILITY_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    Long productId = PayloadJson.longValue(payload, "productId", null);
    Long outletId = PayloadJson.longValue(payload, "outletId", PayloadJson.longValue(payload, "storeId", null));
    if (productId == null || outletId == null) {
      throw new IllegalArgumentException("ITEM_AVAILABILITY_UPDATED requires productId and outletId/storeId");
    }
    boolean available = Boolean.TRUE.equals(PayloadJson.bool(payload, "available", true));
    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.product_outlet_availability (
            product_id, outlet_id, is_available, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (product_id, outlet_id) DO UPDATE
          SET is_available = EXCLUDED.is_available,
              updated_at = EXCLUDED.updated_at
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, productId);
        ps.setLong(2, outletId);
        ps.setBoolean(3, available);
        ps.setTimestamp(4, now);
        ps.setTimestamp(5, now);
        ps.executeUpdate();
      }
      return null;
    });
  }
}
