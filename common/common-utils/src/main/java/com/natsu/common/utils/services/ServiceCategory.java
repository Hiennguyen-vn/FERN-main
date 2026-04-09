package com.natsu.common.utils.services;

/**
 * Categories of services that can be defined in the ServicesRegistry.
 */
public enum ServiceCategory {

    /**
     * Database services (SQL and NoSQL).
     */
    DATABASE,

    /**
     * Cache services (in-memory, distributed).
     */
    CACHE,

    /**
     * Message queue services (local, socket, Redis, RabbitMQ).
     */
    MESSAGE_QUEUE,

    /**
     * Generic/custom service category.
     */
    CUSTOM
}
