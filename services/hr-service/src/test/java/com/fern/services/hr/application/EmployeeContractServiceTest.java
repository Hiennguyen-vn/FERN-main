package com.fern.services.hr.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.fern.services.hr.api.EmployeeContractDto;
import com.fern.services.hr.infrastructure.EmployeeContractRepository;
import com.natsu.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EmployeeContractServiceTest {

  @Mock
  private EmployeeContractRepository contractRepository;
  @Mock
  private SnowflakeIdGenerator idGenerator;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void createContractUsesSnowflakeAndDefaultStatus() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(authorizationPolicyService.canManageContractForUser(RequestUserContextHolder.get(), 200L, "VN")).thenReturn(true);
    when(idGenerator.generateId()).thenReturn(901L);
    when(contractRepository.findById(901L)).thenReturn(java.util.Optional.of(new EmployeeContractRepository.ContractRecord(
        901L,
        200L,
        "full_time",
        "monthly",
        new BigDecimal("1200.00"),
        "USD",
        "VN",
        null,
        null,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-27"),
        null,
        "draft",
        7L,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    )));

    EmployeeContractService service = new EmployeeContractService(contractRepository, idGenerator, authorizationPolicyService);
    EmployeeContractDto result = service.createContract(new EmployeeContractDto.Create(
        200L,
        "full_time",
        "monthly",
        new BigDecimal("1200.00"),
        "USD",
        "VN",
        null,
        null,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-27"),
        null,
        null
    ));

    verify(contractRepository).insert(
        901L,
        200L,
        "full_time",
        "monthly",
        new BigDecimal("1200.00"),
        "USD",
        "VN",
        null,
        null,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-27"),
        null,
        "draft",
        7L
    );
    assertEquals(901L, result.id());
    assertEquals("draft", result.status());
  }

  @Test
  void updateContractRejectsInvalidDates() {
    RequestUserContextHolder.set(new RequestUserContext(
        7L, "admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(authorizationPolicyService.canManageContractForUser(RequestUserContextHolder.get(), 200L, "VN")).thenReturn(true);
    when(contractRepository.findById(901L)).thenReturn(java.util.Optional.of(new EmployeeContractRepository.ContractRecord(
        901L,
        200L,
        "full_time",
        "monthly",
        new BigDecimal("1200.00"),
        "USD",
        "VN",
        null,
        null,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-27"),
        null,
        "active",
        7L,
        null,
        Instant.parse("2026-03-27T00:00:00Z"),
        Instant.parse("2026-03-27T00:00:00Z")
    )));

    EmployeeContractService service = new EmployeeContractService(contractRepository, idGenerator, authorizationPolicyService);

    assertThrows(ServiceException.class, () -> service.updateContract(901L, new EmployeeContractDto.Update(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        LocalDate.parse("2026-04-01"),
        LocalDate.parse("2026-03-31"),
        null
    )));
  }

  @Test
  void createContractRejectsWhenBusinessScopeIsMissing() {
    RequestUserContextHolder.set(new RequestUserContext(
        17L, "manager", "sess-17", Set.of("outlet_manager"), Set.of(), Set.of(10L), true, false, null
    ));
    when(authorizationPolicyService.canManageContractForUser(RequestUserContextHolder.get(), 200L, "VN")).thenReturn(false);

    EmployeeContractService service = new EmployeeContractService(contractRepository, idGenerator, authorizationPolicyService);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.createContract(new EmployeeContractDto.Create(
        200L,
        "full_time",
        "monthly",
        new BigDecimal("1200.00"),
        "USD",
        "VN",
        null,
        null,
        LocalDate.parse("2026-03-01"),
        LocalDate.parse("2026-03-27"),
        null,
        null
    )));

    assertEquals(403, exception.getStatusCode());
  }
}
