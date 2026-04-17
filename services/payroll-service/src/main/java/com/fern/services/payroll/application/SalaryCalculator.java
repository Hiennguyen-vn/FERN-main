package com.fern.services.payroll.application;

import com.dorabets.common.middleware.ServiceException;
import com.fern.services.payroll.api.PayrollDtos;
import com.fern.services.payroll.infrastructure.PayrollRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Stateless salary calculation engine.
 *
 * <p>Formula:
 * <ul>
 *   <li><b>part_time / seasonal / contractor — hourly:</b> netSalary = workHours × baseSalary</li>
 *   <li><b>part_time / seasonal / contractor — daily:</b>  netSalary = workDays × baseSalary</li>
 *   <li><b>full_time — monthly:</b> basePay = baseSalary;
 *       overtimePay = overtimeHours × (baseSalary / standardHoursPerMonth) × overtimeRate</li>
 *   <li><b>full_time — hourly/daily:</b> same as part_time logic</li>
 * </ul>
 * All calculations use {@link RoundingMode#HALF_UP} with scale 2.
 */
@Component
public class SalaryCalculator {

  private static final Logger log = LoggerFactory.getLogger(SalaryCalculator.class);

  private final BigDecimal standardHoursPerMonth;

  public SalaryCalculator(
      @Value("${payroll.salary.standardHoursPerMonth:160}") int standardHoursPerMonthConfig
  ) {
    this.standardHoursPerMonth = BigDecimal.valueOf(standardHoursPerMonthConfig);
  }

  /**
   * Calculates gross salary for the given timesheet using the employee's active contract.
   *
   * @param contract          the employee's latest active contract from hr-service
   * @param timesheet         the payroll timesheet record with aggregated work data
   * @param requestCurrencyCode the currency requested by the caller (must match contract currency)
   * @return a {@link PayrollDtos.CalculateSalaryResult} with netSalary and itemised breakdown
   * @throws com.dorabets.common.spring.error.ServiceException if currencies mismatch
   */
  public PayrollDtos.CalculateSalaryResult calculate(
      PayrollDtos.EmployeeContractSummary contract,
      PayrollRepository.PayrollTimesheetRecord timesheet,
      String requestCurrencyCode
  ) {
    if (!contract.currencyCode().equalsIgnoreCase(requestCurrencyCode)) {
      throw ServiceException.badRequest(
          "Currency mismatch: contract is in " + contract.currencyCode()
              + " but request specifies " + requestCurrencyCode);
    }

    String employmentType = contract.employmentType() != null
        ? contract.employmentType().toLowerCase()
        : "part_time";
    String salaryType = contract.salaryType() != null
        ? contract.salaryType().toLowerCase()
        : "hourly";
    BigDecimal baseSalary = contract.baseSalary() != null
        ? contract.baseSalary()
        : BigDecimal.ZERO;

    BigDecimal workHours = timesheet.workHours() != null
        ? timesheet.workHours()
        : BigDecimal.ZERO;
    BigDecimal workDays = timesheet.workDays() != null
        ? timesheet.workDays()
        : BigDecimal.ZERO;
    BigDecimal overtimeHours = timesheet.overtimeHours() != null
        ? timesheet.overtimeHours()
        : BigDecimal.ZERO;
    BigDecimal overtimeRate = timesheet.overtimeRate() != null
        ? timesheet.overtimeRate()
        : BigDecimal.ONE;

    BigDecimal basePay;
    BigDecimal overtimePay = BigDecimal.ZERO;
    BigDecimal stdHoursUsed = null;
    String method;

    if ("full_time".equals(employmentType) && "monthly".equals(salaryType)) {
      // Full-time monthly: receive full base salary + overtime premium
      basePay = baseSalary.setScale(2, RoundingMode.HALF_UP);
      if (overtimeHours.compareTo(BigDecimal.ZERO) > 0) {
        BigDecimal hourlyRate = baseSalary.divide(standardHoursPerMonth, 10, RoundingMode.HALF_UP);
        overtimePay = overtimeHours.multiply(hourlyRate).multiply(overtimeRate)
            .setScale(2, RoundingMode.HALF_UP);
      }
      stdHoursUsed = standardHoursPerMonth;
      method = "monthly_with_overtime";
    } else if ("daily".equals(salaryType)) {
      // Daily rate workers (any employment type)
      basePay = workDays.multiply(baseSalary).setScale(2, RoundingMode.HALF_UP);
      method = "daily";
    } else {
      // Hourly rate workers (part_time, seasonal, contractor, or full_time-hourly)
      if (!"hourly".equals(salaryType)) {
        log.warn("Unknown salaryType '{}' for userId={}, falling back to hourly calculation",
            salaryType, contract.userId());
      }
      basePay = workHours.multiply(baseSalary).setScale(2, RoundingMode.HALF_UP);
      method = "hourly";
    }

    BigDecimal netSalary = basePay.add(overtimePay).setScale(2, RoundingMode.HALF_UP);

    PayrollDtos.SalaryBreakdown breakdown = new PayrollDtos.SalaryBreakdown(
        basePay,
        overtimePay,
        overtimeHours,
        overtimeRate,
        stdHoursUsed,
        method
    );

    return new PayrollDtos.CalculateSalaryResult(
        baseSalary,
        netSalary,
        contract.salaryType(),
        contract.employmentType(),
        contract.currencyCode(),
        breakdown
    );
  }
}
