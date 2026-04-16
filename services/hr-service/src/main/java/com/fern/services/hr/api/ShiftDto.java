package com.fern.services.hr.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;

public record ShiftDto(
    long id,
    long outletId,
    String code,
    String name,
    LocalTime startTime,
    LocalTime endTime,
    int breakMinutes,
    String daypart,
    int headcountRequired,
    List<RoleRequirement> roleRequirements,
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
      @Min(0) Integer breakMinutes,
      String daypart,
      @Min(1) Integer headcountRequired,
      List<RoleRequirement> roleRequirements
  ) {
  }

  public record Update(
      String code,
      String name,
      LocalTime startTime,
      LocalTime endTime,
      @Min(0) Integer breakMinutes,
      String daypart,
      @Min(1) Integer headcountRequired,
      List<RoleRequirement> roleRequirements
  ) {
  }

  public record RoleRequirement(
      String workRole,
      @Min(0) int requiredCount,
      boolean isOptional
  ) {
  }
}
