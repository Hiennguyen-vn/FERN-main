package com.fern.simulator.engine.phases;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.data.MenuData;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.SimItem;
import com.fern.simulator.model.SimOutlet;
import com.fern.simulator.model.SimProduct;
import com.fern.simulator.model.SimSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.LocalDate;
import java.util.*;

/**
 * Phase 2: Creates a realistic Vietnamese restaurant catalog from MenuData.
 * <p>
 * Creates item categories, UOMs, ~73 base ingredients, 6 composite ingredients,
 * ~60 menu products with fixed recipes, and 7 suppliers.
 */
public class CatalogPhase implements PhaseHandler {

    private static final Logger log = LoggerFactory.getLogger(CatalogPhase.class);

    @Override
    public String name() { return "Catalog"; }

    @Override
    public void execute(SimulationContext ctx, LocalDate day) {
        List<SimOutlet> newOutlets = ctx.getOutlets().values().stream()
                .filter(o -> o.getOpenedDate().equals(day) && o.isActive())
                .toList();

        if (newOutlets.isEmpty()) return;

        if (ctx.getItems().isEmpty()) {
            createItemCategories(ctx);
            createUoms(ctx);
            createItems(ctx);
            createSuppliers(ctx);
        }

        if (ctx.getProducts().isEmpty()) {
            createProductCategories(ctx);
            createProducts(ctx);
        }

        for (SimOutlet outlet : newOutlets) {
            initializeOutletStock(ctx, outlet);
            log.debug("Initialized catalog for outlet {} on {}", outlet.getCode(), day);
        }
    }

    private void createItemCategories(SimulationContext ctx) {
        for (MenuData.ItemCategoryDef cat : MenuData.ITEM_CATEGORIES) {
            ctx.registerItemCategory(cat.code(), cat.name());
        }
        log.info("Created {} item categories", MenuData.ITEM_CATEGORIES.size());
    }

    private void createProductCategories(SimulationContext ctx) {
        for (MenuData.ProductCategoryDef cat : MenuData.PRODUCT_CATEGORIES) {
            ctx.registerProductCategory(cat.code(), cat.name());
        }
        log.info("Created {} product categories", MenuData.PRODUCT_CATEGORIES.size());
    }

    private void createUoms(SimulationContext ctx) {
        for (MenuData.UomDef uom : MenuData.UOMS) {
            ctx.registerUom(uom.code(), uom.name());
        }
        log.info("Created {} units of measure", MenuData.UOMS.size());
    }

    private void createItems(SimulationContext ctx) {
        // Base ingredients
        for (MenuData.IngredientDef def : MenuData.INGREDIENTS) {
            long id = ctx.getIdGen().nextId();
            String code = ctx.nextItemCode();
            long catId = ctx.getItemCategoryId(def.category());
            long uomId = ctx.getUomId(def.uom());
            SimulationConfig.WasteProfile profile = resolveWasteProfile(ctx, def.category(), def.name(), false);

            SimItem item = new SimItem(id, code, def.name(), catId, def.category(),
                    uomId, def.uom(), def.unitCost(), false,
                    def.minStock(), def.maxStock(),
                    profile.perishabilityTier(), profile.shelfLifeDays(),
                    profile.prepWasteWeight(), profile.damageRiskWeight());
            ctx.addItem(item);
        }
        log.info("Created {} base ingredients", MenuData.INGREDIENTS.size());

        // Composite ingredients
        for (MenuData.CompositeRecipe comp : MenuData.COMPOSITES) {
            long id = ctx.getIdGen().nextId();
            String code = ctx.nextItemCode();
            long catId = ctx.getItemCategoryId("SAUCE"); // composites go under sauces
            long uomId = ctx.getUomId(comp.uom());
            SimulationConfig.WasteProfile profile = resolveWasteProfile(ctx, "SAUCE", comp.name(), true);

            SimItem item = new SimItem(id, code, comp.name(), catId, "SAUCE",
                    uomId, comp.uom(), comp.unitCost(), true,
                    comp.minStock(), comp.maxStock(),
                    profile.perishabilityTier(), profile.shelfLifeDays(),
                    profile.prepWasteWeight(), profile.damageRiskWeight());
            ctx.addItem(item);
            ctx.registerCompositeRecipe(comp.name(), comp);
        }
        log.info("Created {} composite ingredients", MenuData.COMPOSITES.size());
    }

    private void createSuppliers(SimulationContext ctx) {
        for (SimulationConfig.RegionConfig region : ctx.getConfig().regions()) {
            for (MenuData.SupplierDef def : MenuData.SUPPLIERS) {
                long id = ctx.getIdGen().nextId();
                String code = ctx.nextSupplierCode();
                ctx.addSupplier(new SimSupplier(
                        id,
                        code,
                        def.name() + " " + region.code(),
                        region.code(),
                        RegionalEconomics.currencyFor(region.code())));
            }
        }
        log.info("Created {} suppliers", ctx.getSuppliers().size());
    }

