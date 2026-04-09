package com.fern.services.sales.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.sales.application.CrmService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/crm")
public class CrmController {

  private final CrmService crmService;

  public CrmController(CrmService crmService) {
    this.crmService = crmService;
  }

  @GetMapping("/customers")
  public PagedResult<CrmDtos.CustomerView> listCustomers(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String query,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(defaultValue = "100") int limit,
      @RequestParam(defaultValue = "0") int offset
  ) {
    return crmService.listCustomers(outletId, query, q, sortBy, sortDir, limit, offset);
  }
}
