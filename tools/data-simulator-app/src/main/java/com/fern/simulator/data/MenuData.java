package com.fern.simulator.data;

import java.util.List;
import java.util.Map;

/**
 * Static data for a realistic Vietnamese restaurant menu.
 * All costs in VND per unit (gram/ml/piece).
 */
public final class MenuData {

    private MenuData() {}

    // ========== ITEM CATEGORIES ==========
    public record ItemCategoryDef(String code, String name) {}
    public static final List<ItemCategoryDef> ITEM_CATEGORIES = List.of(
        new ItemCategoryDef("PROTEIN",   "Proteins & Meats"),
        new ItemCategoryDef("NOODLE",    "Noodles & Rice"),
        new ItemCategoryDef("VEGETABLE", "Vegetables & Herbs"),
        new ItemCategoryDef("AROMATIC",  "Aromatics & Spices"),
        new ItemCategoryDef("SAUCE",     "Sauces & Condiments"),
        new ItemCategoryDef("EGG_DAIRY", "Eggs & Dairy")
    );

    // ========== PRODUCT CATEGORIES ==========
    public record ProductCategoryDef(String code, String name) {}
    public static final List<ProductCategoryDef> PRODUCT_CATEGORIES = List.of(
        new ProductCategoryDef("PHO_SOUP",   "Pho & Noodle Soups"),
        new ProductCategoryDef("RICE",       "Rice Dishes"),
        new ProductCategoryDef("BANH_MI",    "Banh Mi & Wraps"),
        new ProductCategoryDef("BUN",        "Bun Noodle Dishes"),
        new ProductCategoryDef("XAO",        "Stir-Fry"),
        new ProductCategoryDef("BANH",       "Banh (Cakes/Pancakes)"),
        new ProductCategoryDef("SIDE",       "Sides & Appetizers"),
        new ProductCategoryDef("DRINK",      "Drinks & Desserts")
    );

    // ========== UNITS OF MEASURE ==========
    public record UomDef(String code, String name) {}
    public static final List<UomDef> UOMS = List.of(
        new UomDef("g",     "Gram"),
        new UomDef("ml",    "Milliliter"),
        new UomDef("pc",    "Piece"),
        new UomDef("kg",    "Kilogram"),
        new UomDef("L",     "Liter"),
        new UomDef("serve", "Serving")
    );

    // ========== INGREDIENTS ==========
    public record IngredientDef(String name, String category, String uom, long unitCost,
                                 int minStock, int maxStock) {}

