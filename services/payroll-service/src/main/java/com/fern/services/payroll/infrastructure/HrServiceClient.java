package com.fern.services.payroll.infrastructure;

import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fern.services.payroll.api.PayrollDtos;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.retry.annotation.Retry;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Internal client used by payroll-service to fetch approved work-shift data from hr-service.
 * All calls are authenticated with the shared internal service token — no user context is forwarded,
 * so hr-service treats this as an internal (admin-equivalent) call and skips outlet-scope checks.
 */
@Component
public class HrServiceClient {

  private static final Logger log = LoggerFactory.getLogger(HrServiceClient.class);
  private static final String SERVICE_NAME = "payroll-service";
  private static final String CB_NAME = "hr-service";

  private final RestClient restClient;
  private final SpringInternalServiceAuth internalAuth;
  private final JwtTokenService jwtTokenService;
  private final String hrServiceBaseUrl;

  public HrServiceClient(
      RestClient.Builder restClientBuilder,
      SpringInternalServiceAuth internalAuth,
      JwtTokenService jwtTokenService,
      @Value("${dependencies.hrService.baseUrl:http://localhost:8084}") String hrServiceBaseUrl
  ) {
    this.restClient = restClientBuilder.build();
    this.internalAuth = internalAuth;
    this.jwtTokenService = jwtTokenService;
    this.hrServiceBaseUrl = hrServiceBaseUrl.strip().replaceAll("/$", "");
  }

  /**
   * Fetches all approved work shifts for a user within a date range from hr-service.
   * Limit 500 — sufficient for a single payroll period (max ~31 days × shifts/day).
   */
  @CircuitBreaker(name = CB_NAME, fallbackMethod = "fetchApprovedShiftsFallback")
  @Retry(name = CB_NAME)
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
    internalAuth.applyWithJwt(internalHeaders, SERVICE_NAME, "hr-service", jwtTokenService, null);

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

  /**
   * Fetches the latest active employee contract for a user from hr-service.
   * Returns {@link Optional#empty()} when hr-service returns 404 (no active contract).
   * All other non-2xx responses propagate as {@link org.springframework.web.client.RestClientException}.
   */
  @CircuitBreaker(name = CB_NAME, fallbackMethod = "fetchLatestContractFallback")
  @Retry(name = CB_NAME)
  public Optional<PayrollDtos.EmployeeContractSummary> fetchLatestContract(long userId) {
    String url = hrServiceBaseUrl + "/api/v1/hr/contracts/user/" + userId + "/latest";

    HttpHeaders internalHeaders = new HttpHeaders();
    internalAuth.applyWithJwt(internalHeaders, SERVICE_NAME, "hr-service", jwtTokenService, null);

    try {
      PayrollDtos.EmployeeContractSummary contract = restClient.get()
          .uri(url)
          .headers(h -> h.addAll(internalHeaders))
          .retrieve()
          .body(PayrollDtos.EmployeeContractSummary.class);
      return Optional.ofNullable(contract);
    } catch (HttpClientErrorException.NotFound e) {
      return Optional.empty();
    }
  }

  @SuppressWarnings("unused")
  private List<PayrollDtos.WorkShiftSummaryItem> fetchApprovedShiftsFallback(
      long userId, Long outletId, LocalDate startDate, LocalDate endDate, Throwable ex) {
    log.warn("hr-service circuit open or call failed for fetchApprovedShifts userId={}: {}", userId, ex.toString());
    throw new HrServiceUnavailableException("hr-service unavailable for shift fetch", ex);
  }

  @SuppressWarnings("unused")
  private Optional<PayrollDtos.EmployeeContractSummary> fetchLatestContractFallback(long userId, Throwable ex) {
    log.warn("hr-service circuit open or call failed for fetchLatestContract userId={}: {}", userId, ex.toString());
    throw new HrServiceUnavailableException("hr-service unavailable for contract fetch", ex);
  }

  public static class HrServiceUnavailableException extends RuntimeException {
    public HrServiceUnavailableException(String msg, Throwable cause) {
      super(msg, cause);
    }
  }
}
