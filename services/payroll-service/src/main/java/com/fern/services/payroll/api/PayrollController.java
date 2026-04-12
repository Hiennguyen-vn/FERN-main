package com.fern.services.payroll.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.payroll.application.PayrollService;
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
@RequestMapping("/api/v1/payroll")
public class PayrollController {

  private final PayrollService payrollService;

  public PayrollController(PayrollService payrollService) {
    this.payrollService = payrollService;
  }

  @PostMapping("/periods")
  public ResponseEntity<PayrollDtos.PayrollPeriodView> createPeriod(
      @Valid @RequestBody PayrollDtos.CreatePayrollPeriodRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(payrollService.createPeriod(request));
  }

  @GetMapping("/periods/{periodId}")
  public PayrollDtos.PayrollPeriodView getPeriod(@PathVariable long periodId) {
    return payrollService.getPeriod(periodId);
  }

  @GetMapping("/periods")
  public PagedResult<PayrollDtos.PayrollPeriodView> listPeriods(
      @RequestParam(required = false) Long regionId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return payrollService.listPeriods(regionId, startDate, endDate, q, sortBy, sortDir, limit, offset);
  }

  @PostMapping("/timesheets")
  public ResponseEntity<PayrollDtos.PayrollTimesheetView> createTimesheet(
      @Valid @RequestBody PayrollDtos.CreatePayrollTimesheetRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(payrollService.createTimesheet(request));
  }

  @GetMapping("/timesheets/{timesheetId}")
  public PayrollDtos.PayrollTimesheetView getTimesheet(@PathVariable long timesheetId) {
    return payrollService.getTimesheet(timesheetId);
  }

  @GetMapping("/timesheets")
  public PagedResult<PayrollDtos.PayrollTimesheetListItemView> listTimesheets(
      @RequestParam(required = false) Long payrollPeriodId,
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) Long outletId,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return payrollService.listTimesheets(payrollPeriodId, userId, outletId, q, sortBy, sortDir, limit, offset);
  }

  @PostMapping
  public ResponseEntity<PayrollDtos.PayrollView> generatePayroll(
      @Valid @RequestBody PayrollDtos.GeneratePayrollRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(payrollService.generatePayroll(request));
  }

  @GetMapping("/{payrollId}")
  public PayrollDtos.PayrollView getPayroll(@PathVariable long payrollId) {
    return payrollService.getPayroll(payrollId);
  }

  @GetMapping
  public PagedResult<PayrollDtos.PayrollListItemView> listPayroll(
      @RequestParam(required = false) Long payrollPeriodId,
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String status,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return payrollService.listPayroll(payrollPeriodId, userId, outletId, status, q, sortBy, sortDir, limit, offset);
  }

  @PostMapping("/{payrollId}/approve")
  public PayrollDtos.PayrollView approvePayroll(@PathVariable long payrollId) {
    return payrollService.approvePayroll(payrollId);
  }

  @PostMapping("/{payrollId}/reject")
  public PayrollDtos.PayrollView rejectPayroll(
      @PathVariable long payrollId,
      @RequestBody(required = false) PayrollDtos.PayrollDecisionRequest request
  ) {
    return payrollService.rejectPayroll(payrollId, request == null ? null : request.reason());
  }

  /**
   * Imports attendance data from hr-service and creates a payroll timesheet in one call.
   * payroll-service fetches approved work shifts via the internal service token,
   * aggregates workDays / workHours / lateCount / absentDays, then inserts the timesheet record.
   * The frontend never needs to touch raw shift data.
   */
  @PostMapping("/timesheets/import-from-attendance")
  public ResponseEntity<PayrollDtos.PayrollTimesheetView> importTimesheetFromAttendance(
      @Valid @RequestBody PayrollDtos.ImportFromAttendanceRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(payrollService.importFromAttendance(request));
  }
}
