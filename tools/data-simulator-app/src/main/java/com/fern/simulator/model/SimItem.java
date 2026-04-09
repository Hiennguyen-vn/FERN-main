package com.fern.simulator.model;

/**
 * Tracks a simulated inventory item with stock levels and unit cost.
 */
public class SimItem {
    private final long id;
    private final String code;
    private final String name;
    private final long categoryId;
    private final String categoryCode;
    private final long uomId;
    private final String uomCode;
    private final long unitCost; // VND per unit
    private final boolean composite;
    private final String perishabilityTier;
    private final int shelfLifeDays;
    private final double prepWasteWeight;
    private final double damageRiskWeight;
    private int minStockLevel;
    private int maxStockLevel;

    /** In-memory stock tracker per outlet. */
    private int currentStock = 0;

    public SimItem(long id, String code, String name, long categoryId, String categoryCode,
                   long uomId, String uomCode, long unitCost, boolean composite,
                   int minStockLevel, int maxStockLevel, String perishabilityTier,
                   int shelfLifeDays, double prepWasteWeight, double damageRiskWeight) {
        this.id = id;
        this.code = code;
        this.name = name;
        this.categoryId = categoryId;
        this.categoryCode = categoryCode;
        this.uomId = uomId;
        this.uomCode = uomCode;
        this.unitCost = unitCost;
        this.composite = composite;
        this.perishabilityTier = perishabilityTier;
        this.shelfLifeDays = shelfLifeDays;
        this.prepWasteWeight = prepWasteWeight;
        this.damageRiskWeight = damageRiskWeight;
        this.minStockLevel = minStockLevel;
        this.maxStockLevel = maxStockLevel;
    }

    public long getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public long getCategoryId() { return categoryId; }
    public String getCategoryCode() { return categoryCode; }
    public long getUomId() { return uomId; }
    public String getUomCode() { return uomCode; }
    public long getUnitCost() { return unitCost; }
    public boolean isComposite() { return composite; }
    public String getPerishabilityTier() { return perishabilityTier; }
    public int getShelfLifeDays() { return shelfLifeDays; }
    public double getPrepWasteWeight() { return prepWasteWeight; }
    public double getDamageRiskWeight() { return damageRiskWeight; }
    public int getMinStockLevel() { return minStockLevel; }
    public int getMaxStockLevel() { return maxStockLevel; }
    public int getCurrentStock() { return currentStock; }

    public void addStock(int qty) { this.currentStock += qty; }
    public void removeStock(int qty) { this.currentStock -= qty; }
    public boolean needsReorder() { return currentStock < minStockLevel && !composite; }
    public boolean needsManufacture() { return composite && currentStock < minStockLevel; }
    public boolean hasStock(int qty) { return currentStock >= qty; }

    /** Create a per-outlet copy of a global item definition. */
    public SimItem copyForOutlet() {
        return new SimItem(id, code, name, categoryId, categoryCode,
                uomId, uomCode, unitCost, composite, minStockLevel, maxStockLevel,
                perishabilityTier, shelfLifeDays, prepWasteWeight, damageRiskWeight);
    }
}
