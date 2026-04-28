# Database Module

A comprehensive database abstraction layer supporting both SQL and NoSQL databases with connection pooling, unified configuration, and integration with ServicesRegistry.

## Overview

The database module provides:
- **SQL Database Support**: MySQL, PostgreSQL, ClickHouse, H2, SQLite
- **NoSQL Database Support**: MongoDB, Firebase, DynamoDB, Redis, Cassandra
- **Connection Pooling**: HikariCP and simple connection pool implementations
- **Unified Configuration**: `DatabaseConfig` with ServicesRegistry integration
- **Query Builders**: Fluent API for building SQL and NoSQL queries

## Architecture

```
database/
├── Database.java              # Base database interface
├── DatabaseConfig.java        # Configuration (implements ServiceConfig)
├── DatabaseFactory.java       # Factory for creating database instances
├── DatabaseType.java          # Enum of supported database types
├── DatabaseException.java     # Database-specific exception
├── DatabaseStats.java         # Statistics tracking
├── sql/                       # SQL database implementations
│   ├── SqlDatabase.java       # SQL database interface
│   ├── AbstractSqlDatabase.java
│   ├── MySqlDatabase.java
│   ├── PostgreSqlDatabase.java
│   ├── ClickHouseDatabase.java
│   ├── ConnectionPool.java    # Pool interface
│   ├── HikariConnectionPool.java
│   ├── SimpleConnectionPool.java
│   ├── SqlConnection.java     # Connection wrapper
│   ├── SqlResult.java         # Result set wrapper
│   └── QueryBuilder.java      # SQL query builder
└── nosql/                     # NoSQL database implementations
    ├── NoSqlDatabase.java     # NoSQL database interface
    ├── AbstractNoSqlDatabase.java
    ├── MongoDatabase.java
    ├── FirebaseDatabase.java
    ├── DynamoDatabase.java
    ├── RedisDatabase.java
    ├── CassandraDatabase.java
    ├── InMemoryNoSqlDatabase.java
    ├── NoSqlCollection.java   # Collection abstraction
    ├── NoSqlQueryBuilder.java
    ├── Document.java          # Document abstraction
    └── DocumentSerializer.java
```

## Quick Start

### SQL Database

```java
// Create configuration
DatabaseConfig config = DatabaseConfig.mysql("localhost", 3306, "mydb", "user", "password");

// Create database instance
SqlDatabase db = DatabaseFactory.createSql(config);

// Execute queries
db.execute("INSERT INTO users (name, email) VALUES (?, ?)", "John", "john@example.com");

// Query data
SqlResult result = db.query("SELECT * FROM users WHERE id = ?", 1);
while (result.next()) {
    String name = result.getString("name");
    String email = result.getString("email");
}

// Using QueryBuilder
String sql = QueryBuilder.select("id", "name", "email")
    .from("users")
    .where("active = ?", true)
    .orderBy("created_at DESC")
    .limit(10)
    .build();
```

### NoSQL Database

```java
// Create MongoDB configuration
DatabaseConfig config = DatabaseConfig.mongodb("localhost", 27017, "mydb");

// Create with client adapter
MongoDatabase db = (MongoDatabase) DatabaseFactory.createNoSql(config, mongoClientAdapter);

// Get collection
NoSqlCollection<User> users = db.collection("users", User.class);

// CRUD operations
users.insert(new User("John", "john@example.com"));
User user = users.findById("user123");
users.update("user123", new User("John Doe", "johndoe@example.com"));
users.delete("user123");

// Query with builder
List<User> activeUsers = users.find(
    NoSqlQueryBuilder.where("active", true)
        .and("age", ">=", 18)
        .orderBy("name")
        .limit(50)
);
```

## Configuration

### DatabaseConfig

```java
// Builder pattern
DatabaseConfig config = DatabaseConfig.builder()
    .type(DatabaseType.MYSQL)
    .name("primary-db")
    .host("localhost")
    .port(3306)
    .database("myapp")
    .credentials("user", "password")
    .pooling(PoolingConfig.hikari())
    .option("useSSL", true)
    .build();

// Convenience methods
DatabaseConfig mysql = DatabaseConfig.mysql("localhost", 3306, "db", "user", "pass");
DatabaseConfig postgres = DatabaseConfig.postgresql("localhost", 5432, "db", "user", "pass");
DatabaseConfig h2 = DatabaseConfig.h2InMemory("testdb");
DatabaseConfig sqlite = DatabaseConfig.sqlite("/path/to/db.sqlite");
DatabaseConfig mongo = DatabaseConfig.mongodb("localhost", 27017, "db");
DatabaseConfig redis = DatabaseConfig.redis("localhost", 6379);
```

### Connection Pooling

