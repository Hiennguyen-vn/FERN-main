package com.fern.services.org.api;

import com.fern.services.org.application.OrgService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/org")
public class OrgController {

  private final OrgService orgService;

  public OrgController(OrgService orgService) {
    this.orgService = orgService;
  }

  @GetMapping("/regions")
  public List<OrgDtos.RegionView> regions() {
    return orgService.listRegions();
  }

  @GetMapping("/regions/{code}")
  public OrgDtos.RegionView region(@PathVariable String code) {
    return orgService.getRegion(code);
  }

  @GetMapping("/outlets")
  public List<OrgDtos.OutletView> outlets(@RequestParam(name = "regionId", required = false) Long regionId) {
    return orgService.listOutlets(regionId);
  }

  @GetMapping("/outlets/{outletId}")
  public OrgDtos.OutletView outlet(@PathVariable long outletId) {
    return orgService.getOutlet(outletId);
  }

  @GetMapping("/hierarchy")
  public OrgDtos.OrgHierarchyView hierarchy() {
    return orgService.getHierarchy();
  }

  @GetMapping("/exchange-rates")
  public OrgDtos.ExchangeRateView exchangeRate(
      @RequestParam String from,
      @RequestParam String to,
      @RequestParam(name = "on", required = false) LocalDate onDate
  ) {
    return orgService.findExchangeRate(from, to, onDate);
  }

  @PostMapping("/outlets")
  @ResponseStatus(HttpStatus.CREATED)
  public OrgDtos.OutletView createOutlet(@Valid @RequestBody OrgDtos.CreateOutletRequest request) {
    return orgService.createOutlet(request);
  }

  @PutMapping("/exchange-rates")
  public OrgDtos.ExchangeRateView updateExchangeRate(
      @Valid @RequestBody OrgDtos.UpdateExchangeRateRequest request
  ) {
    return orgService.upsertExchangeRate(request);
  }
}
