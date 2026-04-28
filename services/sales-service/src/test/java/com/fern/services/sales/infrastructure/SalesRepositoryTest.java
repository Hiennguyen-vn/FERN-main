package com.fern.services.sales.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Clock;
import java.util.Optional;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

class SalesRepositoryTest {

  @Test
  void convertRecipeQuantityToStockUomUsesConfiguredConversionFactor() {
    BigDecimal converted = SalesRepository.convertRecipeQuantityToStockUom(
        new BigDecimal("92.0000"),
        "g",
        "kg",
        new BigDecimal("0.00100000"),
        "COFFEE-BEAN"
    );

    assertEquals(0, converted.compareTo(new BigDecimal("0.092")));
  }

  @Test
  void convertRecipeQuantityToStockUomRejectsMissingConversionForMismatchedUnits() {
    ServiceException exception = assertThrows(
        ServiceException.class,
        () -> SalesRepository.convertRecipeQuantityToStockUom(
            new BigDecimal("18.0000"),
            "g",
            "kg",
            null,
            "COFFEE-BEAN"
        )
    );

    assertEquals(400, exception.getStatusCode());
  }

  @Test
  void scopedOpenSessionLookupBindsOutletAndDevice() throws Exception {
    SalesRepository repository = new SalesRepository(
        mock(DataSource.class),
        mock(SnowflakeIdGenerator.class),
        Clock.systemUTC());
    Connection conn = mock(Connection.class);
    PreparedStatement ps = mock(PreparedStatement.class);
    ResultSet rs = mock(ResultSet.class);
    when(conn.prepareStatement(anyString())).thenReturn(ps);
    when(ps.executeQuery()).thenReturn(rs);
    when(rs.next()).thenReturn(true);
    when(rs.getLong(1)).thenReturn(777L);

    Optional<Long> result = repository.findOpenPosSessionIdForOutletAndDeviceTx(conn, 10L, 501L);

    assertEquals(Optional.of(777L), result);
    verify(ps).setLong(1, 10L);
    verify(ps).setLong(2, 501L);
  }

  @Test
  void scopedOpenSessionLookupReturnsEmptyWhenTerminalHasNoOpenSession() throws Exception {
    SalesRepository repository = new SalesRepository(
        mock(DataSource.class),
        mock(SnowflakeIdGenerator.class),
        Clock.systemUTC());
    Connection conn = mock(Connection.class);
    PreparedStatement ps = mock(PreparedStatement.class);
    ResultSet rs = mock(ResultSet.class);
    when(conn.prepareStatement(anyString())).thenReturn(ps);
    when(ps.executeQuery()).thenReturn(rs);
    when(rs.next()).thenReturn(false);

    Optional<Long> result = repository.findOpenPosSessionIdForOutletAndDeviceTx(conn, 10L, 999L);

    assertTrue(result.isEmpty());
    verify(ps).setLong(1, 10L);
    verify(ps).setLong(2, 999L);
  }

  @Test
  void outletWideOpenSessionLookupBindsOnlyOutletForNoDevicePublicPath() throws Exception {
    SalesRepository repository = new SalesRepository(
        mock(DataSource.class),
        mock(SnowflakeIdGenerator.class),
        Clock.systemUTC());
    Connection conn = mock(Connection.class);
    PreparedStatement ps = mock(PreparedStatement.class);
    ResultSet rs = mock(ResultSet.class);
    when(conn.prepareStatement(anyString())).thenReturn(ps);
    when(ps.executeQuery()).thenReturn(rs);
    when(rs.next()).thenReturn(true);
    when(rs.getLong(1)).thenReturn(778L);

    Optional<Long> result = repository.findOpenPosSessionIdForOutlet(conn, 10L);

    assertEquals(Optional.of(778L), result);
    verify(ps).setLong(1, 10L);
  }
}
