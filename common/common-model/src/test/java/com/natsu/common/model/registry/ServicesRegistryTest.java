package com.natsu.common.model.registry;

import com.natsu.common.model.cache.CacheConfig;
import com.natsu.common.model.database.DatabaseConfig;
import com.natsu.common.model.database.DatabaseType;
import com.natsu.common.model.message.MessageQueueConfig;
import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServicesRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for ServicesRegistry.
 */
class ServicesRegistryTest {

    @BeforeEach
    void setUp() {
        ServicesRegistry.reset();
    }

    @AfterEach
    void tearDown() {
        ServicesRegistry.reset();
    }

    // ==================== Service Locator Tests ====================

    @Test
    void testRegisterAndRetrieveService() {
        String service = "My Service Instance";
        ServicesRegistry.register(String.class, service);

        String retrieved = ServicesRegistry.getService(String.class);
        assertSame(service, retrieved);
    }

    @Test
    void testRegisterServiceWithUnregisterHook() {
        AtomicBoolean hookRun = new AtomicBoolean(false);
        String service = "Service with hook";

        ServicesRegistry.register(String.class, service, () -> hookRun.set(true));

        assertTrue(ServicesRegistry.unregister(String.class));
        assertTrue(hookRun.get());
    }

    @Test
    void testUnregisterServiceInstance() {
        String service = "Instance to remove";
        ServicesRegistry.register(service);

        assertTrue(ServicesRegistry.unregister(service));
        assertThrows(NoSuchElementException.class, () -> ServicesRegistry.getService(String.class));
    }

    // ==================== Configuration Registry Tests ====================

    @Test
    void testRegisterDatabaseConfig() {
        DatabaseConfig config = DatabaseConfig.builder()
                .type(DatabaseType.MYSQL)
                .name("testdb")
                .host("localhost")
                .port(3306)
                .database("test")
                .build();

        ServicesRegistry.registerConfig(config);

        assertTrue(ServicesRegistry.containsConfig("testdb", ServiceCategory.DATABASE));
        assertEquals(1, ServicesRegistry.configSize());
    }

    @Test
    void testRegisterCacheConfig() {
        CacheConfig config = CacheConfig.builder("testcache")
                .maxSize(1000)
                .defaultTtl(Duration.ofMinutes(5))
                .build();

        ServicesRegistry.registerConfig(config);

        assertTrue(ServicesRegistry.containsConfig("testcache", ServiceCategory.CACHE));
        assertEquals(1, ServicesRegistry.configSize());
    }

    @Test
    void testRegisterMessageQueueConfig() {
        MessageQueueConfig config = MessageQueueConfig.local()
                .name("testqueue")
                .build();

        ServicesRegistry.registerConfig(config);

        assertTrue(ServicesRegistry.containsConfig("testqueue", ServiceCategory.MESSAGE_QUEUE));
        assertEquals(1, ServicesRegistry.configSize());
    }

    @Test
    void testRegisterMultipleConfigs() {
        DatabaseConfig db = DatabaseConfig.mysql("localhost", 3306, "test", "user", "pass");
        CacheConfig cache = CacheConfig.defaultConfig("cache1");
        MessageQueueConfig mq = MessageQueueConfig.local().name("queue1").build();

        ServicesRegistry.registerAll(db, cache, mq);

        assertEquals(3, ServicesRegistry.configSize());
        assertEquals(1, ServicesRegistry.countConfigs(ServiceCategory.DATABASE));
        assertEquals(1, ServicesRegistry.countConfigs(ServiceCategory.CACHE));
        assertEquals(1, ServicesRegistry.countConfigs(ServiceCategory.MESSAGE_QUEUE));
    }

    @Test
    void testRegisterDuplicateThrowsException() {
        CacheConfig config1 = CacheConfig.defaultConfig("test");
        CacheConfig config2 = CacheConfig.builder("test").maxSize(2000).build();

        ServicesRegistry.registerConfig(config1);

        assertThrows(IllegalStateException.class, () -> ServicesRegistry.registerConfig(config2));
    }

