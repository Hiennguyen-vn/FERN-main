package com.natsu.common.model.database;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServiceDefinition;

import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

/**
 * Configuration for database connections.
 * 
 * <p>
 * Implements {@link ServiceDefinition} for use with {@link ServicesRegistry}.
 */
public class DatabaseConfig implements ServiceDefinition {

    private final DatabaseType type;
    private final String name;
    private final String host;
    private final int port;
    private final String database;
    private final String username;
    private final String password;
    private final PoolingConfig pooling;
    private final Map<String, Object> options;

    private DatabaseConfig(Builder builder) {
        this.type = builder.type;
        this.name = builder.name;
        this.host = builder.host;
        this.port = builder.port;
        this.database = builder.database;
        this.username = builder.username;
        this.password = builder.password;
        this.pooling = builder.pooling;
        this.options = Map.copyOf(builder.options);
    }

    public static Builder builder() {
        return new Builder();
    }

    public DatabaseType getType() {
        return type;
    }

    public String getName() {
        return name;
    }

    @Override
    public ServiceCategory getServiceCategory() {
        return ServiceCategory.DATABASE;
    }

    @Override
    public void validate() {
        ServiceDefinition.super.validate();
        if (type == null) {
            throw new IllegalStateException("Database type cannot be null");
        }
    }

    @Override
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>(ServiceDefinition.super.toMap());
        map.put("databaseType", type.name());
        map.put("host", host);
        map.put("port", port);
        map.put("database", database);
        return map;
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public String getDatabase() {
        return database;
    }

    public String getUsername() {
        return username;
    }

    public String getPassword() {
        return password;
    }

    public PoolingConfig getPooling() {
        return pooling;
    }

    public Map<String, Object> getOptions() {
        return options;
    }

    @SuppressWarnings("unchecked")
    public <T> T getOption(String key, T defaultValue) {
        return (T) options.getOrDefault(key, defaultValue);
    }

    /**
     * Converts to JDBC URL for SQL databases.
     * For MySQL, if the option {@code "jdbcParams"} is set, its value is appended
     * as a query string (e.g. {@code ?allowPublicKeyRetrieval=true&useSSL=false}).
     */
    public String toJdbcUrl() {
        return switch (type) {
            case MYSQL -> {
                String base = String.format("jdbc:mysql://%s:%d/%s", host, port, database);
                String params = getOption("jdbcParams", (String) null);
                yield (params != null && !params.isBlank()) ? base + "?" + params : base;
            }
            case POSTGRESQL -> String.format("jdbc:postgresql://%s:%d/%s", host, port, database);
            case CLICKHOUSE -> String.format("jdbc:clickhouse://%s:%d/%s", host, port, database);
            case H2 -> String.format("jdbc:h2:%s", database);
            case SQLITE -> String.format("jdbc:sqlite:%s", database);
            default -> throw new IllegalArgumentException("Not a SQL database type: " + type);
        };
    }

    /**
     * Converts to MongoDB connection string.
     */
    public String toMongoConnectionString() {
        if (username != null && !username.isEmpty()) {
            return String.format("mongodb://%s:%s@%s:%d/%s", username, password, host, port, database);
        }
        return String.format("mongodb://%s:%d/%s", host, port, database);
    }

    /**
     * Converts to Properties for JDBC.
     */
    public Properties toProperties() {
        Properties props = new Properties();
        if (username != null) {
            props.setProperty("user", username);
        }
        if (password != null) {
            props.setProperty("password", password);
        }
        for (Map.Entry<String, Object> entry : options.entrySet()) {
            props.setProperty(entry.getKey(), String.valueOf(entry.getValue()));
        }
        return props;
    }

    /**
     * Connection pooling configuration.
     */
    public static class PoolingConfig {
        private final PoolType poolType;
        private final int minSize;
        private final int maxSize;
        private final long connectionTimeout;
        private final long idleTimeout;
        private final long maxLifetime;
        private final String poolName;

        private PoolingConfig(Builder builder) {
            this.poolType = builder.poolType;
            this.minSize = builder.minSize;
            this.maxSize = builder.maxSize;
            this.connectionTimeout = builder.connectionTimeout;
            this.idleTimeout = builder.idleTimeout;
            this.maxLifetime = builder.maxLifetime;
            this.poolName = builder.poolName;
        }

        public static Builder builder() {
            return new Builder();
        }

        public static PoolingConfig defaults() {
            return builder().build();
        }

        public static PoolingConfig hikari() {
            return builder().poolType(PoolType.HIKARI).build();
        }

        public static PoolingConfig simple() {
            return builder().poolType(PoolType.SIMPLE).build();
        }

        public static PoolingConfig none() {
            return builder().poolType(PoolType.NONE).build();
        }

        public PoolType getPoolType() {
            return poolType;
        }

        public int getMinSize() {
            return minSize;
        }

        public int getMaxSize() {
            return maxSize;
        }

        public long getConnectionTimeout() {
            return connectionTimeout;
        }

        public long getIdleTimeout() {
            return idleTimeout;
        }

        public long getMaxLifetime() {
            return maxLifetime;
        }

        public String getPoolName() {
            return poolName;
        }

        public enum PoolType {
            NONE,
            SIMPLE,
            HIKARI
        }

