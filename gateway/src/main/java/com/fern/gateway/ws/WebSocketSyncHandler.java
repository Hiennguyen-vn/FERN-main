package com.fern.gateway.ws;

import com.dorabets.common.spring.auth.DeviceTokenRegistry;
import com.dorabets.common.spring.auth.JwtClaims;
import com.dorabets.common.spring.auth.JwtTokenService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.reactive.socket.WebSocketHandler;
import org.springframework.web.reactive.socket.WebSocketSession;
import reactor.core.publisher.Mono;

/**
 * WebSocket endpoint: {@code /ws/sync/{outletId}}
 *
 * Auth: client sends JWT as query param {@code ?token=<jwt>} on upgrade request.
 * On connect: subscribe to SyncEventBroadcaster for the outlet.
 * Server → client: JSON event lines (catalog.updated, price.updated, device.revoked, …).
 * Client → server: ignored (read-only push channel).
 */
public class WebSocketSyncHandler implements WebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(WebSocketSyncHandler.class);

    private final SyncEventBroadcaster broadcaster;
    private final JwtTokenService jwtTokenService;
    private final DeviceTokenRegistry deviceTokenRegistry;

    public WebSocketSyncHandler(
            SyncEventBroadcaster broadcaster,
            JwtTokenService jwtTokenService,
            DeviceTokenRegistry deviceTokenRegistry
    ) {
        this.broadcaster = broadcaster;
        this.jwtTokenService = jwtTokenService;
        this.deviceTokenRegistry = deviceTokenRegistry;
    }

    @Override
    public Mono<Void> handle(WebSocketSession session) {
        Long outletId = extractOutletId(session);
        if (outletId == null) {
            log.warn("WS /sync rejected - invalid outlet path: {}", session.getHandshakeInfo().getUri().getPath());
            return session.close();
        }
        // Authenticate via ?token= query param
        String query = session.getHandshakeInfo().getUri().getQuery();
        String token = extractToken(query);
        if (token == null || !isAuthorized(token, outletId)) {
            log.warn("WS /sync/{} rejected — missing or invalid token", outletId);
            return session.close();
        }

        log.debug("WS /sync/{} connected: {}", outletId, session.getId());

        // Pipe broadcaster events → WebSocket text frames
        return session.send(
            broadcaster.subscribe(outletId)
                .map(session::textMessage)
                .doOnError(e -> log.debug("WS /sync/{} send error: {}", outletId, e.getMessage()))
        ).doFinally(sig -> log.debug("WS /sync/{} closed: {} ({})", outletId, session.getId(), sig));
    }

    private String extractToken(String query) {
        if (query == null) return null;
        for (String param : query.split("&")) {
            if (param.startsWith("token=")) return param.substring(6);
        }
        return null;
    }

    private Long extractOutletId(WebSocketSession session) {
        String path = session.getHandshakeInfo().getUri().getPath();
        if (path == null || !path.startsWith("/ws/sync/")) return null;
        String raw = path.substring("/ws/sync/".length()).trim();
        if (raw.isEmpty() || raw.contains("/")) return null;
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private boolean isAuthorized(String token, long outletId) {
        try {
            JwtClaims claims = jwtTokenService.verify(token);
            // Device tokens and user tokens are both accepted.
            // Device must belong to this outlet.
            if (claims.isDeviceToken()) {
                deviceTokenRegistry.requireActiveDevice(claims, token);
                return outletId == claims.deviceOutletId();
            }
            // User must have access to this outlet (or be a global admin with no outlet scope).
            return claims.outletIds() == null
                || claims.outletIds().isEmpty()
                || claims.outletIds().contains(outletId);
        } catch (Exception e) {
            return false;
        }
    }
}
