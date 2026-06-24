package com.fern.services.sales.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.services.sales.application.LoyaltyService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class LoyaltyControllerTest {

  @Mock
  private LoyaltyService loyaltyService;

  @InjectMocks
  private LoyaltyController controller;

  @Test
  void registerDelegatesCreateCustomerRequest() {
    // Given
    LoyaltyService.CreateCustomerRequest request = new LoyaltyService.CreateCustomerRequest(
        "0901000001", "Tran Thi B", LocalDate.parse("1990-01-01"), true, true);
    LoyaltyService.CustomerView expected = customer(101L);
    when(loyaltyService.register(request)).thenReturn(expected);

    // When
    LoyaltyService.CustomerView result = controller.register(request);

    // Then
    assertThat(result).isSameAs(expected);
    verify(loyaltyService).register(request);
  }

  @Test
  void getAndLookupThrowNotFoundWhenCustomerIsMissing() {
    // Given
    when(loyaltyService.findById(404L)).thenReturn(Optional.empty());
    when(loyaltyService.findByPhone("0901999999")).thenReturn(Optional.empty());

    // When / Then
    assertThatThrownBy(() -> controller.get(404L))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(404);
    assertThatThrownBy(() -> controller.lookup("0901999999"))
        .isInstanceOf(ServiceException.class)
        .hasMessage("Customer not found");
  }

  @Test
  void earnParsesBodyAndReturnsNewBalance() {
    // Given
    when(loyaltyService.earn(101L, 5001L, new BigDecimal("250000.00"))).thenReturn(325);

    // When
    Map<String, Object> result = controller.earn(101L, Map.of(
        "saleId", 5001L,
        "saleTotal", "250000.00"
    ));

    // Then
    assertThat(result)
        .containsEntry("customerId", 101L)
        .containsEntry("newBalance", 325);
    verify(loyaltyService).earn(101L, 5001L, new BigDecimal("250000.00"));
  }

  @Test
  void redeemAllowsMissingBodyAndIncludesVoucherAmount() {
    // Given
    when(loyaltyService.redeem(101L, null)).thenReturn(200);

    // When
    Map<String, Object> result = controller.redeem(101L, null);

    // Then
    assertThat(result)
        .containsEntry("customerId", 101L)
        .containsEntry("newBalance", 200)
        .containsEntry("voucherVnd", LoyaltyService.REDEEM_VOUCHER_VND);
    verify(loyaltyService).redeem(101L, null);
  }

  @Test
  void ledgerAndOtpEndpointsWrapServiceResponses() {
    // Given
    List<Map<String, Object>> ledger = List.of(Map.of("delta", 25, "reason", "earn:sale"));
    when(loyaltyService.ledger(101L, 10)).thenReturn(ledger);
    when(loyaltyService.requestOtp("0901000001")).thenReturn(Map.of("requestId", 777L));
    when(loyaltyService.verifyOtp("0901000001", "123456")).thenReturn(true);

    // When
    Map<String, Object> ledgerResult = controller.ledger(101L, 10);
    Map<String, Object> otpRequest = controller.requestOtp(Map.of("phone", "0901000001"));
    Map<String, Object> verifyResult = controller.verifyOtp(Map.of("phone", "0901000001", "code", "123456"));

    // Then
    assertThat(ledgerResult).containsEntry("items", ledger).containsEntry("count", 1);
    assertThat(otpRequest).containsEntry("requestId", 777L);
    assertThat(verifyResult).containsEntry("verified", true);
  }

  private static LoyaltyService.CustomerView customer(long id) {
    return new LoyaltyService.CustomerView(
        id,
        "0901000001",
        "Tran Thi B",
        LocalDate.parse("1990-01-01"),
        300,
        true,
        true,
        true
    );
  }
}
