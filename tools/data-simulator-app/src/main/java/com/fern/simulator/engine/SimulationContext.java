package com.fern.simulator.engine;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.data.MenuData;
import com.fern.simulator.id.SimulatorIdGenerator;
import com.fern.simulator.model.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Mutable shared state for a simulation run.
 * Tracks all active entities, stock levels, pending orders, and counters.
 */
public class SimulationContext {

    private final SimulationConfig config;
    private final SimulationRandom random;
    private final SimulationClock clock;
    private final SimulatorIdGenerator idGen;

    // --- Entity tracking ---
    private final Map<Long, SimOutlet> outlets = new LinkedHashMap<>();
    private final Map<Long, Map<String, Long>> outletShiftIds = new HashMap<>(); // outletId → blockCode → shift id
    private final List<SimEmployee> allEmployees = new ArrayList<>(); // includes historical
    private final Map<Long, List<SimEmployee>> employeesByOutlet = new HashMap<>();
    private final Map<Long, SimEmployee> employeesByUserId = new HashMap<>();
    private final Map<Long, SimItem> items = new LinkedHashMap<>(); // global item registry
    private final Map<Long, Map<Long, SimItem>> outletStock = new HashMap<>(); // outletId → (itemId → SimItem with stock)
    private final Map<Long, Map<Long, Deque<StockLot>>> outletLots = new HashMap<>(); // outletId → itemId → FIFO lots
    private final Map<Long, SimProduct> products = new LinkedHashMap<>();
    private final Map<Long, SimSupplier> suppliers = new LinkedHashMap<>();
    private final Map<Long, Double> supplierReliability = new HashMap<>();
    private final Map<Long, Integer> supplierLateDeliveries = new HashMap<>();
    private final List<SimPromotion> promotions = new ArrayList<>();
    private final Map<Long, Set<Long>> promotionOutletScopes = new HashMap<>(); // promoId -> outletIds
    private final Map<Long, long[]> unmetDemandCarryover = new HashMap<>(); // outletId -> units scheduled for future days
    private final Map<Long, List<WorkedShiftRecord>> workedShiftHistory = new HashMap<>(); // userId -> actual attendance records

    // --- Category & UOM tracking ---
    private final Map<String, Long> itemCategoryIds = new HashMap<>();
    private final Map<String, Long> productCategoryIds = new HashMap<>();
    private final Map<String, Long> uomIds = new HashMap<>();
    private final Map<String, MenuData.CompositeRecipe> compositeRecipes = new HashMap<>();

    // --- Region tracking ---
    private final Set<String> activeRegionCodes = new LinkedHashSet<>();
    private final Set<String> activeSubregionCodes = new LinkedHashSet<>();
    private final Map<String, Long> regionCodeToId = new HashMap<>();
    private final Map<String, LocalDate> regionActivatedOn = new HashMap<>();
    private final Map<String, LocalDate> subregionActivatedOn = new HashMap<>();
    private String currentExpansionTier = "seed";

    // --- Pending operations ---
    private final List<PendingPurchaseOrder> pendingPOs = new ArrayList<>();
    private final List<PendingReplacement> pendingReplacements = new ArrayList<>();
    private DailyOperationalSummary currentOperationalSummary;

    // --- GR linking (for invoice persistence) ---
    private final Map<Long, Long> poToGoodsReceiptId = new HashMap<>(); // poId → grId
    private final Map<Long, Map<Long, Long>> poToGriIds = new HashMap<>(); // poId → (itemId → griId)

    // --- Counters ---
    private int outletSeq = 0;
    private int employeeSeq = 0;
    private int supplierSeq = 0;
    private int itemSeq = 0;
    private int productSeq = 0;
    private int promotionSeq = 0;

    // --- Monthly summaries ---
    private MonthSummary currentMonth;
    private final List<MonthSummary> allMonths = new ArrayList<>();

    // --- Row counts ---
    private final Map<String, Long> rowCounts = new ConcurrentHashMap<>();
    private final Map<Long, Integer> manufacturingLaborMinutesToday = new HashMap<>();

    // --- Write buffer ---
    private boolean writeEnabled;

    // ========== DIRTY TRACKING ==========
    // These track entities created/modified THIS DAY only.
    // Cleared by clearDirtyState() after DayPersister writes them.
    private final List<String> dirtyRegions = new ArrayList<>();
    private final List<SimOutlet> dirtyOutlets = new ArrayList<>();
    private final List<SimOutlet> dirtyOutletUpdates = new ArrayList<>();
    private final List<SimItem> dirtyItems = new ArrayList<>();
    private final List<SimSupplier> dirtySuppliers = new ArrayList<>();
    private final List<SimProduct> dirtyProducts = new ArrayList<>();
    private final List<SimEmployee> dirtyEmployees = new ArrayList<>();
    private final List<SimEmployee> dirtyEmployeeUpdates = new ArrayList<>();
    private final List<PendingPurchaseOrder> dirtyPOs = new ArrayList<>();
    private final List<GoodsReceiptEvent> dirtyGoodsReceipts = new ArrayList<>();
    private final List<SimPromotion> dirtyPromotions = new ArrayList<>();
    private final List<PosSessionEvent> dirtyPosSessions = new ArrayList<>();
    private final List<SaleEvent> dirtySales = new ArrayList<>();
    private final List<PayrollEvent> dirtyPayrolls = new ArrayList<>();
    private final List<WasteEvent> dirtyWasteRecords = new ArrayList<>();
    private final List<ManufacturingEvent> dirtyManufacturing = new ArrayList<>();
    private final List<ExpenseEvent> dirtyExpenses = new ArrayList<>();
    private final List<InvoiceEvent> dirtyInvoices = new ArrayList<>();
    private final List<SupplierPaymentEvent> dirtySupplierPayments = new ArrayList<>();
    private final List<StockCountEvent> dirtyStockCounts = new ArrayList<>();
    private final List<GoodsReceiptInEvent> dirtyGoodsReceiptIns = new ArrayList<>();
    private final Map<Long, Set<Long>> dirtyStockItemsByOutlet = new HashMap<>();
    private final List<Map.Entry<String, String>> dirtyItemCategories = new ArrayList<>();
    private final List<Map.Entry<String, String>> dirtyProductCategories = new ArrayList<>();
    private final List<Map.Entry<String, String>> dirtyUoms = new ArrayList<>();
    // New table tracking
    private final List<OrderingTableEvent> dirtyOrderingTables = new ArrayList<>();
    private final List<WorkShiftEvent> dirtyWorkShifts = new ArrayList<>();
    private final List<ShiftEvent> dirtyShifts = new ArrayList<>();
    private final List<PromotionScopeEvent> dirtyPromotionScopes = new ArrayList<>();
    private final List<SaleItemPromotionEvent> dirtySaleItemPromotions = new ArrayList<>();
    private final List<ExpenseSubtypeEvent> dirtyExpenseSubtypes = new ArrayList<>();
    private final List<AuthSessionEvent> dirtyAuthSessions = new ArrayList<>();
    private final List<AuditLogEvent> dirtyAuditLogs = new ArrayList<>();
    private final List<InventoryAdjustmentEvent> dirtyInventoryAdjustments = new ArrayList<>();
    private final List<PosReconciliationEvent> dirtyReconciliations = new ArrayList<>();