    public static final List<IngredientDef> INGREDIENTS = List.of(
        // --- Proteins (14) ---
        new IngredientDef("Pork Belly",      "PROTEIN", "g", 120, 2000, 10000),
        new IngredientDef("Pork Loin",       "PROTEIN", "g", 110, 2000, 10000),
        new IngredientDef("Ground Pork",     "PROTEIN", "g", 100, 2000, 8000),
        new IngredientDef("Pork Ribs",       "PROTEIN", "g", 130, 1000, 5000),
        new IngredientDef("Chicken Breast",  "PROTEIN", "g", 80,  2000, 10000),
        new IngredientDef("Chicken Thigh",   "PROTEIN", "g", 70,  2000, 10000),
        new IngredientDef("Beef Brisket",    "PROTEIN", "g", 200, 2000, 8000),
        new IngredientDef("Beef Tendon",     "PROTEIN", "g", 150, 1000, 5000),
        new IngredientDef("Shrimp",          "PROTEIN", "g", 180, 1000, 5000),
        new IngredientDef("Squid",           "PROTEIN", "g", 140, 1000, 4000),
        new IngredientDef("Fish Fillet",     "PROTEIN", "g", 120, 1000, 5000),
        new IngredientDef("Tofu",            "PROTEIN", "g", 25,  2000, 8000),
        new IngredientDef("Duck",            "PROTEIN", "g", 160, 1000, 4000),
        new IngredientDef("Crab Paste",      "PROTEIN", "g", 200, 500,  2000),
        // --- Noodles & Rice (9) ---
        new IngredientDef("Rice",            "NOODLE", "g", 15,  5000, 20000),
        new IngredientDef("Pho Noodles",     "NOODLE", "g", 20,  3000, 15000),
        new IngredientDef("Bun Noodles",     "NOODLE", "g", 20,  3000, 15000),
        new IngredientDef("Mi Noodles",      "NOODLE", "g", 25,  2000, 10000),
        new IngredientDef("Glass Noodles",   "NOODLE", "g", 40,  1000, 5000),
        new IngredientDef("Banh Cuon Sheets","NOODLE", "g", 30,  1000, 5000),
        new IngredientDef("Rice Paper",      "NOODLE", "pc", 5,  200,  1000),
        new IngredientDef("Flour",           "NOODLE", "g", 12,  3000, 15000),
        new IngredientDef("Breadcrumbs",     "NOODLE", "g", 30,  1000, 5000),
        // --- Vegetables (18) ---
        new IngredientDef("Lettuce",         "VEGETABLE", "g", 15,  1000, 5000),
        new IngredientDef("Bean Sprouts",    "VEGETABLE", "g", 10,  2000, 8000),
        new IngredientDef("Morning Glory",   "VEGETABLE", "g", 12,  1000, 5000),
        new IngredientDef("Bok Choy",        "VEGETABLE", "g", 15,  1000, 5000),
        new IngredientDef("Cabbage",         "VEGETABLE", "g", 10,  2000, 8000),
        new IngredientDef("Tomato",          "VEGETABLE", "g", 20,  1000, 5000),
        new IngredientDef("Onion",           "VEGETABLE", "g", 15,  2000, 8000),
        new IngredientDef("Spring Onion",    "VEGETABLE", "g", 20,  1000, 5000),
        new IngredientDef("Cilantro",        "VEGETABLE", "g", 25,  500,  3000),
        new IngredientDef("Mint",            "VEGETABLE", "g", 30,  500,  2000),
        new IngredientDef("Thai Basil",      "VEGETABLE", "g", 30,  500,  2000),
        new IngredientDef("Perilla",         "VEGETABLE", "g", 35,  300,  1500),
        new IngredientDef("Banana Flower",   "VEGETABLE", "g", 15,  500,  2000),
        new IngredientDef("Cucumber",        "VEGETABLE", "g", 12,  1000, 5000),
        new IngredientDef("Carrot",          "VEGETABLE", "g", 15,  1000, 5000),
        new IngredientDef("Daikon",          "VEGETABLE", "g", 10,  1000, 5000),
        new IngredientDef("Taro",            "VEGETABLE", "g", 20,  500,  3000),
        new IngredientDef("Banana Leaf",     "VEGETABLE", "pc", 5,  50,   200),
        new IngredientDef("Mushroom",        "VEGETABLE", "g", 40,  500,  3000),
        // --- Aromatics (14) ---
        new IngredientDef("Garlic",          "AROMATIC", "g", 40,  500,  3000),
        new IngredientDef("Ginger",          "AROMATIC", "g", 35,  500,  2000),
        new IngredientDef("Lemongrass",      "AROMATIC", "g", 20,  500,  3000),
        new IngredientDef("Chili",           "AROMATIC", "g", 30,  500,  3000),
        new IngredientDef("Shallot",         "AROMATIC", "g", 30,  500,  3000),
        new IngredientDef("Turmeric",        "AROMATIC", "g", 50,  200,  1000),
        new IngredientDef("Star Anise",      "AROMATIC", "g", 100, 100,  500),
        new IngredientDef("Cinnamon Stick",  "AROMATIC", "g", 80,  100,  500),
        new IngredientDef("Cardamom",        "AROMATIC", "g", 120, 50,   300),
        new IngredientDef("Clove",           "AROMATIC", "g", 100, 50,   300),
        new IngredientDef("Five-Spice",      "AROMATIC", "g", 60,  100,  500),
        new IngredientDef("White Pepper",    "AROMATIC", "g", 80,  200,  1000),
        new IngredientDef("Black Pepper",    "AROMATIC", "g", 70,  200,  1000),
        new IngredientDef("Annatto Seeds",   "AROMATIC", "g", 40,  100,  500),
        // --- Sauces (14) ---
        new IngredientDef("Fish Sauce",      "SAUCE", "ml", 20,  2000, 10000),
        new IngredientDef("Soy Sauce",       "SAUCE", "ml", 25,  1000, 5000),
        new IngredientDef("Oyster Sauce",    "SAUCE", "ml", 30,  1000, 5000),
        new IngredientDef("Hoisin Sauce",    "SAUCE", "ml", 35,  1000, 5000),
        new IngredientDef("Sriracha",        "SAUCE", "ml", 25,  500,  3000),
        new IngredientDef("Coconut Milk",    "SAUCE", "ml", 30,  1000, 5000),
        new IngredientDef("Tamarind Paste",  "SAUCE", "ml", 40,  500,  2000),
        new IngredientDef("Vinegar",         "SAUCE", "ml", 10,  1000, 5000),
        new IngredientDef("Cooking Oil",     "SAUCE", "ml", 25,  3000, 15000),
        new IngredientDef("Sesame Oil",      "SAUCE", "ml", 50,  500,  2000),
        new IngredientDef("Sugar",           "SAUCE", "g",  12,  3000, 15000),
        new IngredientDef("Salt",            "SAUCE", "g",  5,   2000, 10000),
        new IngredientDef("MSG",             "SAUCE", "g",  30,  500,  3000),
        new IngredientDef("Condensed Milk",  "SAUCE", "ml", 35,  1000, 5000),
        // --- Eggs & Dairy (4) ---
        new IngredientDef("Chicken Egg",     "EGG_DAIRY", "pc", 3500, 50, 300),
        new IngredientDef("Duck Egg",        "EGG_DAIRY", "pc", 5000, 30, 150),
        new IngredientDef("Quail Egg",       "EGG_DAIRY", "pc", 1500, 50, 300),
        new IngredientDef("Butter",          "EGG_DAIRY", "g",  80,   200, 1000)
    );

