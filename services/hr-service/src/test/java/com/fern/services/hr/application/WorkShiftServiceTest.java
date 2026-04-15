package com.fern.services.hr.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.BusinessScopeAssignment;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.CanonicalRole;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.auth.ScopeType;
import com.fern.services.hr.api.WorkShiftDto;
import com.fern.services.hr.infrastructure.ShiftRepository;
import com.fern.services.hr.infrastructure.WorkShiftRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
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
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

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

    WorkShiftService service = new WorkShiftService(
        workShiftRepository,
        shiftRepository,
        idGenerator,
        permissionMatrixService,
        authorizationPolicyService
    );
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
    when(authorizationPolicyService.resolveUserProfile(9L))
        .thenReturn(profile(9L, assignment(CanonicalRole.OUTLET_MANAGER, 7L)));
    when(permissionMatrixService.load(9L)).thenReturn(new com.dorabets.common.spring.auth.PermissionMatrix(9L, java.util.Map.of(), java.util.Map.of()));
    when(authorizationPolicyService.canManageHrSchedule(any(RequestUserContext.class), org.mockito.ArgumentMatchers.eq(7L), org.mockito.ArgumentMatchers.eq(true)))
        .thenReturn(true);
    when(authorizationPolicyService.canManageHrSchedule(any(RequestUserContext.class), org.mockito.ArgumentMatchers.eq(7L), org.mockito.ArgumentMatchers.eq(false)))
        .thenReturn(true);

    WorkShiftService service = new WorkShiftService(
        workShiftRepository,
        shiftRepository,
        idGenerator,
        permissionMatrixService,
        authorizationPolicyService
    );
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

    WorkShiftService service = new WorkShiftService(
        workShiftRepository,
        shiftRepository,
        idGenerator,
        permissionMatrixService,
        authorizationPolicyService
    );

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
    when(authorizationPolicyService.resolveUserProfile(200L))
        .thenReturn(profile(200L));
    when(permissionMatrixService.load(200L)).thenReturn(new com.dorabets.common.spring.auth.PermissionMatrix(200L, java.util.Map.of(), java.util.Map.of()));

    WorkShiftService service = new WorkShiftService(
        workShiftRepository,
        shiftRepository,
        idGenerator,
        permissionMatrixService,
        authorizationPolicyService
    );

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

  private static BusinessUserProfile profile(long userId, BusinessScopeAssignment... assignments) {
    if (assignments.length == 0) {
      return new BusinessUserProfile(userId, Set.of(), List.of(), Set.of());
    }
    return new BusinessUserProfile(
        userId,
        Set.of(assignments[0].role()),
        List.of(assignments),
        assignments[0].outletIds()
    );
  }

  private static BusinessScopeAssignment assignment(CanonicalRole role, long outletId) {
    return new BusinessScopeAssignment(role, ScopeType.OUTLET, outletId, Long.toString(outletId), Set.of(outletId), Set.of(role.storedRoleCode()));
  }
}
