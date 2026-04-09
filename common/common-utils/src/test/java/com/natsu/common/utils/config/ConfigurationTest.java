package com.natsu.common.utils.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ConfigurationTest {

    @TempDir
    Path tempDir;

    @Test
    void testFromYamlString() {
        String yaml = """
                server:
                  host: localhost
                  port: 8080
                """;

        ConfigSection config = Configuration.fromYaml(yaml).load();

        assertNotNull(config);
        assertEquals("localhost", config.getString("server.host"));
        assertEquals(8080, config.getInt("server.port"));
    }

    @Test
    void testFromJsonString() {
        String json = """
                {
                  "server": {
                    "host": "127.0.0.1",
                    "port": 9000
                  }
                }
                """;

        ConfigSection config = Configuration.fromJson(json).load();

        assertNotNull(config);
        assertEquals("127.0.0.1", config.getString("server.host"));
        assertEquals(9000, config.getInt("server.port"));
    }

    @Test
    void testFromTomlString() {
        String toml = """
                [server]
                host = "0.0.0.0"
                port = 3000
                """;

        ConfigSection config = Configuration.fromToml(toml).load();

        assertNotNull(config);
        assertEquals("0.0.0.0", config.getString("server.host"));
        assertEquals(3000L, config.getLong("server.port"));
    }

    @Test
    void testFromYamlFile() throws Exception {
        Path configFile = tempDir.resolve("app.yml");
        Files.writeString(configFile, """
                app:
                  name: TestApp
                  version: 1.0.0
                """);

        ConfigSection config = Configuration.fromFile(configFile).load();

        assertNotNull(config);
        assertEquals("TestApp", config.getString("app.name"));
        assertEquals("1.0.0", config.getString("app.version"));
    }

    @Test
    void testFromJsonFile() throws Exception {
        Path configFile = tempDir.resolve("app.json");
        Files.writeString(configFile, """
                {
                  "app": {
                    "name": "JsonApp",
                    "debug": true
                  }
                }
                """);

        ConfigSection config = Configuration.fromFile(configFile).load();

        assertNotNull(config);
        assertEquals("JsonApp", config.getString("app.name"));
        assertTrue(config.getBoolean("app.debug"));
    }

    @Test
    void testFromTomlFile() throws Exception {
        Path configFile = tempDir.resolve("app.toml");
        Files.writeString(configFile, """
                [app]
                name = "TomlApp"
                enabled = false
                """);

        ConfigSection config = Configuration.fromFile(configFile).load();

        assertNotNull(config);
        assertEquals("TomlApp", config.getString("app.name"));
        assertFalse(config.getBoolean("app.enabled"));
    }

    @Test
    void testWithDefaults() {
        String yaml = """
                server:
                  host: custom-host
                """;

        Map<String, Object> defaults = new LinkedHashMap<>();
        Map<String, Object> serverDefaults = new LinkedHashMap<>();
        serverDefaults.put("host", "default-host");
        serverDefaults.put("port", 8080);
        serverDefaults.put("timeout", 30);
        defaults.put("server", serverDefaults);

        ConfigSection config = Configuration.fromYaml(yaml)
                .withDefaults(defaults)
                .load();

        // Overridden value
        assertEquals("custom-host", config.getString("server.host"));
        // Default values
        assertEquals(8080, config.getInt("server.port"));
        assertEquals(30, config.getInt("server.timeout"));
    }

    @Test
    void testEmpty() {
        ConfigSection config = Configuration.empty();

        assertNotNull(config);
        assertTrue(config.getKeys(false).isEmpty());
    }

    @Test
    void testOf() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("key", "value");

        ConfigSection config = Configuration.of(data);

        assertNotNull(config);
        assertEquals("value", config.getString("key"));
    }

    @Test
    void testMissingFileThrows() {
        Path missingFile = tempDir.resolve("missing.yml");

        assertThrows(ConfigurationException.class, () -> {
            Configuration.fromFile(missingFile).load();
        });
    }
}
