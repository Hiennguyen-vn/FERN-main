package com.natsu.common.model.database;

import com.natsu.common.model.database.nosql.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the database abstraction layer.
 */
class DatabaseTest {

    private InMemoryNoSqlDatabase nosqlDb;

    @BeforeEach
    void setUp() {
        nosqlDb = InMemoryNoSqlDatabase.create("test-db");
        nosqlDb.connect();
    }

    @AfterEach
    void tearDown() {
        if (nosqlDb != null) {
            nosqlDb.disconnect();
        }
        DatabaseFactory.shutdown();
    }

    // ==================== NoSQL Tests ====================

    @Test
    void testNoSqlInsertAndFindById() {
        NoSqlCollection users = nosqlDb.collection("users");

        Map<String, Object> user = new HashMap<>();
        user.put("name", "John Doe");
        user.put("email", "john@example.com");
        user.put("age", 30);

        String id = users.insert(user);
        assertNotNull(id);

        Optional<Document> found = users.findById(id);
        assertTrue(found.isPresent());
        assertEquals("John Doe", found.get().getString("name"));
        assertEquals("john@example.com", found.get().getString("email"));
        assertEquals(30, found.get().getInteger("age"));
    }

    @Test
    void testNoSqlInsertMany() {
        NoSqlCollection users = nosqlDb.collection("users");

        List<Map<String, Object>> userList = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            Map<String, Object> user = new HashMap<>();
            user.put("name", "User " + i);
            user.put("index", i);
            userList.add(user);
        }

