package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseException;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Simple connection pool implementation without external dependencies.
 * For production use, consider HikariConnectionPool instead.
 */
public class SimpleConnectionPool implements ConnectionPool {

    private final String jdbcUrl;
    private final String username;
    private final String password;
    private final int minPoolSize;
    private final int maxPoolSize;
    private final long connectionTimeoutMs;
    private final long idleTimeoutMs;
    private final long maxLifetimeMs;
    private final String validationQuery;

    private final BlockingQueue<PooledConnection> availableConnections;
    private final ConcurrentHashMap<Connection, PooledConnection> allConnections = new ConcurrentHashMap<>();
    private final AtomicInteger activeCount = new AtomicInteger(0);
    private final AtomicBoolean running = new AtomicBoolean(false);
    private ScheduledExecutorService maintenanceExecutor;

    private SimpleConnectionPool(Builder builder) {
        this.jdbcUrl = builder.jdbcUrl;
        this.username = builder.username;
        this.password = builder.password;
        this.minPoolSize = builder.minPoolSize;
        this.maxPoolSize = builder.maxPoolSize;
        this.connectionTimeoutMs = builder.connectionTimeoutMs;
        this.idleTimeoutMs = builder.idleTimeoutMs;
        this.maxLifetimeMs = builder.maxLifetimeMs;
        this.validationQuery = builder.validationQuery;
        this.availableConnections = new LinkedBlockingQueue<>(maxPoolSize);
    }

    public static Builder builder() {
        return new Builder();
    }

    @Override
    public Connection getConnection() {
        if (!running.get()) {
            throw new DatabaseException("Connection pool is not running");
        }

        PooledConnection pooledConn = null;
        
        try {
            // Try to get an existing connection
            pooledConn = availableConnections.poll(connectionTimeoutMs, TimeUnit.MILLISECONDS);
            
            if (pooledConn != null) {
                if (isConnectionValid(pooledConn)) {
                    activeCount.incrementAndGet();
                    pooledConn.markActive();
                    return pooledConn.connection;
                } else {
                    // Connection is invalid, close it and try to create new
                    closeConnection(pooledConn);
                    pooledConn = null;
                }
            }
            
            // No connection available, try to create new
            if (allConnections.size() < maxPoolSize) {
                pooledConn = createConnection();
                if (pooledConn != null) {
                    activeCount.incrementAndGet();
                    return pooledConn.connection;
                }
            }
            
            // Wait for a connection to become available
            pooledConn = availableConnections.poll(connectionTimeoutMs, TimeUnit.MILLISECONDS);
            if (pooledConn != null && isConnectionValid(pooledConn)) {
                activeCount.incrementAndGet();
                pooledConn.markActive();
                return pooledConn.connection;
            }
            
            throw new DatabaseException("Connection timeout - no available connections");
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DatabaseException("Interrupted while waiting for connection", e);
        }
    }

    @Override
    public void releaseConnection(Connection connection) {
        PooledConnection pooledConn = allConnections.get(connection);
        if (pooledConn != null) {
            activeCount.decrementAndGet();
            pooledConn.markIdle();
            
            if (running.get() && isConnectionValid(pooledConn)) {
                availableConnections.offer(pooledConn);
            } else {
                closeConnection(pooledConn);
            }
        }
    }

    @Override
    public int getActiveConnections() {
        return activeCount.get();
    }

    @Override
    public int getIdleConnections() {
        return availableConnections.size();
    }

    @Override
    public int getTotalConnections() {
        return allConnections.size();
    }

