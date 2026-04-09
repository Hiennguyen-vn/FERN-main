package com.fern.services.audit.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.audit.application.AuditService;
import java.time.Instant;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/audit")
public class AuditReadController {

  private final AuditService auditService;

  public AuditReadController(AuditService auditService) {
    this.auditService = auditService;
  }

  @GetMapping("/security-events")
  public PagedResult<AuditDtos.SecurityEventView> listSecurityEvents(
      @RequestParam(required = false) String severity,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) Long actorUserId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant createdFrom,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant createdTo,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return auditService.listSecurityEvents(
        severity,
        q,
        actorUserId,
        createdFrom,
        createdTo,
        sortBy,
        sortDir,
        limit,
        offset);
  }

  @GetMapping("/traces")
  public PagedResult<AuditDtos.TraceView> listTraces(
      @RequestParam(required = false) String action,
      @RequestParam(required = false) String entityName,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) Long actorUserId,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant createdFrom,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant createdTo,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return auditService.listTraces(
        action,
        entityName,
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
