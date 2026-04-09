package com.fern.services.audit.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.audit.application.AuditService;
import java.time.Instant;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/audit/logs")
public class AuditController {

  private final AuditService auditService;

  public AuditController(AuditService auditService) {
    this.auditService = auditService;
  }

  @GetMapping("/{auditLogId}")
  public AuditDtos.AuditLogView getAuditLog(@PathVariable long auditLogId) {
    return auditService.getAuditLog(auditLogId);
  }

  @GetMapping
  public PagedResult<AuditDtos.AuditLogView> listAuditLogs(
      @RequestParam(required = false) String entityName,
      @RequestParam(required = false) String entityId,
      @RequestParam(required = false) String action,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) Long actorUserId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant createdFrom,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant createdTo,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return auditService.listAuditLogs(
        entityName,
        entityId,
        action,
        q,
        actorUserId,
        createdFrom,
        createdTo,
        sortBy,
        sortDir,
        limit,
        offset);
  }
}
