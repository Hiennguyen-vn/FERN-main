package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.infrastructure.SyncRepository;
import com.fern.services.sync.infrastructure.SyncRepository.UploadInsertResult;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class SyncUploadService {

  private static final Logger log = LoggerFactory.getLogger(SyncUploadService.class);

  private final SyncRepository syncRepository;
  private final SyncNodeAuthService syncNodeAuthService;

  public SyncUploadService(SyncRepository syncRepository, SyncNodeAuthService syncNodeAuthService) {
    this.syncRepository = syncRepository;
    this.syncNodeAuthService = syncNodeAuthService;
  }

  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    syncNodeAuthService.requireUploadScope(request);
    List<String> accepted = new ArrayList<>();
    List<String> duplicated = new ArrayList<>();
    List<SyncDtos.RejectedEvent> rejected = new ArrayList<>();
    for (SyncDtos.SyncEvent event : request.events()) {
      try {
        UploadInsertResult result = syncRepository.insertCentralInbox(request.nodeId(), request.storeId(), event);
        if (result == UploadInsertResult.DUPLICATED) {
          duplicated.add(event.eventId());
        } else {
          accepted.add(event.eventId());
        }
      } catch (Exception e) {
        log.warn("Rejected sync upload event nodeId={} storeId={} eventId={}: {}",
            request.nodeId(), request.storeId(), event.eventId(), e.getMessage());
        rejected.add(new SyncDtos.RejectedEvent(event.eventId(), "APPLY_FAILED"));
      }
    }
    return new SyncDtos.SyncUploadResponse(accepted, duplicated, rejected);
  }
}
