package com.fern.services.sync.transport.http;

import com.fern.services.sync.api.SyncDtos;
import com.fern.services.sync.application.SyncProperties;
import com.fern.services.sync.transport.CentralSyncClient;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class HttpCentralSyncClient implements CentralSyncClient {

  private final RestClient restClient;

  public HttpCentralSyncClient(RestClient.Builder restClientBuilder, SyncProperties properties) {
    this.restClient = restClientBuilder.baseUrl(properties.getCentralSyncUrl()).build();
  }

  @Override
  public SyncDtos.SyncUploadResponse upload(SyncDtos.SyncUploadRequest request) {
    return restClient
        .post()
        .uri("/api/sync/upload")
        .body(request)
        .retrieve()
        .body(SyncDtos.SyncUploadResponse.class);
  }

  @Override
  public SyncDtos.SyncDownloadResponse download(long storeId, String cursor, Integer limit) {
    return restClient
        .get()
        .uri(uriBuilder -> {
          uriBuilder.path("/api/sync/download").queryParam("storeId", storeId);
          if (cursor != null && !cursor.isBlank()) {
            uriBuilder.queryParam("cursor", cursor);
          }
          if (limit != null) {
            uriBuilder.queryParam("limit", limit);
          }
          return uriBuilder.build();
        })
        .retrieve()
        .body(SyncDtos.SyncDownloadResponse.class);
  }

  @Override
  public void ack(SyncDtos.SyncAckRequest request) {
    restClient
        .post()
        .uri("/api/sync/ack")
        .body(request)
        .retrieve()
        .toBodilessEntity();
  }
}