    private void createProducts(SimulationContext ctx) {
        Map<String, SimItem> itemsByName = new HashMap<>();
        for (SimItem item : ctx.getItems().values()) {
            itemsByName.put(item.getName(), item);
        }

        for (MenuData.ProductDef def : MenuData.PRODUCTS) {
            long productId = ctx.getIdGen().nextId();
            String code = ctx.nextProductCode();
            long recipeId = ctx.getIdGen().nextId();

            List<SimProduct.RecipeItem> recipeItems = new ArrayList<>();
            long totalCost = 0;
            boolean valid = true;

            for (MenuData.RecipeEntry entry : def.recipe()) {
                SimItem ingredient = itemsByName.get(entry.ingredientName());
                if (ingredient == null) {
                    log.warn("Skipping recipe entry '{}' for product '{}' — ingredient not found",
                            entry.ingredientName(), def.name());
                    valid = false;
                    break;
                }
                long recipeItemId = ctx.getIdGen().nextId();
                recipeItems.add(new SimProduct.RecipeItem(recipeId, recipeItemId,
                        ingredient.getId(), entry.qty(), ingredient.getUomCode()));
                totalCost += ingredient.getUnitCost() * entry.qty();
            }

            if (!valid || recipeItems.isEmpty()) continue;

            long catId = ctx.getProductCategoryId(def.category());

            ctx.addProduct(new SimProduct(productId, code, def.name(),
                    def.category(), catId, recipeItems,
                    def.price(), totalCost, "VND"));
        }
        log.info("Created {} products with fixed recipes", ctx.getProducts().size());
    }

    private void initializeOutletStock(SimulationContext ctx, SimOutlet outlet) {
        for (SimItem globalItem : ctx.getItems().values()) {
            SimItem outletItem = globalItem.copyForOutlet();
            ctx.initOutletStock(outlet.getId(), outletItem);
            LocalDate receivedDate = outlet.getOpenedDate().minusDays(ctx.getRandom().intBetween(0, 2));
            LocalDate manufactureDate = receivedDate.minusDays(ctx.getRandom().intBetween(0, 1));
            LocalDate expiryDate = manufactureDate.plusDays(Math.max(1, globalItem.getShelfLifeDays()));
            ctx.addInventoryLot(outlet.getId(), outletItem.getId(), openingStockLevel(globalItem),
                    receivedDate, manufactureDate, expiryDate, "opening-stock");
        }
    }

    private int openingStockLevel(SimItem item) {
        double multiplier = switch (item.getPerishabilityTier()) {
            case "very_high" -> item.isComposite() ? 0.95 : 1.00;
            case "high" -> item.isComposite() ? 1.00 : 1.08;
            case "medium" -> 1.22;
            case "low" -> 1.38;
            default -> 1.15;
        };
        int target = (int) Math.round(item.getMinStockLevel() * multiplier);
        return Math.max(item.getMinStockLevel(), Math.min(item.getMaxStockLevel(), target));
    }

    private SimulationConfig.WasteProfile resolveWasteProfile(SimulationContext ctx, String categoryCode,
                                                              String itemName, boolean composite) {
        Map<String, SimulationConfig.WasteProfile> profiles = ctx.getConfig().realism() != null
                ? ctx.getConfig().realism().categoryProfiles()
                : Map.of();
        SimulationConfig.WasteProfile base = profiles.getOrDefault(categoryCode,
                new SimulationConfig.WasteProfile("medium", composite ? 5 : 10, 0.15, 0.08, 0.01));
        String name = itemName.toLowerCase(Locale.ROOT);

        if (name.contains("shrimp") || name.contains("squid") || name.contains("fish")
                || name.contains("crab") || name.contains("tofu")
                || name.contains("bean sprouts") || name.contains("thai basil")
                || name.contains("mint") || name.contains("cilantro")
                || name.contains("perilla")) {
            return new SimulationConfig.WasteProfile("very_high",
                    Math.max(2, base.shelfLifeDays() - 1),
                    Math.min(0.55, base.prepWasteWeight() + 0.10),
                    Math.min(0.28, base.damageRiskWeight() + 0.08),
                    Math.min(0.05, base.incidentWasteChance() + 0.01));
        }

        if (composite || name.contains("broth") || name.contains("scallion oil")
                || name.contains("pickled") || name.contains("coconut milk")) {
            return new SimulationConfig.WasteProfile("high",
                    Math.max(3, base.shelfLifeDays() - 2),
                    Math.min(0.60, base.prepWasteWeight() + 0.14),
                    Math.min(0.22, base.damageRiskWeight() + 0.03),
                    Math.min(0.04, base.incidentWasteChance() + 0.005));
        }

        if (name.contains("rice") || name.contains("noodle") || name.contains("flour")
                || name.contains("sugar") || name.contains("salt") || name.contains("pepper")) {
            return new SimulationConfig.WasteProfile("low",
                    Math.max(base.shelfLifeDays(), 18),
                    Math.max(0.05, base.prepWasteWeight() * 0.5),
                    Math.max(0.03, base.damageRiskWeight() * 0.7),
                    Math.max(0.002, base.incidentWasteChance() * 0.6));
        }

        return base;
    }
}
