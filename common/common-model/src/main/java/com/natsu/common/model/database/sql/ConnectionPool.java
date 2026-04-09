package com.natsu.common.model.database.sql;

import java.sql.Connection;

/**
 * Interface for connection pools.
 * Implementations can use HikariCP, C3P0, DBCP, or custom pooling.
 */
public interface ConnectionPool extends AutoCloseable {

    /**
     * Gets a connection from the pool.
     *
     * @return a connection
     */
    Connection getConnection();

    /**
     * Returns a connection to the pool.
     *
     * @param connection the connection to return
     */
    void releaseConnection(Connection connection);

    /**
     * Gets the number of active connections.
     *
     * @return active connection count
     */
    int getActiveConnections();

    /**
     * Gets the number of idle connections.
     *
     * @return idle connection count
     */
    int getIdleConnections();

    /**
     * Gets the total number of connections.
     *
     * @return total connection count
     */
    int getTotalConnections();

    /**
     * Gets the maximum pool size.
     *
     * @return max pool size
     */
    int getMaxPoolSize();

    /**
     * Checks if the pool is running.
     *
     * @return true if running
     */
    boolean isRunning();

    /**
     * Starts the pool.
     */
    void start();

    /**
     * Shuts down the pool.
     */
    void shutdown();

    @Override
    default void close() {
        shutdown();
    }

    /**
     * Supported pool types.
     */
    enum PoolType {
        HIKARI,
        SIMPLE,
        NONE
    }
}
