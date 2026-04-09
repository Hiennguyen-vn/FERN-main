package com.fern.events.product;

import java.math.BigDecimal;

public record ProductRecipeUpdatedLineItem(
    long itemId,
    String uomCode,
    BigDecimal quantity
) {
}
