package com.fern.services.finance.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.finance.application.FinanceService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/finance")
public class FinanceController {

  private final FinanceService financeService;

  public FinanceController(FinanceService financeService) {
    this.financeService = financeService;
  }

  @PostMapping("/expenses/operating")
  public ResponseEntity<FinanceDtos.ExpenseView> createOperatingExpense(
      @Valid @RequestBody FinanceDtos.CreateOperatingExpenseRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(financeService.createOperatingExpense(request));
  }

  @PostMapping("/expenses/other")
  public ResponseEntity<FinanceDtos.ExpenseView> createOtherExpense(
      @Valid @RequestBody FinanceDtos.CreateOtherExpenseRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(financeService.createOtherExpense(request));
  }

  @GetMapping("/expenses/{expenseId}")
  public FinanceDtos.ExpenseView getExpense(@PathVariable long expenseId) {
    return financeService.getExpense(expenseId);
  }

  @GetMapping("/expenses")
  public PagedResult<FinanceDtos.ExpenseView> listExpenses(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(required = false) String sourceType,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return financeService.listExpenses(outletId, startDate, endDate, sourceType, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/expenses/monthly")
  public List<FinanceDtos.MonthlyExpenseRow> monthlyExpenses(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate
  ) {
    return financeService.monthlyExpenses(outletId, startDate, endDate);
  }
}
