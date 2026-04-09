package com.natsu.common.utils.services;

import java.util.Map;

/**
 * Base interface for all service configurations.
 * 
 * <p>
 * Implementations include:
 * <ul>
 * <li>{@code DatabaseConfig} - Database connection configuration</li>
 * <li>{@code CacheConfig} - Cache configuration</li>
 * <li>{@code MessageQueueConfig} - Message queue configuration</li>
 * </ul>
 * 
 * <p>
 * Usage:
 * 
 * <pre>
 * // Register a config
 * ServicesRegistry.register(databaseConfig);
 * ServicesRegistry.register(cacheConfig);
 * 
 * // Retrieve a config
 * DatabaseConfig db = ServicesRegistry.get("mydb", ServiceCategory.DATABASE);
 * </pre>
 */
public interface ServiceDefinition {

    /**
     * Gets the unique name of this service configuration.
     * This name is used as the key when registering with ServicesRegistry.
     *
     * @return the configuration name
     */
    String getName();

    /**
     * Gets the category of service this definition represents.
     *
     * @return the service category
     */
    ServiceCategory getServiceCategory();

    /**
     * Validates this configuration.
     *
     * @throws IllegalStateException if the configuration is invalid
     */
    default void validate() {
        if (getName() == null || getName().isBlank()) {
            throw new IllegalStateException("Service name cannot be null or blank");
        }
        if (getServiceCategory() == null) {
            throw new IllegalStateException("Service category cannot be null");
        }
    }

    /**
     * Converts this configuration to a map representation.
     * Useful for serialization and debugging.
     *
     * @return a map representation of the configuration
     */
    default Map<String, Object> toMap() {
        return Map.of(
                "name", getName(),
                "serviceCategory", getServiceCategory().name());
    }

    /**
     * Gets a description of this configuration for logging/debugging.
     *
     * @return a human-readable description
     */
    default String getDescription() {
        return getServiceCategory().name().toLowerCase() + ":" + getName();
    }
}
