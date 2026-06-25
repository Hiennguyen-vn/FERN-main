package com.fern.services.sync.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncPayloadHandler;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.EventType;
import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDate;
import javax.sql.DataSource;
import org.springframework.stereotype.Component;

@Component
public class PricePolicySyncPayloadHandler extends BaseRepository implements SyncPayloadHandler {

  private final Clock clock;

  public PricePolicySyncPayloadHandler(DataSource dataSource, Clock clock) {
    super(dataSource);
    this.clock = clock;
  }

  @Override
  public boolean supports(EventType eventType, AggregateType aggregateType) {
    return aggregateType == AggregateType.PRICE_POLICY && eventType == EventType.PRICE_POLICY_UPDATED;
  }

  @Override
  public void apply(SyncDtos.SyncEvent event) {
    JsonNode payload = event.payload();
    Long productId = PayloadJson.longValue(payload, "productId", null);
    Long outletId = PayloadJson.longValue(payload, "storeId", PayloadJson.longValue(payload, "outletId", null));
    if (productId == null || outletId == null) {
      throw new IllegalArgumentException("PRICE_POLICY_UPDATED requires productId and storeId/outletId");
    }
    String currencyCode = PayloadJson.text(payload, "currencyCode", "USD");
    BigDecimal priceValue = PayloadJson.decimal(
        payload,
        "priceValue",
        PayloadJson.decimal(payload, "unitPrice", null)
    );
    if (priceValue == null) {
      throw new IllegalArgumentException("PRICE_POLICY_UPDATED requires priceValue or unitPrice");
    }
    LocalDate effectiveFrom = PayloadJson.date(payload, "effectiveFrom", LocalDate.now(clock));
    LocalDate effectiveTo = PayloadJson.date(payload, "effectiveTo", null);

    executeInTransaction(conn -> {
      try (PreparedStatement ps = conn.prepareStatement(
          """
          INSERT INTO core.product_price (
            product_id, outlet_id, currency_code, price_value, effective_from,
            effective_to, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (product_id, outlet_id, effective_from) DO UPDATE
          SET currency_code = EXCLUDED.currency_code,
              price_value = EXCLUDED.price_value,
              effective_to = EXCLUDED.effective_to,
              updated_at = EXCLUDED.updated_at,
              version = core.product_price.version + 1
          """
      )) {
        Timestamp now = Timestamp.from(clock.instant());
        ps.setLong(1, productId);
        ps.setLong(2, outletId);
        ps.setString(3, currencyCode);
        ps.setBigDecimal(4, priceValue);
        ps.setObject(5, effectiveFrom);
        ps.setObject(6, effectiveTo);
        ps.setTimestamp(7, now);
        ps.setTimestamp(8, now);
        ps.executeUpdate();
      }
      return null;
    });
  }
}
