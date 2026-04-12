package com.fern.services.hr.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.PermissionMatrix;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.hr.api.ShiftDto;
import com.fern.services.hr.infrastructure.ShiftRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShiftService {

  private static final String HR_SCHEDULE_PERMISSION = "hr.schedule";

  private final ShiftRepository shiftRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final PermissionMatrixService permissionMatrixService;

  public ShiftService(
      ShiftRepository shiftRepository,
      SnowflakeIdGenerator idGenerator,
      PermissionMatrixService permissionMatrixService
  ) {
    this.shiftRepository = shiftRepository;
    this.idGenerator = idGenerator;
    this.permissionMatrixService = permissionMatrixService;
  }

  @Transactional
  public ShiftDto createShift(ShiftDto.Create request) {
    validateTimes(request.startTime(), request.endTime());
    requireScheduleAccess(request.outletId(), true);
    if (request.code() != null && shiftRepository.existsByOutletIdAndCode(request.outletId(), request.code())) {
      throw ServiceException.conflict("Shift code already exists for outlet " + request.outletId());
    }
    long shiftId = idGenerator.generateId();
    shiftRepository.insert(
        shiftId,
        request.outletId(),
        trimToNull(request.code()),
        request.name().trim(),
        request.startTime(),
        request.endTime(),
        request.breakMinutes() == null ? 0 : request.breakMinutes()
    );
    return getShift(shiftId);
  }

  public ShiftDto getShift(long shiftId) {
    ShiftRepository.ShiftRecord record = shiftRepository.findById(shiftId)
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + shiftId));
    requireScheduleAccess(record.outletId(), false);
    return toDto(record);
  }

  public PagedResult<ShiftDto> listShiftsByOutlet(
      Long outletId,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    boolean admin = context.internalService() || context.hasRole("admin") || context.hasRole("superadmin");
    if (!admin && outletId == null) {
      throw ServiceException.forbidden("Outlet-scoped HR access is required");
    }
    if (outletId != null) {
      requireScheduleAccess(outletId, false);
    }
    return shiftRepository.findByOutletId(
            outletId,
            QueryConventions.normalizeQuery(q),
            sortBy,
            sortDir,
            QueryConventions.sanitizeLimit(limit, 50, 200),
            QueryConventions.sanitizeOffset(offset)
        )
        .map(this::toDto);
  }

  @Transactional
  public ShiftDto updateShift(long shiftId, ShiftDto.Update request) {
    ShiftRepository.ShiftRecord existing = shiftRepository.findById(shiftId)
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + shiftId));
    requireScheduleAccess(existing.outletId(), true);
    if (request.startTime() != null && request.endTime() != null) {
      validateTimes(request.startTime(), request.endTime());
    } else if (request.startTime() != null || request.endTime() != null) {
      validateTimes(
          request.startTime() == null ? existing.startTime() : request.startTime(),
          request.endTime() == null ? existing.endTime() : request.endTime()
      );
    }
    String nextCode = trimToNull(request.code());
    if (nextCode != null && shiftRepository.existsByOutletIdAndCodeExcluding(existing.outletId(), nextCode, shiftId)) {
      throw ServiceException.conflict("Shift code already exists for outlet " + existing.outletId());
    }
    shiftRepository.update(
        shiftId,
        nextCode,
        trimToNull(request.name()),
        request.startTime(),
        request.endTime(),
        request.breakMinutes()
    );
    return getShift(shiftId);
  }

  @Transactional
  public void deleteShift(long shiftId) {
    ShiftRepository.ShiftRecord existing = shiftRepository.findById(shiftId)
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + shiftId));
    requireScheduleAccess(existing.outletId(), true);
    shiftRepository.delete(shiftId);
  }

  public List<ShiftDto> listShiftsForDate(Long outletId, LocalDate date) {
    requireScheduleAccess(outletId, false);
    return shiftRepository.findAssignedByOutletAndDate(outletId, date).stream().map(this::toDto).toList();
  }

  private void requireScheduleAccess(Long outletId, boolean mutation) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    long userId = context.requireUserId();
    if (outletId == null) {
      if (mutation) {
        throw ServiceException.forbidden("Outlet-scoped HR access is required");
      }
      return;
    }
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    if (matrix.hasPermission(outletId, HR_SCHEDULE_PERMISSION)
        || matrix.rolesForOutlet(outletId).contains("admin")
        || matrix.rolesForOutlet(outletId).contains("outlet_manager")) {
      return;
    }
    if (!mutation && context.outletIds().contains(outletId)) {
      return;
    }
    throw ServiceException.forbidden("Missing HR schedule access for outlet " + outletId);
  }

  private static void validateTimes(java.time.LocalTime startTime, java.time.LocalTime endTime) {
    if (!endTime.isAfter(startTime)) {
      throw ServiceException.badRequest("Shift end_time must be after start_time");
    }
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private ShiftDto toDto(ShiftRepository.ShiftRecord record) {
    return new ShiftDto(
        record.id(),
        record.outletId(),
        record.code(),
        record.name(),
        record.startTime(),
        record.endTime(),
        record.breakMinutes(),
        record.deletedAt(),
        record.createdAt(),
        record.updatedAt()
    );
  }
}
