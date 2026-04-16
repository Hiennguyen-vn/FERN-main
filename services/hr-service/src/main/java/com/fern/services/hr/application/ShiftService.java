package com.fern.services.hr.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.CanonicalRole;
import com.dorabets.common.spring.auth.PermissionMatrix;
import com.dorabets.common.spring.auth.PermissionMatrixService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.hr.api.ShiftDto;
import com.fern.services.hr.infrastructure.ShiftRepository;
import com.fern.services.hr.infrastructure.ShiftRoleRequirementRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShiftService {

  private static final String HR_SCHEDULE_PERMISSION = "hr.schedule";
  private static final Set<String> VALID_DAYPARTS = Set.of("opening", "breakfast", "lunch_peak", "afternoon", "closing");
  private static final Set<String> VALID_WORK_ROLES = Set.of("cashier", "kitchen_staff", "prep", "support", "closing_support");

  private final ShiftRepository shiftRepository;
  private final ShiftRoleRequirementRepository roleRequirementRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final PermissionMatrixService permissionMatrixService;
  private final AuthorizationPolicyService authorizationPolicyService;

  public ShiftService(
      ShiftRepository shiftRepository,
      ShiftRoleRequirementRepository roleRequirementRepository,
      SnowflakeIdGenerator idGenerator,
      PermissionMatrixService permissionMatrixService,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.shiftRepository = shiftRepository;
    this.roleRequirementRepository = roleRequirementRepository;
    this.idGenerator = idGenerator;
    this.permissionMatrixService = permissionMatrixService;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  @Transactional
  public ShiftDto createShift(ShiftDto.Create request) {
    validateTimes(request.startTime(), request.endTime());
    requireScheduleAccess(request.outletId(), true);
    if (request.code() != null && shiftRepository.existsByOutletIdAndCode(request.outletId(), request.code())) {
      throw ServiceException.conflict("Shift code already exists for outlet " + request.outletId());
    }
    String daypart = validateDaypart(request.daypart());
    validateRoleRequirements(request.roleRequirements());
    long shiftId = idGenerator.generateId();
    shiftRepository.insert(
        shiftId,
        request.outletId(),
        trimToNull(request.code()),
        request.name().trim(),
        request.startTime(),
        request.endTime(),
        request.breakMinutes() == null ? 0 : request.breakMinutes(),
        daypart,
        request.headcountRequired() == null ? 1 : request.headcountRequired()
    );
    saveRoleRequirements(shiftId, request.roleRequirements());
    return getShift(shiftId);
  }

  public ShiftDto getShift(long shiftId) {
    ShiftRepository.ShiftRecord record = shiftRepository.findById(shiftId)
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + shiftId));
    requireScheduleAccess(record.outletId(), false);
    List<ShiftRoleRequirementRepository.RoleRequirementRecord> roles = roleRequirementRepository.findByShiftId(shiftId);
    return toDto(record, roles);
  }

  public PagedResult<ShiftDto> listShiftsByOutlet(
      Long outletId,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    Set<Long> scopedOutletIds = resolveSchedulingOutletIds(false);
    if (outletId != null) {
      requireScheduleAccess(outletId, false);
    }
    PagedResult<ShiftRepository.ShiftRecord> page = shiftRepository.findByOutletId(
        outletId,
        scopedOutletIds,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    );
    List<Long> shiftIds = page.items().stream().map(ShiftRepository.ShiftRecord::id).toList();
    Map<Long, List<ShiftRoleRequirementRepository.RoleRequirementRecord>> rolesByShift =
        roleRequirementRepository.findByShiftIds(shiftIds).stream()
            .collect(Collectors.groupingBy(ShiftRoleRequirementRepository.RoleRequirementRecord::shiftId));
    return page.map(record -> toDto(record, rolesByShift.getOrDefault(record.id(), List.of())));
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
    String daypart = request.daypart() != null ? validateDaypart(request.daypart()) : null;
    validateRoleRequirements(request.roleRequirements());
    shiftRepository.update(
        shiftId,
        nextCode,
        trimToNull(request.name()),
        request.startTime(),
        request.endTime(),
        request.breakMinutes(),
        daypart,
        request.headcountRequired()
    );
    if (request.roleRequirements() != null) {
      saveRoleRequirements(shiftId, request.roleRequirements());
    }
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
    List<ShiftRepository.ShiftRecord> records = shiftRepository.findAssignedByOutletAndDate(outletId, date);
    List<Long> shiftIds = records.stream().map(ShiftRepository.ShiftRecord::id).toList();
    Map<Long, List<ShiftRoleRequirementRepository.RoleRequirementRecord>> rolesByShift =
        roleRequirementRepository.findByShiftIds(shiftIds).stream()
            .collect(Collectors.groupingBy(ShiftRoleRequirementRepository.RoleRequirementRecord::shiftId));
    return records.stream().map(r -> toDto(r, rolesByShift.getOrDefault(r.id(), List.of()))).toList();
  }

  public List<ShiftDto> listAllShiftsByOutlet(long outletId) {
    requireScheduleAccess(outletId, false);
    List<ShiftRepository.ShiftRecord> records = shiftRepository.findByOutletIdAll(outletId);
    List<Long> shiftIds = records.stream().map(ShiftRepository.ShiftRecord::id).toList();
    Map<Long, List<ShiftRoleRequirementRepository.RoleRequirementRecord>> rolesByShift =
        roleRequirementRepository.findByShiftIds(shiftIds).stream()
            .collect(Collectors.groupingBy(ShiftRoleRequirementRepository.RoleRequirementRecord::shiftId));
    return records.stream().map(r -> toDto(r, rolesByShift.getOrDefault(r.id(), List.of()))).toList();
  }

  public List<ShiftDto.RoleRequirement> getRoleRequirements(long shiftId) {
    ShiftRepository.ShiftRecord record = shiftRepository.findById(shiftId)
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + shiftId));
    requireScheduleAccess(record.outletId(), false);
    return roleRequirementRepository.findByShiftId(shiftId).stream()
        .map(r -> new ShiftDto.RoleRequirement(r.workRole(), r.requiredCount(), r.isOptional()))
        .toList();
  }

  @Transactional
  public List<ShiftDto.RoleRequirement> setRoleRequirements(long shiftId, List<ShiftDto.RoleRequirement> requirements) {
    ShiftRepository.ShiftRecord record = shiftRepository.findById(shiftId)
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + shiftId));
    requireScheduleAccess(record.outletId(), true);
    validateRoleRequirements(requirements);
    saveRoleRequirements(shiftId, requirements);
    return getRoleRequirements(shiftId);
  }

  private void saveRoleRequirements(long shiftId, List<ShiftDto.RoleRequirement> requirements) {
    if (requirements == null || requirements.isEmpty()) {
      return;
    }
    roleRequirementRepository.deleteByShiftId(shiftId);
    for (ShiftDto.RoleRequirement req : requirements) {
      roleRequirementRepository.insert(
          idGenerator.generateId(),
          shiftId,
          req.workRole(),
          req.requiredCount(),
          req.isOptional()
      );
    }
  }

  private void requireScheduleAccess(Long outletId, boolean mutation) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
    }
    if (outletId == null) {
      if (!mutation) {
        return;
      }
      throw ServiceException.forbidden("Outlet-scoped HR access is required");
    }
    if (authorizationPolicyService.canManageHrSchedule(context, outletId, mutation)) {
      return;
    }
    throw ServiceException.forbidden("Missing HR schedule access for outlet " + outletId);
  }

  private Set<Long> resolveSchedulingOutletIds(boolean mutation) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return null;
    }
    long userId = context.requireUserId();
    BusinessUserProfile profile = authorizationPolicyService.resolveUserProfile(userId);
    if (profile.hasGlobalRole(CanonicalRole.SUPERADMIN)) {
      return null;
    }
    LinkedHashSet<Long> outletIds = new LinkedHashSet<>();
    outletIds.addAll(profile.outletsForRole(CanonicalRole.HR));
    outletIds.addAll(profile.outletsForRole(CanonicalRole.OUTLET_MANAGER));
    PermissionMatrix matrix = permissionMatrixService.load(userId);
    matrix.permissionsByOutlet().forEach((outletId, permissionCodes) -> {
      if (permissionCodes.contains(HR_SCHEDULE_PERMISSION)) {
        outletIds.add(outletId);
      }
    });
    if (!mutation && !context.outletIds().isEmpty()) {
      outletIds.addAll(context.outletIds());
    }
    if (outletIds.isEmpty() && mutation) {
      throw ServiceException.forbidden("Outlet-scoped HR access is required");
    }
    return outletIds.isEmpty() ? Set.of() : Set.copyOf(outletIds);
  }

  private static void validateTimes(java.time.LocalTime startTime, java.time.LocalTime endTime) {
    if (!endTime.isAfter(startTime)) {
      throw ServiceException.badRequest("Shift end_time must be after start_time");
    }
  }

  private static String validateDaypart(String daypart) {
    if (daypart == null || daypart.isBlank()) {
      return null;
    }
    String normalized = daypart.trim().toLowerCase();
    if (!VALID_DAYPARTS.contains(normalized)) {
      throw ServiceException.badRequest("Invalid daypart: " + daypart + ". Valid values: " + VALID_DAYPARTS);
    }
    return normalized;
  }

  private static void validateRoleRequirements(List<ShiftDto.RoleRequirement> requirements) {
    if (requirements == null) {
      return;
    }
    for (ShiftDto.RoleRequirement req : requirements) {
      if (req.workRole() == null || !VALID_WORK_ROLES.contains(req.workRole().trim().toLowerCase())) {
        throw ServiceException.badRequest("Invalid work_role: " + req.workRole() + ". Valid values: " + VALID_WORK_ROLES);
      }
    }
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private ShiftDto toDto(
      ShiftRepository.ShiftRecord record,
      List<ShiftRoleRequirementRepository.RoleRequirementRecord> roles
  ) {
    return new ShiftDto(
        record.id(),
        record.outletId(),
        record.code(),
        record.name(),
        record.startTime(),
        record.endTime(),
        record.breakMinutes(),
        record.daypart(),
        record.headcountRequired(),
        roles.stream()
            .map(r -> new ShiftDto.RoleRequirement(r.workRole(), r.requiredCount(), r.isOptional()))
            .toList(),
        record.deletedAt(),
        record.createdAt(),
        record.updatedAt()
    );
  }
}
