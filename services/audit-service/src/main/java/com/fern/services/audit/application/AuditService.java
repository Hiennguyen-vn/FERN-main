package com.fern.services.audit.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.audit.api.AuditDtos;
import com.fern.services.audit.infrastructure.AuditRepository;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class AuditService {

  private final AuditRepository auditRepository;

  public AuditService(AuditRepository auditRepository) {
    this.auditRepository = auditRepository;
  }

  public AuditDtos.AuditLogView getAuditLog(long auditLogId) {
    requireAuditRead();
    return auditRepository.findLog(auditLogId)
        .orElseThrow(() -> ServiceException.notFound("Audit log not found: " + auditLogId));
  }

  public PagedResult<AuditDtos.AuditLogView> listAuditLogs(
      String entityName,
      String entityId,
      String action,
      String q,
      Long actorUserId,
      Instant createdFrom,
      Instant createdTo,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    requireAuditRead();
    return auditRepository.listLogs(
        entityName,
        entityId,
        action,
        QueryConventions.normalizeQuery(q),
        actorUserId,
        createdFrom,
        createdTo,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<AuditDtos.SecurityEventView> listSecurityEvents(
      String severity,
      String q,
      Long actorUserId,
      Instant createdFrom,
      Instant createdTo,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    requireAuditRead();
    return auditRepository.listSecurityEvents(
        severity,
        QueryConventions.normalizeQuery(q),
        actorUserId,
        createdFrom,
        createdTo,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public PagedResult<AuditDtos.TraceView> listTraces(
      String action,
      String entityName,
      String q,
      Long actorUserId,
      Instant createdFrom,
      Instant createdTo,
      String sortBy,
      String sortDir,
      int limit,
      int offset
  ) {
    requireAuditRead();
    return auditRepository.listTraces(
        action,
        entityName,
        QueryConventions.normalizeQuery(q),
        actorUserId,
        createdFrom,
        createdTo,
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  private void requireAuditRead() {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    throw ServiceException.forbidden("Audit read access is required");
  }

  private int sanitizeLimit(int limit) {
    return QueryConventions.sanitizeLimit(limit, 100, 500);
  }

  private int sanitizeOffset(int offset) {
    return QueryConventions.sanitizeOffset(offset);
  }
}