        List<String> ids = users.insertMany(userList);
        assertEquals(5, ids.size());
        assertEquals(5, users.count(Map.of()));
    }

    @Test
    void testNoSqlFind() {
        NoSqlCollection users = nosqlDb.collection("users");

        users.insert(Map.of("name", "Alice", "role", "admin"));
        users.insert(Map.of("name", "Bob", "role", "user"));
        users.insert(Map.of("name", "Charlie", "role", "admin"));

        List<Document> admins = users.find(Map.of("role", "admin"));
        assertEquals(2, admins.size());

        List<Document> all = users.findAll();
        assertEquals(3, all.size());
    }

    @Test
    void testNoSqlUpdate() {
        NoSqlCollection users = nosqlDb.collection("users");

        String id = users.insert(Map.of("name", "John", "status", "active"));

        boolean updated = users.updateById(id, Map.of("status", "inactive"));
        assertTrue(updated);

        Optional<Document> doc = users.findById(id);
        assertTrue(doc.isPresent());
        assertEquals("inactive", doc.get().getString("status"));
    }

    @Test
    void testNoSqlDelete() {
        NoSqlCollection users = nosqlDb.collection("users");

        String id = users.insert(Map.of("name", "ToDelete"));
        assertTrue(users.findById(id).isPresent());

        boolean deleted = users.deleteById(id);
        assertTrue(deleted);
        assertFalse(users.findById(id).isPresent());
    }

    @Test
    void testNoSqlQueryBuilder() {
        NoSqlCollection products = nosqlDb.collection("products");

        products.insert(Map.of("name", "Apple", "price", 1.50, "category", "fruit"));
        products.insert(Map.of("name", "Banana", "price", 0.75, "category", "fruit"));
        products.insert(Map.of("name", "Carrot", "price", 0.50, "category", "vegetable"));
        products.insert(Map.of("name", "Orange", "price", 2.00, "category", "fruit"));

        // Test equals query
        List<Document> fruits = products.query()
                .eq("category", "fruit")
                .execute();
        assertEquals(3, fruits.size());
    }

    @Test
    void testNoSqlCollectionManagement() {
        assertFalse(nosqlDb.collectionExists("newCollection"));

        nosqlDb.createCollection("newCollection");
        assertTrue(nosqlDb.collectionExists("newCollection"));

        assertTrue(nosqlDb.listCollections().contains("newCollection"));

        nosqlDb.dropCollection("newCollection");
        assertFalse(nosqlDb.collectionExists("newCollection"));
    }

    @Test
    void testNoSqlUpsert() {
        NoSqlCollection users = nosqlDb.collection("users");

        // Insert via upsert
        String id1 = users.upsert(Map.of("email", "test@example.com"), 
                Map.of("email", "test@example.com", "name", "Test User"));
        assertNotNull(id1);

        // Update via upsert
        Map<String, Object> query = new HashMap<>();
        query.put("id", id1);
        String id2 = users.upsert(query, 
                Map.of("id", id1, "email", "test@example.com", "name", "Updated User"));
        
        // Should return same id (update, not insert)
        Optional<Document> doc = users.findById(id1);
        assertTrue(doc.isPresent());
        assertEquals("Updated User", doc.get().getString("name"));
    }

    // ==================== Document Tests ====================

    @Test
    void testDocumentTypedGetters() {
        Map<String, Object> data = new HashMap<>();
        data.put("string", "hello");
        data.put("integer", 42);
        data.put("long", 123456789L);
        data.put("double", 3.14);
        data.put("boolean", true);
        data.put("list", List.of("a", "b", "c"));
        data.put("nested", Map.of("key", "value"));

        Document doc = Document.of(data);

        assertEquals("hello", doc.getString("string"));
        assertEquals(42, doc.getInteger("integer"));
        assertEquals(123456789L, doc.getLong("long"));
        assertEquals(3.14, doc.getDouble("double"));
        assertEquals(true, doc.getBoolean("boolean"));
        assertEquals(List.of("a", "b", "c"), doc.getList("list"));
        
        Document nested = doc.getDocument("nested");
        assertNotNull(nested);
        assertEquals("value", nested.getString("key"));
    }

    @Test
    void testDocumentCreation() {
        Document doc = Document.of(Map.of(
                "name", "Test",
                "value", 100
        ));
        doc.setId("doc-123");

        assertEquals("doc-123", doc.getId());
        assertEquals("Test", doc.getString("name"));
        assertEquals(100, doc.getInteger("value"));
    }

    // ==================== QueryBuilder Tests ====================

    @Test
    void testQueryBuilderBuildsCorrectly() {
        NoSqlCollection collection = nosqlDb.collection("test");
        
        NoSqlQueryBuilder builder = collection.query()
                .eq("status", "active")
                .gt("age", 18)
                .limit(10)
                .skip(0);

        // Just verify it doesn't throw
        assertNotNull(builder);
    }

    // ==================== Document Serializer Tests ====================

    @Test
    void testReflectionSerializer() {
        DocumentSerializer serializer = DocumentSerializer.reflection();

        TestPojo pojo = new TestPojo();
        pojo.name = "Test";
        pojo.value = 42;
        pojo.active = true;

        Document doc = serializer.serialize(pojo);
        assertEquals("Test", doc.getString("name"));
        assertEquals(42, doc.getInteger("value"));
        assertEquals(true, doc.getBoolean("active"));

        TestPojo restored = serializer.deserialize(doc, TestPojo.class);
        assertEquals("Test", restored.name);
        assertEquals(42, restored.value);
        assertEquals(true, restored.active);
    }

    // Test helper class
    public static class TestPojo {
        public String name;
        public int value;
        public boolean active;
    }

    // ==================== Database Config Tests ====================

    @Test
    void testDatabaseConfigBuilder() {
        DatabaseConfig config = DatabaseConfig.builder()
                .type(DatabaseType.MYSQL)
                .name("main-db")
                .host("localhost")
                .port(3306)
                .database("mydb")
                .credentials("user", "pass")
                .pooling(DatabaseConfig.PoolingConfig.hikari())
                .build();

        assertEquals(DatabaseType.MYSQL, config.getType());
        assertEquals("main-db", config.getName());
        assertEquals("localhost", config.getHost());
        assertEquals(3306, config.getPort());
        assertEquals("mydb", config.getDatabase());
        assertEquals("user", config.getUsername());
        assertEquals("pass", config.getPassword());
        assertEquals(DatabaseConfig.PoolingConfig.PoolType.HIKARI, 
                config.getPooling().getPoolType());
    }

    @Test
    void testDatabaseConfigJdbcUrl() {
        DatabaseConfig mysqlConfig = DatabaseConfig.mysql("localhost", 3306, "testdb", "user", "pass");
        assertEquals("jdbc:mysql://localhost:3306/testdb", mysqlConfig.toJdbcUrl());

        DatabaseConfig pgConfig = DatabaseConfig.postgresql("localhost", 5432, "testdb", "user", "pass");
        assertEquals("jdbc:postgresql://localhost:5432/testdb", pgConfig.toJdbcUrl());
    }

    // ==================== Database Stats Tests ====================

    @Test
    void testDatabaseStats() {
        DatabaseStats stats = new DatabaseStats("test-db");
        
        stats.recordQuery(1_000_000, true); // 1ms
        stats.recordQuery(2_000_000, true); // 2ms
        stats.recordQuery(3_000_000, false); // 3ms failed

        assertEquals(3, stats.getTotalQueries());
        assertEquals(2, stats.getSuccessfulQueries());
        assertEquals(1, stats.getFailedQueries());
        assertEquals(2.0, stats.getAverageLatencyMillis(), 0.01);
    }

    // ==================== Factory Tests ====================

    @Test
    void testDatabaseFactoryInMemory() {
        InMemoryNoSqlDatabase db = DatabaseFactory.createInMemoryNoSql("test-inmem");
        assertNotNull(db);
        
        db.connect();
        assertTrue(db.isConnected());

        // Verify it's registered
        assertEquals(db, DatabaseFactory.getNoSqlDatabase("test-inmem"));
    }
}
