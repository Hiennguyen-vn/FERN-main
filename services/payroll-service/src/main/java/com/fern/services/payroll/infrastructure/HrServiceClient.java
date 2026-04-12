package com.fern.services.payroll.infrastructure;

import com.dorabets.common.spring.auth.SpringInternalServiceAuth;
import com.fern.services.payroll.api.PayrollDtos;
import java.time.LocalDate;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Internal client used by payroll-service to fetch approved work-shift data from hr-service.
 * All calls are authenticated with the shared internal service token — no user context is forwarded,
 * so hr-service treats this as an internal (admin-equivalent) call and skips outlet-scope checks.
 */
@Component
public class HrServiceClient {

  private static final String SERVICE_NAME = "payroll-service";

  private final RestClient restClient;
  private final SpringInternalServiceAuth internalAuth;
  private final String hrServiceBaseUrl;

  public HrServiceClient(
      RestClient.Builder restClientBuilder,
      SpringInternalServiceAuth internalAuth,
      @Value("${dependencies.hrService.baseUrl:http://localhost:8084}") String hrServiceBaseUrl
  ) {
    this.restClient = restClientBuilder.build();
    this.internalAuth = internalAuth;
    this.hrServiceBaseUrl = hrServiceBaseUrl.strip().replaceAll("/$", "");
  }

  /**
   * Fetches all approved work shifts for a user within a date range from hr-service.
   * Limit 500 — sufficient for a single payroll period (max ~31 days × shifts/day).
   */
  public List<PayrollDtos.WorkShiftSummaryItem> fetchApprovedShifts(
      long userId,
      Long outletId,
      LocalDate startDate,
      LocalDate endDate
  ) {
    UriComponentsBuilder uriBuilder = UriComponentsBuilder
        .newInstance()
        .uri(java.net.URI.create(hrServiceBaseUrl + "/api/v1/hr/work-shifts"))
        .queryParam("userId", userId)
        .queryParam("approvalStatus", "approved")
        .queryParam("startDate", startDate.toString())
        .queryParam("endDate", endDate.toString())
        .queryParam("limit", 500)
        .queryParam("offset", 0);

    if (outletId != null) {
      uriBuilder.queryParam("outletId", outletId);
    }

    HttpHeaders internalHeaders = new HttpHeaders();
    internalAuth.apply(internalHeaders, SERVICE_NAME, null);

    PayrollDtos.WorkShiftPage page = restClient.get()
        .uri(uriBuilder.toUriString())
        .headers(h -> h.addAll(internalHeaders))
        .retrieve()
        .body(PayrollDtos.WorkShiftPage.class);

    if (page == null || page.items() == null) {
      return List.of();
    }
    return page.items();
  }
}
