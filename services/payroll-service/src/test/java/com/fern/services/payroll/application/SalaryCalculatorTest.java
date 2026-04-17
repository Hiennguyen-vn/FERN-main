package com.fern.services.payroll.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dorabets.common.middleware.ServiceException;
import com.fern.services.payroll.api.PayrollDtos;
import com.fern.services.payroll.infrastructure.PayrollRepository;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class SalaryCalculatorTest {

  private final SalaryCalculator calculator = new SalaryCalculator(160);

  private static PayrollRepository.PayrollTimesheetRecord timesheet(
      BigDecimal workDays,
      BigDecimal workHours,
      BigDecimal overtimeHours,
      BigDecimal overtimeRate
  ) {
    return new PayrollRepository.PayrollTimesheetRecord(
        1L, 10L, 100L, null,
        workDays, workHours, overtimeHours, overtimeRate,
        0, BigDecimal.ZERO, null, Instant.now(), Instant.now()
    );
  }

  private static PayrollDtos.EmployeeContractSummary contract(
      String employmentType, String salaryType, BigDecimal baseSalary
  ) {
    return new PayrollDtos.EmployeeContractSummary(100L, employmentType, salaryType, baseSalary, "VND");
  }

  // ── Hourly workers ──────────────────────────────────────────────────────────

  @Test
  void partTimeHourly_netSalaryIsWorkHoursTimesRate() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("part_time", "hourly", new BigDecimal("50000")),
        timesheet(BigDecimal.ZERO, new BigDecimal("80"), BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("4000000.00"), result.netSalary());
    assertEquals("hourly", result.breakdown().calculationMethod());
    assertEquals(0, result.breakdown().overtimePay().compareTo(BigDecimal.ZERO));
  }

  @Test
  void contractorHourly_zeroHours_netSalaryIsZero() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("contractor", "hourly", new BigDecimal("100000")),
        timesheet(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("0.00"), result.netSalary());
  }

  // ── Daily workers ───────────────────────────────────────────────────────────

  @Test
  void partTimeDaily_netSalaryIsWorkDaysTimesRate() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("part_time", "daily", new BigDecimal("300000")),
        timesheet(new BigDecimal("20"), BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("6000000.00"), result.netSalary());
    assertEquals("daily", result.breakdown().calculationMethod());
  }

  @Test
  void seasonalDaily_netSalaryIsWorkDaysTimesRate() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("seasonal", "daily", new BigDecimal("250000")),
        timesheet(new BigDecimal("15"), BigDecimal.ZERO, BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("3750000.00"), result.netSalary());
  }

  // ── Full-time monthly ───────────────────────────────────────────────────────

  @Test
  void fullTimeMonthly_noOvertime_netSalaryEqualsBaseSalary() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "monthly", new BigDecimal("16000000")),
        timesheet(new BigDecimal("22"), new BigDecimal("176"), BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("16000000.00"), result.netSalary());
    assertEquals(0, result.breakdown().overtimePay().compareTo(BigDecimal.ZERO));
    assertEquals("monthly_with_overtime", result.breakdown().calculationMethod());
  }

  @Test
  void fullTimeMonthly_withOvertime_addsOvertimePay() {
    // overtimePay = 8 × (16000000/160) × 1.5 = 8 × 100000 × 1.5 = 1200000
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "monthly", new BigDecimal("16000000")),
        timesheet(new BigDecimal("22"), new BigDecimal("176"), new BigDecimal("8"), new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("17200000.00"), result.netSalary());
    assertEquals(new BigDecimal("1200000.00"), result.breakdown().overtimePay());
  }

  @Test
  void fullTimeMonthly_fractionalOvertime_roundsHalfUp() {
    // overtimePay = 1 × (10000000/160) × 1.5 = 1 × 62500 × 1.5 = 93750.00
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "monthly", new BigDecimal("10000000")),
        timesheet(new BigDecimal("22"), new BigDecimal("176"), BigDecimal.ONE, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("10093750.00"), result.netSalary());
  }

  // ── Full-time with non-monthly salary type ──────────────────────────────────

  @Test
  void fullTimeHourly_treatedAsHourlyCalculation() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "hourly", new BigDecimal("60000")),
        timesheet(BigDecimal.ZERO, new BigDecimal("160"), BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("9600000.00"), result.netSalary());
    assertEquals("hourly", result.breakdown().calculationMethod());
  }

  // ── Currency mismatch ───────────────────────────────────────────────────────

  @Test
  void currencyMismatch_throws400() {
    ServiceException ex = assertThrows(ServiceException.class, () ->
        calculator.calculate(
            contract("full_time", "monthly", new BigDecimal("16000000")),
            timesheet(new BigDecimal("22"), new BigDecimal("176"), BigDecimal.ZERO, new BigDecimal("1.5")),
            "USD"
        )
    );
    assertEquals(400, ex.getStatusCode());
  }

  // ── Result metadata ─────────────────────────────────────────────────────────

  @Test
  void resultContainsContractMetadata() {
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("part_time", "hourly", new BigDecimal("50000")),
        timesheet(BigDecimal.ZERO, new BigDecimal("40"), BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals("part_time", result.employmentType());
    assertEquals("hourly", result.salaryType());
    assertEquals("VND", result.currencyCode());
    assertEquals(new BigDecimal("50000"), result.baseSalaryAmount());
  }
}
