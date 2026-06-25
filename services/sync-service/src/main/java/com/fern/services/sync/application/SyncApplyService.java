package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import com.fern.services.sync.model.AggregateType;
import com.fern.services.sync.model.ConflictResolution;
import java.util.EnumMap;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class SyncApplyService {

  private static final Map<AggregateType, ConflictResolution> RESOLUTION_BY_AGGREGATE =
      new EnumMap<>(AggregateType.class);

  static {
    RESOLUTION_BY_AGGREGATE.put(AggregateType.PRODUCT, ConflictResolution.CENTRAL_WINS);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.CATEGORY, ConflictResolution.CENTRAL_WINS);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.PRICE_POLICY, ConflictResolution.CENTRAL_WINS);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.PROMOTION, ConflictResolution.CENTRAL_WINS);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.MENU, ConflictResolution.CENTRAL_WINS);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.TAX_POLICY, ConflictResolution.CENTRAL_WINS);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.SALE_ORDER, ConflictResolution.STORE_OWNS_APPEND_ONLY);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.PAYMENT, ConflictResolution.STORE_OWNS_APPEND_ONLY);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.KITCHEN_TICKET, ConflictResolution.STORE_OWNS_APPEND_ONLY);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.STOCK_MOVEMENT, ConflictResolution.APPEND_MOVEMENT);
    RESOLUTION_BY_AGGREGATE.put(AggregateType.ITEM_AVAILABILITY, ConflictResolution.GLOBAL_AND_STORE_AVAILABILITY);
  }

  private final SyncRepository syncRepository;

  public SyncApplyService(SyncRepository syncRepository) {
    this.syncRepository = syncRepository;
  }

  public boolean shouldApply(SyncDtos.SyncEvent event) {
    ConflictResolution resolution = resolutionFor(event.aggregateType());
    if (resolution == ConflictResolution.STORE_OWNS_APPEND_ONLY
        || resolution == ConflictResolution.APPEND_MOVEMENT
        || resolution == ConflictResolution.GLOBAL_AND_STORE_AVAILABILITY) {
      return true;
    }
    return syncRepository.localVersionIsNewer(
        event.aggregateType().name(),
        event.aggregateId(),
        event.version()
    );
  }

  public void markApplied(SyncDtos.SyncEvent event) {
    syncRepository.recordAppliedVersion(event.aggregateType().name(), event.aggregateId(), event.version());
  }

  public ConflictResolution resolutionFor(AggregateType aggregateType) {
    return RESOLUTION_BY_AGGREGATE.getOrDefault(aggregateType, ConflictResolution.MANUAL_REVIEW);
  }
}
