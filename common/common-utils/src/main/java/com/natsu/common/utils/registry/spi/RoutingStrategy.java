package com.natsu.common.utils.registry.spi;

import com.natsu.common.utils.registry.model.RoutingDecision;
import com.natsu.common.utils.registry.model.ServiceInstance;

import java.util.List;
import java.util.Map;

/**
 * Strategy to select a service instance from a list of candidates.
 */
public interface RoutingStrategy {

    /**
     * Select a service instance based on the request context and available
     * instances.
     * 
     * @param requestContext Context of the request (headers, metadata, etc.) -
     *                       represented as Map for abstraction
     * @param instances      List of available healthy instances
     * @return RoutingDecision containing the selected instance or failure details
     */
    RoutingDecision select(Map<String, String> requestContext, List<ServiceInstance> instances);

    /**
     * Strategy identifier.
     */
    String getName();
}
