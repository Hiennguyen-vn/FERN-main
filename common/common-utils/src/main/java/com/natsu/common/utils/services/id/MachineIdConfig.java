package com.natsu.common.utils.services.id;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServiceDefinition;

/**
 * Configuration definition that registers the current machine worker ID
 * within the {@link com.natsu.common.utils.services.ServicesRegistry}.
 *
 * @param machineId the unique integer ID identifying the executing node
 */
public record MachineIdConfig(long machineId) implements ServiceDefinition {

    @Override
    public String getName() {
        return "machine-id";
    }

    @Override
    public ServiceCategory getServiceCategory() {
        return ServiceCategory.CUSTOM;
    }
}
