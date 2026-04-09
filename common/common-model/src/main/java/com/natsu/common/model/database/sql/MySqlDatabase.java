package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseType;

/**
 * MySQL database implementation.
 */
public class MySqlDatabase extends AbstractSqlDatabase {

    private MySqlDatabase(String name, ConnectionPool connectionPool) {
        super(name, DatabaseType.MYSQL, connectionPool);
    }

    /**
     * Creates a MySQL database with simple connection pool.
     *
     * @param name the database name
     * @param host the host
     * @param port the port (or 0 for default)
     * @param database the database name
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static MySqlDatabase create(String name, String host, int port, 
                                        String database, String username, String password) {
        String jdbcUrl = DatabaseType.MYSQL.buildJdbcUrl(host, port, database);
        return create(name, jdbcUrl, username, password);
    }

    /**
     * Creates a MySQL database with simple connection pool using JDBC URL.
     *
     * @param name the database name
     * @param jdbcUrl the JDBC URL
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static MySqlDatabase create(String name, String jdbcUrl, 
                                        String username, String password) {
        loadDriver();
        
        ConnectionPool pool = SimpleConnectionPool.builder()
                .jdbcUrl(jdbcUrl)
                .username(username)
                .password(password)
                .validationQuery("SELECT 1")
                .build();
        
        return new MySqlDatabase(name, pool);
    }

    /**
     * Creates a MySQL database with HikariCP connection pool.
     *
     * @param name the database name
     * @param host the host
     * @param port the port (or 0 for default)
     * @param database the database name
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static MySqlDatabase createWithHikari(String name, String host, int port,
                                                  String database, String username, String password) {
        String jdbcUrl = DatabaseType.MYSQL.buildJdbcUrl(host, port, database);
        return createWithHikari(name, jdbcUrl, username, password);
    }

    /**
     * Creates a MySQL database with HikariCP connection pool.
     *
     * @param name the database name
     * @param jdbcUrl the JDBC URL
     * @param username the username
     * @param password the password
     * @return the database instance
     */
    public static MySqlDatabase createWithHikari(String name, String jdbcUrl,
                                                  String username, String password) {
        loadDriver();
        
        ConnectionPool pool = HikariConnectionPool.create(
                HikariConnectionPool.HikariConfig.create(jdbcUrl)
                        .username(username)
                        .password(password)
                        .driverClassName(DatabaseType.MYSQL.getDriverClass())
                        .poolName(name + "-hikari")
                        .connectionTestQuery("SELECT 1")
        );
        
        return new MySqlDatabase(name, pool);
    }

    /**
     * Creates a MySQL database with a custom connection pool.
     *
     * @param name the database name
     * @param connectionPool the connection pool
     * @return the database instance
     */
    public static MySqlDatabase create(String name, ConnectionPool connectionPool) {
        return new MySqlDatabase(name, connectionPool);
    }

    private static void loadDriver() {
        try {
            Class.forName(DatabaseType.MYSQL.getDriverClass());
        } catch (ClassNotFoundException e) {
            // Driver will be loaded automatically if available
        }
    }
}
