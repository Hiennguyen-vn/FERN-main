package com.natsu.common.utils.log;

import com.natsu.common.utils.config.ConfigSection;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for LoggerFactory.
 */
class LoggerFactoryTest {

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        LoggerFactory.reset();
    }

    @AfterEach
    void tearDown() {
        LoggerFactory.shutdown();
    }

    @Test
    void testGetLoggerByClass() {
        Logger logger = LoggerFactory.getLogger(LoggerFactoryTest.class);
        
        assertNotNull(logger);
        assertEquals("com.natsu.common.utils.log.LoggerFactoryTest", logger.getName());
    }

    @Test
    void testGetLoggerByName() {
        Logger logger = LoggerFactory.getLogger("my.custom.logger");
        
        assertNotNull(logger);
        assertEquals("my.custom.logger", logger.getName());
    }

    @Test
    void testLoggerCaching() {
        Logger logger1 = LoggerFactory.getLogger("test.logger");
        Logger logger2 = LoggerFactory.getLogger("test.logger");
        
        assertSame(logger1, logger2);
    }

    @Test
    void testRootLogger() {
        Logger root = LoggerFactory.getRootLogger();
        
        assertNotNull(root);
        assertEquals("ROOT", root.getName());
    }

    @Test
    void testSetRootLevel() {
        LoggerFactory.setRootLevel(LogLevel.ERROR);
        
        assertEquals(LogLevel.ERROR, LoggerFactory.getRootLogger().getLevel());
    }

    @Test
    void testConfigureFromConfigSection() {
        // Build config map
        Map<String, Object> appenders = new LinkedHashMap<>();
        
        Map<String, Object> consoleConfig = new LinkedHashMap<>();
        consoleConfig.put("enabled", true);
        consoleConfig.put("colorEnabled", false);
        consoleConfig.put("level", "DEBUG");
        appenders.put("console", consoleConfig);
        
        Map<String, Object> loggingConfig = new LinkedHashMap<>();
        loggingConfig.put("level", "WARN");
        loggingConfig.put("appenders", appenders);
        
        Map<String, Object> loggers = new LinkedHashMap<>();
        loggers.put("com.myapp.debug", "DEBUG");
        loggingConfig.put("loggers", loggers);
        
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("logging", loggingConfig);

        ConfigSection config = new ConfigSection(root);
        LoggerFactory.configure(config);

        assertTrue(LoggerFactory.isConfigured());
        assertEquals(LogLevel.WARN, LoggerFactory.getRootLogger().getLevel());
        
        // Check that per-logger config was applied
        Logger customLogger = LoggerFactory.getLogger("com.myapp.debug");
        assertEquals(LogLevel.DEBUG, customLogger.getLevel());
    }

    @Test
    void testConfigureFileAppender() {
        Map<String, Object> appenders = new LinkedHashMap<>();
        
        Map<String, Object> fileConfig = new LinkedHashMap<>();
        fileConfig.put("enabled", true);
        fileConfig.put("directory", tempDir.toString());
        fileConfig.put("pattern", "test-{date}.log");
        fileConfig.put("level", "INFO");
        fileConfig.put("maxFileSize", "5MB");
        fileConfig.put("maxHistory", 3);
        fileConfig.put("compress", false);
        appenders.put("file", fileConfig);
        
        Map<String, Object> consoleConfig = new LinkedHashMap<>();
        consoleConfig.put("enabled", true);
        appenders.put("console", consoleConfig);
        
        Map<String, Object> loggingConfig = new LinkedHashMap<>();
        loggingConfig.put("level", "INFO");
        loggingConfig.put("appenders", appenders);

        ConfigSection config = new ConfigSection(loggingConfig);
        LoggerFactory.configure(config);

        assertTrue(LoggerFactory.isConfigured());
        // Should have 2 appenders: console and file
        assertEquals(2, LoggerFactory.getRootLogger().getAppenders().size());
    }

    @Test
    void testShutdown() {
        Logger logger = LoggerFactory.getLogger("test");
        LoggerFactory.shutdown();

        assertFalse(LoggerFactory.isConfigured());
    }

    @Test
    void testReset() {
        LoggerFactory.setRootLevel(LogLevel.ERROR);
        LoggerFactory.reset();

        // After reset, should be back to defaults
        assertNotNull(LoggerFactory.getRootLogger());
        assertEquals(LogLevel.INFO, LoggerFactory.getRootLogger().getLevel());
    }

    @Test
    void testLoggingOutput() {
        // Capture stdout
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PrintStream originalOut = System.out;
        System.setOut(new PrintStream(out));

        try {
            LoggerFactory.reset();
            Logger logger = LoggerFactory.getLogger("test");
            logger.info("Test message");
            LoggerFactory.getRootLogger().getAppenders().forEach(a -> {
                try { a.flush(); } catch (Exception e) {}
            });

            String output = out.toString();
            assertTrue(output.contains("Test message"), "Output should contain the message");
            assertTrue(output.contains("INFO"), "Output should contain log level");
        } finally {
            System.setOut(originalOut);
        }
    }
}
