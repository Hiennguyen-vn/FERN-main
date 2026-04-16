package com.fern.services.hr.api;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalDate;

public record WorkShiftDto(
    long id,
    long shiftId,
    long userId,
    long outletId,
    LocalDate workDate,
    String workRole,
    String scheduleStatus,
    String attendanceStatus,
    String approvalStatus,
    Instant actualStartTime,
    Instant actualEndTime,
    Long assignedByUserId,
    Long approvedByUserId,
    String note,
    Instant createdAt,
    Instant updatedAt
) {

  public record Create(
      @NotNull Long shiftId,
      @NotNull Long userId,
      @NotNull LocalDate workDate,
      String workRole,
      String scheduleStatus,
      String attendanceStatus,
      String approvalStatus,
      String note
  ) {
  }

  public record AttendanceUpdate(
      String attendanceStatus,
      Instant actualStartTime,
      Instant actualEndTime,
      String note
  ) {
  }

  public record ApprovalDecision(
      String reason
  ) {
  }
}
