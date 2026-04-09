package com.natsu.common.utils.registry.spi;

import java.util.Map;

public interface PermissionPolicy {

    /**
     * Check if a request is allowed to access a service.
     * 
     * @param requestContext Context of the request
     * @param serviceId      Target service ID
     * @return true if allowed, false otherwise
     */
    boolean isAllowed(Map<String, String> requestContext, String serviceId);
}
