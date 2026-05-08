package com.fern.services.finance.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.spring.auth.JwtTokenService;
import com.fern.common.spring.auth.SpringInternalServiceAuth;
import com.fern.events.finance.InvoiceIssuedEvent;
import com.fern.events.sales.PaymentCapturedEvent;
import com.fern.services.finance.api.FinanceDtos;
import com.fern.services.finance.infrastructure.InvoiceRepository;
import com.fern.services.finance.infrastructure.InvoiceRepository.InvoiceLineRecord;
import com.fern.services.finance.infrastructure.InvoiceRepository.InvoiceRecord;
import com.fern.services.finance.infrastructure.InvoiceRepository.OutletInfo;
import com.fern.common.utils.services.id.SnowflakeIdGenerator;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.retry.annotation.Retry;

@Service
public class InvoiceService {

  private static final Logger log = LoggerFactory.getLogger(InvoiceService.class);

  private final InvoiceRepository invoiceRepository;
  private final SnowflakeIdGenerator idGenerator;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final Clock clock;
  private final RestClient salesRestClient;
  private final SpringInternalServiceAuth internalServiceAuth;
  private final JwtTokenService jwtTokenService;
  private final String salesBaseUrl;

  @Value("${invoice.vat-percent:8.00}")
  private BigDecimal vatPercent;

  public InvoiceService(
      InvoiceRepository invoiceRepository,
      SnowflakeIdGenerator idGenerator,
      AuthorizationPolicyService authorizationPolicyService,
      Clock clock,
      RestClient.Builder restClientBuilder,
      SpringInternalServiceAuth internalServiceAuth,
      JwtTokenService jwtTokenService,
      @Value("${sales-service.base-url:http://sales-service:8080}") String salesBaseUrl
  ) {
    this.invoiceRepository = invoiceRepository;
    this.idGenerator = idGenerator;
    this.authorizationPolicyService = authorizationPolicyService;
    this.clock = clock;
    this.salesRestClient = restClientBuilder.build();
    this.internalServiceAuth = internalServiceAuth;
    this.jwtTokenService = jwtTokenService;
    this.salesBaseUrl = salesBaseUrl.strip().replaceAll("/$", "");
  }

  public FinanceDtos.InvoiceView issueInvoice(PaymentCapturedEvent event) {
    // Idempotency: return existing invoice if already issued for this sale
    Optional<InvoiceRecord> existing = invoiceRepository.findBySaleId(event.saleId());
    if (existing.isPresent()) {
      List<InvoiceLineRecord> lines = invoiceRepository.findLinesByInvoiceId(existing.get().id());
      return toView(existing.get(), lines);
    }

    SaleResponse sale = fetchSale(event.saleId());
    if (sale == null) throw new IllegalStateException("Sale not found: " + event.saleId());

    OutletInfo outlet = invoiceRepository.findOutletInfo(sale.outletId())
        .orElseThrow(() -> new IllegalStateException("Outlet not found: " + sale.outletId()));

    Instant now = clock.instant();
    int year = now.atZone(ZoneOffset.UTC).getYear();
    long serial = invoiceRepository.nextSerial(sale.outletId(), year);
    String invoiceNumber = String.format("%s/%02d/%06d",
        outlet.code(), year % 100, serial);

    // Build lines with VAT
    List<InvoiceLineRecord> lineRecords = new ArrayList<>();
    long subtotalCents = 0;
    long totalVatCents = 0;
    long invoiceId = idGenerator.generateId();

    for (int i = 0; i < sale.items().size(); i++) {
      SaleLineResponse item = sale.items().get(i);
      long unitPrice = item.unitPrice().multiply(BigDecimal.valueOf(100))
          .setScale(0, RoundingMode.HALF_UP).longValue();
      long discount = item.discountAmount().multiply(BigDecimal.valueOf(100))
          .setScale(0, RoundingMode.HALF_UP).longValue();
      // Use pre-computed tax from sale line — avoids double-taxing and handles per-product rates.
      long lineVat = item.taxAmount() != null
          ? item.taxAmount().multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).longValue()
          : 0L;
      // Effective VAT percent for this line (informational, stored on invoice_line).
      BigDecimal lineSubtotalBd = item.unitPrice().multiply(item.quantity())
          .subtract(item.discountAmount()).setScale(2, RoundingMode.HALF_UP);
      BigDecimal effectiveVatPct = lineSubtotalBd.compareTo(BigDecimal.ZERO) > 0 && lineVat > 0
          ? BigDecimal.valueOf(lineVat).divide(
              lineSubtotalBd.multiply(BigDecimal.valueOf(100)), 4, RoundingMode.HALF_UP)
          : BigDecimal.ZERO;
      long lineSubtotalCents = lineSubtotalBd.multiply(BigDecimal.valueOf(100))
          .setScale(0, RoundingMode.HALF_UP).longValue();

      subtotalCents += lineSubtotalCents;
      totalVatCents += lineVat;

      lineRecords.add(new InvoiceLineRecord(
          0L, invoiceId, i + 1,
          item.productCode() != null ? item.productCode() : String.valueOf(item.productId()),
          item.productName(),
          "phần",
          item.quantity(),
          unitPrice,
          discount,
          effectiveVatPct,
          lineVat,
          lineSubtotalCents + lineVat
      ));
    }