    // ========== COMPOSITE INGREDIENTS ==========
    public record CompositeRecipe(String name, String uom, long unitCost,
                                   int minStock, int maxStock, int yieldQty,
                                   List<RecipeEntry> sources) {}
    public record RecipeEntry(String ingredientName, int qty) {}

    public static final List<CompositeRecipe> COMPOSITES = List.of(
        new CompositeRecipe("Pho Broth", "ml", 15, 2000, 10000, 5000, List.of(
            new RecipeEntry("Beef Brisket", 500), new RecipeEntry("Star Anise", 10),
            new RecipeEntry("Cinnamon Stick", 5), new RecipeEntry("Cardamom", 3),
            new RecipeEntry("Ginger", 50), new RecipeEntry("Onion", 100),
            new RecipeEntry("Fish Sauce", 50), new RecipeEntry("Sugar", 20),
            new RecipeEntry("Salt", 10)
        )),
        new CompositeRecipe("Nuoc Cham", "ml", 25, 1000, 5000, 1000, List.of(
            new RecipeEntry("Fish Sauce", 200), new RecipeEntry("Sugar", 150),
            new RecipeEntry("Chili", 20), new RecipeEntry("Garlic", 30),
            new RecipeEntry("Vinegar", 100)
        )),
        new CompositeRecipe("Cha Lua", "g", 90, 500, 3000, 1000, List.of(
            new RecipeEntry("Ground Pork", 800), new RecipeEntry("Fish Sauce", 30),
            new RecipeEntry("White Pepper", 5), new RecipeEntry("Garlic", 20),
            new RecipeEntry("Flour", 50), new RecipeEntry("Sugar", 10)
        )),
        new CompositeRecipe("Scallion Oil", "ml", 35, 500, 3000, 500, List.of(
            new RecipeEntry("Spring Onion", 200), new RecipeEntry("Cooking Oil", 300)
        )),
        new CompositeRecipe("Pickled Vegetables", "g", 15, 1000, 5000, 1000, List.of(
            new RecipeEntry("Daikon", 400), new RecipeEntry("Carrot", 400),
            new RecipeEntry("Vinegar", 100), new RecipeEntry("Sugar", 80),
            new RecipeEntry("Salt", 20)
        )),
        new CompositeRecipe("Caramel Sauce", "ml", 20, 500, 3000, 500, List.of(
            new RecipeEntry("Sugar", 400), new RecipeEntry("Cooking Oil", 20)
        ))
    );

    // ========== MENU PRODUCTS ==========
    public record ProductDef(String name, String category, long price,
                              List<RecipeEntry> recipe) {}

    public record ProductCommercialProfile(
            long basePriceMin,
            long basePriceTarget,
            long basePriceMax,
            double basePopularity,
            double deliverySuitability,
            double prepComplexity,
            double holdWindowHours,
            int batchMin,
            int batchTarget,
            double breakfastFit,
            double lunchFit,
            double afternoonFit,
            double dinnerFit,
            double lateFit,
            boolean premium
    ) {}

