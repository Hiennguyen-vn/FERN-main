package com.fern.services.report.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.services.report.api.ReportDtos;
import com.fern.services.report.infrastructure.ReportRepository;
import java.time.LocalDate;
import org.springframework.stereotype.Service;

@Service
public class ReportService {

  private final ReportRepository reportRepository;

  public ReportService(ReportRepository reportRepository) {
    this.reportRepository = reportRepository;
  }

  public PagedResult<ReportDtos.SalesSummary> salesSummary(
      long outletId,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireOutletRead(outletId);
    return reportRepository.salesSummary(
        outletId,
        defaultStart(startDate),
        defaultEnd(endDate),
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    );
  }

  public PagedResult<ReportDtos.ExpenseSummary> expenseSummary(
      long outletId,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireOutletRead(outletId);
    return reportRepository.expenseSummary(
        outletId,
        defaultStart(startDate),
        defaultEnd(endDate),
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    );
  }

  public PagedResult<ReportDtos.InventoryMovementSummary> inventoryMovementSummary(
      long outletId,
      Long itemId,
      LocalDate startDate,
      LocalDate endDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireOutletRead(outletId);
    return reportRepository.inventoryMovementSummary(
        outletId,
        itemId,
        defaultStart(startDate),
        defaultEnd(endDate),
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    );
  }

  public PagedResult<ReportDtos.LowStockSnapshot> lowStock(
      long outletId,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    requireOutletRead(outletId);
    return reportRepository.lowStock(
        outletId,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        QueryConventions.sanitizeLimit(limit, 50, 200),
        QueryConventions.sanitizeOffset(offset)
    );
  }

  private void requireOutletRead(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    if (!context.outletIds().contains(outletId)) {
      throw ServiceException.forbidden("Report access denied for outlet " + outletId);
    }
  }

  private static LocalDate defaultStart(LocalDate startDate) {
    return startDate == null ? LocalDate.now().minusDays(30) : startDate;
  }

  private static LocalDate defaultEnd(LocalDate endDate) {
    return endDate == null ? LocalDate.now() : endDate;
  }
}
