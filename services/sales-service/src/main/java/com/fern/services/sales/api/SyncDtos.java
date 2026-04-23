package com.fern.services.sales.api;

import java.util.List;

public class SyncDtos {

  // ── Push (Edge → Cloud) ──────────────────────────────────────────────────

  public record PushRequest(
      long deviceId,
      List<PushEvent> events
  ) {}

  public record PushEvent(
      String eventId,
      String idempotencyKey,
      String type,
      String clientOccurredAt,
      String estimatedTime,
      long monotonicSeq,
      Object payload
  ) {}

  public record PushResponse(
      List<String> accepted,
      List<RejectedEvent> rejected
  ) {}

  public record RejectedEvent(
      String eventId,
      String reason
  ) {}

  // ── Pull / Catalog (Cloud → Edge) ────────────────────────────────────────

  public record CatalogRow(
      long id,
      long outletId,
      String name,
      long categoryId,
      String categoryName,
      boolean isAvailable,
      long priceCents,
      long updatedAt   // epoch millis
  ) {}

  // ── Pull / Stock (Cloud → Edge) ──────────────────────────────────────────

  public record StockRow(
      long itemId,
      long outletId,
      String qtyOnHand,
      long lastMovementAt  // epoch millis
  ) {}

  // ── Manifest ─────────────────────────────────────────────────────────────

  public record ManifestResponse(
      long catalogVersion,
      long priceVersion,
      long stockVersion,
      String serverTime
  ) {}
}
