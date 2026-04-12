package com.fern.services.hr.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.hr.api.ShiftDto;
import com.fern.services.hr.infrastructure.ShiftRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ShiftServiceTest {

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
  void createShiftUsesSnowflakeAndReturnsPersistedRecord() {
    RequestUserContextHolder.set(new RequestUserContext(
        null,
        null,
        null,
        Set.of(),
        Set.of(),
        Set.of(),
        false,
        true,
        "inventory-service"
    ));
    when(idGenerator.generateId()).thenReturn(101L);
    when(shiftRepository.existsByOutletIdAndCode(10L, "MORNING")).thenReturn(false);
    when(shiftRepository.findById(101L)).thenReturn(java.util.Optional.of(
        new ShiftRepository.ShiftRecord(
            101L,
            10L,
            "MORNING",
            "Morning Shift",
            LocalTime.of(8, 0),
            LocalTime.of(16, 0),
            30,
            null,
            Instant.parse("2026-03-27T00:00:00Z"),
            Instant.parse("2026-03-27T00:00:00Z")
        )
    ));

    ShiftService service = new ShiftService(shiftRepository, idGenerator, permissionMatrixService);
    ShiftDto result = service.createShift(new ShiftDto.Create(
        10L,
        "MORNING",
        "Morning Shift",
        LocalTime.of(8, 0),
        LocalTime.of(16, 0),
        30
    ));

    assertEquals(101L, result.id());
    assertEquals(10L, result.outletId());
    verify(shiftRepository).insert(101L, 10L, "MORNING", "Morning Shift", LocalTime.of(8, 0), LocalTime.of(16, 0), 30);
  }

  @Test
  void createShiftRejectsInvalidTimeRange() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L,
        "manager",
        null,
        Set.of("admin"),
        Set.of(),
        Set.of(10L),
        true,
        false,
        null
    ));

    ShiftService service = new ShiftService(shiftRepository, idGenerator, permissionMatrixService);

    assertThrows(ServiceException.class, () -> service.createShift(new ShiftDto.Create(
        10L,
        "BROKEN",
        "Broken Shift",
        LocalTime.of(16, 0),
        LocalTime.of(8, 0),
        0
    )));
  }

  @Test
  void listShiftsRequiresOutletScopeForNonAdminUsers() {
    RequestUserContextHolder.set(new RequestUserContext(
        9L,
        "manager",
        null,
        Set.of("outlet_manager"),
        Set.of(),
        Set.of(10L),
        true,
        false,
        null
    ));

    ShiftService service = new ShiftService(shiftRepository, idGenerator, permissionMatrixService);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listShiftsByOutlet(
        null,
        null,
        null,
        null,
        20,
        0
    ));

    assertEquals(403, exception.getStatusCode());
  }
}
