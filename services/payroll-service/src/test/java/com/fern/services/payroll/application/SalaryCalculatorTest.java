package com.fern.services.payroll.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fern.common.middleware.ServiceException;
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
  void fullTimeMonthly_noOvertime_netSalaryAfterStatutoryDeductions() {
    // gross 16,000,000; BHXH 8% = 1,280,000; BHYT 1.5% = 240,000; BHTN 1% = 160,000
    // taxable = 16,000,000 − 1,680,000 − 11,000,000 = 3,320,000; PIT 5% = 166,000
    // net = 16,000,000 − 1,680,000 − 166,000 = 14,154,000.00
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "monthly", new BigDecimal("16000000")),
        timesheet(new BigDecimal("22"), new BigDecimal("176"), BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("14154000.00"), result.netSalary());
    assertEquals(0, result.breakdown().overtimePay().compareTo(BigDecimal.ZERO));
    assertEquals("monthly_with_overtime", result.breakdown().calculationMethod());
    assertEquals(new BigDecimal("16000000.00"), result.breakdown().grossPay());
    assertEquals(true, result.breakdown().deductionsApplied());
  }

  @Test
  void fullTimeMonthly_withOvertime_addsOvertimePayThenDeducts() {
    // gross 17,200,000; insurance 10.5% = 1,806,000; taxable = 4,394,000; PIT 5% = 219,700
    // net = 17,200,000 − 1,806,000 − 219,700 = 15,174,300.00
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "monthly", new BigDecimal("16000000")),
        timesheet(new BigDecimal("22"), new BigDecimal("176"), new BigDecimal("8"), new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("15174300.00"), result.netSalary());
    assertEquals(new BigDecimal("1200000.00"), result.breakdown().overtimePay());
  }

  @Test
  void fullTimeMonthly_belowPersonalAllowance_noPit() {
    // gross 10,093,750; insurance: 807,500 + 151,406.25 + 100,937.50 = 1,059,843.75
    // taxable = 10,093,750 − 1,059,843.75 − 11,000,000 < 0 → PIT 0
    // net = 10,093,750 − 1,059,843.75 = 9,033,906.25
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "monthly", new BigDecimal("10000000")),
        timesheet(new BigDecimal("22"), new BigDecimal("176"), BigDecimal.ONE, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("9033906.25"), result.netSalary());
    assertEquals(0, result.breakdown().personalIncomeTax().compareTo(BigDecimal.ZERO));
  }

  // ── Full-time with non-monthly salary type ──────────────────────────────────

  @Test
  void fullTimeHourly_treatedAsHourlyCalculation_thenDeducts() {
    // gross 9,600,000; insurance = 1,008,000; taxable < 0 → PIT 0
    // net = 9,600,000 − 1,008,000 = 8,592,000.00
    PayrollDtos.CalculateSalaryResult result = calculator.calculate(
        contract("full_time", "hourly", new BigDecimal("60000")),
        timesheet(BigDecimal.ZERO, new BigDecimal("160"), BigDecimal.ZERO, new BigDecimal("1.5")),
        "VND"
    );
    assertEquals(new BigDecimal("8592000.00"), result.netSalary());
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
    assertEquals(new BigDecimal("2000000.00"), result.baseSalaryAmount());
  }
}
