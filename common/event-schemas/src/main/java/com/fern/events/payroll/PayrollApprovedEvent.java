package com.fern.events.payroll;

import java.math.BigDecimal;
import java.time.Instant;

public record PayrollApprovedEvent(
    long payrollId,
    long userId,
    long payrollPeriodId,
    Long outletId,
    String currencyCode,
    BigDecimal netSalary,
    Instant approvedAt
) {
}
