package com.fern.services.audit.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.audit.infrastructure.AuditRepository;
import java.time.Instant;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AuditServiceTest {

  @Mock
  private AuditRepository auditRepository;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void listAuditLogsRejectsNonAdminUsers() {
    RequestUserContextHolder.set(new RequestUserContext(
        12L, "workflow.hcm.manager", "sess-12", Set.of("outlet_manager"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(authorizationPolicyService.canReadAudit(any())).thenReturn(false);
    AuditService service = new AuditService(auditRepository, authorizationPolicyService);

    ServiceException exception = assertThrows(ServiceException.class, () -> service.listAuditLogs(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        20,
        0
    ));

    assertEquals(403, exception.getStatusCode());
  }

  @Test
  void listAuditLogsDelegatesSanitizedLimitAndOffsetForAdmin() {
    RequestUserContextHolder.set(new RequestUserContext(
        1L, "workflow.admin", "sess-admin", Set.of("admin"), Set.of(), Set.of(2000L), true, false, null
    ));
    when(authorizationPolicyService.canReadAudit(any())).thenReturn(true);
    when(auditRepository.listLogs(
        "purchase_order",
        "7000",
        "approve",
        null,
        12L,
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-03-31T23:59:59Z"),
        null,
        null,
        500,
        5
    )).thenReturn(PagedResult.of(java.util.List.of(), 500, 5, 0));

    AuditService service = new AuditService(auditRepository, authorizationPolicyService);
    service.listAuditLogs(
        "purchase_order",
        "7000",
        "approve",
        null,
        12L,
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-03-31T23:59:59Z"),
        null,
        null,
        999,
        5
    );

    verify(auditRepository).listLogs(
        "purchase_order",
        "7000",
        "approve",
        null,
        12L,
        Instant.parse("2026-03-01T00:00:00Z"),
        Instant.parse("2026-03-31T23:59:59Z"),
        null,
        null,
        500,
        5
    );
  }
}
