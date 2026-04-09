package com.fern.simulator.model;

/**
 * Tracks a simulated supplier.
 */
public record SimSupplier(
        long id,
        String code,
        String name,
        String regionCode,
        String currencyCode
) {}
