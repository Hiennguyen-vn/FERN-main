package com.fern.services.sales.api;

import com.fern.services.sales.application.CashMovementService;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/pos/sessions/{sessionId}/cash-movements")
public class CashMovementController {

  private final CashMovementService cashMovementService;

  public CashMovementController(CashMovementService cashMovementService) {
    this.cashMovementService = cashMovementService;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public CashMovementService.CashMovementView create(
      @PathVariable long sessionId,
      @RequestBody CashMovementService.CashMovementRequest request
  ) {
    return cashMovementService.record(sessionId, request);
  }

  @GetMapping
  public Map<String, Object> list(@PathVariable long sessionId) {
    List<CashMovementService.CashMovementView> items = cashMovementService.list(sessionId);
    return Map.of("items", items, "count", items.size());
  }

  @GetMapping("/summary")
  public Map<String, Object> summary(@PathVariable long sessionId) {
    return cashMovementService.summary(sessionId);
  }
}
