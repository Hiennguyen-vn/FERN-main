package com.fern.services.finance.api;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fern.services.finance.application.FinanceService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class FinanceControllerTest {

  @Test
  void expenseSummaryUsesStaticRouteInsteadOfExpenseIdRoute() throws Exception {
    FinanceService financeService = mock(FinanceService.class);
    when(financeService.expenseSummary(
        eq(7L),
        eq(LocalDate.parse("2026-04-01")),
        eq(LocalDate.parse("2026-04-30")),
        eq("operating_expense"),
        eq("rent")
    )).thenReturn(List.of(new FinanceDtos.ExpenseSummaryRow(
        "operating_expense",
        3L,
        new BigDecimal("250000.00"),
        "VND"
    )));

    MockMvc mvc = MockMvcBuilders
        .standaloneSetup(new FinanceController(financeService))
        .build();

    mvc.perform(get("/api/v1/finance/expenses/summary")
            .param("outletId", "7")
            .param("startDate", "2026-04-01")
            .param("endDate", "2026-04-30")
            .param("sourceType", "operating_expense")
            .param("q", "rent"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].sourceType").value("operating_expense"))
        .andExpect(jsonPath("$[0].recordCount").value(3));

    verify(financeService).expenseSummary(
        7L,
        LocalDate.parse("2026-04-01"),
        LocalDate.parse("2026-04-30"),
        "operating_expense",
        "rent"
    );
    verify(financeService, never()).getExpense(7L);
  }
}
