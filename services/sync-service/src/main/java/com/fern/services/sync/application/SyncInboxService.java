package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.SyncRepository;
import org.springframework.stereotype.Service;

@Service
public class SyncInboxService {

  private final SyncRepository syncRepository;
  private final SyncNodeAuthService syncNodeAuthService;

  public SyncInboxService(SyncRepository syncRepository, SyncNodeAuthService syncNodeAuthService) {
    this.syncRepository = syncRepository;
    this.syncNodeAuthService = syncNodeAuthService;
  }

  public void ack(SyncDtos.SyncAckRequest request) {
    syncNodeAuthService.requireStoreScope(request.nodeId(), request.storeId());
    syncRepository.ack(request.nodeId(), request.storeId(), request.events());
  }
}