    @Test
    void testRegisterWithOverwrite() {
        CacheConfig config1 = CacheConfig.builder("test").maxSize(1000).build();
        CacheConfig config2 = CacheConfig.builder("test").maxSize(2000).build();

        ServicesRegistry.registerConfig(config1);
        ServicesRegistry.registerConfig(config2, true);

        CacheConfig retrieved = ServicesRegistry.getConfig("test", ServiceCategory.CACHE);
        assertEquals(2000, retrieved.getMaxSize());
    }

    @Test
    void testRegisterIfAbsent() {
        CacheConfig config1 = CacheConfig.builder("test").maxSize(1000).build();
        CacheConfig config2 = CacheConfig.builder("test").maxSize(2000).build();

        assertTrue(ServicesRegistry.registerConfigIfAbsent(config1));
        assertFalse(ServicesRegistry.registerConfigIfAbsent(config2));

        CacheConfig retrieved = ServicesRegistry.getConfig("test", ServiceCategory.CACHE);
        assertEquals(1000, retrieved.getMaxSize());
    }

    // ==================== Retrieval Tests ====================

    @Test
    void testGetExistingConfig() {
        DatabaseConfig original = DatabaseConfig.postgresql("localhost", 5432, "mydb", "user", "pass");
        ServicesRegistry.registerConfig(original);

        DatabaseConfig retrieved = ServicesRegistry.getConfig("postgresql-db", ServiceCategory.DATABASE);

        assertEquals("postgresql-db", retrieved.getName());
        assertEquals(DatabaseType.POSTGRESQL, retrieved.getType());
    }

    @Test
    void testGetNonExistentThrowsException() {
        assertThrows(NoSuchElementException.class,
                () -> ServicesRegistry.getConfig("nonexistent", ServiceCategory.DATABASE));
    }

    @Test
    void testGetOrNullReturnsNull() {
        CacheConfig result = ServicesRegistry.getConfigOrNull("nonexistent", ServiceCategory.CACHE);
        assertNull(result);
    }

    @Test
    void testGetOrDefaultReturnsDefault() {
        CacheConfig defaultConfig = CacheConfig.defaultConfig("default");

        CacheConfig result = ServicesRegistry.getConfigOrDefault("nonexistent", ServiceCategory.CACHE, defaultConfig);

        assertEquals("default", result.getName());
    }

    @Test
    void testGetAllConfigs() {
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache1"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache2"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache3"));
        ServicesRegistry.registerConfig(DatabaseConfig.h2InMemory("db1"));

        List<CacheConfig> caches = ServicesRegistry.getAllConfigs(ServiceCategory.CACHE);

        assertEquals(3, caches.size());
    }

    @Test
    void testGetConfigNames() {
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("alpha"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("beta"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("gamma"));

        var names = ServicesRegistry.getConfigNames(ServiceCategory.CACHE);

        assertEquals(3, names.size());
        assertTrue(names.contains("alpha"));
        assertTrue(names.contains("beta"));
        assertTrue(names.contains("gamma"));
    }

    // ==================== Removal Tests ====================

    @Test
    void testUnregisterByName() {
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("test"));
        assertTrue(ServicesRegistry.containsConfig("test", ServiceCategory.CACHE));

        boolean removed = ServicesRegistry.unregisterConfig("test", ServiceCategory.CACHE);

        assertTrue(removed);
        assertFalse(ServicesRegistry.containsConfig("test", ServiceCategory.CACHE));
    }

    @Test
    void testUnregisterByConfig() {
        CacheConfig config = CacheConfig.defaultConfig("test");
        ServicesRegistry.registerConfig(config);

        boolean removed = ServicesRegistry.unregisterConfig(config);

        assertTrue(removed);
        assertFalse(ServicesRegistry.containsConfig("test", ServiceCategory.CACHE));
    }