    // --- Ordering table tracking (for dine-in sale linking) ---
    private final Map<Long, List<Long>> outletOrderingTableIds = new HashMap<>();

    public SimulationContext(SimulationConfig config, boolean writeEnabled) {
        this.config = config;
        this.random = new SimulationRandom(config.seed());
        this.clock = new SimulationClock(config.startDate());
        this.idGen = new SimulatorIdGenerator();
        this.writeEnabled = writeEnabled;
    }

    // --- Accessors ---
    public SimulationConfig getConfig() { return config; }
    public SimulationRandom getRandom() { return random; }
    public SimulationClock getClock() { return clock; }
    public SimulatorIdGenerator getIdGen() { return idGen; }
    public String getNamespace() { return config.namespace(); }
    public boolean isWriteEnabled() { return writeEnabled; }

    // --- Outlets ---
    public Map<Long, SimOutlet> getOutlets() { return outlets; }
    public List<SimOutlet> getActiveOutlets() {
        return outlets.values().stream().filter(SimOutlet::isActive).toList();
    }
    public long countActiveOutletsInSubregion(String subregionCode) {
        return outlets.values().stream()
                .filter(SimOutlet::isActive)
                .filter(outlet -> outlet.getSubregionCode().equals(subregionCode))
                .count();
    }
    public long countActiveOutletsInCountry(String regionCode) {
        String countryCode = com.fern.simulator.economics.RegionalEconomics.countryCode(regionCode);
        return outlets.values().stream()
                .filter(SimOutlet::isActive)
                .filter(outlet -> com.fern.simulator.economics.RegionalEconomics.countryCode(outlet.getRegionCode()).equals(countryCode))
                .count();
    }
    public double averageActiveOutletReputation(String regionCode) {
        String countryCode = com.fern.simulator.economics.RegionalEconomics.countryCode(regionCode);
        return outlets.values().stream()
                .filter(SimOutlet::isActive)
                .filter(outlet -> com.fern.simulator.economics.RegionalEconomics.countryCode(outlet.getRegionCode()).equals(countryCode))
                .mapToDouble(SimOutlet::getReputationScore)
                .average()
                .orElse(0.98);
    }
    public void addOutlet(SimOutlet outlet) {
        outlets.put(outlet.getId(), outlet);
        dirtyOutlets.add(outlet);
    }
    public void registerOrderingTable(long outletId, long tableId) {
        outletOrderingTableIds.computeIfAbsent(outletId, ignored -> new ArrayList<>()).add(tableId);
    }
    public Long getRandomOrderingTableId(long outletId) {
        List<Long> tableIds = outletOrderingTableIds.get(outletId);
        if (tableIds == null || tableIds.isEmpty()) return null;
        return tableIds.get(random.intBetween(0, tableIds.size() - 1));
    }
    public void markOutletDirty(SimOutlet outlet) { dirtyOutletUpdates.add(outlet); }
    public void registerShiftForOutlet(long outletId, String blockCode, long shiftId) {
        outletShiftIds.computeIfAbsent(outletId, ignored -> new LinkedHashMap<>())
                .putIfAbsent(blockCode, shiftId);
    }
    public long getShiftIdForOutlet(long outletId) {
        Map<String, Long> blocks = outletShiftIds.get(outletId);
        if (blocks == null || blocks.isEmpty()) {
            return 0L;
        }
        return blocks.values().iterator().next();
    }
    public long getShiftIdForOutlet(long outletId, String blockCode) {
        Map<String, Long> blocks = outletShiftIds.get(outletId);
        if (blocks == null || blocks.isEmpty()) {
            return 0L;
        }
        if (blockCode == null || blockCode.isBlank()) {
            return getShiftIdForOutlet(outletId);
        }
        return blocks.getOrDefault(blockCode, getShiftIdForOutlet(outletId));
    }

    // --- Employees ---
    public List<SimEmployee> getAllEmployees() { return allEmployees; }
    public List<SimEmployee> getActiveEmployees() {
        return allEmployees.stream().filter(SimEmployee::isActive).toList();
    }
    public List<SimEmployee> getActiveEmployeesAtOutlet(long outletId) {
        return employeesByOutlet.getOrDefault(outletId, List.of()).stream()
                .filter(e -> e.isActive() && e.getOutletId() == outletId)
                .toList();
    }
    public void addEmployee(SimEmployee emp) {
        allEmployees.add(emp);
        employeesByOutlet.computeIfAbsent(emp.getOutletId(), ignored -> new ArrayList<>()).add(emp);
        employeesByUserId.put(emp.getUserId(), emp);
        dirtyEmployees.add(emp);
    }
    public void markEmployeeDirty(SimEmployee emp) { dirtyEmployeeUpdates.add(emp); }
    public SimEmployee findEmployee(long userId) { return employeesByUserId.get(userId); }

    // --- Items & Stock ---
    public Map<Long, SimItem> getItems() { return items; }
    public void addItem(SimItem item) {
        items.put(item.getId(), item);
        dirtyItems.add(item);
    }

    public SimItem getOutletStock(long outletId, long itemId) {
        return outletStock.computeIfAbsent(outletId, k -> new HashMap<>()).get(itemId);
    }

    public void initOutletStock(long outletId, SimItem item) {
        outletStock.computeIfAbsent(outletId, k -> new HashMap<>()).put(item.getId(), item);
        outletLots.computeIfAbsent(outletId, ignored -> new HashMap<>())
                .computeIfAbsent(item.getId(), ignored -> new ArrayDeque<>());
        markStockDirty(outletId, item.getId());
    }

    public void addStock(long outletId, long itemId, int qty) {
        addInventoryLot(outletId, itemId, qty, clock.getCurrentDate(), clock.getCurrentDate(), null, "adjustment");
    }

    public void removeStock(long outletId, long itemId, int qty) {
        SimItem stock = getOutletStock(outletId, itemId);
        if (stock == null) return;
        consumeStock(outletId, itemId, qty);
        markStockDirty(outletId, itemId);
    }

    public void setStockLevel(long outletId, long itemId, int qty) {
        SimItem stock = getOutletStock(outletId, itemId);
        if (stock == null) return;
        int delta = qty - stock.getCurrentStock();
        if (delta > 0) {
            addInventoryLot(outletId, itemId, delta, clock.getCurrentDate(), clock.getCurrentDate(), null, "reconciliation");
        } else if (delta < 0) {
            consumeStock(outletId, itemId, -delta);
        }
        markStockDirty(outletId, itemId);
    }

    public void markStockDirty(long outletId, long itemId) {
        dirtyStockItemsByOutlet.computeIfAbsent(outletId, ignored -> new LinkedHashSet<>()).add(itemId);
    }

    public Set<Long> getDirtyStockItems(long outletId) {
        return dirtyStockItemsByOutlet.getOrDefault(outletId, Set.of());
    }

