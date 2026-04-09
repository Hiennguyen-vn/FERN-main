package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseType;

/**
 * ClickHouse database implementation.
 * Optimized for analytics and OLAP workloads.
 */
public class ClickHouseDatabase extends AbstractSqlDatabase {

    private ClickHouseDatabase(String name, ConnectionPool connectionPool) {
        super(name, DatabaseType.CLICKHOUSE, connectionPool);
    }

    /**
     * Creates a ClickHouse database with simple connection pool.
     *
     * @param name the database name
     * @param host the host
     * @param port the port (or 0 for default 8123)
     * @param database the database name
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static ClickHouseDatabase create(String name, String host, int port,
                                             String database, String username, String password) {
        String jdbcUrl = DatabaseType.CLICKHOUSE.buildJdbcUrl(host, port, database);
        return create(name, jdbcUrl, username, password);
    }

    /**
     * Creates a ClickHouse database with simple connection pool using JDBC URL.
     *
     * @param name the database name
     * @param jdbcUrl the JDBC URL
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static ClickHouseDatabase create(String name, String jdbcUrl,
                                             String username, String password) {
        loadDriver();
        
        ConnectionPool pool = SimpleConnectionPool.builder()
                .jdbcUrl(jdbcUrl)
                .username(username)
                .password(password)
                .validationQuery("SELECT 1")
                .build();
        
        return new ClickHouseDatabase(name, pool);
    }

    /**
     * Creates a ClickHouse database with HikariCP connection pool.
     *
     * @param name the database name
     * @param host the host
     * @param port the port (or 0 for default)
     * @param database the database name
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static ClickHouseDatabase createWithHikari(String name, String host, int port,
                                                       String database, String username, String password) {
        String jdbcUrl = DatabaseType.CLICKHOUSE.buildJdbcUrl(host, port, database);
        return createWithHikari(name, jdbcUrl, username, password);
    }

    /**
     * Creates a ClickHouse database with HikariCP connection pool.
     *
     * @param name the database name
     * @param jdbcUrl the JDBC URL
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static ClickHouseDatabase createWithHikari(String name, String jdbcUrl,
                                                       String username, String password) {
        loadDriver();
        
        ConnectionPool pool = HikariConnectionPool.create(
                HikariConnectionPool.HikariConfig.create(jdbcUrl)
                        .username(username)
                        .password(password)
                        .driverClassName(DatabaseType.CLICKHOUSE.getDriverClass())
                        .poolName(name + "-hikari")
                        .connectionTestQuery("SELECT 1")
        );
        
        return new ClickHouseDatabase(name, pool);
    }

    /**
     * Creates a ClickHouse database with a custom connection pool.
     *
     * @param name the database name
     * @param connectionPool the connection pool
     * @return the database instance
     */
    public static ClickHouseDatabase create(String name, ConnectionPool connectionPool) {
        return new ClickHouseDatabase(name, connectionPool);
    }

    /**
     * Inserts data using ClickHouse batch insert (optimized for bulk inserts).
     *
     * @param table the table name
     * @param columns the column names
     * @param values the values (list of rows)
     * @return number of inserted rows
     */
    public int batchInsert(String table, String[] columns, java.util.List<Object[]> values) {
        if (values.isEmpty()) return 0;
        
        String cols = String.join(", ", columns);
        String placeholders = String.join(", ", java.util.Collections.nCopies(columns.length, "?"));
        String sql = String.format("INSERT INTO %s (%s) VALUES (%s)", table, cols, placeholders);
        
        int[] results = executeBatch(sql, values);
        return java.util.Arrays.stream(results).sum();
    }

    private static void loadDriver() {
        try {
            Class.forName(DatabaseType.CLICKHOUSE.getDriverClass());
        } catch (ClassNotFoundException e) {
            // Driver will be loaded automatically if available
        }
    }
}
