package com.fern.services.payroll.api;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public final class PayrollDtos {

  private PayrollDtos() {
  }

  public record PayrollPeriodView(
      String id,
      long regionId,
      String name,
      LocalDate startDate,
      LocalDate endDate,
      LocalDate payDate,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record CreatePayrollPeriodRequest(
      @NotNull Long regionId,
      @NotBlank String name,
      @NotNull LocalDate startDate,
      @NotNull LocalDate endDate,
      LocalDate payDate,
      String note
  ) {
  }

  public record PayrollTimesheetView(
      String id,
      String payrollPeriodId,
      long userId,
      Long outletId,
      BigDecimal workDays,
      BigDecimal workHours,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate,
      int lateCount,
      BigDecimal absentDays,
      Long approvedByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollTimesheetListItemView(
      String id,
      String payrollPeriodId,
      String payrollPeriodName,
      LocalDate payrollPeriodStartDate,
      LocalDate payrollPeriodEndDate,
      long userId,
      Long outletId,
      BigDecimal workDays,
      BigDecimal workHours,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate,
      int lateCount,
      BigDecimal absentDays,
      Long approvedByUserId,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record CreatePayrollTimesheetRequest(
      @NotNull Long payrollPeriodId,
      @NotNull Long userId,
      Long outletId,
      @NotNull @DecimalMin(value = "0.00") BigDecimal workDays,
      @NotNull @DecimalMin(value = "0.00") BigDecimal workHours,
      @NotNull @DecimalMin(value = "0.00") BigDecimal overtimeHours,
      @NotNull @DecimalMin(value = "0.00") BigDecimal overtimeRate,
      int lateCount,
      @NotNull @DecimalMin(value = "0.00") BigDecimal absentDays
  ) {
  }

  public record PayrollView(
      String id,
      String payrollTimesheetId,
      String currencyCode,
      BigDecimal baseSalaryAmount,
      BigDecimal netSalary,
      String status,
      Long approvedByUserId,
      Instant approvedAt,
      String paymentRef,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record PayrollListItemView(
      String id,
      String payrollTimesheetId,
      String payrollPeriodId,
      String payrollPeriodName,
      long userId,
      Long outletId,
      String currencyCode,
      BigDecimal baseSalaryAmount,
      BigDecimal netSalary,
      String status,
      Long approvedByUserId,
      Instant approvedAt,
      String paymentRef,
      String note,
      Instant createdAt,
      Instant updatedAt
  ) {
  }

  public record GeneratePayrollRequest(
      @NotNull Long payrollTimesheetId,
      @NotBlank String currencyCode,
      @DecimalMin(value = "0.00") BigDecimal baseSalaryAmount,
      @DecimalMin(value = "0.00") BigDecimal netSalary,
      String note
  ) {
  }

  public record PayrollDecisionRequest(
      String reason
  ) {
  }

  public record MarkPaidRequest(
      String paymentRef
  ) {
  }

  /**
   * Minimal projection of a work shift record returned by hr-service.
   * Only the fields needed for attendance aggregation are mapped.
   */
  public record WorkShiftSummaryItem(
      Long id,
      Long userId,
      Long outletId,
      String workDate,
      String scheduleStatus,
      String attendanceStatus,
      String approvalStatus,
      String actualStartTime,
      String actualEndTime,
      Double totalHours
  ) {
  }

  /**
   * Paged response wrapper used when deserialising hr-service /work-shifts responses.
   */
  public record WorkShiftPage(
      java.util.List<WorkShiftSummaryItem> items,
      long total,
      boolean hasMore
  ) {
  }

  /**
   * Minimal projection of an employee contract returned by hr-service.
   * Used exclusively by the salary calculation engine — not exposed to API callers directly.
   */
  public record EmployeeContractSummary(
      long userId,
      String employmentType,
      String salaryType,
      BigDecimal baseSalary,
      String currencyCode
  ) {
  }

  /**
   * Itemised breakdown of how netSalary was derived.
   */
  public record SalaryBreakdown(
      BigDecimal basePay,
      BigDecimal overtimePay,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate,
      BigDecimal standardHoursPerMonth,
      String calculationMethod
  ) {
  }

  /**
   * Request body for POST /payroll/calculate-salary.
   * Returns a salary calculation preview without persisting anything.
   */
  public record CalculateSalaryRequest(
      @NotNull Long timesheetId,
      @NotBlank String currencyCode
  ) {
  }

  /**
   * Result of the salary calculation preview endpoint.
   */
  public record CalculateSalaryResult(
      BigDecimal baseSalaryAmount,
      BigDecimal netSalary,
      String salaryType,
      String employmentType,
      String currencyCode,
      SalaryBreakdown breakdown
  ) {
  }

  /**
   * Request body for POST /timesheets/import-from-attendance.
   * payroll-service fetches approved shifts from hr-service, aggregates them, and creates the
   * payroll_timesheet record — the frontend never needs to touch raw shift data.
   */
  public record ImportFromAttendanceRequest(
      @NotNull Long payrollPeriodId,
      @NotNull Long userId,
      Long outletId,
      @NotNull @DecimalMin(value = "0.00") BigDecimal overtimeRate
  ) {
  }
}
