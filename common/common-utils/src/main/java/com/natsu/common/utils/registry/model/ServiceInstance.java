package com.natsu.common.utils.registry.model;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public class ServiceInstance {
    private final String serviceId;
    private final String instanceId;
    private final String host;
    private final int port;
    private final int priority;

    private final AtomicReference<ServiceState> state;
    private final AtomicInteger activeConnections;
    private final Map<String, String> metadata;
    private final long registeredAt;

    public ServiceInstance(String serviceId, String instanceId, String host, int port, int priority) {
        this.serviceId = serviceId;
        this.instanceId = instanceId;
        this.host = host;
        this.port = port;
        this.priority = priority;
        this.state = new AtomicReference<>(ServiceState.STARTING);
        this.activeConnections = new AtomicInteger(0);
        this.metadata = new ConcurrentHashMap<>();
        this.registeredAt = System.currentTimeMillis();
    }

    public String getServiceId() {
        return serviceId;
    }

    public String getInstanceId() {
        return instanceId;
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public int getPriority() {
        return priority;
    }

    public ServiceState getState() {
        return state.get();
    }

    public void setState(ServiceState newState) {
        state.set(newState);
    }

    public int getActiveConnections() {
        return activeConnections.get();
    }

    public void incrementConnections() {
        activeConnections.incrementAndGet();
    }

    public void decrementConnections() {
        activeConnections.decrementAndGet();
    }

    public Map<String, String> getMetadata() {
        return metadata;
    }

    public long getRegisteredAt() {
        return registeredAt;
    }

    public boolean isHealthy() {
        return state.get() == ServiceState.HEALTHY;
    }

    public boolean isDraining() {
        return state.get() == ServiceState.DRAINING;
    }

    public boolean canAcceptTraffic() {
        ServiceState s = state.get();
        return s == ServiceState.HEALTHY; // Draining instances do NOT accept new traffic
    }

    @Override
    public String toString() {
        return "ServiceInstance{" +
                "id='" + instanceId + '\'' +
                ", service='" + serviceId + '\'' +
                ", address=" + host + ":" + port +
                ", state=" + state +
                '}';
    }
}