    public void addInventoryLot(long outletId, long itemId, int qty, LocalDate receivedDate,
                                LocalDate manufactureDate, LocalDate expiryDate, String sourceRef) {
        if (qty <= 0) {
            return;
        }
        SimItem stock = getOutletStock(outletId, itemId);
        if (stock == null) {
            return;
        }
        LocalDate resolvedManufacture = manufactureDate != null ? manufactureDate : receivedDate;
        LocalDate resolvedExpiry = expiryDate != null ? expiryDate
                : resolvedManufacture.plusDays(Math.max(1, stock.getShelfLifeDays()));
        outletLots.computeIfAbsent(outletId, ignored -> new HashMap<>())
                .computeIfAbsent(itemId, ignored -> new ArrayDeque<>())
                .addLast(new StockLot(qty, receivedDate, resolvedManufacture, resolvedExpiry, sourceRef));
        stock.addStock(qty);
        markStockDirty(outletId, itemId);
    }

    public int consumeStock(long outletId, long itemId, int qty) {
        if (qty <= 0) {
            return 0;
        }
        SimItem stock = getOutletStock(outletId, itemId);
        if (stock == null || stock.getCurrentStock() <= 0) {
            return 0;
        }
        int remaining = qty;
        Deque<StockLot> lots = outletLots.computeIfAbsent(outletId, ignored -> new HashMap<>())
                .computeIfAbsent(itemId, ignored -> new ArrayDeque<>());
        while (remaining > 0 && !lots.isEmpty()) {
            StockLot lot = lots.removeFirst();
            int consumed = Math.min(remaining, lot.qty());
            remaining -= consumed;
            int leftover = lot.qty() - consumed;
            if (leftover > 0) {
                lots.addFirst(lot.withQty(leftover));
            }
        }
        int consumedTotal = qty - remaining;
        stock.removeStock(consumedTotal);
        markStockDirty(outletId, itemId);
        return consumedTotal;
    }

    public int expireLots(long outletId, long itemId, LocalDate day) {
        Deque<StockLot> lots = getLots(outletId, itemId);
        if (lots.isEmpty()) {
            return 0;
        }
        int expired = 0;
        Deque<StockLot> kept = new ArrayDeque<>();
        while (!lots.isEmpty()) {
            StockLot lot = lots.removeFirst();
            if (lot.expiryDate() != null && lot.expiryDate().isBefore(day.plusDays(1))) {
                expired += lot.qty();
            } else {
                kept.addLast(lot);
            }
        }
        outletLots.computeIfAbsent(outletId, ignored -> new HashMap<>()).put(itemId, kept);
        if (expired > 0) {
            SimItem stock = getOutletStock(outletId, itemId);
            if (stock != null) {
                stock.removeStock(expired);
            }
            markStockDirty(outletId, itemId);
        }
        return expired;
    }

    public int wasteStock(long outletId, long itemId, int qty) {
        return consumeStock(outletId, itemId, qty);
    }

    public int transferStock(long sourceOutletId, long targetOutletId, long itemId, int qty,
                             LocalDate transferDate, String sourceRef) {
        if (qty <= 0 || sourceOutletId == targetOutletId) {
            return 0;
        }
        SimItem sourceStock = getOutletStock(sourceOutletId, itemId);
        SimItem targetStock = getOutletStock(targetOutletId, itemId);
        if (sourceStock == null || targetStock == null || sourceStock.getCurrentStock() <= 0) {
            return 0;
        }

        int remaining = Math.min(qty, sourceStock.getCurrentStock());
        int movedTotal = 0;
        Deque<StockLot> lots = getLots(sourceOutletId, itemId);
        while (remaining > 0 && !lots.isEmpty()) {
            StockLot lot = lots.removeFirst();
            int movedQty = Math.min(remaining, lot.qty());
            remaining -= movedQty;
            movedTotal += movedQty;

            if (lot.qty() > movedQty) {
                lots.addFirst(lot.withQty(lot.qty() - movedQty));
            }

            addInventoryLot(targetOutletId, itemId, movedQty, transferDate,
                    lot.manufactureDate(), lot.expiryDate(),
                    sourceRef != null ? sourceRef : "internal-transfer");
        }

        if (movedTotal <= 0) {
            return 0;
        }

        sourceStock.removeStock(movedTotal);
        markStockDirty(sourceOutletId, itemId);
        return movedTotal;
    }

    public void reconcileLots(long outletId, long itemId, int targetQty, LocalDate day) {
        SimItem stock = getOutletStock(outletId, itemId);
        if (stock == null) {
            return;
        }
        int current = stock.getCurrentStock();
        if (targetQty < current) {
            consumeStock(outletId, itemId, current - targetQty);
        } else if (targetQty > current) {
            addInventoryLot(outletId, itemId, targetQty - current, day, day, null, "stock-count");
        }
    }

    public int getCurrentCarryoverDemand(long outletId) {
        int carryoverDays = config.realism() != null ? config.realism().stockoutCarryoverDays() : 7;
        return (int) unmetDemandCarryover.computeIfAbsent(outletId,
                ignored -> new long[Math.max(1, carryoverDays)])[0];
    }

    public void addUnmetDemand(long outletId, int units, long lostValue) {
        if (units <= 0) {
            return;
        }
        long recognizedLostValue = recognizeLostSalesValue(lostValue, false);
        SimOutlet outlet = outlets.get(outletId);
        if (outlet != null) {
            outlet.addStockoutLostSalesValue(recognizedLostValue);
            scheduleCarryoverDemand(outlet, outletId, units, false);
        }
        if (currentMonth != null) {
            currentMonth.addStockout(recognizedLostValue);
        }
        currentOperationalSummary().stockouts += units;
        currentOperationalSummary().lostSalesValue += recognizedLostValue;
        currentOperationalSummary().stockoutLostSalesValue += recognizedLostValue;
    }

    public void addServiceConstrainedDemand(long outletId, int units, long lostValue) {
        if (units <= 0) {
            return;
        }
        long recognizedLostValue = recognizeLostSalesValue(lostValue, true);
        SimOutlet outlet = outlets.get(outletId);
        if (outlet != null) {
            outlet.addServiceLostSalesValue(recognizedLostValue);
            outlet.recordServiceConstrainedOrders(units);
            scheduleCarryoverDemand(outlet, outletId, units, true);
        }
        if (currentMonth != null) {
            currentMonth.addDemandLoss(recognizedLostValue);
        }
        currentOperationalSummary().lostSalesValue += recognizedLostValue;
        currentOperationalSummary().serviceLostSalesValue += recognizedLostValue;
    }

    public void addBasketShrinkDemand(long outletId, long lostValue) {
        if (lostValue <= 0) {
            return;
        }
        SimOutlet outlet = outlets.get(outletId);
        if (outlet != null) {
            outlet.addBasketShrinkLostSalesValue(lostValue);
        }
        if (currentMonth != null) {
            currentMonth.addBasketShrinkLoss(lostValue);
        }
        currentOperationalSummary().lostSalesValue += lostValue;
        currentOperationalSummary().basketShrinkLostSalesValue += lostValue;
    }

    public long totalCarryoverDemand(long outletId) {
        long[] schedule = unmetDemandCarryover.get(outletId);
        if (schedule == null) {
            return 0;
        }
        long total = 0;
        for (long value : schedule) {
            total += value;
        }
        return total;
    }

