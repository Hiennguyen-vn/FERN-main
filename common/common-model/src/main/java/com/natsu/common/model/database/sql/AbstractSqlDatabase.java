package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseStats;
import com.natsu.common.model.database.DatabaseType;

import java.sql.Connection;
import java.util.List;

/**
 * Abstract base implementation for SQL databases.
 * Provides common functionality for MySQL, PostgreSQL, ClickHouse, etc.
 */
public abstract class AbstractSqlDatabase implements SqlDatabase {

    protected final String name;
    protected final DatabaseType type;
    protected final ConnectionPool connectionPool;
    protected final DatabaseStats stats;
    protected volatile boolean connected = false;

    protected AbstractSqlDatabase(String name, DatabaseType type, ConnectionPool connectionPool) {
        this.name = name;
        this.type = type;
        this.connectionPool = connectionPool;
        this.stats = new DatabaseStats(name);
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public DatabaseType getType() {
        return type;
    }

    @Override
    public void connect() {
        connectionPool.start();
        connected = true;
    }

    @Override
    public void disconnect() {
        connected = false;
        connectionPool.shutdown();
    }

    @Override
    public boolean isConnected() {
        return connected && connectionPool.isRunning();
    }

    @Override
    public boolean testConnection() {
        try (SqlConnection conn = getConnection()) {
            return conn.isValid();
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public DatabaseStats getStats() {
        return stats;
    }

    @Override
    public SqlConnection getConnection() {
        Connection jdbcConn = connectionPool.getConnection();
        stats.recordConnectionOpened();
        return new PooledSqlConnection(jdbcConn, this);
    }

    @Override
    public ConnectionPool getConnectionPool() {
        return connectionPool;
    }

    @Override
    public SqlResult query(String sql, Object... params) {
        long start = System.nanoTime();
        boolean success = false;
        try (SqlConnection conn = getConnection()) {
            SqlResult result = conn.query(sql, params);
            success = true;
            return result;
        } finally {
            stats.recordQuery(System.nanoTime() - start, success);
        }
    }

    @Override
    public int execute(String sql, Object... params) {
        long start = System.nanoTime();
        boolean success = false;
        try (SqlConnection conn = getConnection()) {
            int result = conn.execute(sql, params);
            success = true;
            return result;
        } finally {
            stats.recordQuery(System.nanoTime() - start, success);
        }
    }

    @Override
    public List<Object> executeInsert(String sql, Object... params) {
        long start = System.nanoTime();
        boolean success = false;
        try (SqlConnection conn = getConnection()) {
            List<Object> result = conn.executeInsert(sql, params);
            success = true;
            return result;
        } finally {
            stats.recordQuery(System.nanoTime() - start, success);
        }
    }

    @Override
    public int[] executeBatch(String sql, List<Object[]> batchParams) {
        long start = System.nanoTime();
        boolean success = false;
        try (SqlConnection conn = getConnection()) {
            Connection jdbcConn = conn.getJdbcConnection();
            try (var stmt = jdbcConn.prepareStatement(sql)) {
                for (Object[] params : batchParams) {
                    for (int i = 0; i < params.length; i++) {
                        stmt.setObject(i + 1, params[i]);
                    }
                    stmt.addBatch();
                }
                int[] result = stmt.executeBatch();
                success = true;
                return result;
            }
        } catch (Exception e) {
            throw new DatabaseException(name, "executeBatch", e.getMessage(), e);
        } finally {
            stats.recordQuery(System.nanoTime() - start, success);
        }
    }

    @Override
    public <T> T transaction(TransactionAction<T> action) {
        return transaction(IsolationLevel.READ_COMMITTED, action);
    }

    @Override
    public <T> T transaction(IsolationLevel isolationLevel, TransactionAction<T> action) {
        try (SqlConnection conn = getConnection()) {
            conn.setIsolationLevel(isolationLevel);
            conn.beginTransaction();
            try {
                T result = action.execute(conn);
                conn.commit();
                return result;
            } catch (Exception e) {
                conn.rollback();
                throw new DatabaseException(name, "transaction", e.getMessage(), e);
            }
        }
    }

    void releaseConnection(Connection connection) {
        connectionPool.releaseConnection(connection);
        stats.recordConnectionClosed();
    }

    /**
     * SqlConnection that returns to pool on close.
     */
    private class PooledSqlConnection implements SqlConnection {
        private final SqlConnection delegate;
        private final Connection jdbcConnection;
        private final AbstractSqlDatabase database;
        private boolean closed = false;

        PooledSqlConnection(Connection jdbcConnection, AbstractSqlDatabase database) {
            this.jdbcConnection = jdbcConnection;
            this.delegate = SqlConnection.wrap(jdbcConnection);
            this.database = database;
        }

        @Override
        public Connection getJdbcConnection() {
            return jdbcConnection;
        }

        @Override
        public SqlResult query(String sql, Object... params) {
            return delegate.query(sql, params);
        }

        @Override
        public int execute(String sql, Object... params) {
            return delegate.execute(sql, params);
        }

        @Override
        public List<Object> executeInsert(String sql, Object... params) {
            return delegate.executeInsert(sql, params);
        }

        @Override
        public void beginTransaction() {
            delegate.beginTransaction();
        }

        @Override
        public void commit() {
            delegate.commit();
        }

        @Override
        public void rollback() {
            delegate.rollback();
        }

        @Override
        public void setIsolationLevel(IsolationLevel level) {
            delegate.setIsolationLevel(level);
        }

        @Override
        public boolean isInTransaction() {
            return delegate.isInTransaction();
        }

        @Override
        public boolean isValid() {
            return delegate.isValid();
        }

        @Override
        public void close() {
            if (!closed) {
                closed = true;
                if (delegate.isInTransaction()) {
                    delegate.rollback();
                }
                database.releaseConnection(jdbcConnection);
            }
        }
    }
}
