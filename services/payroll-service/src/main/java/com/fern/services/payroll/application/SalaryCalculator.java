package com.fern.services.payroll.application;

import com.fern.common.middleware.ServiceException;
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
 * <p>Gross formula:
 * <ul>
 *   <li>part_time / seasonal / contractor — hourly: basePay = workHours × baseSalary</li>
 *   <li>part_time / seasonal / contractor — daily:  basePay = workDays × baseSalary</li>
 *   <li>full_time — monthly: basePay = baseSalary; overtimePay = overtimeHours × (baseSalary / standardHoursPerMonth) × overtimeRate</li>
 *   <li>full_time — hourly/daily: same as part_time logic</li>
 * </ul>
 *
 * <p>Statutory deductions (Vietnam, applied for {@code full_time} only):
 * <ul>
 *   <li>Social insurance (BHXH): 8% of gross</li>
 *   <li>Health insurance (BHYT): 1.5% of gross</li>
 *   <li>Unemployment insurance (BHTN): 1% of gross</li>
 *   <li>Personal income tax (TNCN): progressive on (gross − insurance − personal allowance 11M VND).
 *       Dependents not modeled — personal allowance only.</li>
 * </ul>
 * Non-{@code full_time} employees (part_time / seasonal / contractor) are exempt:
 * net = gross. This matches Vietnamese practice where insurance is mandatory only for
 * indefinite or fixed-term {@code >=} 3-month full-time labor contracts.
 */
@Component
public class SalaryCalculator {

  private static final Logger log = LoggerFactory.getLogger(SalaryCalculator.class);

  private static final BigDecimal SOCIAL_INSURANCE_RATE = new BigDecimal("0.08");
  private static final BigDecimal HEALTH_INSURANCE_RATE = new BigDecimal("0.015");
  private static final BigDecimal UNEMPLOYMENT_INSURANCE_RATE = new BigDecimal("0.01");
  private static final BigDecimal PERSONAL_ALLOWANCE = new BigDecimal("11000000");

  private final BigDecimal standardHoursPerMonth;

  public SalaryCalculator(
      @Value("${payroll.salary.standardHoursPerMonth:160}") int standardHoursPerMonthConfig
  ) {
    this.standardHoursPerMonth = BigDecimal.valueOf(standardHoursPerMonthConfig);
  }

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
      basePay = baseSalary.setScale(2, RoundingMode.HALF_UP);
      if (overtimeHours.compareTo(BigDecimal.ZERO) > 0) {
        BigDecimal hourlyRate = baseSalary.divide(standardHoursPerMonth, 10, RoundingMode.HALF_UP);
        overtimePay = overtimeHours.multiply(hourlyRate).multiply(overtimeRate)
            .setScale(2, RoundingMode.HALF_UP);
      }
      stdHoursUsed = standardHoursPerMonth;
      method = "monthly_with_overtime";
    } else if ("daily".equals(salaryType)) {
      basePay = workDays.multiply(baseSalary).setScale(2, RoundingMode.HALF_UP);
      method = "daily";
    } else {
      if (!"hourly".equals(salaryType)) {
        log.warn("Unknown salaryType '{}' for userId={}, falling back to hourly calculation",
            salaryType, contract.userId());
      }
      basePay = workHours.multiply(baseSalary).setScale(2, RoundingMode.HALF_UP);
      method = "hourly";
    }

    BigDecimal grossPay = basePay.add(overtimePay).setScale(2, RoundingMode.HALF_UP);

    boolean applyDeductions = "full_time".equals(employmentType);
    BigDecimal social = BigDecimal.ZERO;
    BigDecimal health = BigDecimal.ZERO;
    BigDecimal unemployment = BigDecimal.ZERO;
    BigDecimal pit = BigDecimal.ZERO;

    if (applyDeductions) {
      social = grossPay.multiply(SOCIAL_INSURANCE_RATE).setScale(2, RoundingMode.HALF_UP);
      health = grossPay.multiply(HEALTH_INSURANCE_RATE).setScale(2, RoundingMode.HALF_UP);
      unemployment = grossPay.multiply(UNEMPLOYMENT_INSURANCE_RATE).setScale(2, RoundingMode.HALF_UP);
      BigDecimal afterInsurance = grossPay.subtract(social).subtract(health).subtract(unemployment);
      BigDecimal taxable = afterInsurance.subtract(PERSONAL_ALLOWANCE);
      if (taxable.compareTo(BigDecimal.ZERO) > 0) {
        pit = computeProgressivePit(taxable).setScale(2, RoundingMode.HALF_UP);
      }
    }

    BigDecimal totalDeductions = social.add(health).add(unemployment).add(pit)
        .setScale(2, RoundingMode.HALF_UP);
    BigDecimal netSalary = grossPay.subtract(totalDeductions).setScale(2, RoundingMode.HALF_UP);
    if (netSalary.compareTo(BigDecimal.ZERO) < 0) {
      netSalary = BigDecimal.ZERO;
    }

    PayrollDtos.SalaryBreakdown breakdown = new PayrollDtos.SalaryBreakdown(
        basePay,
        overtimePay,
        overtimeHours,
        overtimeRate,
        stdHoursUsed,
        method,
        grossPay,
        social,
        health,
        unemployment,
        pit,
        totalDeductions,
        applyDeductions
    );

    return new PayrollDtos.CalculateSalaryResult(
        basePay,
        netSalary,
        contract.salaryType(),
        contract.employmentType(),
        contract.currencyCode(),
        breakdown
    );
  }

  /**
   * Vietnamese personal income tax progressive brackets (monthly taxable income, VND).
   * Up to 5M: 5%, 5–10M: 10%, 10–18M: 15%, 18–32M: 20%, 32–52M: 25%, 52–80M: 30%, &gt;80M: 35%.
   */
  static BigDecimal computeProgressivePit(BigDecimal taxable) {
    if (taxable == null || taxable.compareTo(BigDecimal.ZERO) <= 0) {
      return BigDecimal.ZERO;
    }
    BigDecimal[][] brackets = {
        { new BigDecimal("5000000"), new BigDecimal("0.05") },
        { new BigDecimal("10000000"), new BigDecimal("0.10") },
        { new BigDecimal("18000000"), new BigDecimal("0.15") },
        { new BigDecimal("32000000"), new BigDecimal("0.20") },
        { new BigDecimal("52000000"), new BigDecimal("0.25") },
        { new BigDecimal("80000000"), new BigDecimal("0.30") },
    };
    BigDecimal tax = BigDecimal.ZERO;
    BigDecimal previousCap = BigDecimal.ZERO;
    BigDecimal remaining = taxable;
    for (BigDecimal[] bracket : brackets) {
      BigDecimal cap = bracket[0];
      BigDecimal rate = bracket[1];
      BigDecimal width = cap.subtract(previousCap);
      if (remaining.compareTo(width) <= 0) {
        tax = tax.add(remaining.multiply(rate));
        return tax;
      }
      tax = tax.add(width.multiply(rate));
      remaining = remaining.subtract(width);
      previousCap = cap;
    }
    tax = tax.add(remaining.multiply(new BigDecimal("0.35")));
    return tax;
  }
}
