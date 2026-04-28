package com.fern.services.report.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.web.PagedResult;
import com.fern.common.spring.web.QueryConventions;
import com.fern.services.report.api.ReportDtos;
import com.fern.services.report.infrastructure.ReportRepository;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ReportService {

  private final ReportRepository reportRepository;
  private final AuthorizationPolicyService authorizationPolicyService;

  public ReportService(ReportRepository reportRepository, AuthorizationPolicyService authorizationPolicyService) {
    this.reportRepository = reportRepository;
    this.authorizationPolicyService = authorizationPolicyService;
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

  public List<ReportDtos.DailyPnl> dailyPnl(long outletId, LocalDate startDate, LocalDate endDate) {
    requireOutletRead(outletId);
    return reportRepository.dailyPnl(outletId, defaultStart(startDate), defaultEnd(endDate));
  }

  public List<ReportDtos.TopSku> topSkus(long outletId, LocalDate startDate, LocalDate endDate, Integer limit) {
    requireOutletRead(outletId);
    int safe = limit == null || limit <= 0 ? 10 : Math.min(limit, 100);
    return reportRepository.topSkus(outletId, defaultStart(startDate), defaultEnd(endDate), safe);
  }

  public List<ReportDtos.StaffKpi> staffKpi(long outletId, LocalDate startDate, LocalDate endDate) {
    requireOutletRead(outletId);
    return reportRepository.staffKpi(outletId, defaultStart(startDate), defaultEnd(endDate));
  }

  public List<ReportDtos.CrossOutletCompare> crossOutletCompare(long regionId, LocalDate startDate, LocalDate endDate) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (context == null || !context.authenticated()) {
      throw ServiceException.forbidden("Cross-outlet report requires authentication");
    }
    return reportRepository.crossOutletCompare(regionId, defaultStart(startDate), defaultEnd(endDate));
  }

  private void requireOutletRead(long outletId) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (authorizationPolicyService.canReadReport(context, outletId)) {
      return;
    }
    throw ServiceException.forbidden("Report access denied for outlet " + outletId);
  }

  private static LocalDate defaultStart(LocalDate startDate) {
    return startDate == null ? LocalDate.now().minusDays(30) : startDate;
  }

  private static LocalDate defaultEnd(LocalDate endDate) {
    return endDate == null ? LocalDate.now() : endDate;
  }
}
