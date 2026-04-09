package com.natsu.common.model.database;

/**
 * Base interface for all database implementations.
 * Provides common operations shared by SQL and NoSQL databases.
 */
public interface Database extends AutoCloseable {

    /**
     * Gets the database name/identifier.
     *
     * @return the database name
     */
    String getName();

    /**
     * Gets the database type.
     *
     * @return the type
     */
    DatabaseType getType();

    /**
     * Connects to the database.
     */
    void connect();

    /**
     * Disconnects from the database.
     */
    void disconnect();

    /**
     * Checks if connected to the database.
     *
     * @return true if connected
     */
    boolean isConnected();

    /**
     * Tests the database connection (ping/health check).
     *
     * @return true if the connection is healthy
     */
    boolean testConnection();

    /**
     * Gets database statistics.
     *
     * @return the stats
     */
    DatabaseStats getStats();

    @Override
    default void close() {
        disconnect();
    }
}