    public double supplierReliability(long supplierId) {
        return supplierReliability.getOrDefault(supplierId, 0.88);
    }

    public void markSupplierLate(long supplierId) {
        supplierLateDeliveries.merge(supplierId, 1, Integer::sum);
        supplierReliability.compute(supplierId, (id, current) -> Math.max(0.55, (current != null ? current : 0.88) - 0.05));
        currentOperationalSummary().lateDeliveries++;
        if (currentMonth != null) {
            currentMonth.addLateDelivery();
        }
    }

    public void markSupplierPartial(long supplierId) {
        supplierReliability.compute(supplierId, (id, current) -> Math.max(0.60, (current != null ? current : 0.88) - 0.03));
        currentOperationalSummary().partialDeliveries++;
        if (currentMonth != null) {
            currentMonth.addPartialDelivery();
        }
    }

    public void markSupplierRecovered(long supplierId) {
        supplierReliability.compute(supplierId, (id, current) -> Math.min(0.98, (current != null ? current : 0.88) + 0.01));
    }

    public int supplierLateCount(long supplierId) {
        return supplierLateDeliveries.getOrDefault(supplierId, 0);
    }

    public Deque<StockLot> getLots(long outletId, long itemId) {
        return outletLots.computeIfAbsent(outletId, ignored -> new HashMap<>())
                .computeIfAbsent(itemId, ignored -> new ArrayDeque<>());
    }

    // --- Products ---
    public Map<Long, SimProduct> getProducts() { return products; }
    public void addProduct(SimProduct product) {
        products.put(product.id(), product);
        dirtyProducts.add(product);
    }

    // --- Suppliers ---
    public Map<Long, SimSupplier> getSuppliers() { return suppliers; }
    public void addSupplier(SimSupplier supplier) {
        suppliers.put(supplier.id(), supplier);
        supplierReliability.putIfAbsent(supplier.id(), random.doubleBetween(0.80, 0.96));
        dirtySuppliers.add(supplier);
    }

    // --- Promotions ---
    public List<SimPromotion> getPromotions() { return promotions; }
    public List<SimPromotion> getActivePromotions() {
        return promotions.stream().filter(SimPromotion::isActive).toList();
    }
    public List<SimPromotion> getActivePromotionsForOutlet(long outletId) {
        return promotions.stream()
                .filter(SimPromotion::isActive)
                .filter(promo -> promotionOutletScopes.getOrDefault(promo.getId(), Set.of()).contains(outletId))
                .toList();
    }
    public void addPromotion(SimPromotion promo) {
        promotions.add(promo);
        dirtyPromotions.add(promo);
    }
    public void registerPromotionScope(long promotionId, long outletId) {
        promotionOutletScopes.computeIfAbsent(promotionId, ignored -> new LinkedHashSet<>()).add(outletId);
    }

    // --- Categories & UOMs ---
    public void registerItemCategory(String code, String name) {
        long id = idGen.nextId();
        itemCategoryIds.put(code, id);
        dirtyItemCategories.add(Map.entry(code, name));
        incrementRowCount("item_category", 1);
    }
    public long getItemCategoryId(String code) {
        return itemCategoryIds.getOrDefault(code, 0L);
    }
    public String getItemCategoryName(String code) {
        return MenuData.ITEM_CATEGORIES.stream()
                .filter(c -> c.code().equals(code)).map(MenuData.ItemCategoryDef::name)
                .findFirst().orElse(code);
    }

    public void registerProductCategory(String code, String name) {
        long id = idGen.nextId();
        productCategoryIds.put(code, id);
        dirtyProductCategories.add(Map.entry(code, name));
        incrementRowCount("product_category", 1);
    }
    public long getProductCategoryId(String code) {
        return productCategoryIds.getOrDefault(code, 0L);
    }

    public void registerUom(String code, String name) {
        long id = idGen.nextId();
        uomIds.put(code, id);
        dirtyUoms.add(Map.entry(code, name));
        incrementRowCount("unit_of_measure", 1);
    }
    public long getUomId(String code) {
        return uomIds.getOrDefault(code, 0L);
    }
    public Map<String, Long> getItemCategoryIds() { return itemCategoryIds; }
    public Map<String, Long> getProductCategoryIds() { return productCategoryIds; }
    public Map<String, Long> getUomIds() { return uomIds; }
    public List<Map.Entry<String, String>> getDirtyItemCategories() { return dirtyItemCategories; }
    public List<Map.Entry<String, String>> getDirtyProductCategories() { return dirtyProductCategories; }
    public List<Map.Entry<String, String>> getDirtyUoms() { return dirtyUoms; }

    // --- GR Linking ---
    public void storeGoodsReceiptId(long poId, long grId) { poToGoodsReceiptId.put(poId, grId); }
    public Long lookupGoodsReceiptId(long poId) { return poToGoodsReceiptId.get(poId); }
    public void storeGoodsReceiptItemIds(long poId, Map<Long, Long> griIds) { poToGriIds.put(poId, griIds); }
    public Long lookupGoodsReceiptItemId(long poId, long itemId) {
        Map<Long, Long> griMap = poToGriIds.get(poId);
        return griMap != null ? griMap.get(itemId) : null;
    }

    // --- Composites ---
    public void registerCompositeRecipe(String name, MenuData.CompositeRecipe recipe) {
        compositeRecipes.put(name, recipe);
    }
    public Map<String, MenuData.CompositeRecipe> getCompositeRecipes() { return compositeRecipes; }
    public Map<Long, Map<Long, SimItem>> getOutletStockMap() { return outletStock; }

    // --- Regions ---
    public Set<String> getActiveRegionCodes() { return activeRegionCodes; }
    public Set<String> getActiveSubregionCodes() { return activeSubregionCodes; }
    public void activateRegion(String code, long id) {
        activateRegion(code, id, clock.getCurrentDate());
    }
    public void activateRegion(String code, long id, LocalDate activatedOn) {
        activeRegionCodes.add(code);
        regionCodeToId.put(code, id);
        regionActivatedOn.put(code, activatedOn);
        dirtyRegions.add(code);
    }
    public void activateSubregion(String code) {
        activateSubregion(code, clock.getCurrentDate());
    }
    public void activateSubregion(String code, LocalDate activatedOn) {
        activeSubregionCodes.add(code);
        subregionActivatedOn.putIfAbsent(code, activatedOn);
        // Subregions can be referenced directly by employee contracts and procurement flows.
        // Ensure they are materialized in core.region during persistence.
        regionCodeToId.computeIfAbsent(code, ignored -> idGen.nextId());
        dirtyRegions.add(code);
    }
    public Long getRegionId(String code) { return regionCodeToId.get(code); }
    public LocalDate getRegionActivatedOn(String code) { return regionActivatedOn.get(code); }
    public LocalDate getSubregionActivatedOn(String code) { return subregionActivatedOn.get(code); }
    /** Remap a region ID (e.g. when DB already has this region with a different ID). */
    public void remapRegionId(String code, long newId) {
        long oldId = regionCodeToId.getOrDefault(code, -1L);
        regionCodeToId.put(code, newId);
        // Fix all outlets that reference the old region ID
        for (SimOutlet outlet : outlets.values()) {
            if (outlet.getRegionId() == oldId) {
                outlet.setRegionId(newId);
            }
        }
    }
    public String getCurrentExpansionTier() { return currentExpansionTier; }
    public void setCurrentExpansionTier(String tier) { this.currentExpansionTier = tier; }

