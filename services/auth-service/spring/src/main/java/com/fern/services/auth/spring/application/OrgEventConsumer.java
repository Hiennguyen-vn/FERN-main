package com.fern.services.auth.spring.application;

import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fern.events.core.EventEnvelope;
import com.fern.events.org.OutletCreatedEvent;
import com.fern.events.org.OutletUpdatedEvent;
import com.fern.events.org.RegionUpdatedEvent;
import com.fern.services.auth.spring.infrastructure.OrgSyncRepository;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class OrgEventConsumer {

  private static final Logger log = LoggerFactory.getLogger(OrgEventConsumer.class);

  private final OrgSyncRepository orgSyncRepository;
  private final PermissionMatrixService permissionMatrixService;
  private final ObjectMapper objectMapper;
  private final MeterRegistry meterRegistry;

  public OrgEventConsumer(
      OrgSyncRepository orgSyncRepository,
      PermissionMatrixService permissionMatrixService,
      ObjectMapper objectMapper,
      MeterRegistry meterRegistry
  ) {
    this.orgSyncRepository = orgSyncRepository;
    this.permissionMatrixService = permissionMatrixService;
    this.objectMapper = objectMapper;
    this.meterRegistry = meterRegistry;
  }

  @KafkaListener(topics = "fern.org.outlet-created")
  public void consumeOutletCreated(String message) {
    handleOutletCreated(message);
  }

  @KafkaListener(topics = "fern.org.outlet-updated")
  public void consumeOutletUpdated(String message) {
    handleOutletUpdated(message);
  }

  @KafkaListener(topics = "fern.org.region-updated")
  public void consumeRegionUpdated(String message) {
    handleRegionUpdated(message);
  }

  void handleOutletCreated(String rawMessage) {
    try {
      EventEnvelope<OutletCreatedEvent> envelope = objectMapper.readValue(
          rawMessage,
          new TypeReference<>() {}
      );
      OutletCreatedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring outlet-created event with empty payload");
        return;
      }
      log.info("Processing outlet-created: outletId={} regionId={}", event.outletId(), event.regionId());
      Set<Long> affectedUsers = orgSyncRepository.fanOutNewOutlet(event.outletId(), event.regionId());
      affectedUsers.forEach(id -> permissionMatrixService.evict(id));
      log.info("outlet-created outletId={}: evicted {} user caches", event.outletId(), affectedUsers.size());
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.org.outlet-created", ex);
    }
  }

  void handleOutletUpdated(String rawMessage) {
    try {
      EventEnvelope<OutletUpdatedEvent> envelope = objectMapper.readValue(
          rawMessage,
          new TypeReference<>() {}
      );
      OutletUpdatedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring outlet-updated event with empty payload");
        return;
      }

      // outlet.region_id is immutable via normal API flows — this event carries name/address/status changes.
      // Detect mismatch in case of manual DB modification (devops SQL, migration script, etc.)
      Long dbRegionId = orgSyncRepository.findOutletRegionId(event.outletId());
      if (dbRegionId == null) {
        log.warn("outlet-updated received for non-existent outlet: {}", event.outletId());
        return;
      }

      if (!dbRegionId.equals(event.regionId())) {
        // Manual DB region change detected — run defensive re-sync using current DB state
        log.error(
            "REGION MISMATCH DETECTED: outlet={} event.regionId={} DB.region_id={}. "
                + "Possible manual DB modification. Running defensive re-sync.",
            event.outletId(), event.regionId(), dbRegionId
        );
        meterRegistry.counter("org.outlet.region_mismatch").increment();
        Set<Long> affectedUsers = orgSyncRepository.reSyncOutletRegion(event.outletId(), dbRegionId);
        affectedUsers.forEach(id -> permissionMatrixService.evict(id));
        log.info("Defensive re-sync complete for outlet={}: evicted {} user caches",
            event.outletId(), affectedUsers.size());
        return;
      }

      // Normal case: name/address/status change, region unchanged, no permission impact
      log.debug("outlet-updated for outletId={} regionId={} - region unchanged, no-op",
          event.outletId(), event.regionId());
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.org.outlet-updated", ex);
    }
  }

  void handleRegionUpdated(String rawMessage) {
    try {
      EventEnvelope<RegionUpdatedEvent> envelope = objectMapper.readValue(
          rawMessage,
          new TypeReference<>() {}
      );
      RegionUpdatedEvent event = envelope.payload();
      if (event == null) {
        log.warn("Ignoring region-updated event with empty payload");
        return;
      }
      log.info("Processing region-updated: regionId={} parentRegionId={}", event.regionId(), event.parentRegionId());
      // OrgScopeRepository rebuilds region tree from DB live — DB rows already correct.
      // Only cache eviction needed to reflect new subtree structure.
      Set<Long> affectedUsers = orgSyncRepository.collectUsersInRegionSubtree(event.regionId());
      affectedUsers.forEach(id -> permissionMatrixService.evict(id));
      log.info("region-updated regionId={}: evicted {} user caches", event.regionId(), affectedUsers.size());
    } catch (Exception ex) {
      throw new IllegalStateException("Failed to process fern.org.region-updated", ex);
    }
  }
}
