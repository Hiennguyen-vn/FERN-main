package com.fern.simulator.model;

import java.time.LocalDate;

/**
 * Tracks a simulated promotion.
 */
public class SimPromotion {
    private final long id;
    private final String code;
    private final String name;
    private final String type; // percentage, fixed_amount
    private final int discountValue;
    private final LocalDate effectiveFrom;
    private final LocalDate effectiveTo;
    private String status = "draft";

    public SimPromotion(long id, String code, String name, String type,
                        int discountValue, LocalDate effectiveFrom, LocalDate effectiveTo) {
        this.id = id;
        this.code = code;
        this.name = name;
        this.type = type;
        this.discountValue = discountValue;
        this.effectiveFrom = effectiveFrom;
        this.effectiveTo = effectiveTo;
    }

    public long getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public String getType() { return type; }
    public int getDiscountValue() { return discountValue; }
    public LocalDate getEffectiveFrom() { return effectiveFrom; }
    public LocalDate getEffectiveTo() { return effectiveTo; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public boolean isActive() { return "active".equals(status); }
    public boolean isExpired(LocalDate today) { return today.isAfter(effectiveTo); }
    public boolean shouldActivate(LocalDate today) { return !today.isBefore(effectiveFrom) && "draft".equals(status); }
}
