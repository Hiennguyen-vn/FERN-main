package com.fern.services.report.api;

import com.fern.common.spring.web.PagedResult;
import com.fern.services.report.application.ReportService;
import java.time.LocalDate;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/reports")
public class ReportController {

  private final ReportService reportService;

  public ReportController(ReportService reportService) {
    this.reportService = reportService;
  }

  @GetMapping("/sales")
  public PagedResult<ReportDtos.SalesSummary> salesSummary(
      @RequestParam long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return reportService.salesSummary(outletId, startDate, endDate, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/expenses")
  public PagedResult<ReportDtos.ExpenseSummary> expenseSummary(
      @RequestParam long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return reportService.expenseSummary(outletId, startDate, endDate, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/inventory-movements")
  public PagedResult<ReportDtos.InventoryMovementSummary> inventoryMovementSummary(
      @RequestParam long outletId,
      @RequestParam(required = false) Long itemId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return reportService.inventoryMovementSummary(
        outletId,
        itemId,
        startDate,
        endDate,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @GetMapping("/low-stock")
  public PagedResult<ReportDtos.LowStockSnapshot> lowStock(
      @RequestParam long outletId,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return reportService.lowStock(outletId, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/pnl")
  public List<ReportDtos.DailyPnl> pnl(
      @RequestParam long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate
  ) {
    return reportService.dailyPnl(outletId, startDate, endDate);
  }

  @GetMapping("/top-skus")
  public List<ReportDtos.TopSku> topSkus(
      @RequestParam long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(required = false) Integer limit
  ) {
    return reportService.topSkus(outletId, startDate, endDate, limit);
  }

  @GetMapping("/staff-kpi")
  public List<ReportDtos.StaffKpi> staffKpi(
      @RequestParam long outletId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate
  ) {
    return reportService.staffKpi(outletId, startDate, endDate);
  }

  @GetMapping("/cross-outlet")
  public List<ReportDtos.CrossOutletCompare> crossOutlet(
      @RequestParam long regionId,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate
  ) {
    return reportService.crossOutletCompare(regionId, startDate, endDate);
  }
}
