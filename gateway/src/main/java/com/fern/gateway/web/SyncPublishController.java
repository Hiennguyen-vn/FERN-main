package com.fern.gateway.web;

import com.fern.gateway.ws.SyncEventBroadcaster;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * Internal endpoint: other FERN microservices POST here to push sync events to edge devices.
 * Protected by the standard internal-service token check in GatewayAuthenticationFilter.
 *
 * POST /api/v1/gateway/sync/publish/{outletId}
 *   Body: raw JSON event string, e.g. {"type":"catalog.updated"}
 *
 * POST /api/v1/gateway/sync/publish/all
 *   Body: event broadcast to every connected outlet.
 */
@RestController
@RequestMapping("/api/v1/gateway/sync/publish")
public class SyncPublishController {

    private final SyncEventBroadcaster broadcaster;

    public SyncPublishController(SyncEventBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    @PostMapping("/{outletId}")
    public Mono<ResponseEntity<Void>> publishToOutlet(
            @PathVariable long outletId,
            @RequestBody String eventJson
    ) {
        broadcaster.publish(outletId, eventJson);
        return Mono.just(ResponseEntity.noContent().<Void>build());
    }

    @PostMapping("/all")
    public Mono<ResponseEntity<Void>> publishToAll(@RequestBody String eventJson) {
        broadcaster.publishAll(eventJson);
        return Mono.just(ResponseEntity.noContent().<Void>build());
    }
}