    // --- Pending POs ---
    public List<PendingPurchaseOrder> getPendingPOs() { return pendingPOs; }
    public void addPendingPO(PendingPurchaseOrder po) {
        pendingPOs.add(po);
        dirtyPOs.add(po);
    }
    public void markGoodsReceived(GoodsReceiptEvent receipt) { dirtyGoodsReceipts.add(receipt); }

    // --- Pending Replacements ---
    public List<PendingReplacement> getPendingReplacements() { return pendingReplacements; }
    public void addPendingReplacement(PendingReplacement r) { pendingReplacements.add(r); }

    // --- Sale Events ---
    public void addSaleEvent(SaleEvent sale) { dirtySales.add(sale); }
    public List<SaleEvent> getDirtySales() { return dirtySales; }

    // --- Payroll Events ---
    public void addPayrollEvent(PayrollEvent payroll) { dirtyPayrolls.add(payroll); }
    public List<PayrollEvent> getDirtyPayrolls() { return dirtyPayrolls; }

    // --- Waste Events ---
    public void addWasteEvent(WasteEvent waste) { dirtyWasteRecords.add(waste); }
    public List<WasteEvent> getDirtyWasteRecords() { return dirtyWasteRecords; }

    // --- Manufacturing Events ---
    public void addManufacturingEvent(ManufacturingEvent evt) { dirtyManufacturing.add(evt); }
    public List<ManufacturingEvent> getDirtyManufacturing() { return dirtyManufacturing; }

    // --- Expense Events ---
    public void addExpenseEvent(ExpenseEvent evt) { dirtyExpenses.add(evt); }
    public List<ExpenseEvent> getDirtyExpenses() { return dirtyExpenses; }

    // --- Invoice Events ---
    public void addInvoiceEvent(InvoiceEvent evt) { dirtyInvoices.add(evt); }
    public List<InvoiceEvent> getDirtyInvoices() { return dirtyInvoices; }

    // --- Supplier Payment Events ---
    public void addSupplierPaymentEvent(SupplierPaymentEvent evt) { dirtySupplierPayments.add(evt); }
    public List<SupplierPaymentEvent> getDirtySupplierPayments() { return dirtySupplierPayments; }

    // --- Sequences ---
    public String nextOutletCode() { return config.namespace() + "-OUT-" + String.format("%04d", ++outletSeq); }
    public String nextEmployeeCode() { return config.namespace() + "-EMP-" + String.format("%04d", ++employeeSeq); }
    public String nextSupplierCode() { return config.namespace() + "-SUP-" + String.format("%04d", ++supplierSeq); }
    public String nextItemCode() { return config.namespace() + "-ITEM-" + String.format("%04d", ++itemSeq); }
    public String nextProductCode() { return config.namespace() + "-PROD-" + String.format("%04d", ++productSeq); }
    public String nextPromotionCode() { return config.namespace() + "-PROMO-" + String.format("%04d", ++promotionSeq); }

    // --- Month tracking ---
    public MonthSummary getCurrentMonth() { return currentMonth; }
    public void advanceToDay(LocalDate day) {
        clock.advanceTo(day);
        rollCarryoverDemand();
        currentOperationalSummary = new DailyOperationalSummary(day);
        manufacturingLaborMinutesToday.clear();
        outlets.values().forEach(outlet -> {
            outlet.decayAttendanceStress();
            outlet.easeLateDeliveryPressure();
        });
        allEmployees.stream()
                .filter(SimEmployee::isActive)
                .forEach(employee -> employee.setFatigueScore(Math.max(0.0, employee.getFatigueScore() - 0.18)));
        if (currentMonth == null || currentMonth.getMonth() != day.getMonthValue()
                || currentMonth.getYear() != day.getYear()) {
            if (currentMonth != null) {
                allMonths.add(currentMonth);
            }
            currentMonth = new MonthSummary(day.getYear(), day.getMonthValue());

            // Reset per-outlet monthly counters
            outlets.values().forEach(SimOutlet::resetMonthlyCounters);
        }
    }
    public List<MonthSummary> getAllMonths() { return allMonths; }
    public MonthSummary getMonthSummary(int year, int month) {
        if (currentMonth != null && currentMonth.getYear() == year && currentMonth.getMonth() == month) {
            return currentMonth;
        }
        for (MonthSummary summary : allMonths) {
            if (summary.getYear() == year && summary.getMonth() == month) {
                return summary;
            }
        }
        return null;
    }

    public DailyOperationalSummary currentOperationalSummary() {
        if (currentOperationalSummary == null) {
            currentOperationalSummary = new DailyOperationalSummary(clock.getCurrentDate());
        }
        return currentOperationalSummary;
    }

    public void finalize(MonthSummary lastMonth) {
        if (lastMonth != null && !allMonths.contains(lastMonth)) {
            allMonths.add(lastMonth);
        }
    }

    // --- Row counts ---
    public void incrementRowCount(String table, long count) {
        rowCounts.merge(table, count, Long::sum);
    }
    public Map<String, Long> getRowCounts() { return rowCounts; }

    public void recordManufacturingLabor(long outletId, int laborMinutes) {
        if (laborMinutes <= 0) {
            return;
        }
        manufacturingLaborMinutesToday.merge(outletId, laborMinutes, Integer::sum);
    }

    public int getManufacturingLaborToday(long outletId) {
        return manufacturingLaborMinutesToday.getOrDefault(outletId, 0);
    }

    public void recordWorkedShift(long userId, long outletId, long shiftId, LocalDate workDate,
                                  double workHours, String attendanceStatus, boolean overtime) {
        workedShiftHistory.computeIfAbsent(userId, ignored -> new ArrayList<>())
                .add(new WorkedShiftRecord(workDate, workHours, attendanceStatus, outletId, shiftId, overtime));
        switch (attendanceStatus) {
            case "absent", "leave" -> {
                if (currentMonth != null) {
                    currentMonth.addAbsentShift();
                }
                currentOperationalSummary().absentShifts++;
            }
            case "late" -> {
                if (currentMonth != null) {
                    currentMonth.addLateShift();
                }
                currentOperationalSummary().lateShifts++;
            }
            default -> {
            }
        }
        if (overtime) {
            if (currentMonth != null) {
                currentMonth.addOvertimeShift();
            }
            currentOperationalSummary().overtimeShifts++;
        }
    }

    public List<WorkedShiftRecord> getWorkedShifts(long userId) {
        return workedShiftHistory.getOrDefault(userId, List.of());
    }

