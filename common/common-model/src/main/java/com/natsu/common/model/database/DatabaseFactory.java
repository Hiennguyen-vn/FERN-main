package com.natsu.common.model.database;

import com.natsu.common.model.database.nosql.*;
import com.natsu.common.model.database.sql.*;
import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Factory for creating and managing database instances.
 *
 * <p>
 * Can be used as either an instance-based factory (for isolation / testing)
 * or via the static convenience methods that delegate to a default singleton.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * // Static API (delegates to default instance)
 * SqlDatabase db = DatabaseFactory.createSql(config);
 * Database found = DatabaseFactory.getDatabase("mydb");
 *
 * // Instance API (for test isolation or multi-tenancy)
 * DatabaseFactory factory = new DatabaseFactory();
 * SqlDatabase db = factory.createSqlDatabase(config);
 * }</pre>
 */
public class DatabaseFactory {

    private static final DatabaseFactory DEFAULT = new DatabaseFactory();

    private final Map<String, Database> databases = new ConcurrentHashMap<>();

    /**
     * Returns the default (global) DatabaseFactory instance.
     *
     * @return the default instance
     */
    public static DatabaseFactory getDefault() {
        return DEFAULT;
    }

    // ==================== Instance API ====================

    /**
     * Creates a SQL database from configuration.
     */
    public SqlDatabase createSqlDatabase(DatabaseConfig config) {
        SqlDatabase db = switch (config.getType()) {
            case MYSQL -> createMySql(config);
            case POSTGRESQL -> createPostgreSql(config);
            case CLICKHOUSE -> createClickHouse(config);
            case H2 -> createH2(config);
            case SQLITE -> createSqlite(config);
            default -> throw new IllegalArgumentException("Not a SQL database type: " + config.getType());
        };

        addDatabase(config.getName(), db);
        return db;
    }

    /**
     * Creates a NoSQL database from configuration.
     */
    public <T> NoSqlDatabase createNoSqlDatabase(DatabaseConfig config, T clientAdapter) {
        NoSqlDatabase db = switch (config.getType()) {
            case MONGODB -> MongoDatabase.create(
                    config.getName(),
                    (MongoDatabase.MongoClientAdapter) clientAdapter,
                    config.getDatabase());
            case FIREBASE -> FirebaseDatabase.create(
                    config.getName(),
                    (FirebaseDatabase.FirebaseClientAdapter) clientAdapter);
            case DYNAMODB -> DynamoDatabase.create(
                    config.getName(),
                    (DynamoDatabase.DynamoClientAdapter) clientAdapter);
            case REDIS -> RedisDatabase.create(
                    config.getName(),
                    (RedisDatabase.RedisClientAdapter) clientAdapter,
                    config.getDatabase() + ":");
            case CASSANDRA -> CassandraDatabase.create(
                    config.getName(),
                    (CassandraDatabase.CassandraClientAdapter) clientAdapter,
                    config.getDatabase());
            default -> throw new IllegalArgumentException("Not a NoSQL database type: " + config.getType());
        };

        addDatabase(config.getName(), db);
        return db;
    }

    /** Creates an in-memory NoSQL database for testing. */
    public InMemoryNoSqlDatabase createInMemoryNoSqlDatabase(String name) {
        InMemoryNoSqlDatabase db = InMemoryNoSqlDatabase.create(name);
        addDatabase(name, db);
        return db;
    }

    /** Creates an in-memory H2 database for testing. */
    public SqlDatabase createInMemorySqlDatabase(String name) {
        DatabaseConfig config = DatabaseConfig.h2InMemory(name);
        return createSqlDatabase(config);
    }

    /** Registers a database instance. */
    public void addDatabase(String name, Database database) {
        databases.put(name, database);
    }

    /** Gets a registered database by name. */
    public Database findDatabase(String name) {
        return databases.get(name);
    }

    /** Gets a registered SQL database by name. */
    public SqlDatabase findSqlDatabase(String name) {
        Database db = databases.get(name);
        if (db instanceof SqlDatabase) {
            return (SqlDatabase) db;
        }
        throw new IllegalArgumentException("Database '" + name + "' is not a SQL database");
    }

