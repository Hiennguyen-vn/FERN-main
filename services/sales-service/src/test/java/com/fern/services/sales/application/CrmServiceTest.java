package com.fern.services.sales.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.services.sales.api.CrmDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CrmServiceTest {

  @Mock
  private SalesRepository salesRepository;

  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  @InjectMocks
  private CrmService crmService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void listCustomersUsesNormalizedQAndRequestedOutletWhenPolicyReturnsNull() {
    // Given
    RequestUserContext context = userContext(Set.of(7L));
    RequestUserContextHolder.set(context);
    PagedResult<CrmDtos.CustomerView> expected = PagedResult.of(
        List.of(customer("CUST-101", 7L)),
        500,
        0,
        1
    );
    when(authorizationPolicyService.resolveSalesReadableOutletIds(context)).thenReturn(null);
    when(salesRepository.listCustomerReferences(
        eq(Set.of(7L)), eq("Nguyen"), eq("lastOrderAt"), eq("desc"), eq(500), eq(0)))
        .thenReturn(expected);

    // When
    PagedResult<CrmDtos.CustomerView> result =
        crmService.listCustomers(7L, "ignored", "  Nguyen  ", "lastOrderAt", "desc", 999, -20);

    // Then
    assertThat(result).isSameAs(expected);
    verify(salesRepository).listCustomerReferences(
        Set.of(7L), "Nguyen", "lastOrderAt", "desc", 500, 0);
  }

  @Test
  void listCustomersFallsBackToLegacyQueryWhenQIsBlankAndUsesAllReadableOutlets() {
    // Given
    RequestUserContext context = userContext(Set.of(7L, 8L));
    RequestUserContextHolder.set(context);
    PagedResult<CrmDtos.CustomerView> expected = PagedResult.of(
        List.of(customer("CUST-201", 8L)),
        100,
        15,
        1
    );
    when(authorizationPolicyService.resolveSalesReadableOutletIds(context)).thenReturn(Set.of(7L, 8L));
    when(salesRepository.listCustomerReferences(
        eq(Set.of(7L, 8L)), eq("coffee"), eq("totalSpend"), eq("asc"), eq(100), eq(15)))
        .thenReturn(expected);

    // When
    PagedResult<CrmDtos.CustomerView> result =
        crmService.listCustomers(null, "coffee", "   ", "totalSpend", "asc", 0, 15);

    // Then
    assertThat(result.items()).hasSize(1);
    assertThat(result.items().getFirst().outletId()).isEqualTo(8L);
    verify(salesRepository).listCustomerReferences(
        Set.of(7L, 8L), "coffee", "totalSpend", "asc", 100, 15);
  }

  @Test
  void listCustomersRejectsEmptyReadableScope() {
    // Given
    RequestUserContext context = userContext(Set.of());
    RequestUserContextHolder.set(context);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(context)).thenReturn(Set.of());

    // When / Then
    assertThatThrownBy(() -> crmService.listCustomers(null, null, null, null, null, 100, 0))
        .isInstanceOf(ServiceException.class)
        .extracting("statusCode")
        .isEqualTo(403);
  }

  @Test
  void listCustomersRejectsRequestedOutletOutsideReadableScope() {
    // Given
    RequestUserContext context = userContext(Set.of(7L));
    RequestUserContextHolder.set(context);
    when(authorizationPolicyService.resolveSalesReadableOutletIds(context)).thenReturn(Set.of(7L));

    // When / Then
    assertThatThrownBy(() -> crmService.listCustomers(9L, null, null, null, null, 100, 0))
        .isInstanceOf(ServiceException.class)
        .hasMessageContaining("9")
        .extracting("statusCode")
        .isEqualTo(403);
  }

  private static RequestUserContext userContext(Set<Long> outletIds) {
    return new RequestUserContext(
        42L, "manager", "session-42", Set.of("manager"), Set.of("sales:read"), outletIds,
        true, false, null, null, null);
  }

  private static CrmDtos.CustomerView customer(String id, long outletId) {
    return new CrmDtos.CustomerView(
        id,
        "phone",
        "Nguyen Van A",
        outletId,
        "HCM-" + outletId,
        "Ho Chi Minh Cafe " + outletId,
        6,
        new BigDecimal("420000.00"),
        Instant.parse("2026-04-01T09:00:00Z")
    );
  }
}