        public static class Builder {
            private PoolType poolType = PoolType.SIMPLE;
            private int minSize = 1;
            private int maxSize = 10;
            private long connectionTimeout = 30000; // 30 seconds
            private long idleTimeout = 600000; // 10 minutes
            private long maxLifetime = 1800000; // 30 minutes
            private String poolName = "db-pool";

            public Builder poolType(PoolType poolType) {
                this.poolType = poolType;
                return this;
            }

            public Builder minSize(int minSize) {
                this.minSize = minSize;
                return this;
            }

            public Builder maxSize(int maxSize) {
                this.maxSize = maxSize;
                return this;
            }

            public Builder connectionTimeout(long connectionTimeout) {
                this.connectionTimeout = connectionTimeout;
                return this;
            }

            public Builder idleTimeout(long idleTimeout) {
                this.idleTimeout = idleTimeout;
                return this;
            }

            public Builder maxLifetime(long maxLifetime) {
                this.maxLifetime = maxLifetime;
                return this;
            }

            public Builder poolName(String poolName) {
                this.poolName = poolName;
                return this;
            }

            public PoolingConfig build() {
                return new PoolingConfig(this);
            }
        }
    }

    public static class Builder {
        private DatabaseType type;
        private String name;
        private String host = "localhost";
        private int port;
        private String database;
        private String username;
        private String password;
        private PoolingConfig pooling = PoolingConfig.defaults();
        private Map<String, Object> options = Map.of();

        public Builder type(DatabaseType type) {
            this.type = type;
            if (port == 0) {
                this.port = getDefaultPort(type);
            }
            return this;
        }

        public Builder name(String name) {
            this.name = name;
            return this;
        }

        public Builder host(String host) {
            this.host = host;
            return this;
        }

        public Builder port(int port) {
            this.port = port;
            return this;
        }

        public Builder database(String database) {
            this.database = database;
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

        public Builder credentials(String username, String password) {
            this.username = username;
            this.password = password;
            return this;
        }

        public Builder pooling(PoolingConfig pooling) {
            this.pooling = pooling;
            return this;
        }

        public Builder options(Map<String, Object> options) {
            this.options = options;
            return this;
        }

        public Builder option(String key, Object value) {
            this.options = new java.util.HashMap<>(this.options);
            this.options.put(key, value);
            return this;
        }

        public DatabaseConfig build() {
            if (type == null) {
                throw new IllegalArgumentException("Database type is required");
            }
            if (name == null) {
                name = type.name().toLowerCase() + "-db";
            }

            // Validate network-oriented database types
            boolean requiresNetwork = type != DatabaseType.H2 && type != DatabaseType.SQLITE;
            if (requiresNetwork) {
                if (host == null || host.isBlank()) {
                    throw new IllegalArgumentException("Host is required for " + type.name() + " databases");
                }
                if (port <= 0) {
                    port = getDefaultPort(type);
                }
            }

            // Validate database name for types that require one
            boolean requiresDatabase = type != DatabaseType.FIREBASE && type != DatabaseType.DYNAMODB
                    && type != DatabaseType.REDIS;
            if (requiresDatabase && (database == null || database.isBlank())) {
                throw new IllegalArgumentException("Database name is required for " + type.name());
            }

            return new DatabaseConfig(this);
        }

        private int getDefaultPort(DatabaseType type) {
            return switch (type) {
                case MYSQL -> 3306;
                case POSTGRESQL -> 5432;
                case CLICKHOUSE -> 8123;
                case MONGODB -> 27017;
                case REDIS -> 6379;
                case CASSANDRA -> 9042;
                default -> 0;
            };
        }
    }

    // Convenience factory methods
    public static DatabaseConfig mysql(String host, int port, String database, String username, String password) {
        return builder()
                .type(DatabaseType.MYSQL)
                .host(host)
                .port(port)
                .database(database)
                .credentials(username, password)
                .build();
    }

    public static DatabaseConfig postgresql(String host, int port, String database, String username, String password) {
        return builder()
                .type(DatabaseType.POSTGRESQL)
                .host(host)
                .port(port)
                .database(database)
                .credentials(username, password)
                .build();
    }

    public static DatabaseConfig clickhouse(String host, int port, String database, String username, String password) {
        return builder()
                .type(DatabaseType.CLICKHOUSE)
                .host(host)
                .port(port)
                .database(database)
                .credentials(username, password)
                .build();
    }

    public static DatabaseConfig h2(String database) {
        return builder()
                .type(DatabaseType.H2)
                .database(database)
                .build();
    }

    public static DatabaseConfig h2InMemory(String name) {
        return builder()
                .type(DatabaseType.H2)
                .database("mem:" + name)
                .build();
    }

    public static DatabaseConfig sqlite(String path) {
        return builder()
                .type(DatabaseType.SQLITE)
                .database(path)
                .build();
    }

    public static DatabaseConfig mongodb(String host, int port, String database) {
        return builder()
                .type(DatabaseType.MONGODB)
                .host(host)
                .port(port)
                .database(database)
                .build();
    }

    public static DatabaseConfig redis(String host, int port) {
        return builder()
                .type(DatabaseType.REDIS)
                .host(host)
                .port(port)
                .build();
    }
}
