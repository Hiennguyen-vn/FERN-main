package com.fern.simulator.persistence;

import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class SimulatorBatchWriterTest {

    @Test
    void batchesHighVolumeStatementsAndReusesPreparedStatements() throws Exception {
        Connection conn = mock(Connection.class);
        PreparedStatement ps = mock(PreparedStatement.class);
        when(conn.prepareStatement(anyString())).thenReturn(ps);

        try (SimulatorBatchWriter writer = new SimulatorBatchWriter(conn)) {
            writer.insertInventoryTransaction(1L, 2L, 3L, -4,
                    LocalDate.of(2024, 1, 1),
                    OffsetDateTime.of(2024, 1, 1, 9, 0, 0, 0, ZoneOffset.UTC),
                    "sale_usage", null);
            writer.insertInventoryTransaction(5L, 2L, 6L, 7,
                    LocalDate.of(2024, 1, 1),
                    OffsetDateTime.of(2024, 1, 1, 10, 0, 0, 0, ZoneOffset.UTC),
                    "purchase_in", 1_000L);
            writer.flush();
        }

        verify(conn, times(1)).prepareStatement(anyString());
        verify(ps, times(2)).addBatch();
        verify(ps, atLeastOnce()).executeBatch();
    }
}
