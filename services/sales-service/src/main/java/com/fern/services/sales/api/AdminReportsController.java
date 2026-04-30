package com.fern.services.sales.api;

import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/reports")
public class AdminReportsController {

  private final SalesRepository salesRepository;
  private final com.fern.services.sales.application.CashMovementService cashMovementService;

  public AdminReportsController(
      SalesRepository salesRepository,
      com.fern.services.sales.application.CashMovementService cashMovementService
  ) {
    this.salesRepository = salesRepository;
    this.cashMovementService = cashMovementService;
  }

  @GetMapping("/cash-summary/{sessionId}")
  public Map<String, Object> cashSummary(@org.springframework.web.bind.annotation.PathVariable long sessionId) {
    return cashMovementService.summary(sessionId);
  }

  @GetMapping("/dlt")
  public Map<String, Object> dltList(
      @RequestParam(defaultValue = "100") int limit
  ) {
    int lim = Math.min(Math.max(limit, 1), 1000);
    java.util.List<Map<String, Object>> items = salesRepository.listDltPending(lim);
    return Map.of("items", items, "count", items.size());
  }

  @org.springframework.web.bind.annotation.PostMapping("/dlt/{eventId}/replay")
  public Map<String, Object> dltReplay(@org.springframework.web.bind.annotation.PathVariable long eventId) {
    int updated = salesRepository.requeueDlt(eventId);
    return Map.of("eventId", eventId, "requeued", updated > 0);
  }

  @GetMapping("/price-drift")
  public Map<String, Object> priceDrift(
      @RequestParam(name = "outletId", required = false) List<Long> outletIds,
      @RequestParam(name = "from") String from,
      @RequestParam(name = "to") String to,
      @RequestParam(name = "limit", defaultValue = "500") int limit
  ) {
    Instant fromInstant = Instant.parse(from);
    Instant toInstant = Instant.parse(to);
    if (limit < 1 || limit > 5000) limit = 500;

    RequestUserContext ctx = RequestUserContextHolder.get();
    java.util.Set<Long> readable = ctx == null ? java.util.Set.of() : ctx.outletIds();
    List<Long> effective;
    if (outletIds == null || outletIds.isEmpty()) {
      effective = List.copyOf(readable);
    } else if (readable.isEmpty()) {
      effective = outletIds;
    } else {
      effective = outletIds.stream().filter(readable::contains).toList();
    }
    if (effective.isEmpty()) {
      return Map.of("items", List.of(), "count", 0);
    }
    List<Map<String, Object>> items =
        salesRepository.reportPriceDrift(effective, fromInstant, toInstant, limit);
    return Map.of("items", items, "count", items.size());
  }
}
