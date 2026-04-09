package com.natsu.common.utils.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ConfigSectionTest {

    @Test
    void testGetString() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("name", "test");
        data.put("count", 42);

        ConfigSection section = new ConfigSection(data);

        assertEquals("test", section.getString("name"));
        assertEquals("42", section.getString("count"));
        assertNull(section.getString("missing"));
        assertEquals("default", section.getString("missing", "default"));
    }

    @Test
    void testGetNumericTypes() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("intValue", 42);
        data.put("longValue", 9876543210L);
        data.put("doubleValue", 3.14);
        data.put("stringNumber", "100");

        ConfigSection section = new ConfigSection(data);

        assertEquals(42, section.getInt("intValue"));
        assertEquals(9876543210L, section.getLong("longValue"));
        assertEquals(3.14, section.getDouble("doubleValue"), 0.001);
        assertEquals(100, section.getInt("stringNumber"));

        assertEquals(99, section.getInt("missing", 99));
        assertEquals(999L, section.getLong("missing", 999L));
        assertEquals(9.9, section.getDouble("missing", 9.9), 0.001);
    }

    @Test
    void testGetBoolean() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", true);
        data.put("disabled", false);
        data.put("yesString", "yes");
        data.put("trueString", "true");
        data.put("oneString", "1");

        ConfigSection section = new ConfigSection(data);

        assertTrue(section.getBoolean("enabled"));
        assertFalse(section.getBoolean("disabled"));
        assertTrue(section.getBoolean("yesString"));
        assertTrue(section.getBoolean("trueString"));
        assertTrue(section.getBoolean("oneString"));
        assertFalse(section.getBoolean("missing", false));
    }

    @Test
    void testNestedAccess() {
        Map<String, Object> database = new LinkedHashMap<>();
        database.put("host", "localhost");
        database.put("port", 5432);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("database", database);

        ConfigSection section = new ConfigSection(data);

        assertEquals("localhost", section.getString("database.host"));
        assertEquals(5432, section.getInt("database.port"));
    }

    @Test
    void testGetSection() {
        Map<String, Object> connection = new LinkedHashMap<>();
        connection.put("timeout", 30);
        connection.put("retries", 3);

        Map<String, Object> database = new LinkedHashMap<>();
        database.put("host", "localhost");
        database.put("connection", connection);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("database", database);

        ConfigSection section = new ConfigSection(data);
        ConfigSection dbSection = section.getSection("database");

        assertNotNull(dbSection);
        assertEquals("localhost", dbSection.getString("host"));
        assertEquals(30, dbSection.getInt("connection.timeout"));
    }

    @Test
    void testGetStringList() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("hosts", Arrays.asList("host1", "host2", "host3"));
        data.put("single", "single-value");

        ConfigSection section = new ConfigSection(data);

        List<String> hosts = section.getStringList("hosts");
        assertEquals(3, hosts.size());
        assertEquals("host1", hosts.get(0));
        assertEquals("host2", hosts.get(1));
        assertEquals("host3", hosts.get(2));

        List<String> single = section.getStringList("single");
        assertEquals(1, single.size());
        assertEquals("single-value", single.get(0));

        assertTrue(section.getStringList("missing").isEmpty());
    }

    @Test
    void testGetDuration() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("timeout", "30s");
        data.put("delay", "5m");
        data.put("ttl", "1h");
        data.put("retention", "7d");
        data.put("quick", "500ms");

        ConfigSection section = new ConfigSection(data);

        assertEquals(Duration.ofSeconds(30), section.getDuration("timeout"));
        assertEquals(Duration.ofMinutes(5), section.getDuration("delay"));
        assertEquals(Duration.ofHours(1), section.getDuration("ttl"));
        assertEquals(Duration.ofDays(7), section.getDuration("retention"));
        assertEquals(Duration.ofMillis(500), section.getDuration("quick"));
    }

    @Test
    void testSetValue() {
        ConfigSection section = new ConfigSection(new LinkedHashMap<>());

        section.set("name", "test");
        section.set("database.host", "localhost");
        section.set("database.port", 5432);

        assertEquals("test", section.getString("name"));
        assertEquals("localhost", section.getString("database.host"));
        assertEquals(5432, section.getInt("database.port"));
    }

    @Test
    void testGetKeys() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("key1", "value1");
        nested.put("key2", "value2");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("simple", "value");
        data.put("nested", nested);

        ConfigSection section = new ConfigSection(data);

        assertEquals(2, section.getKeys(false).size());
        assertTrue(section.getKeys(false).contains("simple"));
        assertTrue(section.getKeys(false).contains("nested"));

        assertTrue(section.getKeys(true).contains("nested.key1"));
        assertTrue(section.getKeys(true).contains("nested.key2"));
    }

    @Test
    void testContains() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exists", "value");

        ConfigSection section = new ConfigSection(data);

        assertTrue(section.contains("exists"));
        assertFalse(section.contains("missing"));
    }

    @Test
    void testGetRequired() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("required", "value");

        ConfigSection section = new ConfigSection(data);

        assertEquals("value", section.getRequired("required", String.class));

        assertThrows(ConfigurationException.class, () -> {
            section.getRequired("missing", String.class);
        });
    }

    @Test
    void testEmptySection() {
        ConfigSection section = ConfigSection.empty();

        assertNull(section.getString("any"));
        assertEquals("default", section.getString("any", "default"));
        assertTrue(section.getKeys(false).isEmpty());
    }
}
