package com.natsu.common.utils.config.parser;

import com.natsu.common.utils.config.ConfigFormat;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ConfigParsersTest {

    @TempDir
    Path tempDir;

    // ---- YAML Parser Tests ----

    @Test
    void testYamlParseString() {
        YamlConfigParser parser = new YamlConfigParser();

        String yaml = """
                database:
                  host: localhost
                  port: 5432
                features:
                  - feature1
                  - feature2
                """;

        Map<String, Object> data = parser.parseString(yaml);

        assertNotNull(data);
        assertTrue(data.containsKey("database"));

        @SuppressWarnings("unchecked")
        Map<String, Object> db = (Map<String, Object>) data.get("database");
        assertEquals("localhost", db.get("host"));
        assertEquals(5432, db.get("port"));
    }

    @Test
    void testYamlWriteToString() {
        YamlConfigParser parser = new YamlConfigParser();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("name", "test");
        data.put("count", 42);

        String yaml = parser.writeToString(data);

        assertNotNull(yaml);
        assertTrue(yaml.contains("name"));
        assertTrue(yaml.contains("test"));
    }

    @Test
    void testYamlFileRoundtrip() throws Exception {
        YamlConfigParser parser = new YamlConfigParser();
        Path file = tempDir.resolve("test.yml");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("host", "localhost");
        data.put("port", 8080);

        parser.write(file, data);
        assertTrue(Files.exists(file));

        Map<String, Object> loaded = parser.parse(file);
        assertEquals("localhost", loaded.get("host"));
        assertEquals(8080, loaded.get("port"));
    }

    // ---- JSON Parser Tests ----

    @Test
    void testJsonParseString() {
        JsonConfigParser parser = new JsonConfigParser();

        String json = """
                {
                  "database": {
                    "host": "localhost",
                    "port": 5432
                  },
                  "enabled": true
                }
                """;

        Map<String, Object> data = parser.parseString(json);

        assertNotNull(data);
        assertTrue(data.containsKey("database"));
        assertEquals(true, data.get("enabled"));

        @SuppressWarnings("unchecked")
        Map<String, Object> db = (Map<String, Object>) data.get("database");
        assertEquals("localhost", db.get("host"));
        assertEquals(5432, db.get("port"));
    }

    @Test
    void testJsonWriteToString() {
        JsonConfigParser parser = new JsonConfigParser();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("name", "test");
        data.put("active", true);

        String json = parser.writeToString(data);

        assertNotNull(json);
        assertTrue(json.contains("\"name\""));
        assertTrue(json.contains("\"test\""));
    }

    @Test
    void testJsonFileRoundtrip() throws Exception {
        JsonConfigParser parser = new JsonConfigParser();
        Path file = tempDir.resolve("test.json");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("host", "127.0.0.1");
        data.put("secure", false);

        parser.write(file, data);
        assertTrue(Files.exists(file));

        Map<String, Object> loaded = parser.parse(file);
        assertEquals("127.0.0.1", loaded.get("host"));
        assertEquals(false, loaded.get("secure"));
    }

    // ---- TOML Parser Tests ----

    @Test
    void testTomlParseString() {
        TomlConfigParser parser = new TomlConfigParser();

        String toml = """
                title = "Config"
                
                [database]
                host = "localhost"
                port = 5432
                enabled = true
                """;

        Map<String, Object> data = parser.parseString(toml);

        assertNotNull(data);
        assertEquals("Config", data.get("title"));
        assertTrue(data.containsKey("database"));

        @SuppressWarnings("unchecked")
        Map<String, Object> db = (Map<String, Object>) data.get("database");
        assertEquals("localhost", db.get("host"));
        assertEquals(5432L, db.get("port")); // TOML parses integers as Long
        assertEquals(true, db.get("enabled"));
    }

    @Test
    void testTomlWriteToString() {
        TomlConfigParser parser = new TomlConfigParser();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("name", "test");
        data.put("version", 1);

        String toml = parser.writeToString(data);

        assertNotNull(toml);
        assertTrue(toml.contains("name"));
        assertTrue(toml.contains("test"));
    }

    @Test
    void testTomlFileRoundtrip() throws Exception {
        TomlConfigParser parser = new TomlConfigParser();
        Path file = tempDir.resolve("test.toml");

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("app", "myapp");
        data.put("debug", true);

        parser.write(file, data);
        assertTrue(Files.exists(file));

        Map<String, Object> loaded = parser.parse(file);
        assertEquals("myapp", loaded.get("app"));
        assertEquals(true, loaded.get("debug"));
    }

    // ---- Parser Factory Tests ----

    @Test
    void testParserFactory() {
        assertNotNull(ConfigParserFactory.yaml());
        assertNotNull(ConfigParserFactory.json());
        assertNotNull(ConfigParserFactory.toml());

        assertEquals(ConfigFormat.YAML, ConfigParserFactory.yaml().getFormat());
        assertEquals(ConfigFormat.JSON, ConfigParserFactory.json().getFormat());
        assertEquals(ConfigFormat.TOML, ConfigParserFactory.toml().getFormat());
    }

    @Test
    void testParserFactoryByFile() {
        ConfigParser yamlParser = ConfigParserFactory.getParserForFile("config.yml");
        assertEquals(ConfigFormat.YAML, yamlParser.getFormat());

        ConfigParser jsonParser = ConfigParserFactory.getParserForFile("config.json");
        assertEquals(ConfigFormat.JSON, jsonParser.getFormat());

        ConfigParser tomlParser = ConfigParserFactory.getParserForFile("config.toml");
        assertEquals(ConfigFormat.TOML, tomlParser.getFormat());
    }

    // ---- Empty/Null handling ----

    @Test
    void testParseEmptyContent() {
        YamlConfigParser yamlParser = new YamlConfigParser();
        JsonConfigParser jsonParser = new JsonConfigParser();
        TomlConfigParser tomlParser = new TomlConfigParser();

        assertTrue(yamlParser.parseString("").isEmpty());
        assertTrue(jsonParser.parseString("{}").isEmpty());
        assertTrue(tomlParser.parseString("").isEmpty());
    }
}
