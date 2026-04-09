package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseException;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Wrapper for SQL database connections.
 * Provides convenient methods for executing queries.
 */
public interface SqlConnection extends AutoCloseable {

    /**
     * Gets the underlying JDBC connection.
     *
     * @return the JDBC connection
     */
    Connection getJdbcConnection();

    /**
     * Executes a query and returns results.
     *
     * @param sql the SQL query
     * @param params the parameters
     * @return the result
     */
    SqlResult query(String sql, Object... params);

    /**
     * Executes an update statement.
     *
     * @param sql the SQL statement
     * @param params the parameters
     * @return number of affected rows
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
     * Begins a transaction.
     */
    void beginTransaction();

    /**
     * Commits the current transaction.
     */
    void commit();

    /**
     * Rolls back the current transaction.
     */
    void rollback();

    /**
     * Sets the transaction isolation level.
     *
     * @param level the isolation level
     */
    void setIsolationLevel(SqlDatabase.IsolationLevel level);

    /**
     * Checks if a transaction is active.
     *
     * @return true if in transaction
     */
    boolean isInTransaction();

    /**
     * Checks if the connection is valid.
     *
     * @return true if valid
     */
    boolean isValid();

    @Override
    void close();

    /**
     * Creates a connection wrapper from a JDBC connection.
     *
     * @param connection the JDBC connection
     * @return the wrapper
     */
    static SqlConnection wrap(Connection connection) {
        return new DefaultSqlConnection(connection);
    }
}

/**
 * Default implementation of SqlConnection.
 */
class DefaultSqlConnection implements SqlConnection {

    private final Connection connection;
    private boolean inTransaction = false;

    DefaultSqlConnection(Connection connection) {
        this.connection = connection;
    }

    @Override
    public Connection getJdbcConnection() {
        return connection;
    }

    @Override
    public SqlResult query(String sql, Object... params) {
        try {
            PreparedStatement stmt = connection.prepareStatement(sql);
            setParameters(stmt, params);
            ResultSet rs = stmt.executeQuery();
            return SqlResult.from(rs);
        } catch (SQLException e) {
            throw new DatabaseException("query", sql, e.getMessage(), e);
        }
    }

    @Override
    public int execute(String sql, Object... params) {
        try (PreparedStatement stmt = connection.prepareStatement(sql)) {
            setParameters(stmt, params);
            return stmt.executeUpdate();
        } catch (SQLException e) {
            throw new DatabaseException("execute", sql, e.getMessage(), e);
        }
    }

    @Override
    public List<Object> executeInsert(String sql, Object... params) {
        try (PreparedStatement stmt = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            setParameters(stmt, params);
            stmt.executeUpdate();
            
            List<Object> keys = new ArrayList<>();
            try (ResultSet rs = stmt.getGeneratedKeys()) {
                while (rs.next()) {
                    keys.add(rs.getObject(1));
                }
            }
            return keys;
        } catch (SQLException e) {
            throw new DatabaseException("executeInsert", sql, e.getMessage(), e);
        }
    }

    @Override
    public void beginTransaction() {
        try {
            connection.setAutoCommit(false);
            inTransaction = true;
        } catch (SQLException e) {
            throw new DatabaseException("transaction", "beginTransaction", e.getMessage(), e);
        }
    }

    @Override
    public void commit() {
        try {
            connection.commit();
            connection.setAutoCommit(true);
            inTransaction = false;
        } catch (SQLException e) {
            throw new DatabaseException("transaction", "commit", e.getMessage(), e);
        }
    }

    @Override
    public void rollback() {
        try {
            connection.rollback();
            connection.setAutoCommit(true);
            inTransaction = false;
        } catch (SQLException e) {
            throw new DatabaseException("transaction", "rollback", e.getMessage(), e);
        }
    }

    @Override
    public void setIsolationLevel(SqlDatabase.IsolationLevel level) {
        try {
            connection.setTransactionIsolation(level.getJdbcLevel());
        } catch (SQLException e) {
            throw new DatabaseException("transaction", "setIsolationLevel", e.getMessage(), e);
        }
    }

    @Override
    public boolean isInTransaction() {
        return inTransaction;
    }

    @Override
    public boolean isValid() {
        try {
            return connection != null && !connection.isClosed() && connection.isValid(5);
        } catch (SQLException e) {
            return false;
        }
    }

    @Override
    public void close() {
        try {
            if (inTransaction) {
                rollback();
            }
            connection.close();
        } catch (SQLException e) {
            // Ignore close errors
        }
    }

    private void setParameters(PreparedStatement stmt, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            Object param = params[i];
            if (param == null) {
                stmt.setNull(i + 1, Types.NULL);
            } else if (param instanceof String) {
                stmt.setString(i + 1, (String) param);
            } else if (param instanceof Integer) {
                stmt.setInt(i + 1, (Integer) param);
            } else if (param instanceof Long) {
                stmt.setLong(i + 1, (Long) param);
            } else if (param instanceof Double) {
                stmt.setDouble(i + 1, (Double) param);
            } else if (param instanceof Float) {
                stmt.setFloat(i + 1, (Float) param);
            } else if (param instanceof Boolean) {
                stmt.setBoolean(i + 1, (Boolean) param);
            } else if (param instanceof java.util.Date) {
                stmt.setTimestamp(i + 1, new Timestamp(((java.util.Date) param).getTime()));
            } else if (param instanceof java.time.LocalDateTime) {
                stmt.setTimestamp(i + 1, Timestamp.valueOf((java.time.LocalDateTime) param));
            } else if (param instanceof java.time.LocalDate) {
                stmt.setDate(i + 1, Date.valueOf((java.time.LocalDate) param));
            } else if (param instanceof byte[]) {
                stmt.setBytes(i + 1, (byte[]) param);
            } else {
                stmt.setObject(i + 1, param);
            }
        }
    }
}
