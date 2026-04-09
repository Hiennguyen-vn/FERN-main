package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.Database;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Interface for SQL databases.
 * Provides relational database operations with connection pooling support.
 */
public interface SqlDatabase extends Database {

    /**
     * Gets a connection from the pool.
     *
     * @return a database connection
     */
    SqlConnection getConnection();

    /**
     * Executes a query and returns results.
     *
     * @param sql the SQL query
     * @param params the query parameters
     * @return the result set
     */
    SqlResult query(String sql, Object... params);

    /**
     * Executes an update (INSERT, UPDATE, DELETE).
     *
     * @param sql the SQL statement
     * @param params the parameters
     * @return the number of affected rows
     */
    int execute(String sql, Object... params);

    /**
     * Executes an insert and returns generated keys.
     *
     * @param sql the INSERT statement
     * @param params the parameters
     * @return list of generated keys
     */
    List<Object> executeInsert(String sql, Object... params);

    /**
     * Executes a batch of statements.
     *
     * @param sql the SQL statement
     * @param batchParams list of parameter arrays
     * @return array of affected row counts
     */
    int[] executeBatch(String sql, List<Object[]> batchParams);

    /**
     * Executes a query asynchronously.
     *
     * @param sql the SQL query
     * @param params the parameters
     * @return future with result
     */
    default CompletableFuture<SqlResult> queryAsync(String sql, Object... params) {
        return CompletableFuture.supplyAsync(() -> query(sql, params));
    }

    /**
     * Executes an update asynchronously.
     *
     * @param sql the SQL statement
     * @param params the parameters
     * @return future with affected row count
     */
    default CompletableFuture<Integer> executeAsync(String sql, Object... params) {
        return CompletableFuture.supplyAsync(() -> execute(sql, params));
    }

    /**
     * Runs operations within a transaction.
     *
     * @param action the transactional action
     * @param <T> the result type
     * @return the result
     */
    <T> T transaction(TransactionAction<T> action);

    /**
     * Runs operations within a transaction with isolation level.
     *
     * @param isolationLevel the isolation level
     * @param action the transactional action
     * @param <T> the result type
     * @return the result
     */
    <T> T transaction(IsolationLevel isolationLevel, TransactionAction<T> action);

    /**
     * Gets the connection pool.
     *
     * @return the pool
     */
    ConnectionPool getConnectionPool();

    /**
     * Creates a query builder for fluent queries.
     *
     * @param table the table name
     * @return the query builder
     */
    default QueryBuilder select(String table) {
        return new QueryBuilder(this, table);
    }

    /**
     * Transaction action interface.
     *
     * @param <T> the result type
     */
    @FunctionalInterface
    interface TransactionAction<T> {
        T execute(SqlConnection connection) throws Exception;
    }

    /**
     * Transaction isolation levels.
     */
    enum IsolationLevel {
        READ_UNCOMMITTED(java.sql.Connection.TRANSACTION_READ_UNCOMMITTED),
        READ_COMMITTED(java.sql.Connection.TRANSACTION_READ_COMMITTED),
        REPEATABLE_READ(java.sql.Connection.TRANSACTION_REPEATABLE_READ),
        SERIALIZABLE(java.sql.Connection.TRANSACTION_SERIALIZABLE);

        private final int jdbcLevel;

        IsolationLevel(int jdbcLevel) {
            this.jdbcLevel = jdbcLevel;
        }

        public int getJdbcLevel() {
            return jdbcLevel;
        }
    }
}
