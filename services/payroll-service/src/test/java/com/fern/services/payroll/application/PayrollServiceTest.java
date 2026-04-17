package com.fern.services.payroll.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.BusinessUserProfile;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.payroll.api.PayrollDtos;
import com.fern.services.payroll.infrastructure.HrServiceClient;
import com.fern.services.payroll.infrastructure.PayrollRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PayrollServiceTest {

  @Mock
  private PayrollRepository payrollRepository;
  @Mock
  private HrServiceClient hrServiceClient;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private TypedKafkaEventPublisher eventPublisher;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);
  private final SalaryCalculator salaryCalculator = new SalaryCalculator(160);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  private PayrollService service() {
    return new PayrollService(
        payrollRepository,
        hrServiceClient,
        salaryCalculator,
        idGenerator,
        eventPublisher,
        clock,
        authorizationPolicyService
    );
  }

  // ── calculateSalary tests ──────────────────────────────────────────────────

  @Test
  void calculateSalaryReturnsResultForHourlyWorker() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetScopeRecord(70L, 11L, 1002L, "VN", 3012L, null)
    ));
    when(payrollRepository.findTimesheet(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetRecord(
            70L, 11L, 3012L, null,
            BigDecimal.ZERO, new BigDecimal("80"), BigDecimal.ZERO, new BigDecimal("1.5"),
            0, BigDecimal.ZERO, null, Instant.now(), Instant.now()
        )
    ));
    when(hrServiceClient.fetchLatestContract(3012L)).thenReturn(Optional.of(
        new PayrollDtos.EmployeeContractSummary(3012L, "part_time", "hourly", new BigDecimal("50000"), "VND")
    ));

    PayrollDtos.CalculateSalaryResult result = service().calculateSalary(
        new PayrollDtos.CalculateSalaryRequest(70L, "VND")
    );

    assertEquals(new BigDecimal("4000000.00"), result.netSalary());
    assertEquals("hourly", result.breakdown().calculationMethod());
  }

  @Test
  void calculateSalaryReturnsResultForFullTimeMonthlyWithOvertime() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(71L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetScopeRecord(71L, 11L, 1002L, "VN", 3013L, null)
    ));
    when(payrollRepository.findTimesheet(71L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetRecord(
            71L, 11L, 3013L, null,
            new BigDecimal("22"), new BigDecimal("176"), new BigDecimal("8"), new BigDecimal("1.5"),
            0, BigDecimal.ZERO, null, Instant.now(), Instant.now()
        )
    ));
    when(hrServiceClient.fetchLatestContract(3013L)).thenReturn(Optional.of(
        new PayrollDtos.EmployeeContractSummary(3013L, "full_time", "monthly", new BigDecimal("16000000"), "VND")
    ));

    PayrollDtos.CalculateSalaryResult result = service().calculateSalary(
        new PayrollDtos.CalculateSalaryRequest(71L, "VND")
    );

    // overtimePay = 8 × (16000000/160) × 1.5 = 8 × 100000 × 1.5 = 1200000
    assertEquals(new BigDecimal("17200000.00"), result.netSalary());
    assertEquals("monthly_with_overtime", result.breakdown().calculationMethod());
  }

  @Test
  void calculateSalaryThrows400WhenNoActiveContract() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(72L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetScopeRecord(72L, 11L, 1002L, "VN", 3014L, null)
    ));
    when(payrollRepository.findTimesheet(72L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetRecord(
            72L, 11L, 3014L, null,
            BigDecimal.ZERO, new BigDecimal("80"), BigDecimal.ZERO, new BigDecimal("1.5"),
            0, BigDecimal.ZERO, null, Instant.now(), Instant.now()
        )
    ));
    when(hrServiceClient.fetchLatestContract(3014L)).thenReturn(Optional.empty());

    ServiceException ex = assertThrows(ServiceException.class, () ->
        service().calculateSalary(new PayrollDtos.CalculateSalaryRequest(72L, "VND"))
    );
    assertEquals(400, ex.getStatusCode());
  }

  @Test
  void generatePayrollAutoCalculatesWhenSalaryFieldsAbsent() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(80L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetScopeRecord(80L, 11L, 1002L, "VN", 3015L, null)
    ));
    when(payrollRepository.findPayrollByTimesheetId(80L)).thenReturn(Optional.empty());
    when(payrollRepository.findTimesheet(80L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetRecord(
            80L, 11L, 3015L, null,
            BigDecimal.ZERO, new BigDecimal("80"), BigDecimal.ZERO, new BigDecimal("1.5"),
            0, BigDecimal.ZERO, null, Instant.now(), Instant.now()
        )
    ));
    when(hrServiceClient.fetchLatestContract(3015L)).thenReturn(Optional.of(
        new PayrollDtos.EmployeeContractSummary(3015L, "part_time", "hourly", new BigDecimal("50000"), "VND")
    ));
    when(idGenerator.generateId()).thenReturn(999L);
    when(payrollRepository.insertPayroll(eq(999L), eq(80L), eq("VND"), eq(new BigDecimal("50000")), eq(new BigDecimal("4000000.00")), any()))
        .thenReturn(new PayrollRepository.PayrollRecord(
            999L, 80L, "VND", new BigDecimal("50000"), new BigDecimal("4000000.00"),
            "draft", null, null, null, null, Instant.now(), Instant.now()
        ));

    PayrollDtos.PayrollView result = service().generatePayroll(
        new PayrollDtos.GeneratePayrollRequest(80L, "VND", null, null, null)
    );

    assertEquals(new BigDecimal("4000000.00"), result.netSalary());
  }

  @Test
  void generatePayrollUsesManualOverrideWhenSalaryFieldsProvided() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(81L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetScopeRecord(81L, 11L, 1002L, "VN", 3016L, null)
    ));
    when(payrollRepository.findPayrollByTimesheetId(81L)).thenReturn(Optional.empty());
    when(idGenerator.generateId()).thenReturn(1000L);
    when(payrollRepository.insertPayroll(eq(1000L), eq(81L), eq("VND"), eq(new BigDecimal("20000000")), eq(new BigDecimal("18000000")), any()))
        .thenReturn(new PayrollRepository.PayrollRecord(
            1000L, 81L, "VND", new BigDecimal("20000000"), new BigDecimal("18000000"),
            "draft", null, null, null, null, Instant.now(), Instant.now()
        ));

    service().generatePayroll(
        new PayrollDtos.GeneratePayrollRequest(81L, "VND", new BigDecimal("20000000"), new BigDecimal("18000000"), null)
    );

    // hr-service must NOT be called when both salary fields are provided
    org.mockito.Mockito.verifyNoInteractions(hrServiceClient);
  }

  @Test
  void generatePayrollRejectsDuplicateTimesheet() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetScopeRecord(70L, 11L, 1002L, "US", 3012L, 2001L)
    ));
    when(payrollRepository.findPayrollByTimesheetId(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollRecord(
            1L,
            70L,
            "USD",
            BigDecimal.TEN,
            BigDecimal.TEN,
            "draft",
            null,
            null,
            null,
            null,
            Instant.now(),
            Instant.now()
        )
    ));

    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.generatePayroll(
        new PayrollDtos.GeneratePayrollRequest(70L, "USD", BigDecimal.TEN, BigDecimal.TEN, null)
    ));

    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void createTimesheetRejectsDuplicateUserInPayrollPeriod() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findPeriodScope(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollPeriodScopeRecord(70L, 1002L, "US")
    ));
    when(payrollRepository.findTimesheetByPeriodAndUser(70L, 3012L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetRecord(
            500L,
            70L,
            3012L,
            2001L,
            BigDecimal.ONE,
            BigDecimal.ONE,
            BigDecimal.ZERO,
            new BigDecimal("1.5"),
            0,
            BigDecimal.ZERO,
            null,
            Instant.now(),
            Instant.now()
        )
    ));

    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createTimesheet(
        new PayrollDtos.CreatePayrollTimesheetRequest(
            70L,
            3012L,
            2001L,
            BigDecimal.ONE,
            new BigDecimal("8.0"),
            BigDecimal.ZERO,
            new BigDecimal("1.5"),
            0,
            BigDecimal.ZERO
        )
    ));

    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void createTimesheetRejectsOutletOutsidePayrollRegionScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findPeriodScope(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollPeriodScopeRecord(70L, 1002L, "US")
    ));
    when(payrollRepository.findTimesheetByPeriodAndUser(70L, 3012L)).thenReturn(Optional.empty());
    when(payrollRepository.outletBelongsToRegionScope(2000L, 1002L)).thenReturn(false);

    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createTimesheet(
        new PayrollDtos.CreatePayrollTimesheetRequest(
            70L,
            3012L,
            2000L,
            BigDecimal.ONE,
            new BigDecimal("8.0"),
            BigDecimal.ZERO,
            new BigDecimal("1.5"),
            0,
            BigDecimal.ZERO
        )
    ));

    assertEquals(400, exception.getStatusCode());
  }

  @Test
  void createTimesheetRejectsUserWithoutOutletScope() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findPeriodScope(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollPeriodScopeRecord(70L, 1002L, "US")
    ));
    when(payrollRepository.findTimesheetByPeriodAndUser(70L, 3012L)).thenReturn(Optional.empty());
    when(payrollRepository.outletBelongsToRegionScope(2001L, 1002L)).thenReturn(true);
    when(payrollRepository.userHasOutletScope(3012L, 2001L)).thenReturn(false);

    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createTimesheet(
        new PayrollDtos.CreatePayrollTimesheetRequest(
            70L,
            3012L,
            2001L,
            BigDecimal.ONE,
            new BigDecimal("8.0"),
            BigDecimal.ZERO,
            new BigDecimal("1.5"),
            0,
            BigDecimal.ZERO
        )
    ));

    assertEquals(400, exception.getStatusCode());
  }

  @Test
  void generatePayrollRejectsMissingTimesheet() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheetScope(70L)).thenReturn(Optional.empty());

    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.generatePayroll(
        new PayrollDtos.GeneratePayrollRequest(70L, "USD", BigDecimal.TEN, BigDecimal.TEN, null)
    ));

    assertEquals(404, exception.getStatusCode());
  }

  @Test
  void approvePayrollPublishesEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));

    PayrollRepository.PayrollRecord payroll = new PayrollRepository.PayrollRecord(
        99L,
        88L,
        "USD",
        new BigDecimal("500.00"),
        new BigDecimal("450.00"),
        "approved",
        5L,
        Instant.parse("2026-03-27T00:00:00Z"),
        null,
        "approved",
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    );
    when(payrollRepository.findPayroll(99L)).thenReturn(Optional.of(new PayrollRepository.PayrollRecord(
        99L,
        88L,
        "USD",
        new BigDecimal("500.00"),
        new BigDecimal("450.00"),
        "draft",
        null,
        null,
        null,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    )));
    when(payrollRepository.findPayrollScope(99L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollScopeRecord(99L, 88L, 11L, 1002L, "US", 12L, 13L)
    ));
    when(payrollRepository.approvePayroll(99L, null)).thenReturn(
        new PayrollRepository.PayrollApprovalProjection(payroll, 11L, 12L, 13L)
    );

    PayrollService service = service();
    service.approvePayroll(99L);

    verify(eventPublisher).publish(
        eq("fern.payroll.payroll-approved"),
        eq("99"),
        eq("payroll.payroll-approved"),
        any()
    );
  }

  @Test
  void rejectPayrollUpdatesDraftRun() {
    RequestUserContextHolder.set(new RequestUserContext(
        5L, "finance", "sess-5", Set.of("finance"), Set.of(), Set.of(), true, false, null
    ));
    when(payrollRepository.findPayrollScope(99L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollScopeRecord(99L, 88L, 11L, 1002L, "US", 12L, 13L)
    ));
    when(authorizationPolicyService.canApprovePayroll(RequestUserContextHolder.get(), 1002L)).thenReturn(true);
    when(payrollRepository.findPayroll(99L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollRecord(
            99L,
            88L,
            "USD",
            new BigDecimal("500.00"),
            new BigDecimal("450.00"),
            "draft",
            null,
            null,
            null,
            null,
            Instant.parse("2026-03-27T00:00:00Z"),
            Instant.parse("2026-03-27T00:00:00Z")
        )
    ));
    when(payrollRepository.rejectPayroll(99L, 5L, "Missing evidence")).thenReturn(
        new PayrollRepository.PayrollRecord(
            99L,
            88L,
            "USD",
            new BigDecimal("500.00"),
            new BigDecimal("450.00"),
            "rejected",
            5L,
            null,
            null,
            "Rejection: Missing evidence",
            Instant.parse("2026-03-27T00:00:00Z"),
            Instant.parse("2026-03-27T00:05:00Z")
        )
    );

    PayrollService service = service();
    PayrollDtos.PayrollView result = service.rejectPayroll(99L, "Missing evidence");

    assertEquals("rejected", result.status());
    verify(payrollRepository).rejectPayroll(99L, 5L, "Missing evidence");
  }

  @Test
  void approvePayrollRejectsNonDraftRuns() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findPayrollScope(99L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollScopeRecord(99L, 88L, 11L, 1002L, "US", 12L, 13L)
    ));
    when(payrollRepository.findPayroll(99L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollRecord(
            99L,
            88L,
            "USD",
            new BigDecimal("500.00"),
            new BigDecimal("450.00"),
            "approved",
            5L,
            Instant.parse("2026-03-27T00:00:00Z"),
            null,
            "approved",
            Instant.parse("2026-03-27T00:00:00Z"),
            Instant.parse("2026-03-27T00:00:00Z")
        )
    ));

    PayrollService service = service();
    ServiceException exception = assertThrows(ServiceException.class, () -> service.approvePayroll(99L));

    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void createPeriodRejectsPayDateBeforeEndDate() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    PayrollService service = service();

    assertThrows(ServiceException.class, () -> service.createPeriod(new PayrollDtos.CreatePayrollPeriodRequest(
        7L,
        "2026-03 Payroll",
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        LocalDate.parse("2026-03-30"),
        null
    )));
  }

  @Test
  void createPeriodRejectsDuplicateRegionWindow() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findPeriodByRegionAndWindow(
        1002L,
        LocalDate.parse("2026-04-01"),
        LocalDate.parse("2026-04-30")
    )).thenReturn(Optional.of(new PayrollRepository.PayrollPeriodRecord(
        55L,
        1002L,
        "Existing payroll",
        LocalDate.parse("2026-04-01"),
        LocalDate.parse("2026-04-30"),
        LocalDate.parse("2026-05-05"),
        null,
        Instant.now(),
        Instant.now()
    )));

    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createPeriod(
        new PayrollDtos.CreatePayrollPeriodRequest(
            1002L,
            "Duplicate payroll",
            LocalDate.parse("2026-04-01"),
            LocalDate.parse("2026-04-30"),
            LocalDate.parse("2026-05-05"),
            null
        )
    ));

    assertEquals(409, exception.getStatusCode());
  }

  @Test
  void listPeriodsRejectsNonAdminUsers() {
    RequestUserContextHolder.set(new RequestUserContext(
        15L, "manager", "sess-15", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(authorizationPolicyService.resolveUserProfile(15L))
        .thenReturn(new BusinessUserProfile(15L, Set.of(), List.of(), Set.of(2000L)));
    PayrollService service = service();

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listPeriods(
        null,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-31"),
        null,
        null,
        null,
        20,
        0
    ));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listTimesheetsDelegatesFiltersAndCapsLimitForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.listTimesheets(null, 11L, 12L, 13L, null, null, null, 200, 0))
        .thenReturn(PagedResult.of(java.util.List.of(), 200, 0, 0));

    PayrollService service = service();
    service.listTimesheets(11L, 12L, 13L, null, null, null, 1000, null);

    verify(payrollRepository).listTimesheets(null, 11L, 12L, 13L, null, null, null, 200, 0);
  }

  @Test
  void listPayrollDelegatesStatusFilterForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.listPayroll(null, 11L, 12L, 13L, "approved", null, null, null, 50, 0))
        .thenReturn(PagedResult.of(java.util.List.of(), 50, 0, 0));

    PayrollService service = service();
    service.listPayroll(11L, 12L, 13L, "approved", null, null, null, null, null);

    verify(payrollRepository).listPayroll(null, 11L, 12L, 13L, "approved", null, null, null, 50, 0);
  }

  @Test
  void listPeriodsDelegatesLimitAndOffsetForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.listPeriods(null, 7L, LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-31"), null, null, null, 200, 5))
        .thenReturn(PagedResult.of(java.util.List.of(), 200, 5, 0));

    PayrollService service = service();
    service.listPeriods(7L, LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-31"), null, null, null, 1000, 5);

    verify(payrollRepository).listPeriods(null, 7L, LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-31"), null, null, null, 200, 5);
  }
}
