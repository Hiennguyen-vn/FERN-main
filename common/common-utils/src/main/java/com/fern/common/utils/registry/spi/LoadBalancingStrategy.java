package com.fern.common.utils.registry.spi;

import com.fern.common.utils.registry.model.ServiceInstance;

import java.util.List;
import java.util.Optional;

public interface LoadBalancingStrategy {

    /**
     * Choose an instance from a list to balance load.
     */
    Optional<ServiceInstance> choose(List<ServiceInstance> instances);

    String getName();
}
