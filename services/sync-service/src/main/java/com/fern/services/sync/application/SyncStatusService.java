package com.fern.services.sync.application;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.state.SyncRepository;
import org.springframework.stereotype.Service;

@Service
public class SyncStatusService {

  private final SyncRepository syncRepository;
  private final SyncNodeAuthService syncNodeAuthService;

  public SyncStatusService(SyncRepository syncRepository, SyncNodeAuthService syncNodeAuthService) {
    this.syncRepository = syncRepository;
    this.syncNodeAuthService = syncNodeAuthService;
  }

  public SyncDtos.SyncStatusResponse status(long storeId) {
    syncNodeAuthService.requireDownloadScope(storeId);
    return syncRepository.status(storeId);
  }
}
