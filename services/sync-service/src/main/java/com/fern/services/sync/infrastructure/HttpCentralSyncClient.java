package com.fern.services.sync.infrastructure;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.CentralSyncClient;
import com.fern.services.sync.application.SyncProperties;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class HttpCentralSyncClient implements CentralSyncClient {

  private final RestClient.Builder restClientBuilder;
  private final SyncProperties properties;

  public HttpCentralSyncClient(RestClient.Builder restClientBuilder, SyncProperties properties) {
    this.restClientBuilder = restClientBuilder;
    this.properties = properties;
  }

  @Override
  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    return restClientBuilder.build()
        .post()
        .uri(properties.getCentralSyncUrl() + "/api/sync/upload")
        .body(request)
        .retrieve()
        .body(SyncDtos.SyncUploadResponse.class);
  }
}
