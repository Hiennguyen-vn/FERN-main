package com.natsu.common.utils.registry.model;

import java.util.Optional;

public class RoutingDecision {
    private final ServiceInstance selectedInstance;
    private final String decisionReason;
    private final boolean success;
    private final String failureReason;

    private RoutingDecision(ServiceInstance selectedInstance, String decisionReason, boolean success,
            String failureReason) {
        this.selectedInstance = selectedInstance;
        this.decisionReason = decisionReason;
        this.success = success;
        this.failureReason = failureReason;
    }

    public static RoutingDecision success(ServiceInstance instance, String reason) {
        return new RoutingDecision(instance, reason, true, null);
    }

    public static RoutingDecision failure(String reason) {
        return new RoutingDecision(null, null, false, reason);
    }

    public Optional<ServiceInstance> getSelectedInstance() {
        return Optional.ofNullable(selectedInstance);
    }

    public String getDecisionReason() {
        return decisionReason;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getFailureReason() {
        return failureReason;
    }
}