    @Test
    void testClearConfigCategory() {
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache1"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache2"));
        ServicesRegistry.registerConfig(DatabaseConfig.h2InMemory("db1"));

        int removed = ServicesRegistry.clearConfigCategory(ServiceCategory.CACHE);

        assertEquals(2, removed);
        assertEquals(1, ServicesRegistry.configSize());
        assertTrue(ServicesRegistry.containsConfig("h2-db", ServiceCategory.DATABASE));
    }

    @Test
    void testClearAll() {
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache1"));
        ServicesRegistry.registerConfig(DatabaseConfig.h2InMemory("db1"));
        ServicesRegistry.registerConfig(MessageQueueConfig.local().name("mq1").build());

        ServicesRegistry.clear();

        assertTrue(ServicesRegistry.isEmpty());
    }

    // ==================== Listener Tests ====================

    @Test
    void testListenerNotification() {
        AtomicInteger callCount = new AtomicInteger(0);

        ServicesRegistry.onConfigRegister(ServiceCategory.CACHE, config -> callCount.incrementAndGet());

        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache1"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache2"));
        ServicesRegistry.registerConfig(DatabaseConfig.h2InMemory("db1")); // Should not trigger

        assertEquals(2, callCount.get());
    }

    // ==================== ServiceDefinition Interface Tests ====================

    @Test
    void testDatabaseConfigImplementsServiceDefinition() {
        DatabaseConfig config = DatabaseConfig.mysql("localhost", 3306, "test", "user", "pass");

        assertEquals(ServiceCategory.DATABASE, config.getServiceCategory());
        assertNotNull(config.getName());
        assertDoesNotThrow(config::validate);
        assertNotNull(config.toMap());
        assertNotNull(config.getDescription());
    }

    @Test
    void testCacheConfigImplementsServiceDefinition() {
        CacheConfig config = CacheConfig.defaultConfig("test");

        assertEquals(ServiceCategory.CACHE, config.getServiceCategory());
        assertEquals("test", config.getName());
        assertDoesNotThrow(config::validate);
        assertTrue(config.toMap().containsKey("maxSize"));
    }

    @Test
    void testMessageQueueConfigImplementsServiceDefinition() {
        MessageQueueConfig config = MessageQueueConfig.local()
                .name("testqueue")
                .build();

        assertEquals(ServiceCategory.MESSAGE_QUEUE, config.getServiceCategory());
        assertEquals("testqueue", config.getName());
        assertDoesNotThrow(config::validate);
        assertTrue(config.toMap().containsKey("messageQueueType"));
    }

    // ==================== Namespace Isolation Tests ====================

    @Test
    void testSameNameDifferentTypesAreIsolated() {
        DatabaseConfig db = DatabaseConfig.builder()
                .type(DatabaseType.H2)
                .name("test")
                .database("mem:test")
                .build();
        CacheConfig cache = CacheConfig.defaultConfig("test");
        MessageQueueConfig mq = MessageQueueConfig.local().name("test").build();

        ServicesRegistry.registerConfig(db);
        ServicesRegistry.registerConfig(cache);
        ServicesRegistry.registerConfig(mq);

        assertEquals(3, ServicesRegistry.configSize());

        DatabaseConfig retrievedDb = ServicesRegistry.getConfig("test", ServiceCategory.DATABASE);
        CacheConfig retrievedCache = ServicesRegistry.getConfig("test", ServiceCategory.CACHE);
        MessageQueueConfig retrievedMq = ServicesRegistry.getConfig("test", ServiceCategory.MESSAGE_QUEUE);

        assertEquals(DatabaseType.H2, retrievedDb.getType());
        assertEquals(CacheConfig.EvictionPolicy.LRU, retrievedCache.getEvictionPolicy());
        assertEquals(MessageQueueConfig.MessageQueueType.LOCAL, retrievedMq.getType());
    }

    // ==================== Summary Test ====================

    @Test
    void testSummary() {
        ServicesRegistry.registerConfig(DatabaseConfig.h2InMemory("db1"));
        ServicesRegistry.registerConfig(CacheConfig.defaultConfig("cache1"));
        ServicesRegistry.register(new RegisteredService());

        String summary = ServicesRegistry.summary();

        assertNotNull(summary);
        assertTrue(summary.contains("DATABASE"));
        assertTrue(summary.contains("CACHE"));
        assertTrue(summary.contains("RegisteredService"));
    }

    // Helper class
    static class RegisteredService {
    }
}
