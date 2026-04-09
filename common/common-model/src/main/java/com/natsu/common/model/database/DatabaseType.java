package com.natsu.common.model.database;

/**
 * Enumeration of supported database types.
 */
public enum DatabaseType {
    // SQL Databases
    MYSQL("mysql", true, "com.mysql.cj.jdbc.Driver", 3306),
    POSTGRESQL("postgresql", true, "org.postgresql.Driver", 5432),
    CLICKHOUSE("clickhouse", true, "com.clickhouse.jdbc.ClickHouseDriver", 8123),
    H2("h2", true, "org.h2.Driver", 9092),
    SQLITE("sqlite", true, "org.sqlite.JDBC", 0),
    
    // NoSQL Databases
    MONGODB("mongodb", false, null, 27017),
    FIREBASE("firebase", false, null, 443),
    DYNAMODB("dynamodb", false, null, 443),
    REDIS("redis", false, null, 6379),
    CASSANDRA("cassandra", false, null, 9042);

    private final String name;
    private final boolean sql;
    private final String driverClass;
    private final int defaultPort;

    DatabaseType(String name, boolean sql, String driverClass, int defaultPort) {
        this.name = name;
        this.sql = sql;
        this.driverClass = driverClass;
        this.defaultPort = defaultPort;
    }

    public String getName() {
        return name;
    }

    public boolean isSql() {
        return sql;
    }

    public boolean isNoSql() {
        return !sql;
    }

    public String getDriverClass() {
        return driverClass;
    }

    public int getDefaultPort() {
        return defaultPort;
    }

    /**
     * Builds a JDBC URL for SQL databases.
     *
     * @param host the host
     * @param port the port (or default if <= 0)
     * @param database the database name
     * @return the JDBC URL
     */
    public String buildJdbcUrl(String host, int port, String database) {
        if (!sql) {
            throw new IllegalStateException("Not a SQL database");
        }
        int actualPort = port > 0 ? port : defaultPort;
        
        return switch (this) {
            case MYSQL -> String.format("jdbc:mysql://%s:%d/%s", host, actualPort, database);
            case POSTGRESQL -> String.format("jdbc:postgresql://%s:%d/%s", host, actualPort, database);
            case CLICKHOUSE -> String.format("jdbc:clickhouse://%s:%d/%s", host, actualPort, database);
            case H2 -> String.format("jdbc:h2:tcp://%s:%d/%s", host, actualPort, database);
            case SQLITE -> String.format("jdbc:sqlite:%s", database);
            default -> throw new IllegalStateException("Unknown SQL database type");
        };
    }

    /**
     * Finds a database type by name.
     *
     * @param name the name
     * @return the database type
     */
    public static DatabaseType fromName(String name) {
        for (DatabaseType type : values()) {
            if (type.name.equalsIgnoreCase(name)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown database type: " + name);
    }
}