    @Override
    public int getMaxPoolSize() {
        return maxPoolSize;
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public void start() {
        if (running.compareAndSet(false, true)) {
            // Pre-create minimum connections
            for (int i = 0; i < minPoolSize; i++) {
                PooledConnection conn = createConnection();
                if (conn != null) {
                    availableConnections.offer(conn);
                }
            }
            
            // Start maintenance thread
            maintenanceExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "pool-maintenance");
                t.setDaemon(true);
                return t;
            });
            maintenanceExecutor.scheduleAtFixedRate(this::performMaintenance, 30, 30, TimeUnit.SECONDS);
        }
    }

    @Override
    public void shutdown() {
        if (running.compareAndSet(true, false)) {
            if (maintenanceExecutor != null) {
                maintenanceExecutor.shutdownNow();
            }
            
            // Close all connections
            for (PooledConnection conn : allConnections.values()) {
                closeConnection(conn);
            }
            allConnections.clear();
            availableConnections.clear();
        }
    }

    private PooledConnection createConnection() {
        try {
            Connection conn;
            if (username != null) {
                conn = DriverManager.getConnection(jdbcUrl, username, password);
            } else {
                conn = DriverManager.getConnection(jdbcUrl);
            }
            
            PooledConnection pooledConn = new PooledConnection(conn);
            allConnections.put(conn, pooledConn);
            return pooledConn;
        } catch (SQLException e) {
            throw new DatabaseException("Failed to create connection", e);
        }
    }

    private boolean isConnectionValid(PooledConnection pooledConn) {
        if (pooledConn.connection == null) {
            return false;
        }
        
        // Check max lifetime
        if (System.currentTimeMillis() - pooledConn.createTime > maxLifetimeMs) {
            return false;
        }
        
        try {
            if (pooledConn.connection.isClosed()) {
                return false;
            }
            
            if (validationQuery != null && !validationQuery.isEmpty()) {
                try (var stmt = pooledConn.connection.createStatement()) {
                    stmt.execute(validationQuery);
                }
            } else {
                return pooledConn.connection.isValid(5);
            }
            
            return true;
        } catch (SQLException e) {
            return false;
        }
    }

    private void closeConnection(PooledConnection pooledConn) {
        allConnections.remove(pooledConn.connection);
        try {
            if (!pooledConn.connection.isClosed()) {
                pooledConn.connection.close();
            }
        } catch (SQLException e) {
            // Ignore close errors
        }
    }

    private void performMaintenance() {
        // Remove idle connections that have exceeded idle timeout
        long now = System.currentTimeMillis();
        
        availableConnections.removeIf(pooledConn -> {
            if (now - pooledConn.lastActiveTime > idleTimeoutMs && 
                allConnections.size() > minPoolSize) {
                closeConnection(pooledConn);
                return true;
            }
            return false;
        });
        
        // Ensure minimum pool size
        while (allConnections.size() < minPoolSize && running.get()) {
            PooledConnection conn = createConnection();
            if (conn != null) {
                availableConnections.offer(conn);
            } else {
                break;
            }
        }
    }

    private static class PooledConnection {
        final Connection connection;
        final long createTime;
        volatile long lastActiveTime;

        PooledConnection(Connection connection) {
            this.connection = connection;
            this.createTime = System.currentTimeMillis();
            this.lastActiveTime = createTime;
        }

        void markActive() {
            lastActiveTime = System.currentTimeMillis();
        }

        void markIdle() {
            lastActiveTime = System.currentTimeMillis();
        }
    }

    public static class Builder {
        private String jdbcUrl;
        private String username;
        private String password;
        private int minPoolSize = 5;
        private int maxPoolSize = 20;
        private long connectionTimeoutMs = 30000;
        private long idleTimeoutMs = 600000; // 10 minutes
        private long maxLifetimeMs = 1800000; // 30 minutes
        private String validationQuery = "SELECT 1";

        public Builder jdbcUrl(String jdbcUrl) {
            this.jdbcUrl = jdbcUrl;
            return this;
        }

        public Builder username(String username) {
            this.username = username;
            return this;
        }

        public Builder password(String password) {
            this.password = password;
            return this;
        }

        public Builder minPoolSize(int minPoolSize) {
            this.minPoolSize = minPoolSize;
            return this;
        }

        public Builder maxPoolSize(int maxPoolSize) {
            this.maxPoolSize = maxPoolSize;
            return this;
        }

        public Builder connectionTimeoutMs(long connectionTimeoutMs) {
            this.connectionTimeoutMs = connectionTimeoutMs;
            return this;
        }

        public Builder idleTimeoutMs(long idleTimeoutMs) {
            this.idleTimeoutMs = idleTimeoutMs;
            return this;
        }

        public Builder maxLifetimeMs(long maxLifetimeMs) {
            this.maxLifetimeMs = maxLifetimeMs;
            return this;
        }

        public Builder validationQuery(String validationQuery) {
            this.validationQuery = validationQuery;
            return this;
        }

        public SimpleConnectionPool build() {
            if (jdbcUrl == null || jdbcUrl.isEmpty()) {
                throw new IllegalArgumentException("JDBC URL is required");
            }
            return new SimpleConnectionPool(this);
        }
    }
}
