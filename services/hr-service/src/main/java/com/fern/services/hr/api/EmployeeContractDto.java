package com.fern.services.hr.api;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public record EmployeeContractDto(
    long id,
    long userId,
    String employmentType,
    String salaryType,
    BigDecimal baseSalary,
    String currencyCode,
    String regionCode,
    String taxCode,
    String bankAccount,
    LocalDate hireDate,
    LocalDate startDate,
    LocalDate endDate,
    String status,
    Long createdByUserId,
    Instant deletedAt,
    Instant createdAt,
    Instant updatedAt
) {

  public record Create(
      @NotNull Long userId,
      @NotBlank String employmentType,
      @NotBlank String salaryType,
      @NotNull @DecimalMin(value = "0.00") BigDecimal baseSalary,
      @NotBlank String currencyCode,
      @NotBlank String regionCode,
      String taxCode,
      String bankAccount,
      LocalDate hireDate,
      @NotNull LocalDate startDate,
      LocalDate endDate,
      String status
  ) {
  }

  public record Update(
      String employmentType,
      String salaryType,
      @DecimalMin(value = "0.00") BigDecimal baseSalary,
      String currencyCode,
      String regionCode,
      String taxCode,
      String bankAccount,
      LocalDate hireDate,
      LocalDate startDate,
      LocalDate endDate,
      String status
  ) {
  }

  public record Terminate(
      LocalDate endDate
  ) {
  }
}
