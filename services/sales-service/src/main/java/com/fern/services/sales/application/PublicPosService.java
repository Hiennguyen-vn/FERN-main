package com.fern.services.sales.application;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.auth.OutletScopeContext;
import com.fern.services.sales.api.PublicPosDtos;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class PublicPosService {

  private final SalesRepository salesRepository;
  private final Clock clock;
  private final PromotionEngine promotionEngine;
  private final boolean promotionEngineEnabled;

  public PublicPosService(
      SalesRepository salesRepository,
      Clock clock,
      PromotionEngine promotionEngine,
      @Value("${promotion.engine.enabled:false}") boolean promotionEngineEnabled
  ) {
    this.salesRepository = salesRepository;
    this.clock = clock;
    this.promotionEngine = promotionEngine;
    this.promotionEngineEnabled = promotionEngineEnabled;
  }

  public PublicPosDtos.PublicTableView getTable(String tableToken) {
    return withPublicTableScope(tableToken, true, table ->
        toTableView(table, currentBusinessDate(table)));
  }

  public List<PublicPosDtos.PublicMenuItemView> listMenu(String tableToken, LocalDate onDate) {
    return withPublicTableScope(tableToken, true, table -> {
      LocalDate businessDate = onDate == null ? currentBusinessDate(table) : onDate;
      return salesRepository.listPublicMenu(table.outletId(), businessDate);
    });
  }

  public PublicPosDtos.PublicOrderReceiptView getOrder(String tableToken, String orderToken) {
    return withPublicTableScope(tableToken, false, table -> {
      SalesRepository.CreatedPublicOrder order = salesRepository.findPublicOrder(tableToken, orderToken)
          .orElseThrow(() -> ServiceException.notFound("Customer order not found"));
      return toReceipt(table, order.orderToken(), order.sale());
    });
  }

  public PublicPosDtos.PublicOrderReceiptView createOrder(
      String tableToken,
      PublicPosDtos.CreatePublicOrderRequest request
  ) {
    return withPublicTableScope(tableToken, true, table -> {
      LocalDate businessDate = currentBusinessDate(table);
      List<PublicPosDtos.PublicMenuItemView> menu =
          salesRepository.listPublicMenu(table.outletId(), businessDate);
      Map<String, PublicPosDtos.PublicMenuItemView> menuByProductId =
          menu.stream()
              .collect(
                  java.util.stream.Collectors.toMap(
                      PublicPosDtos.PublicMenuItemView::productId,
                      Function.identity(),
                      (left, right) -> left,
                      java.util.LinkedHashMap::new));
      PromotionEngine.Allocation promotionAllocation =
          computePromotionDiscounts(table.outletId(), request, menuByProductId);
      Map<Long, BigDecimal> discountByProduct = discountByProduct(promotionAllocation);
      SalesRepository.CreatedPublicOrder created;
      try {
        created = discountByProduct.isEmpty()
            ? salesRepository.submitPublicOrder(table, request, businessDate)
            : salesRepository.submitPublicOrder(
                table,
                request,
                businessDate,
                discountByProduct,
                promotionAllocation.promotionId());
      } catch (ServiceException exception) {
        if (exception.getStatusCode() == 409 && exception.getDetails() != null) {
          throw ServiceException.conflict(
              "One or more items are unavailable or exceed the stock available for this table");
        }
        throw exception;
      }
      return toReceipt(table, created.orderToken(), created.sale(), menuByProductId);
    });
  }

  private <T> T withPublicTableScope(
      String tableToken,
      boolean requireActive,
      Function<SalesRepository.PublicOrderingTableRecord, T> action
  ) {
    OutletScopeContext.ScopeSnapshot previousScope = OutletScopeContext.snapshot();
    try {
      SalesRepository.PublicOrderingTableRecord table = requireKnownTableForPublicRequest(tableToken);
      if (requireActive) {
        requireAvailable(table);
      }
      return action.apply(table);
    } finally {
      OutletScopeContext.restore(previousScope);
    }
  }

  private PromotionEngine.Allocation computePromotionDiscounts(
      long outletId,
      PublicPosDtos.CreatePublicOrderRequest request,
      Map<String, PublicPosDtos.PublicMenuItemView> menuByProductId
  ) {
    if (!promotionEngineEnabled) {
      return PromotionEngine.Allocation.EMPTY;
    }
    List<PromotionEngine.CartLine> cart = new java.util.ArrayList<>();
    for (PublicPosDtos.PublicOrderLineRequest item : request.items()) {
      PublicPosDtos.PublicMenuItemView menuItem = menuByProductId.get(item.productId());
      if (menuItem == null) continue;
      long productId;
      try {
        productId = Long.parseLong(item.productId());
      } catch (NumberFormatException ex) {
        continue;
      }
      cart.add(new PromotionEngine.CartLine(productId, item.quantity(), menuItem.priceValue()));
    }
    if (cart.isEmpty()) return PromotionEngine.Allocation.EMPTY;
    return promotionEngine.evaluateForCart(outletId, cart);
  }

  private Map<Long, BigDecimal> discountByProduct(PromotionEngine.Allocation allocation) {
    if (allocation == null || allocation.lineDiscounts().isEmpty()) return Map.of();
    Map<Long, BigDecimal> map = new HashMap<>();
    for (PromotionEngine.LineDiscount ld : allocation.lineDiscounts()) {
      map.merge(ld.productId(), ld.discountAmount(), BigDecimal::add);
    }
    return map;
  }

  private void requireAvailable(SalesRepository.PublicOrderingTableRecord table) {
    if (!"active".equalsIgnoreCase(table.status())) {
      throw ServiceException.conflict("This table is not currently available for customer ordering");
    }
    if (!"active".equalsIgnoreCase(table.outletStatus())) {
      throw ServiceException.conflict("This outlet is not currently accepting customer orders");
    }
  }

  private SalesRepository.PublicOrderingTableRecord requireKnownTableForPublicRequest(String tableToken) {
    OutletScopeContext.set(OutletScopeContext.ALL);
    SalesRepository.PublicOrderingTableRecord table =
        salesRepository
            .findPublicOrderingTable(tableToken)
            .orElseThrow(() -> ServiceException.notFound("Ordering table not found"));
    OutletScopeContext.set(table.outletId());
    return table;
  }

  private LocalDate currentBusinessDate(SalesRepository.PublicOrderingTableRecord table) {
    return clock.instant().atZone(ZoneId.of(table.timezoneName())).toLocalDate();
  }

  private PublicPosDtos.PublicTableView toTableView(
      SalesRepository.PublicOrderingTableRecord table,
      LocalDate businessDate
  ) {
    return new PublicPosDtos.PublicTableView(
        table.publicToken(),
        table.tableCode(),
        table.displayName(),
        table.status(),
        table.outletCode(),
        table.outletName(),
        table.currencyCode(),
        table.timezoneName(),
        businessDate);
  }

  private PublicPosDtos.PublicOrderReceiptView toReceipt(
      SalesRepository.PublicOrderingTableRecord table,
      String orderToken,
      SalesDtos.SaleView sale
  ) {
    LocalDate businessDate = currentBusinessDate(table);
    Map<String, PublicPosDtos.PublicMenuItemView> menuByProductId = salesRepository
        .listPublicMenu(table.outletId(), businessDate)
        .stream()
        .collect(
            java.util.stream.Collectors.toMap(
                PublicPosDtos.PublicMenuItemView::productId,
                Function.identity(),
                (left, right) -> left,
                java.util.LinkedHashMap::new));
    return toReceipt(table, orderToken, sale, menuByProductId);
  }

  private PublicPosDtos.PublicOrderReceiptView toReceipt(
      SalesRepository.PublicOrderingTableRecord table,
      String orderToken,
      SalesDtos.SaleView sale,
      Map<String, PublicPosDtos.PublicMenuItemView> menuByProductId
  ) {
    return new PublicPosDtos.PublicOrderReceiptView(
        orderToken,
        table.tableCode(),
        table.displayName(),
        table.outletCode(),
        table.outletName(),
        sale.currencyCode(),
        sale.status(),
        sale.paymentStatus(),
        sale.totalAmount(),
        sale.note(),
        sale.createdAt(),
        sale.items().stream()
            .map(
                item -> {
                  String productId = Long.toString(item.productId());
                  PublicPosDtos.PublicMenuItemView menuItem = menuByProductId.get(productId);
                  return new PublicPosDtos.PublicOrderLineView(
                      productId,
                      menuItem == null ? productId : menuItem.code(),
                      menuItem == null ? "Product " + productId : menuItem.name(),
                      item.quantity(),
                      item.unitPrice(),
                      item.lineTotal(),
                      item.note());
                })
            .toList());
  }
}
