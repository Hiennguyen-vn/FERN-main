package com.fern.services.sales.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Statement;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class IdempotencyCacheCleanupJobTest {

  @Test
  void deleteExpiredBatchDeletesOldestExpiredRowsByConfiguredBatchSize() throws Exception {
    DataSource dataSource = mock(DataSource.class);
    Connection conn = mock(Connection.class);
    Statement statement = mock(Statement.class);
    PreparedStatement ps = mock(PreparedStatement.class);
    ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
    when(dataSource.getConnection()).thenReturn(conn);
    when(conn.createStatement()).thenReturn(statement);
    when(conn.prepareStatement(sqlCaptor.capture())).thenReturn(ps);
    when(ps.executeUpdate()).thenReturn(37);

    IdempotencyCacheCleanupJob job = new IdempotencyCacheCleanupJob(dataSource, 37, 3);

    assertEquals(37, job.deleteExpiredBatch());
    verify(ps).setInt(1, 37);
    verify(conn).commit();
    assertTrue(sqlCaptor.getValue().contains("WHERE expires_at < NOW()"));
    assertTrue(sqlCaptor.getValue().contains("ORDER BY expires_at"));
    assertTrue(sqlCaptor.getValue().contains("LIMIT ?"));
  }
}