    public Map<String, Object> dailyOperationalSnapshot() {
        DailyOperationalSummary summary = currentOperationalSummary();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("date", summary.date().toString());
        data.put("wasteEvents", summary.wasteEvents);
        data.put("wasteCost", summary.wasteCost);
        data.put("stockouts", summary.stockouts);
        data.put("lostSalesValue", summary.lostSalesValue);
        data.put("stockoutLostSalesValue", summary.stockoutLostSalesValue);
        data.put("serviceLostSalesValue", summary.serviceLostSalesValue);
        data.put("basketShrinkLostSalesValue", summary.basketShrinkLostSalesValue);
        data.put("lateDeliveries", summary.lateDeliveries);
        data.put("partialDeliveries", summary.partialDeliveries);
        data.put("absentShifts", summary.absentShifts);
        data.put("lateShifts", summary.lateShifts);
        data.put("overtimeShifts", summary.overtimeShifts);
        data.put("quits", summary.quits);
        data.put("replacements", summary.replacements);
        data.put("carryoverDemand", getActiveOutlets().stream()
                .mapToLong(outlet -> totalCarryoverDemand(outlet.getId()))
                .sum());
        return data;
    }

    public void recordWasteImpact(long qty, long wasteCost, String reason) {
        if (currentMonth != null) {
            currentMonth.addWasteEvent(wasteCost);
        }
        currentOperationalSummary().wasteEvents++;
        currentOperationalSummary().wasteCost += wasteCost;
        currentOperationalSummary().wasteReasons.merge(reason, (int) qty, Integer::sum);
    }

    public void recordQuit() {
        if (currentMonth != null) {
            currentMonth.addQuit();
        }
        currentOperationalSummary().quits++;
    }

    public void recordReplacement() {
        if (currentMonth != null) {
            currentMonth.addReplacement();
        }
        currentOperationalSummary().replacements++;
    }

    private void scheduleCarryoverDemand(SimOutlet outlet, long outletId, int units, boolean serviceConstrained) {
        double configuredCarryoverRate = config.realism() != null ? config.realism().stockoutCarryoverRate() : 0.45;
        double carryoverRate = serviceConstrained ? configuredCarryoverRate * 0.48 : configuredCarryoverRate * 0.96;
        outlet.addUnmetDemandCarryover(units * carryoverRate);

        int carryoverDays = config.realism() != null ? config.realism().stockoutCarryoverDays() : 7;
        List<Integer> weights = config.realism() != null && config.realism().stockoutCarryoverWeights() != null
                ? config.realism().stockoutCarryoverWeights()
                : List.of(28, 20, 16, 12, 10, 8, 6);
        if (serviceConstrained) {
            weights = List.of(38, 30, 20, 12);
        }
        long[] schedule = unmetDemandCarryover.computeIfAbsent(outletId,
                ignored -> new long[Math.max(1, carryoverDays)]);
        int carryoverUnits = (int) Math.round(units * carryoverRate);
        int totalWeight = weights.stream().mapToInt(Integer::intValue).sum();
        for (int i = 0; i < Math.min(schedule.length, weights.size()); i++) {
            schedule[i] += Math.round((double) carryoverUnits * weights.get(i) / Math.max(1, totalWeight));
        }
    }

    private long recognizeLostSalesValue(long lostValue, boolean serviceConstrained) {
        double carryoverRate = config.realism() != null ? config.realism().stockoutCarryoverRate() : 0.45;
        // Service failures are more terminal than stockouts. Stockouts still lose revenue,
        // but a meaningful share is recovered through later visits, substitutions, and
        // basket adjustments that the simulator already models elsewhere.
        double deferredRecovery = serviceConstrained ? carryoverRate * 0.46 : carryoverRate * 0.94;
        double sameDayRecovery = serviceConstrained ? 0.36 : 0.13;
        double substitutionRecovery = serviceConstrained ? 0.30 : 0.33;
        double realizedShare = serviceConstrained
                ? clamp(1.0 - deferredRecovery - sameDayRecovery - substitutionRecovery, 0.08, 0.28)
                : clamp(1.0 - deferredRecovery - sameDayRecovery - substitutionRecovery, 0.06, 0.30);
        return Math.max(0L, Math.round(lostValue * realizedShare));
    }

    private void rollCarryoverDemand() {
        for (var entry : unmetDemandCarryover.entrySet()) {
            long[] schedule = entry.getValue();
            long todayCarryover = schedule.length > 0 ? schedule[0] : 0;
            if (schedule.length > 1) {
                System.arraycopy(schedule, 1, schedule, 0, schedule.length - 1);
            }
            schedule[schedule.length - 1] = 0;
            SimOutlet outlet = outlets.get(entry.getKey());
            if (outlet != null && todayCarryover > 0) {
                outlet.consumeUnmetDemandCarryover(todayCarryover);
            }
        }
    }

