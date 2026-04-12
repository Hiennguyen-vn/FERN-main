package com.fern.services.payroll.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.payroll.PayrollApprovedEvent;
import com.fern.services.payroll.api.PayrollDtos;
import com.fern.services.payroll.infrastructure.HrServiceClient;
import com.fern.services.payroll.infrastructure.PayrollRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import org.springframework.stereotype.Service;

@Service
public class PayrollService {

  private final PayrollRepository payrollRepository;
  private final HrServiceClient hrServiceClient;
  private final SnowflakeIdGenerator idGenerator;
  private final TypedKafkaEventPublisher eventPublisher;
  private final Clock clock;

  public PayrollService(
      PayrollRepository payrollRepository,
      HrServiceClient hrServiceClient,
      SnowflakeIdGenerator idGenerator,
      TypedKafkaEventPublisher eventPublisher,
      Clock clock
  ) {
    this.payrollRepository = payrollRepository;
    this.hrServiceClient = hrServiceClient;
    this.idGenerator = idGenerator;
    this.eventPublisher = eventPublisher;
    this.clock = clock;
  }

  public PayrollDtos.PayrollPeriodView createPeriod(PayrollDtos.CreatePayrollPeriodRequest request) {
    requirePayrollAdmin();
    validatePeriodDates(request.startDate(), request.endDate(), request.payDate());
    if (payrollRepository.findPeriodByRegionAndWindow(request.regionId(), request.startDate(), request.endDate()).isPresent()) {
      throw ServiceException.conflict(
          "Payroll period already exists for region " + request.regionId()
              + " between " + request.startDate() + " and " + request.endDate()
      );
    }
    long periodId = idGenerator.generateId();
    payrollRepository.insertPeriod(
        periodId,
        request.regionId(),
        request.name().trim(),
        request.startDate(),
        request.endDate(),
        request.payDate(),
        trimToNull(request.note())
    );
    return getPeriod(periodId);
  }

  public PayrollDtos.PayrollPeriodView getPeriod(long periodId) {
    requirePayrollAdmin();
    return payrollRepository.findPeriod(periodId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("Payroll period not found: " + periodId));
  }

  public PagedResult<PayrollDtos.PayrollPeriodView> listPeriods(
      Long regionId,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requirePayrollAdmin();
    return payrollRepository.listPeriods(
            regionId,
            startDate,
            endDate,
            QueryConventions.normalizeQuery(q),
            sortBy,
            sortDir,
            sanitizeLimit(limit),
            sanitizeOffset(offset)
        ).map(this::toDto);
  }

  public PayrollDtos.PayrollTimesheetView createTimesheet(PayrollDtos.CreatePayrollTimesheetRequest request) {
    requirePayrollAdmin();
    PayrollRepository.PayrollPeriodScopeRecord period = payrollRepository.findPeriodScope(request.payrollPeriodId())
        .orElseThrow(() -> ServiceException.notFound("Payroll period not found: " + request.payrollPeriodId()));
    if (payrollRepository.findTimesheetByPeriodAndUser(request.payrollPeriodId(), request.userId()).isPresent()) {
      throw ServiceException.conflict(
          "Timesheet already exists for user " + request.userId() + " in payroll period " + request.payrollPeriodId()
      );
    }
    if (request.outletId() != null) {
      if (!payrollRepository.outletBelongsToRegionScope(request.outletId(), period.regionId())) {
        throw ServiceException.badRequest(
            "Selected outlet " + request.outletId() + " is outside payroll period scope " + period.regionCode()
        );
      }
      if (!payrollRepository.userHasOutletScope(request.userId(), request.outletId())) {
        throw ServiceException.badRequest(
            "User " + request.userId() + " is not assigned to outlet " + request.outletId()
        );
      }
    }
    long timesheetId = idGenerator.generateId();
    payrollRepository.insertTimesheet(
        timesheetId,
        request.payrollPeriodId(),
        request.userId(),
        request.outletId(),
        request.workDays(),
        request.workHours(),
        request.overtimeHours(),
        request.overtimeRate(),
        request.lateCount(),
        request.absentDays(),
        RequestUserContextHolder.get().userId()
    );
    return getTimesheet(timesheetId);
  }

