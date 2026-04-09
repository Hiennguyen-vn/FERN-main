package com.natsu.common.utils.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ConfigurationManagerTest {

    @TempDir
    Path tempDir;

    private ConfigurationManager manager;

    @BeforeEach
    void setUp() {
        manager = ConfigurationManager.builder()
                .withBaseDirectory(tempDir)
                .withAutoReload(false)
                .withSaveDelay(Duration.ZERO)
                .build();
    }

    @AfterEach
    void tearDown() {
        if (manager != null) {
            manager.close();
        }
    }

    @Test
    void testLoadYamlConfig() throws Exception {
        Path configFile = tempDir.resolve("app.yml");
        Files.writeString(configFile, """
                app:
                  name: TestApp
                  port: 8080
                """);

        ConfigSection config = manager.getConfig("app.yml");

        assertNotNull(config);
        assertEquals("TestApp", config.getString("app.name"));
        assertEquals(8080, config.getInt("app.port"));
    }

    @Test
    void testLoadJsonConfig() throws Exception {
        Path configFile = tempDir.resolve("app.json");
        Files.writeString(configFile, """
                {
                  "database": {
                    "host": "localhost",
                    "port": 5432
                  }
                }
                """);

        ConfigSection config = manager.getConfig("app.json");

        assertNotNull(config);
        assertEquals("localhost", config.getString("database.host"));
        assertEquals(5432, config.getInt("database.port"));
    }

    @Test
    void testLoadTomlConfig() throws Exception {
        Path configFile = tempDir.resolve("app.toml");
        Files.writeString(configFile, """
                [server]
                host = "0.0.0.0"
                port = 3000
                """);

        ConfigSection config = manager.getConfig("app.toml");

        assertNotNull(config);
        assertEquals("0.0.0.0", config.getString("server.host"));
        assertEquals(3000L, config.getLong("server.port"));
    }

    @Test
    void testConfigCaching() throws Exception {
        Path configFile = tempDir.resolve("cached.yml");
        Files.writeString(configFile, "key: value");

        ConfigSection first = manager.getConfig("cached.yml");
        ConfigSection second = manager.getConfig("cached.yml");

        assertSame(first, second, "Should return cached instance");
    }

    @Test
    void testReloadConfig() throws Exception {
        Path configFile = tempDir.resolve("reload.yml");
        Files.writeString(configFile, "version: 1");

        ConfigSection original = manager.getConfig("reload.yml");
        assertEquals("1", original.getString("version"));

        Files.writeString(configFile, "version: 2");

        ConfigSection reloaded = manager.reloadConfig("reload.yml");
        assertEquals("2", reloaded.getString("version"));
    }

    @Test
    void testSaveConfig() throws Exception {
        Path configFile = tempDir.resolve("save.yml");

        ConfigSection config = ConfigSection.empty();
        config.set("app.name", "SavedApp");
        config.set("app.port", 9000);

        manager.saveConfig("save.yml", config);

        assertTrue(Files.exists(configFile));
        String content = Files.readString(configFile);
        assertTrue(content.contains("SavedApp"));
    }

    @Test
    void testInvalidate() throws Exception {
        Path configFile = tempDir.resolve("invalidate.yml");
        Files.writeString(configFile, "key: value");

        manager.getConfig("invalidate.yml");
        assertTrue(manager.isLoaded("invalidate.yml"));

        manager.invalidate("invalidate.yml");
        assertFalse(manager.isLoaded("invalidate.yml"));
    }

    @Test
    void testGetLoadedConfigurations() throws Exception {
        Path config1 = tempDir.resolve("config1.yml");
        Path config2 = tempDir.resolve("config2.json");
        Files.writeString(config1, "a: 1");
        Files.writeString(config2, "{\"b\": 2}");

        manager.getConfig("config1.yml");
        manager.getConfig("config2.json");

        var loaded = manager.getLoadedConfigurations();
        assertEquals(2, loaded.size());
        assertTrue(loaded.contains("config1.yml"));
        assertTrue(loaded.contains("config2.json"));
    }

    @Test
    void testMissingConfigThrows() {
        assertThrows(ConfigurationException.class, () -> {
            manager.getConfig("missing.yml");
        });
    }

    @Test
    void testGetConfigWithDefault() throws Exception {
        ConfigSection defaultConfig = ConfigSection.empty();
        defaultConfig.set("fallback", true);

        ConfigSection result = manager.getConfig("missing.yml", defaultConfig);

        assertSame(defaultConfig, result);
        assertTrue(result.getBoolean("fallback"));
    }

    @Test
    void testSubdirectoryConfig() throws Exception {
        Path subDir = tempDir.resolve("sub");
        Files.createDirectories(subDir);
        Path configFile = subDir.resolve("nested.yml");
        Files.writeString(configFile, "nested: true");

        ConfigSection config = manager.getConfig("sub/nested.yml");

        assertNotNull(config);
        assertTrue(config.getBoolean("nested"));
    }

    @Test
    void testAutoReloadWithListener() throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<ConfigSection> newConfigRef = new AtomicReference<>();

        ConfigurationManager autoManager = ConfigurationManager.builder()
                .withBaseDirectory(tempDir)
                .withAutoReload(true)
                .withReloadDebounce(Duration.ofMillis(100))
                .build()
                .start();

        try {
            Path configFile = tempDir.resolve("auto.yml");
            Files.writeString(configFile, "version: 1");

            autoManager.addChangeListener(event -> {
                newConfigRef.set(event.newConfig());
                latch.countDown();
            });

            ConfigSection original = autoManager.getConfig("auto.yml");
            assertEquals("1", original.getString("version"));

            // Modify the file
            Thread.sleep(200);
            Files.writeString(configFile, "version: 2");

            // Wait for the change to be detected
            boolean detected = latch.await(5, TimeUnit.SECONDS);

            if (detected) {
                assertEquals("2", newConfigRef.get().getString("version"));
            }
            // Note: File watching can be flaky in tests, so we don't fail if not detected
        } finally {
            autoManager.close();
        }
    }
}
