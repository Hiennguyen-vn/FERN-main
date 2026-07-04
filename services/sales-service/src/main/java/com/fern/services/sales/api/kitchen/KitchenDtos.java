package com.fern.services.sales.api.kitchen;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class KitchenDtos {

  private KitchenDtos() {}

  public record TicketItemView(
      long id,
      long productId,
      String productName,
      BigDecimal qty,
      String status,
      Map<String, Object> modifiers,
      String notes,
      Instant startedAt,
      Instant readyAt,
      Instant servedAt
  ) {}

  public record TicketView(
      long id,
      long saleId,
      long outletId,
      Long orderingTableId,
      String orderingTableCode,
      String orderingTableName,
      String orderType,
      String status,
      int prepSlaSeconds,
      String notes,
      boolean slaBreached,
      Instant createdAt,
      Instant startedAt,
      Instant readyAt,
      Instant servedAt,
      List<TicketItemView> items
  ) {}

  public record AdvanceStatusRequest(@NotBlank String status) {}

  public record TicketListResponse(@NotNull Long outletId, List<TicketView> tickets) {}
}