```java
// HikariCP (recommended for production)
PoolingConfig pooling = PoolingConfig.builder()
    .poolType(PoolType.HIKARI)
    .minSize(5)
    .maxSize(20)
    .connectionTimeout(30000)
    .idleTimeout(600000)
    .maxLifetime(1800000)
    .poolName("my-pool")
    .build();

// Simple pool (for development/testing)
PoolingConfig simple = PoolingConfig.simple();

// No pooling
PoolingConfig none = PoolingConfig.none();
```

## ServicesRegistry Integration

```java
// Register configuration
ServicesRegistry.register(DatabaseConfig.mysql("localhost", 3306, "mydb", "user", "pass"));

// Create from registry
SqlDatabase db = DatabaseFactory.createSqlFromRegistry("mysql-db");

// Get or create (returns existing if already created)
SqlDatabase db = DatabaseFactory.getOrCreateSql("mysql-db");

// Create all registered SQL databases
DatabaseFactory.createAllFromRegistry();
```

## DatabaseFactory

```java
// Create SQL database
SqlDatabase sql = DatabaseFactory.createSql(config);

// Create NoSQL database (requires client adapter)
NoSqlDatabase nosql = DatabaseFactory.createNoSql(config, clientAdapter);

// Create in-memory databases for testing
SqlDatabase testSql = DatabaseFactory.createInMemorySql("test");
NoSqlDatabase testNoSql = DatabaseFactory.createInMemoryNoSql("test");

// Registry operations
DatabaseFactory.registerDatabase("alias", database);
Database db = DatabaseFactory.getDatabase("alias");
SqlDatabase sql = DatabaseFactory.getSqlDatabase("alias");
NoSqlDatabase nosql = DatabaseFactory.getNoSqlDatabase("alias");

// Cleanup
DatabaseFactory.shutdown(); // Disconnects and removes all databases
```

## Database Types

| Type | SQL/NoSQL | Driver | Default Port |
|------|-----------|--------|--------------|
| MYSQL | SQL | com.mysql.cj.jdbc.Driver | 3306 |
| POSTGRESQL | SQL | org.postgresql.Driver | 5432 |
| CLICKHOUSE | SQL | com.clickhouse.jdbc.ClickHouseDriver | 8123 |
| H2 | SQL | org.h2.Driver | 9092 |
| SQLITE | SQL | org.sqlite.JDBC | - |
| MONGODB | NoSQL | - | 27017 |
| FIREBASE | NoSQL | - | 443 |
| DYNAMODB | NoSQL | - | 443 |
| REDIS | NoSQL | - | 6379 |
| CASSANDRA | NoSQL | - | 9042 |

## Client Adapters

NoSQL databases require client adapters that you implement to wrap your preferred client library:

```java
// MongoDB adapter
public class MyMongoAdapter implements MongoDatabase.MongoClientAdapter {
    private final MongoClient client;
    
    @Override
    public <T> List<T> find(String collection, Map<String, Object> query, Class<T> type) {
        // Implementation using your MongoDB driver
    }
    
    // ... other methods
}

// Redis adapter
public class MyRedisAdapter implements RedisDatabase.RedisClientAdapter {
    private final JedisPool pool;
    
    @Override
    public String get(String key) {
        try (Jedis jedis = pool.getResource()) {
            return jedis.get(key);
        }
    }
    
    // ... other methods
}
```

## Query Builders

### SQL QueryBuilder

```java
String query = QueryBuilder.select("u.id", "u.name", "p.title")
    .from("users u")
    .join("posts p ON p.user_id = u.id")
    .where("u.active = ?", true)
    .and("p.published = ?", true)
    .groupBy("u.id")
    .having("COUNT(p.id) > ?", 5)
    .orderBy("u.name ASC")
    .limit(10)
    .offset(20)
    .build();
```

### NoSQL QueryBuilder

```java
NoSqlQueryBuilder query = NoSqlQueryBuilder.where("status", "active")
    .and("age", ">=", 21)
    .or("vip", true)
    .orderBy("createdAt", false)  // descending
    .limit(100)
    .skip(50);

List<User> users = collection.find(query);
```

## Exception Handling

```java
try {
    db.execute("INSERT INTO users ...");
} catch (DatabaseException e) {
    String database = e.getDatabase();
    String operation = e.getOperation();
    System.err.println("Failed " + operation + " on " + database + ": " + e.getMessage());
}
```

## Testing

```java
// Use in-memory databases for tests
@BeforeEach
void setUp() {
    db = DatabaseFactory.createInMemorySql("test");
    nosqlDb = DatabaseFactory.createInMemoryNoSql("test");
}

@AfterEach
void tearDown() {
    DatabaseFactory.shutdown();
}
```

## Thread Safety

- All database implementations are thread-safe
- Connection pools manage concurrent access
- SqlResult should be used within a single thread