    public static final List<ProductDef> PRODUCTS = List.of(
        // --- Pho & Noodle Soups (10) ---
        new ProductDef("Pho Bo Tai", "PHO_SOUP", 40000, List.of(
            new RecipeEntry("Pho Broth", 400), new RecipeEntry("Pho Noodles", 200),
            new RecipeEntry("Beef Brisket", 100), new RecipeEntry("Bean Sprouts", 30),
            new RecipeEntry("Thai Basil", 5), new RecipeEntry("Spring Onion", 10))),
        new ProductDef("Pho Bo Chin", "PHO_SOUP", 40000, List.of(
            new RecipeEntry("Pho Broth", 400), new RecipeEntry("Pho Noodles", 200),
            new RecipeEntry("Beef Brisket", 120), new RecipeEntry("Bean Sprouts", 30),
            new RecipeEntry("Cilantro", 5), new RecipeEntry("Onion", 15))),
        new ProductDef("Pho Ga", "PHO_SOUP", 40000, List.of(
            new RecipeEntry("Pho Broth", 400), new RecipeEntry("Pho Noodles", 200),
            new RecipeEntry("Chicken Thigh", 120), new RecipeEntry("Bean Sprouts", 30),
            new RecipeEntry("Spring Onion", 10), new RecipeEntry("Cilantro", 5))),
        new ProductDef("Bun Bo Hue", "PHO_SOUP", 45000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Beef Brisket", 80),
            new RecipeEntry("Pork Ribs", 60), new RecipeEntry("Lemongrass", 20),
            new RecipeEntry("Chili", 10), new RecipeEntry("Shrimp", 30),
            new RecipeEntry("Fish Sauce", 15))),
        new ProductDef("Bun Rieu", "PHO_SOUP", 40000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Crab Paste", 40),
            new RecipeEntry("Tomato", 50), new RecipeEntry("Tofu", 30),
            new RecipeEntry("Fish Sauce", 15), new RecipeEntry("Spring Onion", 10))),
        new ProductDef("Hu Tieu Nam Vang", "PHO_SOUP", 45000, List.of(
            new RecipeEntry("Mi Noodles", 200), new RecipeEntry("Shrimp", 50),
            new RecipeEntry("Ground Pork", 50), new RecipeEntry("Garlic", 5),
            new RecipeEntry("Spring Onion", 10), new RecipeEntry("Bean Sprouts", 30))),
        new ProductDef("Mi Quang", "PHO_SOUP", 45000, List.of(
            new RecipeEntry("Mi Noodles", 200), new RecipeEntry("Shrimp", 40),
            new RecipeEntry("Pork Belly", 60), new RecipeEntry("Turmeric", 3),
            new RecipeEntry("Lettuce", 30), new RecipeEntry("Pho Broth", 200))),
        new ProductDef("Cao Lau", "PHO_SOUP", 45000, List.of(
            new RecipeEntry("Mi Noodles", 200), new RecipeEntry("Pork Belly", 80),
            new RecipeEntry("Bean Sprouts", 30), new RecipeEntry("Lettuce", 20),
            new RecipeEntry("Mint", 5), new RecipeEntry("Soy Sauce", 10))),
        new ProductDef("Bun Moc", "PHO_SOUP", 40000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Ground Pork", 80),
            new RecipeEntry("Mushroom", 30), new RecipeEntry("Spring Onion", 10),
            new RecipeEntry("Fish Sauce", 15))),
        new ProductDef("Chao Long", "PHO_SOUP", 30000, List.of(
            new RecipeEntry("Rice", 150), new RecipeEntry("Pork Belly", 50),
            new RecipeEntry("Ginger", 10), new RecipeEntry("Spring Onion", 10),
            new RecipeEntry("Fish Sauce", 10))),

        // --- Rice Dishes (8) ---
        new ProductDef("Com Tam Suon", "RICE", 45000, List.of(
            new RecipeEntry("Rice", 250), new RecipeEntry("Pork Ribs", 150),
            new RecipeEntry("Nuoc Cham", 30), new RecipeEntry("Cucumber", 20),
            new RecipeEntry("Tomato", 20), new RecipeEntry("Scallion Oil", 10))),
        new ProductDef("Com Tam Bi", "RICE", 40000, List.of(
            new RecipeEntry("Rice", 250), new RecipeEntry("Pork Loin", 100),
            new RecipeEntry("Nuoc Cham", 30), new RecipeEntry("Cucumber", 20),
            new RecipeEntry("Pickled Vegetables", 30))),
        new ProductDef("Com Tam Suon Bi Cha", "RICE", 55000, List.of(
            new RecipeEntry("Rice", 250), new RecipeEntry("Pork Ribs", 120),
            new RecipeEntry("Pork Loin", 50), new RecipeEntry("Cha Lua", 30),
            new RecipeEntry("Nuoc Cham", 30), new RecipeEntry("Chicken Egg", 1))),
        new ProductDef("Com Chien Duong Chau", "RICE", 45000, List.of(
            new RecipeEntry("Rice", 300), new RecipeEntry("Shrimp", 40),
            new RecipeEntry("Chicken Egg", 1), new RecipeEntry("Carrot", 20),
            new RecipeEntry("Spring Onion", 10), new RecipeEntry("Soy Sauce", 10))),
        new ProductDef("Com Ga Xoi Mo", "RICE", 50000, List.of(
            new RecipeEntry("Rice", 250), new RecipeEntry("Chicken Thigh", 150),
            new RecipeEntry("Cooking Oil", 30), new RecipeEntry("Garlic", 10),
            new RecipeEntry("Cucumber", 20), new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Com Bo Luc Lac", "RICE", 60000, List.of(
            new RecipeEntry("Rice", 250), new RecipeEntry("Beef Brisket", 150),
            new RecipeEntry("Butter", 10), new RecipeEntry("Garlic", 10),
            new RecipeEntry("Lettuce", 30), new RecipeEntry("Tomato", 30),
            new RecipeEntry("Soy Sauce", 15))),
        new ProductDef("Com Rang Thap Cam", "RICE", 50000, List.of(
            new RecipeEntry("Rice", 300), new RecipeEntry("Shrimp", 30),
            new RecipeEntry("Chicken Breast", 40), new RecipeEntry("Chicken Egg", 1),
            new RecipeEntry("Carrot", 20), new RecipeEntry("Spring Onion", 10),
            new RecipeEntry("Soy Sauce", 10))),
        new ProductDef("Com Tay Cam", "RICE", 55000, List.of(
            new RecipeEntry("Rice", 300), new RecipeEntry("Chicken Thigh", 100),
            new RecipeEntry("Mushroom", 30), new RecipeEntry("Garlic", 5),
            new RecipeEntry("Soy Sauce", 10), new RecipeEntry("Sesame Oil", 5))),

        // --- Banh Mi & Wraps (6) ---
        new ProductDef("Banh Mi Thit", "BANH_MI", 24000, List.of(
            new RecipeEntry("Flour", 100), new RecipeEntry("Pork Belly", 40),
            new RecipeEntry("Cha Lua", 20), new RecipeEntry("Pickled Vegetables", 30),
            new RecipeEntry("Cilantro", 5), new RecipeEntry("Chili", 3))),
        new ProductDef("Banh Mi Op La", "BANH_MI", 26000, List.of(
            new RecipeEntry("Flour", 100), new RecipeEntry("Chicken Egg", 2),
            new RecipeEntry("Cha Lua", 20), new RecipeEntry("Butter", 5),
            new RecipeEntry("Soy Sauce", 5))),
        new ProductDef("Banh Mi Cha", "BANH_MI", 22000, List.of(
            new RecipeEntry("Flour", 100), new RecipeEntry("Cha Lua", 40),
            new RecipeEntry("Pickled Vegetables", 30), new RecipeEntry("Cilantro", 5),
            new RecipeEntry("Chili", 3))),
        new ProductDef("Banh Mi Ga", "BANH_MI", 28000, List.of(
            new RecipeEntry("Flour", 100), new RecipeEntry("Chicken Breast", 60),
            new RecipeEntry("Lettuce", 15), new RecipeEntry("Cucumber", 15),
            new RecipeEntry("Pickled Vegetables", 20))),
        new ProductDef("Goi Cuon", "BANH_MI", 35000, List.of(
            new RecipeEntry("Rice Paper", 4), new RecipeEntry("Shrimp", 40),
            new RecipeEntry("Bun Noodles", 30), new RecipeEntry("Lettuce", 20),
            new RecipeEntry("Mint", 5), new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Goi Cuon Tom", "BANH_MI", 38000, List.of(
            new RecipeEntry("Rice Paper", 4), new RecipeEntry("Shrimp", 60),
            new RecipeEntry("Bun Noodles", 30), new RecipeEntry("Lettuce", 20),
            new RecipeEntry("Thai Basil", 5), new RecipeEntry("Hoisin Sauce", 15))),

        // --- Bun Dishes (8) ---
        new ProductDef("Bun Cha", "BUN", 45000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Pork Belly", 80),
            new RecipeEntry("Ground Pork", 40), new RecipeEntry("Nuoc Cham", 50),
            new RecipeEntry("Lettuce", 20), new RecipeEntry("Mint", 5))),
        new ProductDef("Bun Thit Nuong", "BUN", 45000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Pork Loin", 100),
            new RecipeEntry("Nuoc Cham", 40), new RecipeEntry("Lettuce", 20),
            new RecipeEntry("Bean Sprouts", 30), new RecipeEntry("Spring Onion", 10))),
        new ProductDef("Bun Bo Nam Bo", "BUN", 50000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Beef Brisket", 100),
            new RecipeEntry("Lettuce", 20), new RecipeEntry("Bean Sprouts", 30),
            new RecipeEntry("Garlic", 5), new RecipeEntry("Nuoc Cham", 40))),
        new ProductDef("Bun Dau Mam Tom", "BUN", 50000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Tofu", 100),
            new RecipeEntry("Cha Lua", 30), new RecipeEntry("Fish Sauce", 20),
            new RecipeEntry("Lettuce", 30), new RecipeEntry("Mint", 5))),
        new ProductDef("Bun Ca", "BUN", 45000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Fish Fillet", 100),
            new RecipeEntry("Turmeric", 3), new RecipeEntry("Tomato", 30),
            new RecipeEntry("Spring Onion", 10), new RecipeEntry("Fish Sauce", 15))),
        new ProductDef("Bun Mam", "BUN", 55000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Fish Fillet", 60),
            new RecipeEntry("Shrimp", 40), new RecipeEntry("Squid", 30),
            new RecipeEntry("Pork Belly", 30), new RecipeEntry("Fish Sauce", 20))),
        new ProductDef("Bun Cha Ca", "BUN", 45000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Fish Fillet", 80),
            new RecipeEntry("Turmeric", 3), new RecipeEntry("Garlic", 5),
            new RecipeEntry("Cooking Oil", 10), new RecipeEntry("Spring Onion", 10))),
        new ProductDef("Bun Tom", "BUN", 50000, List.of(
            new RecipeEntry("Bun Noodles", 200), new RecipeEntry("Shrimp", 80),
            new RecipeEntry("Lettuce", 20), new RecipeEntry("Mint", 5),
            new RecipeEntry("Nuoc Cham", 40))),

        // --- Stir-Fry (8) ---
        new ProductDef("Mi Xao Bo", "XAO", 50000, List.of(
            new RecipeEntry("Mi Noodles", 200), new RecipeEntry("Beef Brisket", 100),
            new RecipeEntry("Bok Choy", 40), new RecipeEntry("Cooking Oil", 15),
            new RecipeEntry("Soy Sauce", 10), new RecipeEntry("Garlic", 5))),
        new ProductDef("Mi Xao Hai San", "XAO", 65000, List.of(
            new RecipeEntry("Mi Noodles", 200), new RecipeEntry("Shrimp", 50),
            new RecipeEntry("Squid", 50), new RecipeEntry("Bok Choy", 40),
            new RecipeEntry("Cooking Oil", 15), new RecipeEntry("Oyster Sauce", 10))),
        new ProductDef("Pho Xao", "XAO", 45000, List.of(
            new RecipeEntry("Pho Noodles", 200), new RecipeEntry("Beef Brisket", 80),
            new RecipeEntry("Bean Sprouts", 30), new RecipeEntry("Cooking Oil", 15),
            new RecipeEntry("Soy Sauce", 10), new RecipeEntry("Spring Onion", 10))),
        new ProductDef("Bo Xao Rau", "XAO", 60000, List.of(
            new RecipeEntry("Rice", 200), new RecipeEntry("Beef Brisket", 120),
            new RecipeEntry("Morning Glory", 50), new RecipeEntry("Garlic", 10),
            new RecipeEntry("Cooking Oil", 15), new RecipeEntry("Oyster Sauce", 10))),
        new ProductDef("Ga Xao Sa Ot", "XAO", 45000, List.of(
            new RecipeEntry("Rice", 200), new RecipeEntry("Chicken Thigh", 120),
            new RecipeEntry("Lemongrass", 20), new RecipeEntry("Chili", 10),
            new RecipeEntry("Cooking Oil", 15), new RecipeEntry("Fish Sauce", 10))),
        new ProductDef("Tom Xao Bong Cai", "XAO", 55000, List.of(
            new RecipeEntry("Rice", 200), new RecipeEntry("Shrimp", 80),
            new RecipeEntry("Bok Choy", 50), new RecipeEntry("Garlic", 5),
            new RecipeEntry("Cooking Oil", 15), new RecipeEntry("Oyster Sauce", 10))),
        new ProductDef("Rau Muong Xao Toi", "XAO", 30000, List.of(
            new RecipeEntry("Morning Glory", 200), new RecipeEntry("Garlic", 15),
            new RecipeEntry("Cooking Oil", 15), new RecipeEntry("Fish Sauce", 5))),
        new ProductDef("Dau Hu Sot Ca", "XAO", 35000, List.of(
            new RecipeEntry("Rice", 200), new RecipeEntry("Tofu", 120),
            new RecipeEntry("Tomato", 60), new RecipeEntry("Spring Onion", 10),
            new RecipeEntry("Fish Sauce", 10), new RecipeEntry("Sugar", 5))),

        // --- Banh (6) ---
        new ProductDef("Banh Xeo", "BANH", 40000, List.of(
            new RecipeEntry("Flour", 80), new RecipeEntry("Shrimp", 40),
            new RecipeEntry("Pork Belly", 40), new RecipeEntry("Bean Sprouts", 40),
            new RecipeEntry("Turmeric", 2), new RecipeEntry("Coconut Milk", 30),
            new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Banh Khot", "BANH", 35000, List.of(
            new RecipeEntry("Flour", 60), new RecipeEntry("Shrimp", 40),
            new RecipeEntry("Coconut Milk", 30), new RecipeEntry("Turmeric", 2),
            new RecipeEntry("Spring Onion", 10), new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Banh Cuon", "BANH", 35000, List.of(
            new RecipeEntry("Banh Cuon Sheets", 150), new RecipeEntry("Ground Pork", 50),
            new RecipeEntry("Mushroom", 20), new RecipeEntry("Shallot", 10),
            new RecipeEntry("Nuoc Cham", 30), new RecipeEntry("Cha Lua", 20))),
        new ProductDef("Banh Beo", "BANH", 30000, List.of(
            new RecipeEntry("Flour", 80), new RecipeEntry("Shrimp", 20),
            new RecipeEntry("Scallion Oil", 10), new RecipeEntry("Nuoc Cham", 20),
            new RecipeEntry("Cooking Oil", 5))),
        new ProductDef("Banh Bot Loc", "BANH", 35000, List.of(
            new RecipeEntry("Flour", 80), new RecipeEntry("Shrimp", 40),
            new RecipeEntry("Pork Belly", 30), new RecipeEntry("Banana Leaf", 2),
            new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Banh Canh", "BANH", 45000, List.of(
            new RecipeEntry("Flour", 200), new RecipeEntry("Crab Paste", 30),
            new RecipeEntry("Shrimp", 40), new RecipeEntry("Quail Egg", 2),
            new RecipeEntry("Fish Sauce", 15), new RecipeEntry("Spring Onion", 10))),

        // --- Sides & Appetizers (7) ---
        new ProductDef("Cha Gio", "SIDE", 35000, List.of(
            new RecipeEntry("Rice Paper", 8), new RecipeEntry("Ground Pork", 60),
            new RecipeEntry("Glass Noodles", 20), new RecipeEntry("Carrot", 15),
            new RecipeEntry("Cooking Oil", 20), new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Nem Nuong", "SIDE", 40000, List.of(
            new RecipeEntry("Ground Pork", 100), new RecipeEntry("Garlic", 10),
            new RecipeEntry("Sugar", 5), new RecipeEntry("Fish Sauce", 5),
            new RecipeEntry("Lettuce", 20), new RecipeEntry("Rice Paper", 4))),
        new ProductDef("Goi Ga", "SIDE", 40000, List.of(
            new RecipeEntry("Chicken Breast", 100), new RecipeEntry("Cabbage", 50),
            new RecipeEntry("Carrot", 20), new RecipeEntry("Mint", 5),
            new RecipeEntry("Nuoc Cham", 30))),
        new ProductDef("Goi Xoai", "SIDE", 35000, List.of(
            new RecipeEntry("Shrimp", 40), new RecipeEntry("Carrot", 30),
            new RecipeEntry("Cucumber", 30), new RecipeEntry("Mint", 5),
            new RecipeEntry("Nuoc Cham", 30), new RecipeEntry("Chili", 3))),
        new ProductDef("Dau Hu Chien", "SIDE", 25000, List.of(
            new RecipeEntry("Tofu", 150), new RecipeEntry("Cooking Oil", 20),
            new RecipeEntry("Soy Sauce", 10), new RecipeEntry("Spring Onion", 5))),
        new ProductDef("Com Chay", "SIDE", 20000, List.of(
            new RecipeEntry("Rice", 200), new RecipeEntry("Cooking Oil", 20),
            new RecipeEntry("Fish Sauce", 5), new RecipeEntry("Chicken Egg", 1))),
        new ProductDef("Canh Chua", "SIDE", 40000, List.of(
            new RecipeEntry("Fish Fillet", 60), new RecipeEntry("Tomato", 40),
            new RecipeEntry("Tamarind Paste", 15), new RecipeEntry("Bean Sprouts", 30),
            new RecipeEntry("Mint", 5), new RecipeEntry("Fish Sauce", 10))),

        // --- Drinks & Desserts (7) ---
        new ProductDef("Ca Phe Sua Da", "DRINK", 29000, List.of(
            new RecipeEntry("Condensed Milk", 30), new RecipeEntry("Sugar", 5))),
        new ProductDef("Ca Phe Den", "DRINK", 25000, List.of(
            new RecipeEntry("Sugar", 10))),
        new ProductDef("Tra Da", "DRINK", 5000, List.of(
            new RecipeEntry("Sugar", 10))),
        new ProductDef("Nuoc Mia", "DRINK", 18000, List.of(
            new RecipeEntry("Sugar", 100))),
        new ProductDef("Sinh To Bo", "DRINK", 32000, List.of(
            new RecipeEntry("Condensed Milk", 30), new RecipeEntry("Sugar", 15))),
        new ProductDef("Che Ba Mau", "DRINK", 25000, List.of(
            new RecipeEntry("Coconut Milk", 50), new RecipeEntry("Sugar", 30),
            new RecipeEntry("Flour", 20))),
        new ProductDef("Che Chuoi", "DRINK", 22000, List.of(
            new RecipeEntry("Coconut Milk", 50), new RecipeEntry("Sugar", 30),
            new RecipeEntry("Flour", 10)))
    );

    // ========== SUPPLIERS ==========
    public record SupplierDef(String name, String specialty) {}
    public static final List<SupplierDef> SUPPLIERS = List.of(
        new SupplierDef("Mekong Fresh Meats",    "Proteins"),
        new SupplierDef("Saigon Noodle Supply",  "Noodles & Rice"),
        new SupplierDef("Delta Greens Co.",      "Vegetables"),
        new SupplierDef("Pacific Spice Trading", "Aromatics & Spices"),
        new SupplierDef("Golden Sauce Factory",  "Sauces & Condiments"),
        new SupplierDef("Highland Dairy Farm",   "Eggs & Dairy"),
        new SupplierDef("Central Kitchen Supplies", "General")
    );

    private static final Map<String, ProductCommercialProfile> PRODUCT_PROFILE_OVERRIDES = Map.ofEntries(
            Map.entry("Pho Bo Tai", new ProductCommercialProfile(35_000L, 40_000L, 45_000L, 1.24, 0.60, 1.02, 6.0, 12, 36, 0.62, 1.12, 0.82, 1.02, 0.52, false)),
            Map.entry("Pho Bo Chin", new ProductCommercialProfile(35_000L, 40_000L, 45_000L, 1.18, 0.56, 1.04, 6.0, 12, 34, 0.56, 1.10, 0.80, 1.00, 0.48, false)),
            Map.entry("Pho Ga", new ProductCommercialProfile(35_000L, 40_000L, 45_000L, 1.14, 0.58, 0.96, 6.0, 12, 32, 0.58, 1.06, 0.82, 0.98, 0.48, false)),
            Map.entry("Bun Bo Hue", new ProductCommercialProfile(40_000L, 45_000L, 50_000L, 1.08, 0.54, 1.08, 5.0, 10, 28, 0.42, 1.08, 0.80, 1.12, 0.50, false)),
            Map.entry("Com Tam Suon", new ProductCommercialProfile(40_000L, 45_000L, 50_000L, 1.10, 0.68, 1.04, 4.0, 10, 30, 0.34, 1.12, 0.86, 1.08, 0.42, false)),
            Map.entry("Com Bo Luc Lac", new ProductCommercialProfile(50_000L, 60_000L, 65_000L, 0.82, 0.52, 1.18, 3.5, 8, 18, 0.24, 0.92, 0.72, 1.00, 0.34, true)),
            Map.entry("Banh Mi Thit", new ProductCommercialProfile(18_000L, 24_000L, 28_000L, 1.30, 0.82, 0.74, 3.0, 16, 40, 0.96, 1.04, 1.02, 0.92, 0.76, false)),
            Map.entry("Banh Mi Op La", new ProductCommercialProfile(20_000L, 26_000L, 30_000L, 1.08, 0.74, 0.78, 2.5, 12, 32, 1.10, 1.00, 0.86, 0.72, 0.44, false)),
            Map.entry("Ca Phe Sua Da", new ProductCommercialProfile(25_000L, 29_000L, 35_000L, 1.16, 0.72, 0.52, 4.5, 20, 64, 1.18, 0.92, 1.14, 0.98, 0.82, false)),
            Map.entry("Ca Phe Den", new ProductCommercialProfile(20_000L, 25_000L, 30_000L, 1.08, 0.70, 0.50, 4.5, 18, 56, 1.12, 0.88, 1.08, 0.94, 0.76, false)),
            Map.entry("Tra Da", new ProductCommercialProfile(5_000L, 5_000L, 8_000L, 0.86, 0.14, 0.18, 3.0, 20, 90, 0.78, 0.84, 0.94, 0.82, 0.64, false))
    );

    /**
     * @return the ingredient by name, or null if uses a composite name not in base list
     */
    public static IngredientDef findIngredient(String name) {
        for (IngredientDef def : INGREDIENTS) {
            if (def.name().equals(name)) return def;
        }
        return null;
    }

    public static CompositeRecipe findComposite(String name) {
        for (CompositeRecipe c : COMPOSITES) {
            if (c.name().equals(name)) return c;
        }
        return null;
    }

    public static ProductCommercialProfile commercialProfile(String productName, String categoryCode, long launchPrice) {
        ProductCommercialProfile override = PRODUCT_PROFILE_OVERRIDES.get(productName);
        if (override != null) {
            return override;
        }
        return switch (categoryCode) {
            case "PHO_SOUP", "BUN" -> new ProductCommercialProfile(35_000L, clampPrice(launchPrice, 40_000L, 48_000L), 55_000L,
                    1.02, 0.58, 1.00, 5.0, 10, 30, 0.52, 1.08, 0.82, 1.02, 0.48, false);
            case "RICE" -> new ProductCommercialProfile(35_000L, clampPrice(launchPrice, 42_000L, 52_000L), 60_000L,
                    0.98, 0.64, 1.06, 3.8, 10, 26, 0.30, 1.10, 0.84, 1.06, 0.36, false);
            case "BANH_MI" -> new ProductCommercialProfile(18_000L, clampPrice(launchPrice, 24_000L, 28_000L), 30_000L,
                    1.16, 0.78, 0.72, 3.0, 14, 38, 0.94, 1.02, 0.98, 0.90, 0.72, false);
            case "XAO" -> new ProductCommercialProfile(35_000L, clampPrice(launchPrice, 45_000L, 55_000L), 65_000L,
                    0.82, 0.56, 1.14, 3.0, 8, 18, 0.24, 0.94, 0.76, 1.04, 0.32, false);
            case "BANH", "SIDE" -> new ProductCommercialProfile(18_000L, clampPrice(launchPrice, 28_000L, 38_000L), 45_000L,
                    0.88, 0.48, 0.92, 3.2, 8, 24, 0.40, 0.92, 0.96, 1.00, 0.34, false);
            case "DRINK" -> launchPrice <= 10_000L
                    ? new ProductCommercialProfile(5_000L, launchPrice, 8_000L, 0.72, 0.12, 0.18, 3.0, 20, 80,
                    0.82, 0.84, 0.96, 0.90, 0.66, false)
                    : new ProductCommercialProfile(18_000L, clampPrice(launchPrice, 24_000L, 34_000L), 45_000L,
                    1.00, 0.74, 0.46, 4.0, 18, 60, 1.04, 0.90, 1.12, 0.98, 0.74, false);
            default -> new ProductCommercialProfile(20_000L, clampPrice(launchPrice, 35_000L, 50_000L), 70_000L,
                    0.90, 0.58, 1.0, 4.0, 10, 24, 0.40, 1.0, 0.9, 1.0, 0.4, false);
        };
    }

    public static double daypartFit(ProductCommercialProfile profile, String blockCode) {
        return switch (blockCode) {
            case "08_10" -> profile.breakfastFit();
            case "10_12", "12_14" -> profile.lunchFit();
            case "14_16" -> profile.afternoonFit();
            case "16_18", "18_20" -> profile.dinnerFit();
            case "20_22" -> profile.lateFit();
            default -> 0.82;
        };
    }

    private static long clampPrice(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }
}