    long totalCents = subtotalCents + totalVatCents;

    InvoiceRecord inv = new InvoiceRecord(
        invoiceId,
        sale.outletId(),
        event.saleId(),
        invoiceNumber,
        year,
        serial,
        now,
        outlet.taxCode(),
        outlet.name(),
        outlet.address(),
        null, // buyer: walk-in
        null,
        subtotalCents,
        totalVatCents,
        totalCents,
        VnAmountToWords.convert(totalCents),
        event.paymentMethod(),
        event.currencyCode() != null ? event.currencyCode() : "VND",
        "internal_only",
        "v1",
        now
    );

    InvoiceIssuedEvent issuedEvent = new InvoiceIssuedEvent(
        invoiceId, event.saleId(), sale.outletId(), invoiceNumber, now);
    invoiceRepository.insertInvoice(inv, lineRecords, issuedEvent);

    log.info("Invoice issued: {} for sale {}", invoiceNumber, event.saleId());
    return toView(inv, lineRecords);
  }

  public Optional<FinanceDtos.InvoiceView> getInvoiceById(long invoiceId) {
    return invoiceRepository.findById(invoiceId).map(inv -> {
      requireInvoiceRead(inv.outletId());
      List<InvoiceLineRecord> lines = invoiceRepository.findLinesByInvoiceId(invoiceId);
      return toView(inv, lines);
    });
  }

  public Optional<FinanceDtos.InvoiceView> getInvoiceBySaleId(long saleId) {
    return invoiceRepository.findBySaleId(saleId).map(inv -> {
      requireInvoiceRead(inv.outletId());
      List<InvoiceLineRecord> lines = invoiceRepository.findLinesByInvoiceId(inv.id());
      return toView(inv, lines);
    });
  }

  public List<FinanceDtos.InvoiceSummary> listInvoices(
      long outletId, Instant from, Instant to, int limit, int offset) {
    requireInvoiceRead(outletId);
    return invoiceRepository.listInvoices(outletId, from, to, limit, offset);
  }

  private void requireInvoiceRead(long outletId) {
    RequestUserContext ctx = RequestUserContextHolder.get();
    if (!authorizationPolicyService.canReadFinance(ctx)) {
      throw ServiceException.forbidden("Finance invoice read access required");
    }
    Set<Long> readableOutletIds = authorizationPolicyService.resolveFinanceReadableOutletIds(ctx);
    if (readableOutletIds != null && !readableOutletIds.contains(outletId)) {
      throw ServiceException.forbidden("Invoice outlet is outside readable finance scope");
    }
  }

  private FinanceDtos.InvoiceView toView(InvoiceRecord inv, List<InvoiceLineRecord> lines) {
    List<FinanceDtos.InvoiceLineView> lineViews = lines.stream().map(l ->
        new FinanceDtos.InvoiceLineView(
            l.lineNo(), l.productCode(), l.productName(), l.unit(), l.qty(),
            l.unitPriceCents(), l.discountCents(), l.vatPercent(), l.vatCents(), l.amountCents()
        )
    ).toList();
    return new FinanceDtos.InvoiceView(
        inv.id(), inv.outletId(), inv.saleId(), inv.invoiceNumber(), inv.issuedAt(),
        inv.sellerTaxCode(), inv.sellerName(), inv.sellerAddress(),
        inv.buyerName(), inv.buyerPhone(),
        inv.subtotalCents(), inv.vatCents(), inv.totalCents(),
        inv.totalInWords(), inv.paymentMethod(), inv.currency(),
        inv.cqtStatus(), inv.templateVersion(), lineViews
    );
  }

  // Internal DTOs for sales-service REST response
  @CircuitBreaker(name = "sales-service", fallbackMethod = "fetchSaleFallback")
  @Retry(name = "sales-service")
  SaleResponse fetchSale(long saleId) {
    HttpHeaders internalHeaders = new HttpHeaders();
    internalServiceAuth.applyWithJwt(internalHeaders, "finance-service", "sales-service", jwtTokenService, null);
    return salesRestClient.get()
        .uri(salesBaseUrl + "/api/v1/sales/orders/{id}", saleId)
        .headers(headers -> headers.addAll(internalHeaders))
        .retrieve()
        .body(SaleResponse.class);
  }

  @SuppressWarnings("unused")
  private SaleResponse fetchSaleFallback(long saleId, Throwable ex) {
    log.warn("sales-service unavailable for fetchSale saleId={}: {}", saleId, ex.toString());
    throw new SalesServiceUnavailableException("sales-service unavailable", ex);
  }

  public static class SalesServiceUnavailableException extends RuntimeException {
    public SalesServiceUnavailableException(String msg, Throwable cause) {
      super(msg, cause);
    }
  }

  record SaleResponse(long outletId, java.util.List<SaleLineResponse> items) {}
  record SaleLineResponse(
      long productId, String productCode, String productName,
      BigDecimal quantity, BigDecimal unitPrice, BigDecimal discountAmount,
      BigDecimal taxAmount   // may be null for legacy/zero-tax lines
  ) {}
}
