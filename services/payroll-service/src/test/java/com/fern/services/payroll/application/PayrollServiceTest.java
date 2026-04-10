package com.fern.services.payroll.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.payroll.api.PayrollDtos;
import com.fern.services.payroll.infrastructure.PayrollRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
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
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private TypedKafkaEventPublisher eventPublisher;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void generatePayrollRejectsDuplicateTimesheet() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.findTimesheet(70L)).thenReturn(Optional.of(
        new PayrollRepository.PayrollTimesheetRecord(
            70L,
            11L,
            3012L,
            2001L,
            BigDecimal.ONE,
            new BigDecimal("8.0"),
            BigDecimal.ZERO,
            new BigDecimal("1.5"),
            0,
            BigDecimal.ZERO,
            null,
            Instant.now(),
            Instant.now()
        )
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

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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
    when(payrollRepository.findTimesheet(70L)).thenReturn(Optional.empty());

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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
    when(payrollRepository.approvePayroll(99L, null)).thenReturn(
        new PayrollRepository.PayrollApprovalProjection(payroll, 11L, 12L, 13L)
    );

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);
    service.approvePayroll(99L);

    verify(eventPublisher).publish(
        eq("fern.payroll.payroll-approved"),
        eq("99"),
        eq("payroll.payroll-approved"),
        any()
    );
  }

  @Test
  void createPeriodRejectsPayDateBeforeEndDate() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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
    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);

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
    when(payrollRepository.listTimesheets(11L, 12L, 13L, null, null, null, 200, 0))
        .thenReturn(PagedResult.of(java.util.List.of(), 200, 0, 0));

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);
    service.listTimesheets(11L, 12L, 13L, null, null, null, 1000, null);

    verify(payrollRepository).listTimesheets(11L, 12L, 13L, null, null, null, 200, 0);
  }

  @Test
  void listPayrollDelegatesStatusFilterForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.listPayroll(11L, 12L, 13L, "approved", null, null, null, 50, 0))
        .thenReturn(PagedResult.of(java.util.List.of(), 50, 0, 0));

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);
    service.listPayroll(11L, 12L, 13L, "approved", null, null, null, null, null);

    verify(payrollRepository).listPayroll(11L, 12L, 13L, "approved", null, null, null, 50, 0);
  }

  @Test
  void listPeriodsDelegatesLimitAndOffsetForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        null, null, null, Set.of(), Set.of(), Set.of(), false, true, "finance-service"
    ));
    when(payrollRepository.listPeriods(7L, LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-31"), null, null, null, 200, 5))
        .thenReturn(PagedResult.of(java.util.List.of(), 200, 5, 0));

    PayrollService service = new PayrollService(payrollRepository, idGenerator, eventPublisher, clock);
    service.listPeriods(7L, LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-31"), null, null, null, 1000, 5);

    verify(payrollRepository).listPeriods(7L, LocalDate.parse("2026-03-01"), LocalDate.parse("2026-03-31"), null, null, null, 200, 5);
  }
}
