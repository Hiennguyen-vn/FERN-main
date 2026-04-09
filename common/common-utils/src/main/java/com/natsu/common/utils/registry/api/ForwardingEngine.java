package com.natsu.common.utils.registry.api;

import com.natsu.common.utils.registry.model.RoutingDecision;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

public interface ForwardingEngine {

    /**
     * Forward a request to the selected service instance.
     * 
     * @param decision    The routing decision containing the target instance
     * @param requestBody The request body/payload
     * @param headers     Request headers
     * @return Future containing the response (as String for now, or generic Object)
     */
    CompletableFuture<Object> forward(RoutingDecision decision, Object requestBody, Map<String, String> headers);
}
