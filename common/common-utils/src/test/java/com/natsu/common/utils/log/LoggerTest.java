package com.natsu.common.utils.log;

import com.natsu.common.utils.log.appender.AbstractLogAppender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the Logger class.
 */
class LoggerTest {

    private Logger logger;
    private TestAppender testAppender;

    @BeforeEach
    void setUp() {
        LoggerFactory.reset();
        logger = new Logger("TestLogger");
        logger.setLevel(LogLevel.DEBUG);
        testAppender = new TestAppender("test");
        logger.addAppender(testAppender);
    }

    @Test
    void testLoggerName() {
        assertEquals("TestLogger", logger.getName());
    }

    @Test
    void testLogLevel() {
        logger.setLevel(LogLevel.WARN);
        assertEquals(LogLevel.WARN, logger.getLevel());

        assertTrue(logger.isWarnEnabled());
        assertTrue(logger.isErrorEnabled());
        assertFalse(logger.isInfoEnabled());
        assertFalse(logger.isDebugEnabled());
        assertFalse(logger.isTraceEnabled());
    }

    @Test
    void testDebugLogging() {
        logger.setLevel(LogLevel.DEBUG);
        logger.debug("Debug message");

        assertEquals(1, testAppender.getEvents().size());
        LogEvent event = testAppender.getEvents().get(0);
        assertEquals(LogLevel.DEBUG, event.level());
        assertEquals("Debug message", event.message());
    }

    @Test
    void testInfoLogging() {
        logger.info("Info message");

        assertEquals(1, testAppender.getEvents().size());
        LogEvent event = testAppender.getEvents().get(0);
        assertEquals(LogLevel.INFO, event.level());
        assertEquals("Info message", event.message());
    }

    @Test
    void testWarnLogging() {
        logger.warn("Warning message");

        assertEquals(1, testAppender.getEvents().size());
        LogEvent event = testAppender.getEvents().get(0);
        assertEquals(LogLevel.WARN, event.level());
    }

    @Test
    void testErrorLogging() {
        Exception ex = new RuntimeException("Test error");
        logger.error("Error message", ex);

        assertEquals(1, testAppender.getEvents().size());
        LogEvent event = testAppender.getEvents().get(0);
        assertEquals(LogLevel.ERROR, event.level());
        assertNotNull(event.throwable());
        assertEquals("Test error", event.throwable().getMessage());
    }

    @Test
    void testPlaceholderFormatting() {
        logger.info("Hello, {}!", "World");

        assertEquals(1, testAppender.getEvents().size());
        LogEvent event = testAppender.getEvents().get(0);
        
        // Event should contain raw message and args
        assertEquals("Hello, {}!", event.message());
        assertArrayEquals(new Object[]{"World"}, event.args());
        
        // Formatted message should replace placeholder
        assertEquals("Hello, World!", event.getFormattedMessage());
    }

    @Test
    void testMultiplePlaceholders() {
        logger.info("User {} logged in from {}", "john", "192.168.1.1");

        LogEvent event = testAppender.getEvents().get(0);
        assertEquals("User john logged in from 192.168.1.1", event.getFormattedMessage());
    }

    @Test
    void testLevelFiltering() {
        logger.setLevel(LogLevel.WARN);
        
        logger.debug("Debug");
        logger.info("Info");
        logger.warn("Warn");
        logger.error("Error");

        // Only WARN and ERROR should be logged
        assertEquals(2, testAppender.getEvents().size());
        assertEquals(LogLevel.WARN, testAppender.getEvents().get(0).level());
        assertEquals(LogLevel.ERROR, testAppender.getEvents().get(1).level());
    }

    @Test
    void testAddAndRemoveAppender() {
        TestAppender appender2 = new TestAppender("test2");
        logger.addAppender(appender2);

        assertEquals(2, logger.getAppenders().size());

        logger.removeAppender(appender2);
        assertEquals(1, logger.getAppenders().size());
    }

    @Test
    void testThrowableExtraction() {
        RuntimeException ex = new RuntimeException("Test");
        logger.info("Message with exception: {}", "arg1", ex);

        LogEvent event = testAppender.getEvents().get(0);
        assertNotNull(event.throwable());
        assertEquals("Test", event.throwable().getMessage());
    }

    @Test
    void testTraceLogging() {
        logger.setLevel(LogLevel.TRACE);
        logger.trace("Trace message");

        assertEquals(1, testAppender.getEvents().size());
        assertEquals(LogLevel.TRACE, testAppender.getEvents().get(0).level());
    }

    /**
     * Test appender that captures log events for verification.
     */
    static class TestAppender extends AbstractLogAppender {
        private final List<LogEvent> events = new ArrayList<>();

        TestAppender(String name) {
            super(name, LogLevel.TRACE);
        }

        @Override
        protected void doAppend(LogEvent event) {
            events.add(event);
        }

        public List<LogEvent> getEvents() {
            return events;
        }

        public void clear() {
            events.clear();
        }
    }
}
