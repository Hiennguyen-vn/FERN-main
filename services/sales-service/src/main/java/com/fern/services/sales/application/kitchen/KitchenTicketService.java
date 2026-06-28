package com.fern.services.sales.application.kitchen;

import com.fern.common.middleware.ServiceException;
import com.fern.common.repository.BaseRepository;
import com.fern.services.sales.api.SalesDtos;
import com.fern.services.sales.api.kitchen.KitchenDtos;
import com.fern.services.sales.infrastructure.KitchenTicketRepository;
import com.fern.services.sales.infrastructure.SalesRepository;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class KitchenTicketService extends BaseRepository {

  private static final Logger log = LoggerFactory.getLogger(KitchenTicketService.class);

  private final KitchenTicketRepository ticketRepository;
  private final SalesRepository salesRepository;
  private final KitchenSyncPublisher syncPublisher;

  // Linear prep-SLA model: sla = base + perItem * totalUnits. Tunable per deployment.
  @org.springframework.beans.factory.annotation.Value("${fern.kitchen.sla.base-seconds:120}")
  private int slaBaseSeconds = 120;

  @org.springframework.beans.factory.annotation.Value("${fern.kitchen.sla.per-item-seconds:60}")
  private int slaPerItemSeconds = 60;

  public KitchenTicketService(
      DataSource dataSource,
      KitchenTicketRepository ticketRepository,
      SalesRepository salesRepository,
      KitchenSyncPublisher syncPublisher
  ) {
    super(dataSource);
    this.ticketRepository = ticketRepository;
    this.salesRepository = salesRepository;
    this.syncPublisher = syncPublisher;
  }

  /**
   * Create a kitchen ticket from an approved sale. Idempotent — if a ticket for the sale
   * already exists, no-op. Designed to be called from SalesService lifecycle hooks; never
   * throws to the caller so a kitchen-side failure cannot block sale approval.
   */
  public Optional<KitchenDtos.TicketView> createFromSale(long saleId) {
    try {
      SalesDtos.SaleView sale = salesRepository.findSale(saleId).orElse(null);
      if (sale == null) return Optional.empty();
      if (sale.items() == null || sale.items().isEmpty()) return Optional.empty();
      if (isDryGood(sale.orderType())) {
        return Optional.empty();
      }
      Long orderingTableId = lookupOrderingTableId(saleId);
      Map<Long, List<String>> allergensByProduct = loadAllergens(productIds(sale.items()));
      List<KitchenTicketRepository.NewTicketItem> ticketItems = new ArrayList<>(sale.items().size());
      for (SalesDtos.SaleLineView line : sale.items()) {
        ticketItems.add(new KitchenTicketRepository.NewTicketItem(
            line.productId(),
            displayName(line),
            line.quantity(),
            modifiersToMap(line),
            allergensByProduct.getOrDefault(line.productId(), List.of()),
            line.note()
        ));
      }
      int prepSlaSeconds = KitchenScheduling.computePrepSlaSeconds(
          ticketItems.stream().map(KitchenTicketRepository.NewTicketItem::qty).toList(),
          slaBaseSeconds,
          slaPerItemSeconds
      );
      KitchenTicketRepository.NewTicket newTicket = new KitchenTicketRepository.NewTicket(
          saleId,
          sale.outletId(),
          orderingTableId,
          sale.orderingTableCode(),
          sale.orderingTableName(),
          sale.orderType(),
          sale.note(),
          prepSlaSeconds,
          ticketItems
      );
      long ticketId = ticketRepository.createTicket(newTicket);
      Optional<KitchenDtos.TicketView> view = ticketRepository.findTicket(ticketId);
      view.ifPresent(syncPublisher::publishTicketCreated);
      return view;
    } catch (RuntimeException e) {
      log.warn("kitchen ticket creation failed for sale {}: {}", saleId, e.getMessage());
      return Optional.empty();
    }
  }

  public Optional<KitchenDtos.TicketView> createFromPublicBatch(
      SalesDtos.SaleView sale,
      SalesDtos.PublicOrderBatchView batch
  ) {
    try {
      if (sale == null || batch == null || batch.items() == null || batch.items().isEmpty()) return Optional.empty();
      if (isDryGood(sale.orderType())) return Optional.empty();
      Long orderingTableId = lookupOrderingTableId(Long.parseLong(sale.id()));
      List<Long> productIds = batch.items().stream()
          .map(SalesDtos.PublicOrderBatchItemView::productId)
          .filter(id -> id != null && !id.isBlank())
          .map(Long::parseLong)
          .toList();
      Map<Long, List<String>> allergensByProduct = loadAllergens(productIds);
      List<KitchenTicketRepository.NewTicketItem> ticketItems = new ArrayList<>(batch.items().size());
      for (SalesDtos.PublicOrderBatchItemView line : batch.items()) {
        long productId = Long.parseLong(line.productId());
        ticketItems.add(new KitchenTicketRepository.NewTicketItem(
            productId,
            line.productName() == null ? line.productCode() : line.productName(),
            line.quantity(),
            null,
            allergensByProduct.getOrDefault(productId, List.of()),
            line.note()
        ));
      }
      int prepSlaSeconds = KitchenScheduling.computePrepSlaSeconds(
          ticketItems.stream().map(KitchenTicketRepository.NewTicketItem::qty).toList(),
          slaBaseSeconds,
          slaPerItemSeconds
      );
      KitchenTicketRepository.NewTicket newTicket = new KitchenTicketRepository.NewTicket(
          Long.parseLong(sale.id()),
          sale.outletId(),
          orderingTableId,
          sale.orderingTableCode(),
          sale.orderingTableName(),
          sale.orderType(),
          batch.note(),
          prepSlaSeconds,
          ticketItems
      );
      long ticketId = ticketRepository.createTicketAlways(newTicket);
      Optional<KitchenDtos.TicketView> view = ticketRepository.findTicket(ticketId);
      view.ifPresent(syncPublisher::publishTicketCreated);
      return view;
    } catch (RuntimeException e) {
      log.warn("kitchen ticket batch creation failed for sale {} batch {}: {}",
          sale == null ? null : sale.id(), batch == null ? null : batch.id(), e.getMessage());
      return Optional.empty();
    }
  }

  /**
   * Cancel the kitchen ticket for a sale that was cancelled/voided/refunded. Idempotent —
   * no-op when no active ticket exists. Mirrors {@link #createFromSale}: never throws to the
   * caller so a kitchen-side failure cannot block sale cancellation. Broadcasts the updated
   * (cancelled) ticket so KDS screens drop it immediately.
   */
  public Optional<KitchenDtos.TicketView> cancelBySale(long saleId) {
    try {
      Optional<Long> ticketId = ticketRepository.cancelTicketBySale(saleId);
      if (ticketId.isEmpty()) return Optional.empty();
      Optional<KitchenDtos.TicketView> view = ticketRepository.findTicket(ticketId.get());
      view.ifPresent(syncPublisher::publishTicketUpdated);
      return view;
    } catch (RuntimeException e) {
      log.warn("kitchen ticket cancel failed for sale {}: {}", saleId, e.getMessage());
      return Optional.empty();
    }
  }

  public KitchenDtos.TicketListResponse listOpenTickets(long outletId) {
    List<KitchenDtos.TicketView> tickets = new ArrayList<>(ticketRepository.listOpenTickets(outletId));
    // Earliest Deadline First: show the ticket whose (createdAt + prepSla) deadline is nearest.
    tickets.sort(KitchenScheduling.earliestDeadlineFirst());
    return new KitchenDtos.TicketListResponse(outletId, tickets);
  }

  /**
   * Advance an item state with state-machine guard. Broadcasts updated ticket.
   * Returns the resolved ticket id.
   */
  public KitchenDtos.TicketView advanceItem(long ticketId, long itemId, String newStatus) {
    Long owningTicket = ticketRepository.findTicketIdForItem(itemId)
        .orElseThrow(() -> ServiceException.notFound("Kitchen ticket item not found: " + itemId));
    if (owningTicket != ticketId) {
      throw ServiceException.conflict("Item does not belong to ticket " + ticketId);
    }
    ticketRepository.advanceItemStatus(itemId, newStatus);
    KitchenDtos.TicketView updated = ticketRepository.findTicket(ticketId)
        .orElseThrow(() -> ServiceException.notFound("Kitchen ticket not found: " + ticketId));
    syncPublisher.publishTicketUpdated(updated);
    return updated;
  }

  public KitchenDtos.TicketView setTicketStatus(long ticketId, String newStatus) {
    ticketRepository.setTicketStatus(ticketId, newStatus);
    KitchenDtos.TicketView updated = ticketRepository.findTicket(ticketId)
        .orElseThrow(() -> ServiceException.notFound("Kitchen ticket not found: " + ticketId));
    syncPublisher.publishTicketUpdated(updated);
    return updated;
  }

  public Optional<Long> findOutletForTicket(long ticketId) {
    return ticketRepository.findOutletForTicket(ticketId);
  }

  public List<Long> claimSlaBreaches() {
    return ticketRepository.claimSlaBreaches();
  }

  public KitchenSyncPublisher syncPublisher() {
    return syncPublisher;
  }

  private static boolean isDryGood(String orderType) {
    return orderType != null && orderType.equalsIgnoreCase("retail");
  }

  private static String displayName(SalesDtos.SaleLineView line) {
    if (line.variantName() != null && !line.variantName().isBlank()) {
      return line.productName() + " — " + line.variantName();
    }
    return line.productName();
  }

  private static Map<String, Object> modifiersToMap(SalesDtos.SaleLineView line) {
    if (line.modifiers() == null || line.modifiers().isEmpty()) return null;
    List<Map<String, Object>> list = new ArrayList<>();
    line.modifiers().forEach(m -> {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("name", safeAttribute(m, "name"));
      entry.put("value", safeAttribute(m, "value"));
      list.add(entry);
    });
    Map<String, Object> wrapper = new LinkedHashMap<>();
    wrapper.put("entries", list);
    return wrapper;
  }

  private static Object safeAttribute(Object record, String field) {
    try {
      var accessor = record.getClass().getMethod(field);
      return accessor.invoke(record);
    } catch (Exception e) {
      return null;
    }
  }

  private static LinkedHashSet<Long> productIds(List<SalesDtos.SaleLineView> items) {
    LinkedHashSet<Long> ids = new LinkedHashSet<>();
    items.forEach(line -> ids.add(line.productId()));
    return ids;
  }

  private Map<Long, List<String>> loadAllergens(Collection<Long> productIds) {
    if (productIds.isEmpty()) return Map.of();
    StringBuilder placeholders = new StringBuilder();
    Object[] params = new Object[productIds.size()];
    int idx = 0;
    for (Long id : productIds) {
      if (idx > 0) placeholders.append(',');
      placeholders.append('?');
      params[idx++] = id;
    }
    String sql = "SELECT product_id, allergen_code FROM core.product_allergen"
        + " WHERE product_id IN (" + placeholders + ")";
    Map<Long, List<String>> result = new LinkedHashMap<>();
    try (var conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) ps.setLong(i + 1, (long) params[i]);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          long pid = rs.getLong(1);
          String code = rs.getString(2);
          result.computeIfAbsent(pid, k -> new ArrayList<>()).add(code);
        }
      }
    } catch (Exception e) {
      log.debug("kitchen allergen lookup failed: {}", e.getMessage());
    }
    return result;
  }

  private Long lookupOrderingTableId(long saleId) {
    String sql = "SELECT ordering_table_id FROM core.sale_record WHERE id = ? LIMIT 1";
    try (var conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(sql)) {
      ps.setLong(1, saleId);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          long id = rs.getLong(1);
          return rs.wasNull() ? null : id;
        }
      }
    } catch (Exception e) {
      log.debug("kitchen ordering_table_id lookup failed for sale {}: {}", saleId, e.getMessage());
    }
    return null;
  }
}
