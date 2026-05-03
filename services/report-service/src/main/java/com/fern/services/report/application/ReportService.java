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
  private com.fern.services.report.infrastructure.ClickHouseReportRepository clickHouseRepo;
  private com.fern.services.report.infrastructure.ProjectionLagDetector lagDetector;

  public ReportService(ReportRepository reportRepository, AuthorizationPolicyService authorizationPolicyService) {
    this.reportRepository = reportRepository;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  public void setClickHouseRepo(com.fern.services.report.infrastructure.ClickHouseReportRepository repo) {
    this.clickHouseRepo = repo;
  }

  @org.springframework.beans.factory.annotation.Autowired(required = false)
  public void setLagDetector(com.fern.services.report.infrastructure.ProjectionLagDetector detector) {
    this.lagDetector = detector;
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
    LocalDate s = defaultStart(startDate);
    LocalDate e = defaultEnd(endDate);
    int safeLimit = QueryConventions.sanitizeLimit(limit, 50, 200);
    int safeOffset = QueryConventions.sanitizeOffset(offset);
    String normalizedQ = QueryConventions.normalizeQuery(q);
    boolean chEligible = (normalizedQ == null || normalizedQ.isBlank())
        && (sortBy == null || sortBy.isBlank());
    if (chEligible && clickHouseRepo != null && (lagDetector == null || !lagDetector.isLagged())) {
      try {
        return clickHouseRepo.salesSummaryPaged(outletId, s, e, safeLimit, safeOffset);
      } catch (RuntimeException ex) {
        // Fall through to Postgres on ClickHouse failure.
      }
    }
    return reportRepository.salesSummary(outletId, s, e, normalizedQ, sortBy, sortDir, safeLimit, safeOffset);
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
    LocalDate s = defaultStart(startDate);
    LocalDate e = defaultEnd(endDate);
    if (clickHouseRepo != null && (lagDetector == null || !lagDetector.isLagged())) {
      try {
        return clickHouseRepo.dailyPnl(outletId, s, e);
      } catch (RuntimeException ex) {
        // Fall through to Postgres on ClickHouse failure.
      }
    }
    return reportRepository.dailyPnl(outletId, s, e);
  }

  public List<ReportDtos.TopSku> topSkus(long outletId, LocalDate startDate, LocalDate endDate, Integer limit) {
    requireOutletRead(outletId);
    int safe = limit == null || limit <= 0 ? 10 : Math.min(limit, 100);
    LocalDate s = defaultStart(startDate);
    LocalDate e = defaultEnd(endDate);
    if (clickHouseRepo != null && (lagDetector == null || !lagDetector.isLagged())) {
      try {
        return clickHouseRepo.topSkus(outletId, s, e, safe);
      } catch (RuntimeException ex) {
        // Fall through to Postgres on ClickHouse failure.
      }
    }
    return reportRepository.topSkus(outletId, s, e, safe);
  }

  public List<ReportDtos.StaffKpi> staffKpi(long outletId, LocalDate startDate, LocalDate endDate) {
    requireOutletRead(outletId);
    return reportRepository.staffKpi(outletId, defaultStart(startDate), defaultEnd(endDate));
  }

  public List<ReportDtos.CrossOutletCompare> crossOutletCompare(long regionId, LocalDate startDate, LocalDate endDate) {
    RequestUserContext context = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canReadReportForRegion(context, regionId)) {
      throw ServiceException.forbidden("Cross-outlet report access denied for region " + regionId);
    }
    LocalDate s = defaultStart(startDate);
    LocalDate e = defaultEnd(endDate);
    if (clickHouseRepo != null && (lagDetector == null || !lagDetector.isLagged())) {
      try {
        return clickHouseRepo.crossOutletCompare(regionId, s, e);
      } catch (RuntimeException ex) {
        // Fall through to Postgres on ClickHouse failure.
      }
    }
    return reportRepository.crossOutletCompare(regionId, s, e);
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
