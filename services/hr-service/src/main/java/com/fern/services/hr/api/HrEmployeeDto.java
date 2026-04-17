package com.fern.services.hr.api;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Employee profile view combining core user data with latest HR contract info.
 * This endpoint is accessible to users with HR schedule or contract access,
 * unlike the IAM /auth/users endpoint which requires IAM read permissions.
 */
public record HrEmployeeDto(
    long id,
    String username,
    String fullName,
    String employeeCode,
    String email,
    String phone,
    String status,
    String gender,
    LocalDate dob,
    Instant createdAt,
    // Latest active contract summary (null if no active contract)
    ActiveContract activeContract
) {

  public record ActiveContract(
      long contractId,
      String employmentType,
      String salaryType,
      java.math.BigDecimal baseSalary,
      String currencyCode,
      String regionCode,
      LocalDate startDate,
      LocalDate endDate,
      String contractStatus
  ) {}
}
