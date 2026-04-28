package com.fern.gateway.ws;

import com.fern.common.spring.auth.DeviceTokenRegistry;
import com.fern.common.spring.auth.JwtTokenService;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.HandlerMapping;
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping;
import org.springframework.web.reactive.socket.WebSocketHandler;
import org.springframework.web.reactive.socket.server.support.WebSocketHandlerAdapter;

/**
 * Registers one WebSocket handler per configured outlet ID at /ws/sync/{outletId}.
 *
 * Outlet IDs are supplied via ${sync.ws.outlet-ids} (comma-separated list).
 * Example: sync.ws.outlet-ids=1,2,3,4,5
 *
 * New outlets can be added by updating the config + restarting gateway.
 */
@Configuration
public class WebSocketSyncConfiguration {

    @Bean
    public HandlerMapping webSocketSyncHandlerMapping(
            SyncEventBroadcaster broadcaster,
            JwtTokenService jwtTokenService,
            DeviceTokenRegistry deviceTokenRegistry
    ) {
        Map<String, WebSocketHandler> handlers = Map.of(
            "/ws/sync/{outletId}",
            new WebSocketSyncHandler(broadcaster, jwtTokenService, deviceTokenRegistry)
        );
        SimpleUrlHandlerMapping mapping = new SimpleUrlHandlerMapping();
        mapping.setUrlMap(handlers);
        mapping.setOrder(-1);  // before Spring Cloud Gateway route predicates
        return mapping;
    }

    @Bean
    public WebSocketHandlerAdapter webSocketHandlerAdapter() {
        return new WebSocketHandlerAdapter();
    }
}
