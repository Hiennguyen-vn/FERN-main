package com.natsu.common.model.cache;

/**
 * Exception thrown for cache-related errors.
 * Mirrors the structure of
 * {@link com.natsu.common.model.database.DatabaseException}
 * for consistency across the common-model subsystem.
 */
public class CacheException extends RuntimeException {

    private final String cacheName;
    private final String operation;

    public CacheException(String message) {
        super(message);
        this.cacheName = null;
        this.operation = null;
    }

    public CacheException(String message, Throwable cause) {
        super(message, cause);
        this.cacheName = null;
        this.operation = null;
    }

    public CacheException(String cacheName, String message) {
        super("[" + cacheName + "] " + message);
        this.cacheName = cacheName;
        this.operation = null;
    }

    public CacheException(String cacheName, String message, Throwable cause) {
        super("[" + cacheName + "] " + message, cause);
        this.cacheName = cacheName;
        this.operation = null;
    }

    public CacheException(String cacheName, String operation, String message) {
        super("[" + cacheName + "] " + operation + ": " + message);
        this.cacheName = cacheName;
        this.operation = operation;
    }

    public CacheException(String cacheName, String operation, String message, Throwable cause) {
        super("[" + cacheName + "] " + operation + ": " + message, cause);
        this.cacheName = cacheName;
        this.operation = operation;
    }

    /**
     * Gets the name of the cache that produced this exception.
     *
     * @return the cache name, or null if not specified
     */
    public String getCacheName() {
        return cacheName;
    }

    /**
     * Gets the operation that was being performed when the error occurred.
     *
     * @return the operation name, or null if not specified
     */
    public String getOperation() {
        return operation;
    }
}
