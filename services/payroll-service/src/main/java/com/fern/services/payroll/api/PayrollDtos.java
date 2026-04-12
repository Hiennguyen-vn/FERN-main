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
      @NotNull @DecimalMin(value = "0.00") BigDecimal baseSalaryAmount,
      @NotNull @DecimalMin(value = "0.00") BigDecimal netSalary,
      String note
  ) {
  }

  public record PayrollDecisionRequest(
      String reason
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