  /**
   * Fetches approved work shifts for the employee from hr-service, aggregates attendance data,
   * and creates the payroll_timesheet record — all in one server-side operation.
   *
   * <p>Aggregation rules (mirrors what payroll clerks would do manually):
   * <ul>
   *   <li>workDays  = number of shifts where attendanceStatus != 'absent'</li>
   *   <li>workHours = sum of (actualEndTime - actualStartTime) in hours for present shifts;
   *                   falls back to 0 h for shifts without clock-in/out data</li>
   *   <li>lateCount = count of shifts where attendanceStatus == 'late'</li>
   *   <li>absentDays = count of shifts where attendanceStatus == 'absent'</li>
   *   <li>overtimeHours = 0 by default (OT is rarely captured in basic shift records)</li>
   * </ul>
   */
  public PayrollDtos.PayrollTimesheetView importFromAttendance(
      PayrollDtos.ImportFromAttendanceRequest request
  ) {
    requirePayrollAdmin();

    PayrollRepository.PayrollPeriodRecord period = payrollRepository
        .findPeriod(request.payrollPeriodId())
        .orElseThrow(() -> ServiceException.notFound(
            "Payroll period not found: " + request.payrollPeriodId()));

    PayrollRepository.PayrollPeriodScopeRecord periodScope = payrollRepository
        .findPeriodScope(request.payrollPeriodId())
        .orElseThrow(() -> ServiceException.notFound(
            "Payroll period scope not found: " + request.payrollPeriodId()));

    if (payrollRepository.findTimesheetByPeriodAndUser(
        request.payrollPeriodId(), request.userId()).isPresent()) {
      throw ServiceException.conflict(
          "Timesheet already exists for user " + request.userId()
              + " in payroll period " + request.payrollPeriodId());
    }

    if (request.outletId() != null) {
      if (!payrollRepository.outletBelongsToRegionScope(request.outletId(), periodScope.regionId())) {
        throw ServiceException.badRequest(
            "Outlet " + request.outletId()
                + " is outside payroll period scope " + periodScope.regionCode());
      }
      if (!payrollRepository.userHasOutletScope(request.userId(), request.outletId())) {
        throw ServiceException.badRequest(
            "User " + request.userId()
                + " is not assigned to outlet " + request.outletId());
      }
    }

    // Fetch approved shifts from hr-service (internal call — no permission gate)
    java.util.List<PayrollDtos.WorkShiftSummaryItem> shifts = hrServiceClient.fetchApprovedShifts(
        request.userId(),
        request.outletId(),
        period.startDate(),
        period.endDate()
    );

    if (shifts.isEmpty()) {
      throw ServiceException.badRequest(
          "No approved work shifts found for user " + request.userId()
              + " between " + period.startDate() + " and " + period.endDate());
    }

    // Aggregate attendance metrics
    int workDaysCount = 0;
    double workHoursSum = 0.0;
    int lateCountSum = 0;
    int absentDaysCount = 0;

    for (PayrollDtos.WorkShiftSummaryItem shift : shifts) {
      String status = shift.attendanceStatus() == null
          ? "" : shift.attendanceStatus().toLowerCase().trim();

      if ("absent".equals(status)) {
        absentDaysCount++;
        continue;
      }

      workDaysCount++;
      if ("late".equals(status)) {
        lateCountSum++;
      }

      // Hours: prefer explicit totalHours field, then derive from clock-in/out timestamps
      if (shift.totalHours() != null && shift.totalHours() > 0) {
        workHoursSum += shift.totalHours();
      } else if (shift.actualStartTime() != null && shift.actualEndTime() != null) {
        try {
          Instant start = Instant.parse(shift.actualStartTime());
          Instant end = Instant.parse(shift.actualEndTime());
          double hours = Duration.between(start, end).toSeconds() / 3600.0;
          if (hours > 0) {
            workHoursSum += hours;
          }
        } catch (Exception ignored) {
          // malformed timestamp — skip hours for this shift, count the day
        }
      }
    }

    // Round to 2 decimal places for cleaner DB storage
    BigDecimal workDays = BigDecimal.valueOf(workDaysCount);
    BigDecimal workHours = BigDecimal.valueOf(Math.round(workHoursSum * 100) / 100.0);
    BigDecimal overtimeHours = BigDecimal.ZERO;
    BigDecimal overtimeRate = request.overtimeRate() != null
        ? request.overtimeRate() : new BigDecimal("1.50");
    BigDecimal absentDays = BigDecimal.valueOf(absentDaysCount);

    long timesheetId = idGenerator.generateId();
    payrollRepository.insertTimesheet(
        timesheetId,
        request.payrollPeriodId(),
        request.userId(),
        request.outletId(),
        workDays,
        workHours,
        overtimeHours,
        overtimeRate,
        lateCountSum,
        absentDays,
        RequestUserContextHolder.get().userId()
    );

    return getTimesheet(timesheetId);
  }

