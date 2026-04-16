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
import com.fern.services.hr.api.WorkShiftDto;
import com.fern.services.hr.infrastructure.ShiftRepository;
import com.fern.services.hr.infrastructure.WorkShiftRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkShiftService {

  private static final String HR_SCHEDULE_PERMISSION = "hr.schedule";
  private static final Set<String> ATTENDANCE_STATUSES = Set.of("pending", "present", "late", "absent", "leave");
  private static final Set<String> VALID_WORK_ROLES = Set.of("cashier", "kitchen_staff", "prep", "support", "closing_support");

  private final WorkShiftRepository workShiftRepository;
  private final ShiftRepository shiftRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final PermissionMatrixService permissionMatrixService;
  private final AuthorizationPolicyService authorizationPolicyService;

  public WorkShiftService(
      WorkShiftRepository workShiftRepository,
      ShiftRepository shiftRepository,
      SnowflakeIdGenerator idGenerator,
      PermissionMatrixService permissionMatrixService,
      AuthorizationPolicyService authorizationPolicyService
  ) {
    this.workShiftRepository = workShiftRepository;
    this.shiftRepository = shiftRepository;
    this.idGenerator = idGenerator;
    this.permissionMatrixService = permissionMatrixService;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  @Transactional
  public WorkShiftDto createWorkShift(WorkShiftDto.Create request) {
    ShiftRepository.ShiftRecord shift = shiftRepository.findById(request.shiftId())
        .orElseThrow(() -> ServiceException.notFound("Shift not found: " + request.shiftId()));
    requireScheduleAccess(shift.outletId(), true);
    if (workShiftRepository.existsAssignment(request.shiftId(), request.userId(), request.workDate())) {
      throw ServiceException.conflict("Work shift already exists for shift/user/date");
    }
    validateWorkRole(request.workRole());
    RequestUserContext context = RequestUserContextHolder.get();
    long workShiftId = idGenerator.generateId();
    workShiftRepository.insert(
        workShiftId,
        request.shiftId(),
        request.userId(),
        request.workDate(),
        trimToNull(request.workRole()),
        defaultEnum(request.scheduleStatus(), "scheduled"),
        defaultEnum(request.attendanceStatus(), "pending"),
        defaultEnum(request.approvalStatus(), "pending"),
        context.userId(),
        request.note()
    );
    return getWorkShift(workShiftId);
  }

  public WorkShiftDto getWorkShift(long workShiftId) {
    WorkShiftRepository.WorkShiftRecord record = workShiftRepository.findById(workShiftId)
        .orElseThrow(() -> ServiceException.notFound("Work shift not found: " + workShiftId));
    requireReadAccess(record);
    return toDto(record);
  }

  public PagedResult<WorkShiftDto> listWorkShifts(
      Long userId,
      Long outletId,
      String scheduleStatus,
      String attendanceStatus,
      String approvalStatus,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    Long resolvedUserId = userId;
    Long resolvedOutletId = outletId;
    Set<Long> scopedOutletIds = resolveSchedulingOutletIds(false);

    if (scopedOutletIds != null) {
      long currentUserId = context.requireUserId();
      boolean scheduler = !scopedOutletIds.isEmpty();
      if (!scheduler && resolvedUserId == null && resolvedOutletId == null) {
        resolvedUserId = currentUserId;
      }
      if (!scheduler && resolvedUserId != null && resolvedUserId != currentUserId) {
        throw ServiceException.forbidden("Cannot view another user's work shifts");
      }
      if (resolvedOutletId != null) {
        requireScheduleAccess(resolvedOutletId, false);
      }
    }
    LocalDate from = startDate == null ? LocalDate.now().minusMonths(1) : startDate;
    LocalDate to = endDate == null ? LocalDate.now().plusMonths(1) : endDate;
    return workShiftRepository.search(
            resolvedUserId,
            resolvedOutletId,
            scopedOutletIds,
            from,
            to,
            trimToNull(scheduleStatus),
            trimToNull(attendanceStatus),
            trimToNull(approvalStatus),
            QueryConventions.normalizeQuery(q),
            sortBy,
            sortDir,
            QueryConventions.sanitizeLimit(limit, 50, 200),
            QueryConventions.sanitizeOffset(offset)
        )
        .map(this::toDto);
  }

  public PagedResult<WorkShiftDto> listTimeOffRequests(
      Long userId,
      Long outletId,
      String approvalStatus,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return listWorkShifts(
        userId,
        outletId,
        null,
        "leave",
        approvalStatus,
        startDate,
        endDate,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  public List<WorkShiftDto> listWorkShiftsByOutlet(Long outletId, LocalDate date) {
    requireScheduleAccess(outletId, false);
    return workShiftRepository.findByOutletIdAndDate(outletId, date).stream().map(this::toDto).toList();
  }

  public List<WorkShiftRepository.StaffSummary> listOutletStaff(long outletId) {
    requireScheduleAccess(outletId, false);
    return workShiftRepository.findDistinctStaffByOutlet(outletId);
  }

  @Transactional
  public WorkShiftDto updateAttendance(long workShiftId, WorkShiftDto.AttendanceUpdate request) {
    WorkShiftRepository.WorkShiftRecord existing = workShiftRepository.findById(workShiftId)
        .orElseThrow(() -> ServiceException.notFound("Work shift not found: " + workShiftId));
    requireAttendanceMutationAccess(existing);
    if (request.actualStartTime() != null && request.actualEndTime() != null
        && request.actualEndTime().isBefore(request.actualStartTime())) {
      throw ServiceException.badRequest("actualEndTime must be after actualStartTime");
    }
    validateAttendanceStatus(request.attendanceStatus());
    workShiftRepository.updateAttendance(
        workShiftId,
        trimToNull(request.attendanceStatus()),
        request.actualStartTime(),
        request.actualEndTime(),
        trimToNull(request.note())
    );
    return getWorkShift(workShiftId);
  }

  @Transactional
  public WorkShiftDto approveWorkShift(long workShiftId) {
    WorkShiftRepository.WorkShiftRecord existing = workShiftRepository.findById(workShiftId)
        .orElseThrow(() -> ServiceException.notFound("Work shift not found: " + workShiftId));
    requireApprovalAccess(existing.outletId());
    workShiftRepository.approve(workShiftId, RequestUserContextHolder.get().userId());
    return getWorkShift(workShiftId);
  }

  @Transactional
  public WorkShiftDto rejectWorkShift(long workShiftId, String reason) {
    WorkShiftRepository.WorkShiftRecord existing = workShiftRepository.findById(workShiftId)
        .orElseThrow(() -> ServiceException.notFound("Work shift not found: " + workShiftId));
    requireApprovalAccess(existing.outletId());
    workShiftRepository.reject(workShiftId, RequestUserContextHolder.get().userId(), trimToNull(reason));
    return getWorkShift(workShiftId);
  }

  private void requireReadAccess(WorkShiftRepository.WorkShiftRecord record) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (resolveSchedulingOutletIds(false) == null) {
      return;
    }
    Long userId = context.userId();
    if (userId != null && userId == record.userId()) {
      return;
    }
    requireScheduleAccess(record.outletId(), false);
  }

  private void requireApprovalAccess(long outletId) {
    requireScheduleAccess(outletId, true);
  }

  private void requireAttendanceMutationAccess(WorkShiftRepository.WorkShiftRecord record) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (resolveSchedulingOutletIds(true) == null) {
      return;
    }
    Long userId = context.userId();
    if (userId != null && userId == record.userId()) {
      return;
    }
    requireScheduleAccess(record.outletId(), true);
  }

  private void requireScheduleAccess(long outletId, boolean mutation) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService()) {
      return;
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
    return outletIds.isEmpty() ? Set.of() : Set.copyOf(outletIds);
  }

  private static String defaultEnum(String value, String fallback) {
    String normalized = trimToNull(value);
    return normalized == null ? fallback : normalized;
  }

  private static void validateAttendanceStatus(String attendanceStatus) {
    String normalized = trimToNull(attendanceStatus);
    if (normalized == null) {
      return;
    }
    if (!ATTENDANCE_STATUSES.contains(normalized)) {
      throw ServiceException.badRequest("Unsupported attendanceStatus: " + normalized);
    }
  }

  private static void validateWorkRole(String workRole) {
    String normalized = trimToNull(workRole);
    if (normalized == null) {
      return;
    }
    if (!VALID_WORK_ROLES.contains(normalized)) {
      throw ServiceException.badRequest("Invalid work_role: " + normalized + ". Valid values: " + VALID_WORK_ROLES);
    }
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private WorkShiftDto toDto(WorkShiftRepository.WorkShiftRecord record) {
    return new WorkShiftDto(
        record.id(),
        record.shiftId(),
        record.userId(),
        record.outletId(),
        record.workDate(),
        record.workRole(),
        record.scheduleStatus(),
        record.attendanceStatus(),
        record.approvalStatus(),
        record.actualStartTime(),
        record.actualEndTime(),
        record.assignedByUserId(),
        record.approvedByUserId(),
        record.note(),
        record.createdAt(),
        record.updatedAt(),
        record.userFullName(),
        record.userUsername()
    );
  }
}
