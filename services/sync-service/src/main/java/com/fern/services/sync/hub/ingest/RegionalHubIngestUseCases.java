package com.fern.services.sync.hub.ingest;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.hub.RegionalHubNodeScopePolicy;
import com.fern.services.sync.hub.relay.RegionalIngestRelayEnqueuer;
import com.fern.services.sync.state.DownstreamInboxStore;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class RegionalHubIngestUseCases {

  private static final Logger log = LoggerFactory.getLogger(RegionalHubIngestUseCases.class);

  private final DownstreamInboxStore downstreamInboxStore;
  private final RegionalHubNodeScopePolicy nodeScopePolicy;
  private final RegionalIngestRelayEnqueuer relayEnqueuer;

  public RegionalHubIngestUseCases(
      DownstreamInboxStore downstreamInboxStore,
      RegionalHubNodeScopePolicy nodeScopePolicy,
      RegionalIngestRelayEnqueuer relayEnqueuer
  ) {
    this.downstreamInboxStore = downstreamInboxStore;
    this.nodeScopePolicy = nodeScopePolicy;
    this.relayEnqueuer = relayEnqueuer;
  }

  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    nodeScopePolicy.requireUploadScope(request);
    List<String> accepted = new ArrayList<>();
    List<String> duplicated = new ArrayList<>();
    List<SyncDtos.RejectedEvent> rejected = new ArrayList<>();
    for (SyncDtos.SyncEvent event : request.events()) {
      try {
        DownstreamInboxStore.IngestResult result =
            downstreamInboxStore.insertDownstreamInbox(request.nodeId(), request.storeId(), event);
        if (result == DownstreamInboxStore.IngestResult.DUPLICATED) {
          duplicated.add(event.eventId());
        } else {
          relayEnqueuer.enqueueAccepted(request.nodeId(), request.storeId(), event);
          accepted.add(event.eventId());
        }
      } catch (Exception e) {
        log.warn("Rejected hub sync upload event nodeId={} storeId={} eventId={}: {}",
            request.nodeId(), request.storeId(), event.eventId(), e.getMessage());
        rejected.add(new SyncDtos.RejectedEvent(event.eventId(), "INGEST_FAILED"));
      }
    }
    return new SyncDtos.SyncUploadResponse(accepted, duplicated, rejected);
  }

  public void ack(SyncDtos.SyncAckRequest request, java.util.function.Consumer<SyncDtos.SyncAckRequest> ackConsumer) {
    nodeScopePolicy.requireAckScope(request);
    ackConsumer.accept(request);
  }
}