  public PayrollDtos.PayrollTimesheetView getTimesheet(long timesheetId) {
    requirePayrollAdmin();
    return payrollRepository.findTimesheet(timesheetId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("Payroll timesheet not found: " + timesheetId));
  }

  public PagedResult<PayrollDtos.PayrollTimesheetListItemView> listTimesheets(
      Long payrollPeriodId,
      Long userId,
      Long outletId,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requirePayrollAdmin();
    return payrollRepository.listTimesheets(
            payrollPeriodId,
            userId,
            outletId,
            QueryConventions.normalizeQuery(q),
            sortBy,
            sortDir,
            sanitizeLimit(limit),
            sanitizeOffset(offset)
        ).map(this::toListDto);
  }

  public PayrollDtos.PayrollView generatePayroll(PayrollDtos.GeneratePayrollRequest request) {
    requirePayrollAdmin();
    if (payrollRepository.findTimesheet(request.payrollTimesheetId()).isEmpty()) {
      throw ServiceException.notFound("Payroll timesheet not found: " + request.payrollTimesheetId());
    }
    if (payrollRepository.findPayrollByTimesheetId(request.payrollTimesheetId()).isPresent()) {
      throw ServiceException.conflict("Payroll already exists for timesheet " + request.payrollTimesheetId());
    }
    long payrollId = idGenerator.generateId();
    PayrollRepository.PayrollRecord record = payrollRepository.insertPayroll(
        payrollId,
        request.payrollTimesheetId(),
        request.currencyCode().trim(),
        request.baseSalaryAmount(),
        request.netSalary(),
        trimToNull(request.note())
    );
    return toDto(record);
  }

  public PayrollDtos.PayrollView getPayroll(long payrollId) {
    requirePayrollAdmin();
    return payrollRepository.findPayroll(payrollId)
        .map(this::toDto)
        .orElseThrow(() -> ServiceException.notFound("Payroll not found: " + payrollId));
  }

  public PagedResult<PayrollDtos.PayrollListItemView> listPayroll(
      Long payrollPeriodId,
      Long userId,
      Long outletId,
      String status,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requirePayrollAdmin();
    return payrollRepository.listPayroll(
            payrollPeriodId,
            userId,
            outletId,
            status,
            QueryConventions.normalizeQuery(q),
            sortBy,
            sortDir,
            sanitizeLimit(limit),
            sanitizeOffset(offset)
        ).map(this::toListDto);
  }

  public PayrollDtos.PayrollView approvePayroll(long payrollId) {
    requirePayrollAdmin();
    PayrollRepository.PayrollRecord existing = payrollRepository.findPayroll(payrollId)
        .orElseThrow(() -> ServiceException.notFound("Payroll not found: " + payrollId));
    if (!"draft".equalsIgnoreCase(existing.status())) {
      throw ServiceException.conflict("Only draft payroll runs can be approved");
    }
    PayrollRepository.PayrollApprovalProjection projection = payrollRepository.approvePayroll(
        payrollId,
        RequestUserContextHolder.get().userId()
    );
    eventPublisher.publish(
        "fern.payroll.payroll-approved",
        Long.toString(projection.payroll().id()),
        "payroll.payroll-approved",
        new PayrollApprovedEvent(
            projection.payroll().id(),
            projection.userId(),
            projection.payrollPeriodId(),
            projection.outletId(),
            projection.payroll().currencyCode(),
            projection.payroll().netSalary(),
            projection.payroll().approvedAt() == null ? clock.instant() : projection.payroll().approvedAt()
        )
    );
    return toDto(projection.payroll());
  }

