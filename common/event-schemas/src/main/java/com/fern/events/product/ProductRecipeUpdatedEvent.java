package com.fern.events.product;

import java.time.Instant;
import java.util.List;

public record ProductRecipeUpdatedEvent(
    long productId,
    String version,
    String status,
    List<ProductRecipeUpdatedLineItem> items,
    Instant updatedAt,
    Long updatedByUserId
) {
}