    // --- ZoneId lookup ---
    public ZoneId getTimezoneForRegion(String regionCode) {
        if (config.regions() == null) return ZoneId.systemDefault();
        return config.regions().stream()
                .filter(r -> regionCode.startsWith(r.code()))
                .findFirst()
                .map(r -> ZoneId.of(r.timezone()))
                .orElse(ZoneId.systemDefault());
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    // ========== DIRTY GETTERS ==========
    public List<String> getDirtyRegions() { return dirtyRegions; }
    public List<SimOutlet> getDirtyOutlets() { return dirtyOutlets; }
    public List<SimOutlet> getDirtyOutletUpdates() { return dirtyOutletUpdates; }
    public List<SimItem> getDirtyItems() { return dirtyItems; }
    public List<SimSupplier> getDirtySuppliers() { return dirtySuppliers; }
    public List<SimProduct> getDirtyProducts() { return dirtyProducts; }
    public List<SimEmployee> getDirtyEmployees() { return dirtyEmployees; }
    public List<SimEmployee> getDirtyEmployeeUpdates() { return dirtyEmployeeUpdates; }
    public List<PendingPurchaseOrder> getDirtyPOs() { return dirtyPOs; }
    public List<GoodsReceiptEvent> getDirtyGoodsReceipts() { return dirtyGoodsReceipts; }
    public List<SimPromotion> getDirtyPromotions() { return dirtyPromotions; }

    /** Clear all dirty state after successful persistence. */
    public void clearDirtyState() {
        dirtyRegions.clear();
        dirtyOutlets.clear();
        dirtyOutletUpdates.clear();
        dirtyItems.clear();
        dirtySuppliers.clear();
        dirtyProducts.clear();
        dirtyEmployees.clear();
        dirtyEmployeeUpdates.clear();
        dirtyPOs.clear();
        dirtyGoodsReceipts.clear();
        dirtyPromotions.clear();
        dirtyPosSessions.clear();
        dirtySales.clear();
        dirtyPayrolls.clear();
        dirtyWasteRecords.clear();
        dirtyManufacturing.clear();
        dirtyExpenses.clear();
        dirtyInvoices.clear();
        dirtySupplierPayments.clear();
        dirtyStockCounts.clear();
        dirtyGoodsReceiptIns.clear();
        dirtyStockItemsByOutlet.clear();
        dirtyItemCategories.clear();
        dirtyProductCategories.clear();
        dirtyUoms.clear();
        dirtyOrderingTables.clear();
        dirtyWorkShifts.clear();
        dirtyShifts.clear();
        dirtyPromotionScopes.clear();
        dirtySaleItemPromotions.clear();
        dirtyExpenseSubtypes.clear();
        dirtyAuthSessions.clear();
        dirtyAuditLogs.clear();
        dirtyInventoryAdjustments.clear();
        dirtyReconciliations.clear();
    }

    // ========== EVENT RECORDS (for DayPersister) ==========

    public static final class PendingPurchaseOrder {
        private final long poId;
        private final long outletId;
        private final long supplierId;
        private final String regionCode;
        private final Map<Long, Integer> orderedQuantities;
        private final Map<Long, Integer> remainingQuantities;
        private final Map<Long, Integer> cumulativeReceivedQuantities;
        private LocalDate expectedDeliveryDate;
        private LocalDate nextReceiptDate;
        private LocalDate invoiceReadyDate;
        private final String currencyCode;
        private final long expectedTotal;
        private final Long createdByUserId;
        private final Long approvedByUserId;
        private final double supplierReliability;
        private final String note;
        private boolean late;
        private boolean partial;

        public PendingPurchaseOrder(long poId, long outletId, long supplierId, String regionCode,
                                    Map<Long, Integer> orderedQuantities, LocalDate expectedDeliveryDate,
                                    String currencyCode, long expectedTotal, Long createdByUserId,
                                    double supplierReliability, String note) {
            this.poId = poId;
            this.outletId = outletId;
            this.supplierId = supplierId;
            this.regionCode = regionCode;
            this.orderedQuantities = new LinkedHashMap<>(orderedQuantities);
            this.remainingQuantities = new LinkedHashMap<>(orderedQuantities);
            this.cumulativeReceivedQuantities = new LinkedHashMap<>();
            this.expectedDeliveryDate = expectedDeliveryDate;
            this.nextReceiptDate = expectedDeliveryDate;
            this.currencyCode = currencyCode;
            this.expectedTotal = expectedTotal;
            this.createdByUserId = createdByUserId;
            this.approvedByUserId = createdByUserId; // auto-approved POs
            this.supplierReliability = supplierReliability;
            this.note = note;
        }

        public long poId() { return poId; }
        public long outletId() { return outletId; }
        public long supplierId() { return supplierId; }
        public String regionCode() { return regionCode; }
        public Map<Long, Integer> itemQuantities() { return orderedQuantities; }
        public Map<Long, Integer> orderedQuantities() { return orderedQuantities; }
        public Map<Long, Integer> remainingQuantities() { return remainingQuantities; }
        public Map<Long, Integer> cumulativeReceivedQuantities() { return cumulativeReceivedQuantities; }
        public LocalDate expectedDeliveryDate() { return expectedDeliveryDate; }
        public LocalDate nextReceiptDate() { return nextReceiptDate; }
        public LocalDate invoiceReadyDate() { return invoiceReadyDate; }
        public String currencyCode() { return currencyCode; }
        public long expectedTotal() { return expectedTotal; }
        public Long createdByUserId() { return createdByUserId; }
        public Long approvedByUserId() { return approvedByUserId; }
        public double supplierReliability() { return supplierReliability; }
        public String note() { return note; }
        public boolean late() { return late; }
        public boolean partial() { return partial; }
        public boolean isComplete() { return remainingQuantities.values().stream().mapToInt(Integer::intValue).sum() <= 0; }

        public void setExpectedDeliveryDate(LocalDate expectedDeliveryDate) { this.expectedDeliveryDate = expectedDeliveryDate; }
        public void setNextReceiptDate(LocalDate nextReceiptDate) { this.nextReceiptDate = nextReceiptDate; }
        public void setInvoiceReadyDate(LocalDate invoiceReadyDate) { this.invoiceReadyDate = invoiceReadyDate; }
        public void setLate(boolean late) { this.late = late; }
        public void setPartial(boolean partial) { this.partial = partial; }

        public Map<Long, Integer> applyReceipt(Map<Long, Integer> deliveredQuantities) {
            Map<Long, Integer> accepted = new LinkedHashMap<>();
            for (var entry : deliveredQuantities.entrySet()) {
                int remaining = remainingQuantities.getOrDefault(entry.getKey(), 0);
                int delivered = Math.min(remaining, entry.getValue());
                if (delivered <= 0) {
                    continue;
                }
                remainingQuantities.put(entry.getKey(), remaining - delivered);
                cumulativeReceivedQuantities.merge(entry.getKey(), delivered, Integer::sum);
                accepted.put(entry.getKey(), delivered);
            }
            return accepted;
        }
    }

    public record PendingReplacement(
            long outletId, String regionCode, String roleCode, LocalDate scheduledDate
    ) {}

    public record SaleEvent(
            long saleId, long outletId, Long posSessionId, String currencyCode,
            String orderType, String status, String paymentStatus,
            long subtotal, long discount, long taxAmount, long totalAmount,
            List<SaleItemEvent> items,
            long paymentAmount, String paymentMethod,
            java.time.OffsetDateTime paymentTime,
            List<SaleTxnEvent> inventoryTransactions,
            String transactionRef, Long orderingTableId
    ) {}

    public record SaleItemEvent(
            long productId, long unitPrice, int qty,
            long discountAmount, long taxAmount, long lineTotal
    ) {}

    public record SaleTxnEvent(long txnId, long itemId, long productId, int qtyUsed) {}

    public record PayrollEvent(
            long periodId, long regionId, String periodName,
            LocalDate startDate, LocalDate endDate, LocalDate payDate,
            List<PayrollTimesheetEntry> timesheets
    ) {}

    public record PayrollTimesheetEntry(
            long timesheetId, long payrollId, long userId, Long outletId,
            int workDays, double workHours, double overtimeHours, double overtimeRate,
            int lateCount, double absentDays, Long approvedByUserId,
            String currencyCode, long baseSalary, long netSalary
    ) {}

    public record WasteEvent(long txnId, long outletId, long itemId,
                              int qty, String regionCode, String reason, Long approvedByUserId) {}

    public record ManufacturingEvent(
            long batchId, long outletId, String refCode, LocalDate businessDate,
            String note, Long createdByUserId,
            List<ManufacturingTxn> inputs,
            ManufacturingTxn output
    ) {}

    public record ManufacturingTxn(long txnId, long itemId, int qty, long unitCost) {}

    public record ExpenseEvent(
            long expenseId, long outletId, LocalDate businessDate,
            String currencyCode, long amount, String sourceType,
            String note, Long linkedId, Long createdByUserId
    ) {}

    public record InvoiceEvent(
            long invoiceId, String invoiceNumber, long supplierId,
            String currencyCode, LocalDate invoiceDate, LocalDate dueDate,
            long subtotal, long taxAmount, long totalAmount,
            long receiptId, String status, String note, List<InvoiceLineEvent> lines
    ) {}

    public record InvoiceLineEvent(
            int lineNumber, Long itemId, Long goodsReceiptItemId, int qtyInvoiced,
            long unitPrice, long taxAmount, long lineTotal,
            String description, double taxPercent
    ) {}

    public record SupplierPaymentEvent(
            long paymentId, long supplierId, String currencyCode,
            String paymentMethod, long amount, OffsetDateTime paymentTime,
            long invoiceId, String transactionRef, String note, Long createdByUserId
    ) {}

    public record StockCountEvent(
            long sessionId, long outletId, LocalDate countDate,
            Long countedByUserId, Long approvedByUserId, String note,
            List<StockCountLineEvent> lines
    ) {}

    public record StockCountLineEvent(
            long itemId, int systemQty, int countedQty
    ) {}

    public record GoodsReceiptInEvent(
            long txnId, long outletId, long itemId, int qty, long unitCost
    ) {}

    public record GoodsReceiptEvent(
            long poId, long outletId, long supplierId, String regionCode, String currencyCode,
            Map<Long, Integer> receivedQuantities, Map<Long, Integer> cumulativeReceivedQuantities,
            Map<Long, Integer> orderedQuantities,
            long totalPrice, OffsetDateTime receiptTime, LocalDate businessDate,
            String note, String supplierLotNumber, Long createdByUserId, Long approvedByUserId,
            boolean partial, boolean late, LocalDate manufactureDate, LocalDate expiryDate
    ) {}

    public record PosSessionEvent(
            long id, String sessionCode, long outletId, String currencyCode,
            Long managerId, OffsetDateTime openedAt, OffsetDateTime closedAt,
            LocalDate businessDate, String status
    ) {}

    // --- Dirty accessors for new events ---
    public void addPosSessionEvent(PosSessionEvent event) { dirtyPosSessions.add(event); }
    public List<PosSessionEvent> getDirtyPosSessions() { return dirtyPosSessions; }
    public void addStockCountEvent(StockCountEvent event) { dirtyStockCounts.add(event); }
    public List<StockCountEvent> getDirtyStockCounts() { return dirtyStockCounts; }
    public void addGoodsReceiptInEvent(GoodsReceiptInEvent event) { dirtyGoodsReceiptIns.add(event); }
    public List<GoodsReceiptInEvent> getDirtyGoodsReceiptIns() { return dirtyGoodsReceiptIns; }

    // --- New table event records ---
    public record OrderingTableEvent(long id, long outletId, String tableCode, String displayName, String publicToken) {}
    public record ShiftEvent(long id, long outletId, String code, String name, String startTime, String endTime, int breakMinutes) {}
    public record WorkShiftEvent(
            long id, long shiftId, long userId, LocalDate workDate,
            String scheduleStatus, String attendanceStatus, String approvalStatus,
            OffsetDateTime actualStartTime, OffsetDateTime actualEndTime,
            Long assignedByUserId, Long approvedByUserId, String note
    ) {}
    public record PromotionScopeEvent(long promotionId, long outletId) {}
    public record SaleItemPromotionEvent(long saleId, long productId, long promotionId) {}
    public record ExpenseSubtypeEvent(long expenseRecordId, String subtype, String description, Long linkedId) {}
    public record AuthSessionEvent(String sessionId, long userId, OffsetDateTime issuedAt, OffsetDateTime expiresAt, String userAgent, String clientIp) {}
    public record AuditLogEvent(long id, Long actorUserId, String action, String entityName, String entityId, String reason) {}
    public record InventoryAdjustmentEvent(long txnId, long outletId, long itemId, int quantity,
                                            Long stockCountLineId, String reason, Long approvedByUserId) {}
    public record PosReconciliationEvent(
            long sessionId, Long reconciledByUserId, OffsetDateTime reconciledAt,
            long expectedTotal, long actualTotal, long discrepancyTotal, String note,
            List<PosReconciliationLineEvent> lines
    ) {}
    public record PosReconciliationLineEvent(
            String paymentMethod, long expectedAmount, long actualAmount, long discrepancyAmount
    ) {}
    public record StockLot(int qty, LocalDate receivedDate, LocalDate manufactureDate,
                           LocalDate expiryDate, String sourceRef) {
        public StockLot withQty(int newQty) {
            return new StockLot(newQty, receivedDate, manufactureDate, expiryDate, sourceRef);
        }
    }

    public record WorkedShiftRecord(LocalDate workDate, double workHours, String attendanceStatus,
                                    long outletId, long shiftId, boolean overtime) {}

    public static final class DailyOperationalSummary {
        private final LocalDate date;
        private int wasteEvents;
        private long wasteCost;
        private int stockouts;
        private long lostSalesValue;
        private long stockoutLostSalesValue;
        private long serviceLostSalesValue;
        private long basketShrinkLostSalesValue;
        private int lateDeliveries;
        private int partialDeliveries;
        private int absentShifts;
        private int lateShifts;
        private int overtimeShifts;
        private int quits;
        private int replacements;
        private final Map<String, Integer> wasteReasons = new LinkedHashMap<>();

        public DailyOperationalSummary(LocalDate date) {
            this.date = date;
        }

        public LocalDate date() { return date; }
    }

    // --- Dirty accessors for new tables ---
    public void addOrderingTableEvent(OrderingTableEvent e) { dirtyOrderingTables.add(e); }
    public List<OrderingTableEvent> getDirtyOrderingTables() { return dirtyOrderingTables; }
    public void addShiftEvent(ShiftEvent e) { dirtyShifts.add(e); }
    public List<ShiftEvent> getDirtyShifts() { return dirtyShifts; }
    public void addWorkShiftEvent(WorkShiftEvent e) { dirtyWorkShifts.add(e); }
    public List<WorkShiftEvent> getDirtyWorkShifts() { return dirtyWorkShifts; }
    public void addPromotionScopeEvent(PromotionScopeEvent e) { dirtyPromotionScopes.add(e); }
    public List<PromotionScopeEvent> getDirtyPromotionScopes() { return dirtyPromotionScopes; }
    public void addSaleItemPromotionEvent(SaleItemPromotionEvent e) { dirtySaleItemPromotions.add(e); }
    public List<SaleItemPromotionEvent> getDirtySaleItemPromotions() { return dirtySaleItemPromotions; }
    public void addExpenseSubtypeEvent(ExpenseSubtypeEvent e) { dirtyExpenseSubtypes.add(e); }
    public List<ExpenseSubtypeEvent> getDirtyExpenseSubtypes() { return dirtyExpenseSubtypes; }
    public void addAuthSessionEvent(AuthSessionEvent e) { dirtyAuthSessions.add(e); }
    public List<AuthSessionEvent> getDirtyAuthSessions() { return dirtyAuthSessions; }
    public void addAuditLogEvent(AuditLogEvent e) { dirtyAuditLogs.add(e); }
    public List<AuditLogEvent> getDirtyAuditLogs() { return dirtyAuditLogs; }
    public void addInventoryAdjustmentEvent(InventoryAdjustmentEvent e) { dirtyInventoryAdjustments.add(e); }
    public List<InventoryAdjustmentEvent> getDirtyInventoryAdjustments() { return dirtyInventoryAdjustments; }
    public void addReconciliationEvent(PosReconciliationEvent e) { dirtyReconciliations.add(e); }
    public List<PosReconciliationEvent> getDirtyReconciliations() { return dirtyReconciliations; }
}