  public PayrollDtos.PayrollView rejectPayroll(long payrollId, String reason) {
    requirePayrollAdmin();
    PayrollRepository.PayrollRecord existing = payrollRepository.findPayroll(payrollId)
        .orElseThrow(() -> ServiceException.notFound("Payroll not found: " + payrollId));
    if (!"draft".equalsIgnoreCase(existing.status())) {
      throw ServiceException.conflict("Only draft payroll runs can be rejected");
    }
    PayrollRepository.PayrollRecord rejected = payrollRepository.rejectPayroll(
        payrollId,
        RequestUserContextHolder.get().userId(),
        trimToNull(reason)
    );
    return toDto(rejected);
  }

  private void requirePayrollAdmin() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    throw ServiceException.forbidden("Payroll administration access is required");
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 200);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }

  private static void validatePeriodDates(LocalDate startDate, LocalDate endDate, LocalDate payDate) {
    if (endDate.isBefore(startDate)) {
      throw ServiceException.badRequest("Payroll period endDate must be on or after startDate");
    }
    if (payDate != null && payDate.isBefore(endDate)) {
      throw ServiceException.badRequest("Payroll payDate must be on or after endDate");
    }
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private PayrollDtos.PayrollPeriodView toDto(PayrollRepository.PayrollPeriodRecord record) {
    return new PayrollDtos.PayrollPeriodView(
        Long.toString(record.id()),
        record.regionId(),
        record.name(),
        record.startDate(),
        record.endDate(),
        record.payDate(),
        record.note(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private PayrollDtos.PayrollTimesheetView toDto(PayrollRepository.PayrollTimesheetRecord record) {
    return new PayrollDtos.PayrollTimesheetView(
        Long.toString(record.id()),
        Long.toString(record.payrollPeriodId()),
        record.userId(),
        record.outletId(),
        record.workDays(),
        record.workHours(),
        record.overtimeHours(),
        record.overtimeRate(),
        record.lateCount(),
        record.absentDays(),
        record.approvedByUserId(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private PayrollDtos.PayrollTimesheetListItemView toListDto(PayrollRepository.PayrollTimesheetListItemRecord record) {
    return new PayrollDtos.PayrollTimesheetListItemView(
        Long.toString(record.id()),
        Long.toString(record.payrollPeriodId()),
        record.payrollPeriodName(),
        record.payrollPeriodStartDate(),
        record.payrollPeriodEndDate(),
        record.userId(),
        record.outletId(),
        record.workDays(),
        record.workHours(),
        record.overtimeHours(),
        record.overtimeRate(),
        record.lateCount(),
        record.absentDays(),
        record.approvedByUserId(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private PayrollDtos.PayrollView toDto(PayrollRepository.PayrollRecord record) {
    return new PayrollDtos.PayrollView(
        Long.toString(record.id()),
        Long.toString(record.payrollTimesheetId()),
        record.currencyCode(),
        record.baseSalaryAmount(),
        record.netSalary(),
        record.status(),
        record.approvedByUserId(),
        record.approvedAt(),
        record.paymentRef(),
        record.note(),
        record.createdAt(),
        record.updatedAt()
    );
  }

  private PayrollDtos.PayrollListItemView toListDto(PayrollRepository.PayrollListItemRecord record) {
    return new PayrollDtos.PayrollListItemView(
        Long.toString(record.id()),
        Long.toString(record.payrollTimesheetId()),
        Long.toString(record.payrollPeriodId()),
        record.payrollPeriodName(),
        record.userId(),
        record.outletId(),
        record.currencyCode(),
        record.baseSalaryAmount(),
        record.netSalary(),
        record.status(),
        record.approvedByUserId(),
        record.approvedAt(),
        record.paymentRef(),
        record.note(),
        record.createdAt(),
        record.updatedAt()
    );
  }
}
