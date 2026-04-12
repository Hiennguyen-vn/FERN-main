package com.fern.services.hr.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.hr.api.WorkShiftDto;
import com.fern.services.hr.infrastructure.ShiftRepository;
import com.fern.services.hr.infrastructure.WorkShiftRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class WorkShiftServiceTest {

  @Mock
  private WorkShiftRepository workShiftRepository;
  @Mock
  private ShiftRepository shiftRepository;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private PermissionMatrixService permissionMatrixService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void createWorkShiftUsesSnowflakeAndDefaultStatuses() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "inventory-service"
    ));
    when(shiftRepository.findById(10L)).thenReturn(java.util.Optional.of(new ShiftRepository.ShiftRecord(
        10L,
        7L,
        "MORNING",
        "Morning Shift",
        LocalTime.of(8, 0),
        LocalTime.of(16, 0),
        30,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    )));
    when(workShiftRepository.existsAssignment(10L, 200L, LocalDate.parse("2026-03-28"))).thenReturn(false);
    when(idGenerator.generateId()).thenReturn(501L);
    when(workShiftRepository.findById(501L)).thenReturn(java.util.Optional.of(new WorkShiftRepository.WorkShiftRecord(
        501L,
        10L,
        200L,
        LocalDate.parse("2026-03-28"),
        "scheduled",
        "pending",
        "pending",
        null,
        null,
        null,
        null,
        "note",
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        7L
    )));

    WorkShiftService service = new WorkShiftService(workShiftRepository, shiftRepository, idGenerator, permissionMatrixService);
    WorkShiftDto result = service.createWorkShift(new WorkShiftDto.Create(
        10L,
        200L,
        LocalDate.parse("2026-03-28"),
        null,
        null,
        null,
        "note"
    ));

    verify(workShiftRepository).insert(501L, 10L, 200L, LocalDate.parse("2026-03-28"), "scheduled", "pending", "pending", null, "note");
    assertEquals(501L, result.id());
    assertEquals("scheduled", result.scheduleStatus());
  }

  @Test
  void approveWorkShiftDelegatesToRepository() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L, "manager", "sess-9", Set.of("admin"), Set.of(), Set.of(7L), true, false, null
    ));
    when(workShiftRepository.findById(501L)).thenReturn(java.util.Optional.of(new WorkShiftRepository.WorkShiftRecord(
        501L,
        10L,
        200L,
        LocalDate.parse("2026-03-28"),
        "scheduled",
        "pending",
        "pending",
        null,
        null,
        9L,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        7L
    ))).thenReturn(java.util.Optional.of(new WorkShiftRepository.WorkShiftRecord(
        501L,
        10L,
        200L,
        LocalDate.parse("2026-03-28"),
        "scheduled",
        "pending",
        "approved",
        null,
        null,
        9L,
        9L,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:05:00Z"),
        7L
    )));

    WorkShiftService service = new WorkShiftService(workShiftRepository, shiftRepository, idGenerator, permissionMatrixService);
    WorkShiftDto result = service.approveWorkShift(501L);

    verify(workShiftRepository).approve(501L, 9L);
    assertEquals("approved", result.approvalStatus());
  }

  @Test
  void updateAttendanceRejectsInvertedActualTimes() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "inventory-service"
    ));
    when(workShiftRepository.findById(501L)).thenReturn(java.util.Optional.of(new WorkShiftRepository.WorkShiftRecord(
        501L,
        10L,
        200L,
        LocalDate.parse("2026-03-28"),
        "scheduled",
        "pending",
        "pending",
        null,
        null,
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        7L
    )));

    WorkShiftService service = new WorkShiftService(workShiftRepository, shiftRepository, idGenerator, permissionMatrixService);

    assertThrows(ServiceException.class, () -> service.updateAttendance(
        501L,
        new WorkShiftDto.AttendanceUpdate(
            "present",
            Instant.parse("2026-03-28T10:00:00Z"),
            Instant.parse("2026-03-28T09:00:00Z"),
            null
        )
    ));
  }

  @Test
  void updateAttendanceRejectsUnsupportedAttendanceStatus() {
    RequestUserContextHolder.set(new RequestUserContext(
        200L,
        "cashier",
        null,
        Set.of("cashier"),
        Set.of(),
        Set.of(7L),
        true,
        false,
        null
    ));
    when(workShiftRepository.findById(501L)).thenReturn(java.util.Optional.of(new WorkShiftRepository.WorkShiftRecord(
        501L,
        10L,
        200L,
        LocalDate.parse("2026-03-28"),
        "scheduled",
        "pending",
        "pending",
        null,
        null,
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z"),
        7L
    )));

    WorkShiftService service = new WorkShiftService(workShiftRepository, shiftRepository, idGenerator, permissionMatrixService);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.updateAttendance(
        501L,
        new WorkShiftDto.AttendanceUpdate(
            "checked_in",
            null,
            null,
            null
        )
    ));

    assertEquals(400, exception.getStatusCode());
  }
}
