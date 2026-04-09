package com.natsu.common.utils.services.id;

import com.natsu.common.utils.services.ServicesRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class SnowflakeIdGeneratorTest {

    @BeforeEach
    void setUp() {
        ServicesRegistry.reset();
    }

    @AfterEach
    void tearDown() {
        ServicesRegistry.reset();
    }

    @Test
    void testGenerateIdWithConfiguredWorkerId() {
        ServicesRegistry.registerConfig(new MachineIdConfig(1L));

        SnowflakeIdGenerator generator = new SnowflakeIdGenerator();
        long id = generator.generateId();
        assertTrue(id > 0);
    }

    @Test
    void testMissingMachineIdConfigThrowsException() {
        assertThrows(IllegalStateException.class, SnowflakeIdGenerator::new);
    }

    @Test
    void testInvalidWorkerIdThrowsException() {
        ServicesRegistry.registerConfig(new MachineIdConfig(1024L)); // Max is 1023
        assertThrows(IllegalArgumentException.class, SnowflakeIdGenerator::new);

        ServicesRegistry.reset();
        ServicesRegistry.registerConfig(new MachineIdConfig(-1L));
        assertThrows(IllegalArgumentException.class, SnowflakeIdGenerator::new);
    }

    @Test
    void testUniqueIds() {
        SnowflakeIdGenerator generator = new SnowflakeIdGenerator(1L);
        Set<Long> ids = new HashSet<>();
        for (int i = 0; i < 10000; i++) {
            long id = generator.generateId();
            assertTrue(ids.add(id), "Duplicate ID generated");
        }
    }

    @Test
    void testEpochIsCorrect() {
        // Custom generator stubbing the clock
        SnowflakeIdGenerator generator = new SnowflakeIdGenerator(0L) {
            @Override
            protected long timeGen() {
                // Exactly custom epoch -> timestamp part should be 0
                return CUSTOM_EPOCH;
            }
        };
        long id = generator.generateId();
        // Since timestamp diff is 0, workerId is 0, and sequence starts at 0 ->
        // combined ID is 0
        assertEquals(0L, id);
    }
}
