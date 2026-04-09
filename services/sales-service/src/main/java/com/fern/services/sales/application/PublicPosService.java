package com.fern.services.sales.application;

import com.dorabets.common.middleware.ServiceException;
import com.fern.services.sales.api.PublicPosDtos;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

@Service
public class PublicPosService {

  private final SalesRepository salesRepository;
  private final Clock clock;

  public PublicPosService(SalesRepository salesRepository, Clock clock) {
    this.salesRepository = salesRepository;
    this.clock = clock;
  }

  public PublicPosDtos.PublicTableView getTable(String tableToken) {
    SalesRepository.PublicOrderingTableRecord table = requireActiveTable(tableToken);
    return toTableView(table, currentBusinessDate(table));
  }

  public List<PublicPosDtos.PublicMenuItemView> listMenu(String tableToken, LocalDate onDate) {
    SalesRepository.PublicOrderingTableRecord table = requireActiveTable(tableToken);
    LocalDate businessDate = onDate == null ? currentBusinessDate(table) : onDate;
    return salesRepository.listPublicMenu(table.outletId(), businessDate);
  }

  public PublicPosDtos.PublicOrderReceiptView getOrder(String tableToken, String orderToken) {
    SalesRepository.PublicOrderingTableRecord table = requireKnownTable(tableToken);
    SalesRepository.CreatedPublicOrder order = salesRepository.findPublicOrder(tableToken, orderToken)
        .orElseThrow(() -> ServiceException.notFound("Customer order not found"));
    return toReceipt(table, order.orderToken(), order.sale());
  }

  public PublicPosDtos.PublicOrderReceiptView createOrder(
      String tableToken,
      PublicPosDtos.CreatePublicOrderRequest request
  ) {
    SalesRepository.PublicOrderingTableRecord table = requireActiveTable(tableToken);
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
    SalesRepository.CreatedPublicOrder created;
    try {
      created = salesRepository.submitPublicOrder(table, request, businessDate);
    } catch (ServiceException exception) {
      if (exception.getStatusCode() == 409 && exception.getDetails() != null) {
        throw ServiceException.conflict(
            "One or more items are unavailable or exceed the stock available for this table");
      }
      throw exception;
    }
    return toReceipt(table, created.orderToken(), created.sale(), menuByProductId);
  }

  private SalesRepository.PublicOrderingTableRecord requireActiveTable(String tableToken) {
    SalesRepository.PublicOrderingTableRecord table = requireKnownTable(tableToken);
    if (!"active".equalsIgnoreCase(table.status())) {
      throw ServiceException.conflict("This table is not currently available for customer ordering");
    }
    if (!"active".equalsIgnoreCase(table.outletStatus())) {
      throw ServiceException.conflict("This outlet is not currently accepting customer orders");
    }
    return table;
  }

  private SalesRepository.PublicOrderingTableRecord requireKnownTable(String tableToken) {
    return salesRepository
        .findPublicOrderingTable(tableToken)
        .orElseThrow(() -> ServiceException.notFound("Ordering table not found"));
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
