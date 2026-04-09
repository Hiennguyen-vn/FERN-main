package com.fern.services.hr.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalTime;

public record ShiftDto(
    long id,
    long outletId,
    String code,
    String name,
    LocalTime startTime,
    LocalTime endTime,
    int breakMinutes,
    Instant deletedAt,
    Instant createdAt,
    Instant updatedAt
) {

  public record Create(
      @NotNull Long outletId,
      String code,
      @NotBlank String name,
      @NotNull LocalTime startTime,
      @NotNull LocalTime endTime,
      @Min(0) Integer breakMinutes
  ) {
  }

  public record Update(
      String code,
      String name,
      LocalTime startTime,
      LocalTime endTime,
      @Min(0) Integer breakMinutes
  ) {
  }
}
