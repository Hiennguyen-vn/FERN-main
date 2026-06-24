package com.fern.services.sales.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fern.common.spring.web.PagedResult;
import com.fern.services.sales.application.CrmService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CrmControllerTest {

  @Mock
  private CrmService crmService;

  @InjectMocks
  private CrmController controller;

  @Test
  void listCustomersDelegatesAllQueryParameters() {
    // Given
    PagedResult<CrmDtos.CustomerView> expected = PagedResult.of(
        List.of(new CrmDtos.CustomerView(
            "CUST-101",
            "phone",
            "Nguyen Van A",
            7L,
            "HCM-7",
            "Ho Chi Minh Cafe 7",
            5,
            new BigDecimal("350000.00"),
            Instant.parse("2026-04-05T11:30:00Z")
        )),
        25,
        50,
        1
    );
    when(crmService.listCustomers(7L, "nguyen", "a", "lastOrderAt", "desc", 25, 50))
        .thenReturn(expected);

    // When
    PagedResult<CrmDtos.CustomerView> result =
        controller.listCustomers(7L, "nguyen", "a", "lastOrderAt", "desc", 25, 50);

    // Then
    assertThat(result).isSameAs(expected);
    verify(crmService).listCustomers(7L, "nguyen", "a", "lastOrderAt", "desc", 25, 50);
  }
}
