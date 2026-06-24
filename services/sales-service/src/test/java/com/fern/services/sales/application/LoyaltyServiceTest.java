package com.fern.services.sales.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class LoyaltyServiceTest {

  private static final Clock FIXED_CLOCK =
      Clock.fixed(Instant.parse("2026-04-04T08:00:00Z"), ZoneOffset.UTC);

  @Mock
  private DataSource dataSource;

  @Mock
  private SnowflakeIdGenerator idGenerator;

  @Mock
  private Connection connection;

  @Mock
  private PreparedStatement statement;

  @Mock
  private ResultSet resultSet;

  @Test
  void pointsForFloorsPositiveSaleTotalsAndRejectsNonPositiveTotals() {
    // Given / When / Then
    assertThat(LoyaltyService.pointsFor(null)).isZero();
    assertThat(LoyaltyService.pointsFor(new BigDecimal("-1.00"))).isZero();
    assertThat(LoyaltyService.pointsFor(BigDecimal.ZERO)).isZero();
    assertThat(LoyaltyService.pointsFor(new BigDecimal("9999.99"))).isZero();
    assertThat(LoyaltyService.pointsFor(new BigDecimal("10000.00"))).isEqualTo(1);
    assertThat(LoyaltyService.pointsFor(new BigDecimal("25999.00"))).isEqualTo(2);
  }

  @Test
  void registerRejectsMissingPhoneOrPdplConsent() {
    // Given
    LoyaltyService loyaltyService = newService(true, "123456");

    // When / Then
    assertThatThrownBy(() -> loyaltyService.register(null))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(400);
    assertThatThrownBy(() -> loyaltyService.register(new LoyaltyService.CreateCustomerRequest(
        "0901000001", "Tran Thi B", LocalDate.parse("1990-01-01"), true, false)))
        .isInstanceOf(ServiceException.class)
        .hasMessageContaining("consentDataProcessing");
    verifyNoInteractions(dataSource);
  }

  @Test
  void registerReturnsExistingCustomerWhenPhoneAlreadyExists() throws Exception {
    // Given
    mockSingleCustomerLookup(true);
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    LoyaltyService.CustomerView result = loyaltyService.register(new LoyaltyService.CreateCustomerRequest(
        "0901000001", "Tran Thi B", LocalDate.parse("1990-01-01"), true, true));

    // Then
    assertThat(result.id()).isEqualTo(101L);
    assertThat(result.phone()).isEqualTo("0901000001");
    assertThat(result.phoneVerified()).isTrue();
    verifyNoInteractions(idGenerator);
  }

  @Test
  void registerCreatesCustomerWhenPhoneIsNew() throws Exception {
    // Given
    Connection lookupConnection = mock(Connection.class);
    PreparedStatement lookupStatement = mock(PreparedStatement.class);
    ResultSet emptyResultSet = mock(ResultSet.class);
    Connection insertConnection = mock(Connection.class);
    PreparedStatement insertStatement = mock(PreparedStatement.class);
    when(dataSource.getConnection()).thenReturn(lookupConnection, insertConnection);
    when(lookupConnection.prepareStatement(contains("FROM crm.customer"))).thenReturn(lookupStatement);
    when(lookupStatement.executeQuery()).thenReturn(emptyResultSet);
    when(emptyResultSet.next()).thenReturn(false);
    when(insertConnection.prepareStatement(contains("INSERT INTO crm.customer"))).thenReturn(insertStatement);
    when(idGenerator.generateId()).thenReturn(202L);
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    LoyaltyService.CustomerView result = loyaltyService.register(new LoyaltyService.CreateCustomerRequest(
        "0901000002", "Le Van C", null, false, true));

    // Then
    assertThat(result.id()).isEqualTo(202L);
    assertThat(result.pointsBalance()).isZero();
    assertThat(result.consentMarketing()).isFalse();
    verify(insertStatement).setNull(4, Types.DATE);
    verify(insertStatement).setBoolean(5, false);
    verify(insertStatement).setBoolean(6, true);
    verify(insertStatement).executeUpdate();
  }

  @Test
  void findByPhoneWrapsSqlException() throws Exception {
    // Given
    when(dataSource.getConnection()).thenThrow(new SQLException("crm schema unavailable"));
    LoyaltyService loyaltyService = newService(true, "123456");

    // When / Then
    assertThatThrownBy(() -> loyaltyService.findByPhone("0901000001"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("findByPhone")
        .hasRootCauseMessage("crm schema unavailable");
  }

  @Test
  void earnSkipsLedgerWhenSaleTotalHasNoPoints() {
    // Given
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    int balance = loyaltyService.earn(101L, 5001L, new BigDecimal("9999.00"));

    // Then
    assertThat(balance).isZero();
    verifyNoInteractions(dataSource);
  }

  @Test
  void redeemUpdatesCustomerLedgerAndCommitsTransaction() throws Exception {
    // Given
    PreparedStatement selectStatement = mock(PreparedStatement.class);
    PreparedStatement updateStatement = mock(PreparedStatement.class);
    PreparedStatement ledgerStatement = mock(PreparedStatement.class);
    ResultSet balanceResultSet = mock(ResultSet.class);
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(anyString()))
        .thenReturn(selectStatement, updateStatement, ledgerStatement);
    when(selectStatement.executeQuery()).thenReturn(balanceResultSet);
    when(balanceResultSet.next()).thenReturn(true);
    when(balanceResultSet.getInt(1)).thenReturn(150);
    when(idGenerator.generateId()).thenReturn(90001L);
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    int balance = loyaltyService.redeem(101L, null);

    // Then
    assertThat(balance).isEqualTo(50);
    verify(connection).setAutoCommit(false);
    verify(updateStatement).setInt(1, 50);
    verify(ledgerStatement).setNull(3, Types.BIGINT);
    verify(connection).commit();
    verify(connection).setAutoCommit(true);
  }

  @Test
  void redeemRollsBackWhenBalanceWouldBecomeNegative() throws Exception {
    // Given
    PreparedStatement selectStatement = mock(PreparedStatement.class);
    ResultSet balanceResultSet = mock(ResultSet.class);
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(contains("FOR UPDATE"))).thenReturn(selectStatement);
    when(selectStatement.executeQuery()).thenReturn(balanceResultSet);
    when(balanceResultSet.next()).thenReturn(true);
    when(balanceResultSet.getInt(1)).thenReturn(10);
    LoyaltyService loyaltyService = newService(true, "123456");

    // When / Then
    assertThatThrownBy(() -> loyaltyService.redeem(101L, 5001L))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(409);
    verify(connection).rollback();
    verify(connection).setAutoCommit(true);
  }

  @Test
  void ledgerClampsLimitAndMapsNullSaleId() throws Exception {
    // Given
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(contains("FROM crm.points_ledger"))).thenReturn(statement);
    when(statement.executeQuery()).thenReturn(resultSet);
    when(resultSet.next()).thenReturn(true, false);
    when(resultSet.getLong("sale_id")).thenReturn(0L);
    when(resultSet.wasNull()).thenReturn(true);
    when(resultSet.getLong("id")).thenReturn(70001L);
    when(resultSet.getInt("delta")).thenReturn(25);
    when(resultSet.getString("reason")).thenReturn("earn:sale");
    when(resultSet.getInt("balance_after")).thenReturn(125);
    when(resultSet.getTimestamp("created_at"))
        .thenReturn(Timestamp.from(Instant.parse("2026-04-04T09:00:00Z")));
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    List<Map<String, Object>> result = loyaltyService.ledger(101L, 999);

    // Then
    assertThat(result).hasSize(1);
    assertThat(result.getFirst())
        .containsEntry("id", 70001L)
        .containsEntry("saleId", null)
        .containsEntry("balanceAfter", 125);
    verify(statement).setInt(2, 500);
  }

  @Test
  void requestOtpStoresHashAndReturnsDebugCodeWhenMockOtpIsEnabled() throws Exception {
    // Given
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(contains("INSERT INTO crm.otp_request"))).thenReturn(statement);
    when(idGenerator.generateId()).thenReturn(8080L);
    LoyaltyService loyaltyService = newService(true, "654321");

    // When
    Map<String, Object> result = loyaltyService.requestOtp("0901000001");

    // Then
    assertThat(result)
        .containsEntry("requestId", 8080L)
        .containsEntry("expiresAt", "2026-04-04T08:05:00Z")
        .containsEntry("debugCode", "654321");
    verify(statement).setString(org.mockito.ArgumentMatchers.eq(2), org.mockito.ArgumentMatchers.eq("0901000001"));
    verify(statement).setString(
        org.mockito.ArgumentMatchers.eq(3),
        org.mockito.ArgumentMatchers.argThat(value -> !"654321".equals(value)));
    verify(statement).executeUpdate();
  }

  @Test
  void requestOtpRejectsBlankPhone() {
    // Given
    LoyaltyService loyaltyService = newService(true, "123456");

    // When / Then
    assertThatThrownBy(() -> loyaltyService.requestOtp("  "))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(400);
  }

  @Test
  void verifyOtpReturnsFalseWhenNoActiveRequestMatches() throws Exception {
    // Given
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(contains("UPDATE crm.otp_request"))).thenReturn(statement);
    when(statement.executeUpdate()).thenReturn(0);
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    boolean result = loyaltyService.verifyOtp("0901000001", "000000");

    // Then
    assertThat(result).isFalse();
    verify(statement).setString(org.mockito.ArgumentMatchers.eq(1), org.mockito.ArgumentMatchers.eq("0901000001"));
  }

  @Test
  void verifyOtpMarksCustomerVerifiedWhenRequestIsConsumed() throws Exception {
    // Given
    Connection otpConnection = mock(Connection.class);
    PreparedStatement otpStatement = mock(PreparedStatement.class);
    Connection customerConnection = mock(Connection.class);
    PreparedStatement customerStatement = mock(PreparedStatement.class);
    when(dataSource.getConnection()).thenReturn(otpConnection, customerConnection);
    when(otpConnection.prepareStatement(contains("UPDATE crm.otp_request"))).thenReturn(otpStatement);
    when(customerConnection.prepareStatement(contains("UPDATE crm.customer"))).thenReturn(customerStatement);
    when(otpStatement.executeUpdate()).thenReturn(1);
    LoyaltyService loyaltyService = newService(true, "123456");

    // When
    boolean result = loyaltyService.verifyOtp("0901000001", "123456");

    // Then
    assertThat(result).isTrue();
    verify(customerStatement).setString(1, "0901000001");
    verify(customerStatement).executeUpdate();
  }

  private LoyaltyService newService(boolean mockOtpEnabled, String mockOtpCode) {
    return new LoyaltyService(dataSource, idGenerator, FIXED_CLOCK, mockOtpEnabled, mockOtpCode);
  }

  private void mockSingleCustomerLookup(boolean verified) throws Exception {
    when(dataSource.getConnection()).thenReturn(connection);
    when(connection.prepareStatement(contains("FROM crm.customer"))).thenReturn(statement);
    when(statement.executeQuery()).thenReturn(resultSet);
    when(resultSet.next()).thenReturn(true);
    when(resultSet.getDate("birthday")).thenReturn(Date.valueOf("1990-01-01"));
    when(resultSet.getTimestamp("phone_verified_at"))
        .thenReturn(verified ? Timestamp.from(Instant.parse("2026-04-04T07:50:00Z")) : null);
    when(resultSet.getLong("id")).thenReturn(101L);
    when(resultSet.getString("phone")).thenReturn("0901000001");
    when(resultSet.getString("full_name")).thenReturn("Tran Thi B");
    when(resultSet.getInt("points_balance")).thenReturn(250);
    when(resultSet.getBoolean("consent_marketing")).thenReturn(true);
    when(resultSet.getBoolean("consent_data_processing")).thenReturn(true);
  }
}
