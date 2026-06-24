package com.fern.services.sales.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CashMovementServiceTest {

  @Mock
  private DataSource dataSource;

  @Mock
  private SnowflakeIdGenerator idGenerator;

  @Mock
  private Clock clock;

  @Mock
  private Connection connection;

  @Mock
  private Connection insertConnection;

  @Mock
  private PreparedStatement statement;

  @Mock
  private PreparedStatement insertStatement;

  @Mock
  private ResultSet resultSet;

  @InjectMocks
  private CashMovementService cashMovementService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void recordRejectsUnknownTypeBeforeOpeningConnection() {
    // Given
    CashMovementService.CashMovementRequest request =
        new CashMovementService.CashMovementRequest("REFUND", BigDecimal.TEN, "wrong type", null, null);

    // When / Then
    assertThatThrownBy(() -> cashMovementService.record(9001L, request))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(400);
    verifyNoInteractions(dataSource);
  }

  @Test
  void recordRejectsNegativeAmountBeforeOpeningConnection() {
    // Given
    CashMovementService.CashMovementRequest request =
        new CashMovementService.CashMovementRequest("PAID_OUT", new BigDecimal("-1.00"), "cash error", null, null);

    // When / Then
    assertThatThrownBy(() -> cashMovementService.record(9001L, request))
        .isInstanceOf(ServiceException.class)
        .hasMessageContaining("Amount");
    verifyNoInteractions(dataSource);
  }

  @Test
  void recordCreatesMovementWithUserAndNullableReferences() throws Exception {
    // Given
    RequestUserContextHolder.set(new RequestUserContext(
        77L, "cashier", "session-77", Set.of("cashier"), Set.of("sales:write"), Set.of(5L),
        true, false, null, null, null));
    Instant now = Instant.parse("2026-04-03T10:15:30Z");
    when(clock.instant()).thenReturn(now);
    when(idGenerator.generateId()).thenReturn(88001L);
    mockSessionLookup(9001L, 5L, "OPEN");
    when(dataSource.getConnection()).thenReturn(connection, insertConnection);
    when(insertConnection.prepareStatement(org.mockito.ArgumentMatchers.contains("INSERT INTO core.cash_movement")))
        .thenReturn(insertStatement);

    CashMovementService.CashMovementRequest request =
        new CashMovementService.CashMovementRequest(
            "PAID_IN", new BigDecimal("150000.00"), "cash top-up", null, 99L);

    // When
    CashMovementService.CashMovementView result = cashMovementService.record(9001L, request);

    // Then
    assertThat(result.id()).isEqualTo(88001L);
    assertThat(result.outletId()).isEqualTo(5L);
    assertThat(result.createdByUserId()).isEqualTo(77L);
    assertThat(result.referenceSaleId()).isNull();
    assertThat(result.createdAt()).isEqualTo(now);
    verify(insertStatement).setNull(7, java.sql.Types.BIGINT);
    verify(insertStatement).setLong(8, 77L);
    verify(insertStatement).setLong(9, 99L);
    verify(insertStatement).executeUpdate();
  }

  @Test
  void recordThrowsNotFoundWhenSessionDoesNotExist() throws Exception {
    // Given
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(org.mockito.ArgumentMatchers.contains("core.pos_session")))
        .thenReturn(statement);
    when(statement.executeQuery()).thenReturn(resultSet);
    when(resultSet.next()).thenReturn(false);

    CashMovementService.CashMovementRequest request =
        new CashMovementService.CashMovementRequest("DROP", BigDecimal.ZERO, "safe drop", null, null);

    // When / Then
    assertThatThrownBy(() -> cashMovementService.record(9001L, request))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(404);
  }

  @Test
  void listMapsNullableSaleAndUserFields() throws Exception {
    // Given
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(org.mockito.ArgumentMatchers.contains("FROM core.cash_movement")))
        .thenReturn(statement);
    when(statement.executeQuery()).thenReturn(resultSet);
    when(resultSet.next()).thenReturn(true, false);
    when(resultSet.getLong("reference_sale_id")).thenReturn(501L);
    when(resultSet.getLong("created_by_user_id")).thenReturn(0L);
    when(resultSet.getLong("approved_by_user_id")).thenReturn(99L);
    when(resultSet.wasNull()).thenReturn(false, true, false);
    when(resultSet.getLong("id")).thenReturn(3001L);
    when(resultSet.getLong("session_id")).thenReturn(9001L);
    when(resultSet.getLong("outlet_id")).thenReturn(5L);
    when(resultSet.getString("type")).thenReturn("SALE_CASH");
    when(resultSet.getBigDecimal("amount")).thenReturn(new BigDecimal("35000.00"));
    when(resultSet.getString("reason")).thenReturn("Order #501");
    when(resultSet.getTimestamp("created_at"))
        .thenReturn(Timestamp.from(Instant.parse("2026-04-03T11:00:00Z")));

    // When
    List<CashMovementService.CashMovementView> result = cashMovementService.list(9001L);

    // Then
    assertThat(result).hasSize(1);
    assertThat(result.getFirst().referenceSaleId()).isEqualTo(501L);
    assertThat(result.getFirst().createdByUserId()).isNull();
    assertThat(result.getFirst().approvedByUserId()).isEqualTo(99L);
  }

  @Test
  void summaryReturnsBusinessDateAndTotals() throws Exception {
    // Given
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(org.mockito.ArgumentMatchers.contains("core.cash_session_summary")))
        .thenReturn(statement);
    when(statement.executeQuery()).thenReturn(resultSet);
    when(resultSet.next()).thenReturn(true);
    when(resultSet.getLong("session_id")).thenReturn(9001L);
    when(resultSet.getLong("outlet_id")).thenReturn(5L);
    when(resultSet.getDate("business_date")).thenReturn(Date.valueOf("2026-04-03"));
    when(resultSet.getBigDecimal("open_float")).thenReturn(new BigDecimal("500000.00"));
    when(resultSet.getBigDecimal("sales_cash")).thenReturn(new BigDecimal("350000.00"));
    when(resultSet.getBigDecimal("paid_in")).thenReturn(new BigDecimal("100000.00"));
    when(resultSet.getBigDecimal("paid_out")).thenReturn(new BigDecimal("50000.00"));
    when(resultSet.getBigDecimal("drops")).thenReturn(new BigDecimal("200000.00"));
    when(resultSet.getBigDecimal("counted")).thenReturn(new BigDecimal("700000.00"));
    when(resultSet.getBigDecimal("expected_total")).thenReturn(new BigDecimal("700000.00"));
    when(resultSet.getBigDecimal("variance")).thenReturn(BigDecimal.ZERO);

    // When
    Map<String, Object> result = cashMovementService.summary(9001L);

    // Then
    assertThat(result)
        .containsEntry("sessionId", 9001L)
        .containsEntry("outletId", 5L)
        .containsEntry("businessDate", "2026-04-03")
        .containsEntry("variance", BigDecimal.ZERO);
  }

  @Test
  void summaryWrapsSqlExceptions() throws Exception {
    // Given
    when(dataSource.getConnection()).thenThrow(new SQLException("database offline"));

    // When / Then
    assertThatThrownBy(() -> cashMovementService.summary(9001L))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("cash summary")
        .hasRootCauseMessage("database offline");
  }

  private void mockSessionLookup(long sessionId, long outletId, String status) throws Exception {
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(org.mockito.ArgumentMatchers.contains("core.pos_session")))
        .thenReturn(statement);
    when(statement.executeQuery()).thenReturn(resultSet);
    when(resultSet.next()).thenReturn(true);
    when(resultSet.getLong(1)).thenReturn(sessionId);
    when(resultSet.getLong(2)).thenReturn(outletId);
    when(resultSet.getString(3)).thenReturn(status);
  }
}
