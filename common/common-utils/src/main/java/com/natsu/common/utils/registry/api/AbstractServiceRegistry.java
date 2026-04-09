package com.natsu.common.utils.registry.api;

import com.natsu.common.utils.registry.model.ServiceInstance;

import java.util.List;
import java.util.concurrent.CompletableFuture;

public interface AbstractServiceRegistry {

    /**
     * Register a service instance.
     */
    CompletableFuture<Void> register(ServiceInstance instance);

    /**
     * Unregister a service instance.
     */
    CompletableFuture<Void> unregister(String serviceId, String instanceId);

    /**
     * Find all instances for a service ID.
     */
    List<ServiceInstance> find(String serviceId);

    /**
     * Find a specific instance.
     */
    ServiceInstance findInstance(String serviceId, String instanceId);

    /**
     * Get all registered services.
     */
    List<String> getServiceIds();
}