    /** Gets a registered NoSQL database by name. */
    public NoSqlDatabase findNoSqlDatabase(String name) {
        Database db = databases.get(name);
        if (db instanceof NoSqlDatabase) {
            return (NoSqlDatabase) db;
        }
        throw new IllegalArgumentException("Database '" + name + "' is not a NoSQL database");
    }

    /** Removes a database from the registry. */
    public Database removeDatabase(String name) {
        return databases.remove(name);
    }

    /** Disconnects and removes all registered databases. */
    public void shutdownAll() {
        for (Database db : databases.values()) {
            try {
                db.disconnect();
            } catch (Exception e) {
                // Ignore disconnection errors during shutdown
            }
        }
        databases.clear();
    }

    /** Gets all registered database names. */
    public Set<String> databaseNames() {
        return Set.copyOf(databases.keySet());
    }

    /** Gets or creates a SQL database from the registry. */
    public SqlDatabase getOrCreateSqlFromRegistry(String name) {
        Database existing = databases.get(name);
        if (existing instanceof SqlDatabase) {
            return (SqlDatabase) existing;
        }
        DatabaseConfig config = ServicesRegistry.getConfig(name, ServiceCategory.DATABASE);
        return createSqlDatabase(config);
    }

    /** Creates all SQL databases from the registry. */
    public void createAllFromRegistryInstance() {
        for (DatabaseConfig config : ServicesRegistry.<DatabaseConfig>getAllConfigs(ServiceCategory.DATABASE)) {
            if (config.getType().isSql()) {
                createSqlDatabase(config);
            }
        }
    }

    // ==================== Private SQL Creation Helpers ====================

    private SqlDatabase createMySql(DatabaseConfig config) {
        String jdbcUrl = config.toJdbcUrl();
        String username = config.getUsername();
        String password = config.getPassword();
        DatabaseConfig.PoolingConfig pooling = config.getPooling();

        if (pooling.getPoolType() == DatabaseConfig.PoolingConfig.PoolType.HIKARI) {
            return MySqlDatabase.createWithHikari(config.getName(), jdbcUrl, username, password);
        } else {
            return MySqlDatabase.create(config.getName(), jdbcUrl, username, password);
        }
    }

    private SqlDatabase createPostgreSql(DatabaseConfig config) {
        String jdbcUrl = config.toJdbcUrl();
        String username = config.getUsername();
        String password = config.getPassword();
        DatabaseConfig.PoolingConfig pooling = config.getPooling();

        if (pooling.getPoolType() == DatabaseConfig.PoolingConfig.PoolType.HIKARI) {
            return PostgreSqlDatabase.createWithHikari(config.getName(), jdbcUrl, username, password);
        } else {
            return PostgreSqlDatabase.create(config.getName(), jdbcUrl, username, password);
        }
    }

    private SqlDatabase createClickHouse(DatabaseConfig config) {
        String jdbcUrl = config.toJdbcUrl();
        String username = config.getUsername();
        String password = config.getPassword();
        DatabaseConfig.PoolingConfig pooling = config.getPooling();

        if (pooling.getPoolType() == DatabaseConfig.PoolingConfig.PoolType.HIKARI) {
            return ClickHouseDatabase.createWithHikari(config.getName(), jdbcUrl, username, password);
        } else {
            return ClickHouseDatabase.create(config.getName(), jdbcUrl, username, password);
        }
    }

    private SqlDatabase createH2(DatabaseConfig config) {
        String database = config.getDatabase();
        String jdbcUrl;

        if (database.startsWith("mem:")) {
            jdbcUrl = "jdbc:h2:" + database;
        } else if (database.startsWith("file:") || database.startsWith("tcp:")) {
            jdbcUrl = "jdbc:h2:" + database;
        } else {
            jdbcUrl = "jdbc:h2:file:" + database;
        }

        DatabaseConfig.PoolingConfig pooling = config.getPooling();
        ConnectionPool pool;

        if (pooling.getPoolType() == DatabaseConfig.PoolingConfig.PoolType.HIKARI) {
            HikariConnectionPool.HikariConfig hikariConfig = HikariConnectionPool.HikariConfig.create(jdbcUrl)
                    .username(config.getUsername())
                    .password(config.getPassword())
                    .maxPoolSize(pooling.getMaxSize())
                    .minPoolSize(pooling.getMinSize());
            pool = HikariConnectionPool.create(hikariConfig);
        } else {
            pool = SimpleConnectionPool.builder()
                    .jdbcUrl(jdbcUrl)
                    .username(config.getUsername())
                    .password(config.getPassword())
                    .minPoolSize(pooling.getMinSize())
                    .maxPoolSize(pooling.getMaxSize())
                    .build();
        }

        return new AbstractSqlDatabase(config.getName(), DatabaseType.H2, pool) {
        };
    }

