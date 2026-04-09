package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseType;

/**
 * PostgreSQL database implementation.
 */
public class PostgreSqlDatabase extends AbstractSqlDatabase {

    private PostgreSqlDatabase(String name, ConnectionPool connectionPool) {
        super(name, DatabaseType.POSTGRESQL, connectionPool);
    }

    /**
     * Creates a PostgreSQL database with simple connection pool.
     *
     * @param name the database name
     * @param host the host
     * @param port the port (or 0 for default)
     * @param database the database name
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static PostgreSqlDatabase create(String name, String host, int port,
                                             String database, String username, String password) {
        String jdbcUrl = DatabaseType.POSTGRESQL.buildJdbcUrl(host, port, database);
        return create(name, jdbcUrl, username, password);
    }

    /**
     * Creates a PostgreSQL database with simple connection pool using JDBC URL.
     *
     * @param name the database name
     * @param jdbcUrl the JDBC URL
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static PostgreSqlDatabase create(String name, String jdbcUrl,
                                             String username, String password) {
        loadDriver();
        
        ConnectionPool pool = SimpleConnectionPool.builder()
                .jdbcUrl(jdbcUrl)
                .username(username)
                .password(password)
                .validationQuery("SELECT 1")
                .build();
        
        return new PostgreSqlDatabase(name, pool);
    }

    /**
     * Creates a PostgreSQL database with HikariCP connection pool.
     *
     * @param name the database name
     * @param host the host
     * @param port the port (or 0 for default)
     * @param database the database name
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static PostgreSqlDatabase createWithHikari(String name, String host, int port,
                                                       String database, String username, String password) {
        String jdbcUrl = DatabaseType.POSTGRESQL.buildJdbcUrl(host, port, database);
        return createWithHikari(name, jdbcUrl, username, password);
    }

    /**
     * Creates a PostgreSQL database with HikariCP connection pool.
     *
     * @param name the database name
     * @param jdbcUrl the JDBC URL
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static PostgreSqlDatabase createWithHikari(String name, String jdbcUrl,
                                                       String username, String password) {
        loadDriver();
        
        ConnectionPool pool = HikariConnectionPool.create(
                HikariConnectionPool.HikariConfig.create(jdbcUrl)
                        .username(username)
                        .password(password)
                        .driverClassName(DatabaseType.POSTGRESQL.getDriverClass())
                        .poolName(name + "-hikari")
                        .connectionTestQuery("SELECT 1")
        );
        
        return new PostgreSqlDatabase(name, pool);
    }

    /**
     * Creates a PostgreSQL database with a custom connection pool.
     *
     * @param name the database name
     * @param connectionPool the connection pool
     * @return the database instance
     */
    public static PostgreSqlDatabase create(String name, ConnectionPool connectionPool) {
        return new PostgreSqlDatabase(name, connectionPool);
    }

    private static void loadDriver() {
        try {
            Class.forName(DatabaseType.POSTGRESQL.getDriverClass());
        } catch (ClassNotFoundException e) {
            // Driver will be loaded automatically if available
        }
    }
}
