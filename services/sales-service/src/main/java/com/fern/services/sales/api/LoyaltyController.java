package com.fern.services.sales.api;

import com.fern.services.sales.application.LoyaltyService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/loyalty")
public class LoyaltyController {

  private final LoyaltyService loyaltyService;

  public LoyaltyController(LoyaltyService loyaltyService) {
    this.loyaltyService = loyaltyService;
  }

  @PostMapping("/customers")
  @ResponseStatus(HttpStatus.CREATED)
  public LoyaltyService.CustomerView register(
      @RequestBody LoyaltyService.CreateCustomerRequest request
  ) {
    return loyaltyService.register(request);
  }

  @GetMapping("/customers/{id}")
  public LoyaltyService.CustomerView get(@PathVariable long id) {
    return loyaltyService.findById(id)
        .orElseThrow(() -> com.fern.common.middleware.ServiceException.notFound("Customer not found"));
  }

  @GetMapping("/customers")
  public LoyaltyService.CustomerView lookup(@RequestParam String phone) {
    return loyaltyService.findByPhone(phone)
        .orElseThrow(() -> com.fern.common.middleware.ServiceException.notFound("Customer not found"));
  }

  @DeleteMapping("/customers/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void erase(@PathVariable long id) {
    loyaltyService.erase(id);
  }

  @PostMapping("/customers/{id}/earn")
  public Map<String, Object> earn(
      @PathVariable long id,
      @RequestBody Map<String, Object> body
  ) {
    BigDecimal total = new BigDecimal(body.get("saleTotal").toString());
    Long saleId = body.get("saleId") == null ? null : ((Number) body.get("saleId")).longValue();
    int newBalance = loyaltyService.earn(id, saleId, total);
    return Map.of("customerId", id, "newBalance", newBalance);
  }

  @PostMapping("/customers/{id}/redeem")
  public Map<String, Object> redeem(
      @PathVariable long id,
      @RequestBody(required = false) Map<String, Object> body
  ) {
    Long saleId = body == null || body.get("saleId") == null
        ? null : ((Number) body.get("saleId")).longValue();
    int newBalance = loyaltyService.redeem(id, saleId);
    return Map.of("customerId", id, "newBalance", newBalance,
        "voucherVnd", LoyaltyService.REDEEM_VOUCHER_VND);
  }

  @GetMapping("/customers/{id}/ledger")
  public Map<String, Object> ledger(
      @PathVariable long id,
      @RequestParam(defaultValue = "100") int limit
  ) {
    List<Map<String, Object>> items = loyaltyService.ledger(id, limit);
    return Map.of("items", items, "count", items.size());
  }

  @PostMapping("/otp/request")
  public Map<String, Object> requestOtp(@RequestBody Map<String, String> body) {
    return loyaltyService.requestOtp(body.get("phone"));
  }

  @PostMapping("/otp/verify")
  public Map<String, Object> verifyOtp(@RequestBody Map<String, String> body) {
    boolean ok = loyaltyService.verifyOtp(body.get("phone"), body.get("code"));
    return Map.of("verified", ok);
  }
}