    private SqlDatabase createSqlite(DatabaseConfig config) {
        String jdbcUrl = "jdbc:sqlite:" + config.getDatabase();

        ConnectionPool pool = SimpleConnectionPool.builder()
                .jdbcUrl(jdbcUrl)
                .minPoolSize(1)
                .maxPoolSize(1)
                .build();

        return new AbstractSqlDatabase(config.getName(), DatabaseType.SQLITE, pool) {
        };
    }

    // ==================== Static Delegates (backwards compatible)
    // ====================

    /** Creates a SQL database. Delegates to the default instance. */
    public static SqlDatabase createSql(DatabaseConfig config) {
        return DEFAULT.createSqlDatabase(config);
    }

    /** Creates a NoSQL database. Delegates to the default instance. */
    public static <T> NoSqlDatabase createNoSql(DatabaseConfig config, T clientAdapter) {
        return DEFAULT.createNoSqlDatabase(config, clientAdapter);
    }

    /** Creates an in-memory NoSQL database. Delegates to the default instance. */
    public static InMemoryNoSqlDatabase createInMemoryNoSql(String name) {
        return DEFAULT.createInMemoryNoSqlDatabase(name);
    }

    /** Creates an in-memory H2 database. Delegates to the default instance. */
    public static SqlDatabase createInMemorySql(String name) {
        return DEFAULT.createInMemorySqlDatabase(name);
    }

    /** Registers a database instance. Delegates to the default instance. */
    public static void registerDatabase(String name, Database database) {
        DEFAULT.addDatabase(name, database);
    }

    /** Gets a registered database by name. Delegates to the default instance. */
    public static Database getDatabase(String name) {
        return DEFAULT.findDatabase(name);
    }

    /**
     * Gets a registered SQL database by name. Delegates to the default instance.
     */
    public static SqlDatabase getSqlDatabase(String name) {
        return DEFAULT.findSqlDatabase(name);
    }

    /**
     * Gets a registered NoSQL database by name. Delegates to the default instance.
     */
    public static NoSqlDatabase getNoSqlDatabase(String name) {
        return DEFAULT.findNoSqlDatabase(name);
    }

    /** Removes a database from the registry. Delegates to the default instance. */
    public static Database unregisterDatabase(String name) {
        return DEFAULT.removeDatabase(name);
    }

    /**
     * Disconnects and removes all registered databases. Delegates to the default
     * instance.
     */
    public static void shutdown() {
        DEFAULT.shutdownAll();
    }

    /** Gets all registered database names. Delegates to the default instance. */
    public static Set<String> getDatabaseNames() {
        return DEFAULT.databaseNames();
    }

    // ServicesRegistry integration

    /** Creates a SQL database from registry. Delegates to the default instance. */
    public static SqlDatabase createSqlFromRegistry(String name) {
        DatabaseConfig config = ServicesRegistry.getConfig(name, ServiceCategory.DATABASE);
        return DEFAULT.createSqlDatabase(config);
    }

    /**
     * Creates a NoSQL database from registry. Delegates to the default instance.
     */
    public static <T> NoSqlDatabase createNoSqlFromRegistry(String name, T clientAdapter) {
        DatabaseConfig config = ServicesRegistry.getConfig(name, ServiceCategory.DATABASE);
        return DEFAULT.createNoSqlDatabase(config, clientAdapter);
    }

    /** Gets or creates a SQL database. Delegates to the default instance. */
    public static SqlDatabase getOrCreateSql(String name) {
        return DEFAULT.getOrCreateSqlFromRegistry(name);
    }

    /**
     * Creates all SQL databases from registry. Delegates to the default instance.
     */
    public static void createAllFromRegistry() {
        DEFAULT.createAllFromRegistryInstance();
    }
}
