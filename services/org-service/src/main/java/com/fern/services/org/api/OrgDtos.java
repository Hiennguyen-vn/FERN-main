package com.fern.services.org.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public final class OrgDtos {

  private OrgDtos() {
  }

  public record RegionView(
      long id,
      String code,
      Long parentRegionId,
      String currencyCode,
      String name,
      String taxCode,
      String timezoneName
  ) {
  }

  public record OutletView(
      long id,
      long regionId,
      String code,
      String name,
      String status,
      String address,
      String phone,
      String email,
      LocalDate openedAt,
      LocalDate closedAt
  ) {
  }

  public record ExchangeRateView(
      String fromCurrencyCode,
      String toCurrencyCode,
      BigDecimal rate,
      LocalDate effectiveFrom,
      LocalDate effectiveTo,
      Instant updatedAt
  ) {
  }

  public record OrgHierarchyView(
      List<RegionView> regions,
      List<OutletView> outlets
  ) {
  }

  public record CreateOutletRequest(
      @NotNull Long regionId,
      @NotBlank String code,
      @NotBlank String name,
      String status,
      String address,
      String phone,
      String email,
      LocalDate openedAt,
      LocalDate closedAt
  ) {
  }

  public record UpdateExchangeRateRequest(
      @NotBlank String fromCurrencyCode,
      @NotBlank String toCurrencyCode,
      @NotNull BigDecimal rate,
      @NotNull LocalDate effectiveFrom,
      LocalDate effectiveTo
  ) {
  }
}
