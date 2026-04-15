# FERN Catalog Module — Target-State Redesign Blueprint

> **Document type**: Product architecture blueprint
> **Audience**: Product, Design, Frontend, Backend
> **Scope**: Target-state operating model + current-state gap analysis
> **Date**: 2026-04-15

---

## A. Design Principles

### A.1 Triết lý

Catalog trong chuỗi F&B multi-outlet không phải product database. Nó là **hệ thống quy tắc** quyết định:
- **Gì** được bán (product + variant + modifier)
- **Gồm gì** để làm ra (recipe + ingredient)
- **Bán ở đâu** (outlet, channel)
- **Khi nào** (daypart, effective window)
- **Trong menu nào** (menu assignment, category)
- **Giá bao nhiêu** (price rule, scoped)
- **Ai quyết định** (scope hierarchy, override authority)
- **Khi nào có hiệu lực** (publish workflow)

Mỗi "lớp quy tắc" trên là một **first-class domain** — không phải sub-tab của product detail.

### A.2 Separation of concerns

| Layer | Domain | Tại sao phải tách |
|-------|--------|-------------------|
| **Identity** | Product, Variant, Modifier Group | Lifecycle riêng: tạo 1 lần, tồn tại lâu dài |
| **Composition** | Recipe, Ingredient | Lifecycle riêng: thay đổi theo mùa, region, cost optimization |
| **Commercial** | Price Rule | Lifecycle riêng: thay đổi hàng tuần/tháng, scoped per outlet/channel/daypart |
| **Visibility** | Menu Assignment | Lifecycle riêng: menu structure thay đổi theo chiến lược kinh doanh |
| **Scope** | Override | Cross-cutting: mọi entity trên đều có thể bị override theo hierarchy |
| **Release** | Publish Version | Cross-cutting: gom thay đổi từ nhiều entity thành 1 release |
| **Audit** | Change History | Cross-cutting: ai thay đổi gì, khi nào, scope nào |

### A.3 Core design rules

| # | Rule | Rationale |
|---|------|-----------|
| 1 | **Mọi record phải biết mình thuộc scope nào** | Không có record "trôi nổi" không biết áp cho đâu |
| 2 | **Mọi field phải cho biết nguồn gốc: base / inherited / overridden** | Tránh sửa nhầm dữ liệu kế thừa |
| 3 | **Mọi write phải explicit scope + impact preview** | "Thay đổi này áp cho 12 outlets qua region HCM" |
| 4 | **Draft ≠ Published ≠ Scheduled** | Không cho thay đổi chưa review/publish chạy production |
| 5 | **Override không thay thế base — nó che base tại scope cụ thể** | Xóa override → quay về base, không mất dữ liệu |
| 6 | **Dependency phải visible trước mọi destructive action** | Xóa ingredient → cảnh báo "đang dùng trong 5 recipes" |
| 7 | **Availability ≠ Pricing ≠ Menu Assignment** | Ba khái niệm khác nhau, ba lifecycle khác nhau |

---

## B. Entity Model

### B.1 Entity catalog

```
┌─────────────────────────────────────────────────────────────────┐
│                     CATALOG ENTITY MODEL                         │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│  IDENTITY LAYER      │  COMPOSITION LAYER                       │
│  ┌──────────────┐    │  ┌──────────────┐                       │
│  │ Product      │    │  │ Ingredient   │                       │
│  │ (master)     │    │  │ (item)       │                       │
│  └──────┬───────┘    │  └──────┬───────┘                       │
│         │            │         │                                │
│  ┌──────┴───────┐    │  ┌──────┴───────┐                       │
│  │ Variant      │    │  │ UOM          │                       │
│  │ (SKU/size)   │    │  │ Conversion   │                       │
│  └──────┬───────┘    │  └──────────────┘                       │
│         │            │                                          │
│  ┌──────┴───────┐    │  ┌──────────────────────────────────┐   │
│  │ Modifier     │    │  │ Recipe                            │   │
│  │ Group        │    │  │ (product_id, version)             │   │
│  │ + Options    │    │  │  └── Recipe Line Items            │   │
│  └──────────────┘    │  │      (ingredient + qty + uom)     │   │
│                      │  └──────────────────────────────────┘   │
├──────────────────────┼──────────────────────────────────────────┤
│                      │                                          │
│  COMMERCIAL LAYER    │  VISIBILITY LAYER                        │
│  ┌──────────────┐    │  ┌──────────────┐                       │
│  │ Price Rule   │    │  │ Menu         │                       │
│  │ (scoped)     │    │  │              │                       │
│  └──────────────┘    │  └──────┬───────┘                       │
│                      │         │                                │
│  ┌──────────────┐    │  ┌──────┴───────┐                       │
│  │ Tax Rule     │    │  │ Menu Item    │                       │
│  │ (region)     │    │  │ Assignment   │                       │
│  └──────────────┘    │  └──────────────┘                       │
│                      │                                          │
│  ┌──────────────┐    │  ┌──────────────┐                       │
│  │ Promotion    │    │  │ Availability │                       │
│  │ (scoped)     │    │  │ Rule         │                       │
│  └──────────────┘    │  └──────────────┘                       │
│                      │                                          │
├──────────────────────┴──────────────────────────────────────────┤
│                                                                  │
│  CROSS-CUTTING LAYERS                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Scope        │  │ Publish      │  │ Audit        │          │
│  │ Override     │  │ Version      │  │ History      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### B.2 Entity definitions

| Entity | Definition | Unique key | Status lifecycle |
|--------|-----------|-----------|-----------------|
| **Product** | Sellable item master. Identity + metadata. | `code` | draft → active → inactive → discontinued |
| **Variant** | Size/form variation of a product (S/M/L, Hot/Iced). | `product_id + variant_code` | inherits product status |
| **Modifier Group** | Optional add-on group (Toppings, Sauce, Sugar Level). | `code` | active / inactive |
| **Modifier Option** | Single option within a group (Pearl, Less Sugar). | `modifier_group_id + code` | active / inactive |
| **Ingredient** | Raw material / consumable item. | `code` | active → inactive → discontinued |
| **Recipe** | Composition formula for a product. | `product_id + version` | draft → active → archived |
| **Recipe Line** | Ingredient + quantity + UOM within a recipe. | `recipe_pk + item_id` | — |
| **Price Rule** | Price for a product at a scope (outlet, channel, daypart, date). | `product_id + scope_key + effective_from` | active (date-ranged) |
| **Menu** | Logical grouping of products for a sales context. | `code` | draft → active → inactive |
| **Menu Category** | Subdivision within a menu (Hot Drinks, Snacks). | `menu_id + code` | — |
| **Menu Item Assignment** | Product → Menu + Category + display_order. | `menu_id + category_id + product_id` | — |
| **Availability Rule** | Whether a product is sellable at a scope. | `product_id + scope_key` | enabled / disabled |
| **Scope Override** | Overrides a field value at a lower scope level. | `entity_type + entity_id + field + scope_key` | active |
| **Publish Version** | Set of changes bundled for coordinated release. | `id` (snowflake) | draft → review → approved → scheduled → published → rolled_back |
| **Publish Item** | Single change within a publish version. | `publish_version_id + entity_ref` | — |

---

## C. Scope Model

### C.1 Scope hierarchy

```
Corporate (global)
  └── Region
        └── Subregion (optional)
              └── Outlet
                    ├── Channel (dine-in, delivery, takeaway, online)
                    │     └── Daypart (breakfast, lunch, dinner, late-night)
                    └── Menu (Breakfast Menu, All-Day Menu, Delivery Menu)
                          └── Category (Hot Drinks, Cold Drinks, Snacks)

Temporal overlay:
  └── Effective Window (effective_from → effective_to)
```

### C.2 Scope applicability per entity

| Entity | Corporate | Region | Outlet | Channel | Menu | Daypart | Effective date | Versioned |
|--------|-----------|--------|--------|---------|------|---------|---------------|-----------|
| **Product** | ● base | — | — | — | — | — | — | No (status lifecycle) |
| **Variant** | ● base | — | — | — | — | — | — | No |
| **Modifier Group** | ● base | — | — | — | — | — | — | No |
| **Ingredient** | ● base | — | — | — | — | — | — | No |
| **Recipe** | ● base | ○ override | ○ override | — | — | — | — | Yes (version) |
| **Price Rule** | ● base | ○ override | ○ override | ○ override | — | ○ override | ● required | No |
| **Menu Assignment** | — | — | ○ attach | ○ attach | ● attach | — | ○ optional | No |
| **Availability Rule** | ● default | ○ override | ○ override | ○ override | — | ○ override | ○ optional | No |
| **Promotion** | — | ○ scoped | ○ scoped | ○ scoped | — | ○ scoped | ● required | No |

Legend: ● = required/primary scope, ○ = optional/applicable, — = not applicable

### C.3 Inheritance & override model

**Principle**: Lower scope overrides higher scope. Removing override restores inherited value.

```
Price resolution order (most specific wins):
  outlet + channel + daypart + date
    → outlet + channel + date
      → outlet + date
        → region + date
          → corporate base + date
            → no price (product not priced)

Availability resolution order:
  outlet + channel + daypart
    → outlet + channel
      → outlet
        → region
          → corporate default (enabled)

Recipe resolution order:
  outlet version (if exists)
    → region version (if exists)
      → corporate version (latest active)
```

### C.4 Override behavior

| Override type | Semantics | Conflict resolution |
|-------------|-----------|-------------------|
| **Price override** | Lower scope price replaces higher scope price for that scope | Most specific scope wins. Ties: lowest effective_from wins. |
| **Recipe override** | Region/outlet can have own recipe version for same product | Explicit version select at scope. No implicit cascade. |
| **Availability override** | Lower scope can disable what higher scope enables, or enable what higher scope disables | Most specific scope wins. Explicit toggle. |
| **Menu assignment** | Per outlet/channel — which products appear in which menu | Additive at base, removable at outlet. Outlet can exclude items from inherited menu. |

### C.5 Override visibility rules

| UI element | Meaning |
|-----------|---------|
| **No badge** | Value defined here at this scope (base or local) |
| **↓ Inherited** badge (muted) | Value cascaded from parent scope. Read-only here. |
| **✎ Overridden** badge (accent) | Value defined here, overriding parent. Shows parent value on hover. |
| **⚠ Conflict** badge (warning) | Multiple overrides at same level. Needs resolution. |

---

## D. Information Architecture — Target State

### D.1 Module structure

```
Catalog
│
├── Control Tower                 ← Cross-entity overview, health dashboard
│
├── Products                      ← Product master + variants + modifiers
│   ├── Product List
│   └── Product Detail
│       ├── Identity
│       ├── Variants & Modifiers
│       ├── Recipe (linked)
│       ├── Pricing (linked)
│       ├── Menu Assignments (linked)
│       ├── Availability (linked)
│       └── Dependencies
│
├── Ingredients                   ← Items, UOM, conversions, stock link
│   ├── Item List
│   └── Item Detail (drawer)
│
├── Recipes                       ← Recipe builder, versioning, cost
│   ├── Recipe List (by product)
│   └── Recipe Studio (builder)
│
├── Price Rules                   ← Scoped pricing, promotions
│   ├── Price Rule Grid (scope-filtered)
│   ├── Price Editor
│   ├── Promotion Manager
│   └── Tax Reference (read-only)
│
├── Menu Assignment               ← Menu structure, product-to-menu mapping
│   ├── Menu List
│   ├── Menu Builder (category + items)
│   └── Assignment Matrix (product × menu × outlet)
│
├── Scope Overrides               ← Override management across hierarchy
│   ├── Override Explorer (entity type filter)
│   ├── Override Detail (base vs override comparison)
│   └── Conflict Resolution
│
├── Publish Center                ← Draft/review/publish workflow
│   ├── Draft Workspace
│   ├── Review Queue
│   ├── Publish History
│   └── Rollback Manager
│
└── Change History                ← Audit trail
    └── Change Log (filterable by entity, user, scope, date)
```

### D.2 Section descriptions

#### Control Tower
- **Purpose**: Bird's-eye view of catalog health across the chain
- **Users**: product_manager, region_manager, admin
- **Key metrics**: total products (by status), pricing coverage (% outlets priced), recipe coverage, menu assignment coverage, pending drafts, recent publishes
- **Actions**: Quick links to problem areas (e.g., "12 products without pricing", "3 draft recipes pending review")

#### Products
- **Purpose**: Master data for sellable items
- **Users**: product_manager (CRUD), outlet_manager (read), staff (read)
- **Actions**: Create product (→ draft), edit, change status, manage variants, manage modifiers, view dependencies
- **Links to**: Recipe (composition), Price Rules (commercial), Menu Assignment (visibility), Availability (sellability)

#### Ingredients
- **Purpose**: Reference library for raw materials used in recipes
- **Users**: product_manager (CRUD)
- **Actions**: Create, edit, manage UOM, view recipe usage, view stock levels (cross-service)
- **Links to**: Recipes (used-by), Inventory (stock reference)

#### Recipes
- **Purpose**: Define composition and cost structure of each product
- **Users**: product_manager (CRUD)
- **Actions**: Create version, edit lines, activate, archive, view cost roll-up
- **Links to**: Products (1 product → N recipe versions), Ingredients (line items)
- **Scope**: Corporate base + optional region/outlet override versions

#### Price Rules
- **Purpose**: Manage what each product costs at each scope intersection
- **Users**: product_manager (base prices), outlet_manager (view/override at outlet)
- **Actions**: Set base price, set override price, manage effective windows, manage promotions
- **Links to**: Products, Outlets, Channels, Dayparts
- **Scope**: Full hierarchy — corporate → region → outlet → channel → daypart → date

#### Menu Assignment
- **Purpose**: Control which products appear in which menus, at which outlets/channels, in which order
- **Users**: product_manager (menu structure), outlet_manager (local exclusions)
- **Actions**: Create menu, add categories, assign products, set display order, outlet-level exclusions
- **Links to**: Products, Outlets, Channels
- **Scope**: Corporate menus inherited to outlets, outlet can exclude/reorder

#### Scope Overrides
- **Purpose**: Unified view of all overrides across the hierarchy
- **Users**: product_manager, admin
- **Actions**: View base vs override, compare scopes, resolve conflicts, remove overrides (→ inherit)
- **Links to**: All overridable entities (Price, Recipe, Availability, Menu exclusion)

#### Publish Center
- **Purpose**: Coordinate changes across multiple entities into versioned releases
- **Users**: product_manager (create draft, submit), admin/region_manager (review, approve), product_manager (publish/schedule)
- **Actions**: Create draft set, add changes, preview diff, preview impact, submit for review, approve, schedule publish, publish now, view history, rollback
- **Links to**: All entities that participate in publish workflow

#### Change History
- **Purpose**: Audit trail for all catalog mutations
- **Users**: admin, product_manager
- **Actions**: Filter by entity type, user, scope, date range; view change detail

---

## E. Screen Designs — Target State

### E.1 Control Tower

```
┌─ Catalog Control Tower ─────────────────────────────────────────────────────┐
│                                                                              │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐             │
│  │  142  │ │   87  │ │  128  │ │ 68%   │ │ 3     │ │ 7     │             │
│  │Products│ │Ingredi│ │Recipes│ │Price  │ │Pending│ │Recent │             │
│  │       │ │ents   │ │       │ │Coverage│ │Drafts │ │Changes│             │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘             │
│                                                                              │
│  ── Attention Required ──────────────────────────────────────────────────── │
│  ⚠ 12 active products without pricing at any outlet         [→ Price Rules] │
│  ⚠ 5 recipes in draft status for > 7 days                   [→ Recipes]     │
│  ⚠ 3 products active but not assigned to any menu            [→ Menu Assign]│
│  ℹ 2 scope overrides have conflicts in HCM region           [→ Overrides]  │
│                                                                              │
│  ── Recent Publishes ──────────────────────────  ── Quick Actions ───────── │
│  │ v2026.04.12 · "April menu refresh"       │  │ + New Product             │ │
│  │   14 changes · 5 outlets · 3 days ago    │  │ + New Recipe              │ │
│  │ v2026.04.01 · "Q2 price adjustment"      │  │ + Set Price               │ │
│  │   23 changes · all outlets · 14 days ago │  │ + Create Draft            │ │
│  └───────────────────────────────────────────┘  └─────────────────────────┘ │
│                                                                              │
│  ── Scope Coverage Matrix ───────────────────────────────────────────────── │
│  (Heatmap: Products × Outlets — color = coverage level)                      │
│  Green = priced + assigned + available                                       │
│  Yellow = partially configured                                               │
│  Red = missing pricing or assignment                                         │
│  Grey = not applicable / not in scope                                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.2 Product Detail

```
┌─ Product Detail ────────────────────────────────────────────────────────────┐
│                                                                              │
│  ← Back to Products                                                          │
│                                                                              │
│  ☕ Cà Phê Sữa Đá                                              [Edit] [···]│
│  BEV-001 · beverage · ●active                                               │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  [Identity] [Variants] [Recipe] [Pricing] [Menus] [Availability] [History]  │
│                                                                              │
│  ─── Identity Tab ──────────────────────────────────────────────────────── │
│                                                                              │
│  ┌─ Master Data ─────────────────────┐  ┌─ Dependencies ────────────────┐  │
│  │ Code:       BEV-001               │  │                               │  │
│  │ Name:       Cà Phê Sữa Đá        │  │ Recipe:  v1 (active, 3 lines) │  │
│  │ Category:   beverage              │  │ Pricing: 4 of 12 outlets      │  │
│  │ Status:     ●active               │  │ Menus:   2 menus, 3 outlets   │  │
│  │ Description: Vietnamese iced...   │  │ Avail:   4 outlets enabled    │  │
│  │ Image:      [📷]                  │  │                               │  │
│  │                                   │  │ ⚠ 8 outlets not priced        │  │
│  │ Scope: Corporate (base)           │  │ ⚠ Not in Delivery menu        │  │
│  └───────────────────────────────────┘  └───────────────────────────────┘  │
│                                                                              │
│  ─── Variants Tab ──────────────────────────────────────────────────────── │
│                                                                              │
│  Variant     │ Code      │ Status  │ Price modifier │                       │
│  ────────────┼───────────┼─────────┼────────────────│                       │
│  Regular     │ BEV001-R  │ ●active │ base           │ [Edit]                │
│  Large       │ BEV001-L  │ ●active │ +20%           │ [Edit]                │
│  [+ Add Variant]                                                             │
│                                                                              │
│  ─── Recipe Tab ────────────────────────────────────────────────────────── │
│                                                                              │
│  Active Recipe: v1 (●active)                    [Open in Recipe Studio →]   │
│                                                                              │
│  Ingredient       │ Qty    │ UOM │ Scope                                    │
│  ─────────────────┼────────┼─────┼──────────────                            │
│  Coffee Beans     │ 18.000 │ g   │ base                                     │
│  Fresh Milk       │ 80.000 │ ml  │ base                                     │
│  Condensed Milk   │ 20.000 │ ml  │ base                                     │
│                                                                              │
│  Region overrides:                                                           │
│  └─ HCM: v2 (draft) — uses coconut milk instead of condensed                │
│                                                                              │
│  ─── Pricing Tab ───────────────────────────────────────────────────────── │
│                                                                              │
│  Scope filter: [All outlets ▾] [All channels ▾] [All dayparts ▾]           │
│                                                                              │
│  Outlet       │ Channel  │ Daypart │ Price    │ Currency │ Source           │
│  ─────────────┼──────────┼─────────┼──────────┼──────────┼─────────────────│
│  HCM-001      │ all      │ all     │ 45,000   │ VND      │ ↓ region base  │
│  HCM-001      │ delivery │ all     │ 50,000   │ VND      │ ✎ outlet ovrd  │
│  HCM-002      │ all      │ all     │ 45,000   │ VND      │ ↓ region base  │
│  NYC-001      │ all      │ all     │ 4.50     │ USD      │ base           │
│  NYC-001      │ all      │ lunch   │ 3.99     │ USD      │ ✎ daypart ovrd │
│                                                                              │
│  ─── Menus Tab ─────────────────────────────────────────────────────────── │
│                                                                              │
│  Menu              │ Category    │ Outlets  │ Position │ Source             │
│  ──────────────────┼─────────────┼──────────┼──────────┼────────────────── │
│  All-Day Menu      │ Hot Drinks  │ all      │ 3        │ base              │
│  Breakfast Menu    │ Beverages   │ HCM only │ 1        │ ✎ region assign  │
│  Delivery Menu     │ —           │ —        │ —        │ ⚠ not assigned   │
│                                                                              │
│  ─── Availability Tab ──────────────────────────────────────────────────── │
│                                                                              │
│  Outlet      │ Channel  │ Daypart  │ Status   │ Source                      │
│  ────────────┼──────────┼──────────┼──────────┼──────────────────────────── │
│  HCM-001     │ all      │ all      │ ✓ enabled│ ↓ corporate default        │
│  HCM-001     │ delivery │ all      │ ✗ disabled│ ✎ outlet override         │
│  HCM-002     │ all      │ all      │ ✓ enabled│ ↓ corporate default        │
│  DN-001      │ all      │ all      │ ✗ disabled│ ✎ region override         │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.3 Recipe Studio

```
┌─ Recipe Studio ─────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌─ Product Selector (30%) ───────┐  ┌─ Recipe Builder (70%) ──────────────┐│
│  │                                 │  │                                     ││
│  │ 🔍 Search          [Filter ▾]  │  │ ☕ Cà Phê Sữa Đá                   ││
│  │                                 │  │ ─────────────────────────────────── ││
│  │ Product      │ Recipe │ Status  │  │                                     ││
│  │──────────────┼────────┼─────────│  │ Scope: [Corporate ▾] (base)        ││
│  │ Cà Phê Sữa  │ v1     │ ●active │  │                                     ││
│  │ Trà Đào      │ v1     │ ●active │  │ Version: [v1 ▾] [+ New Version]    ││
│  │ Bạc Xỉu      │ v2     │ ○draft  │  │ Status:  ●active                   ││
│  │ Sinh Tố Bơ   │ —      │ ○none   │  │ Yield:   1 cup                     ││
│  │                                 │  │ ─────────────────────────────────── ││
│  │                                 │  │                                     ││
│  │ [Region overrides ▾]           │  │ ── Ingredient Lines ──              ││
│  │  └ HCM: Bạc Xỉu v2 (draft)   │  │                                     ││
│  │  └ HCM: Cà Phê Sữa Đá (draft)│  │ # │ Ingredient    │ Qty  │ UOM │ ✗ ││
│  │                                 │  │───┼───────────────┼──────┼─────┼── ││
│  └─────────────────────────────────┘  │ 1 │ Coffee Beans  │ 18   │ g   │ 🗑││
│                                        │ 2 │ Fresh Milk    │ 80   │ ml  │ 🗑││
│                                        │ 3 │ Condensed Milk│ 20   │ ml  │ 🗑││
│                                        │   │ [+ Add Line]                  ││
│                                        │ ─────────────────────────────────── ││
│                                        │                                     ││
│                                        │ ── Cost Roll-up ──                  ││
│                                        │ Ingredient cost: ~₫12,500 / cup     ││
│                                        │ (Coffee ₫7,200 + Milk ₫3,200 +     ││
│                                        │  Condensed ₫2,100)                  ││
│                                        │                                     ││
│                                        │ ── Scope Comparison ──              ││
│                                        │ Base (corporate):  18g coffee, 80ml ││
│                                        │ HCM override:      15g coffee, 80ml ││
│                                        │                    coconut milk      ││
│                                        │ ─────────────────────────────────── ││
│                                        │                                     ││
│                                        │ [Reset]              [Save Recipe]  ││
│                                        └─────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.4 Price Rule Center

```
┌─ Price Rule Center ─────────────────────────────────────────────────────────┐
│                                                                              │
│  Scope lens: [Region: HCM ▾] [Outlet: All ▾] [Channel: All ▾]             │
│              [Daypart: All ▾] [Date: Today ▾]                               │
│                                                                              │
│  [+ Set Price]  🔍 Search  [Export]                                          │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Product         │ Outlet   │ Channel │ Daypart │ Price   │ Curr │ Source   │
│  ────────────────┼──────────┼─────────┼─────────┼─────────┼──────┼───────── │
│  Cà Phê Sữa Đá  │ HCM-001  │ all     │ all     │ 45,000  │ VND  │↓ region │
│  Cà Phê Sữa Đá  │ HCM-001  │ delivery│ all     │ 50,000  │ VND  │✎ outlet │
│  Cà Phê Sữa Đá  │ HCM-001  │ dine-in │ lunch   │ 39,000  │ VND  │✎ daypart│
│  Cà Phê Sữa Đá  │ HCM-002  │ all     │ all     │ 45,000  │ VND  │↓ region │
│  Trà Đào         │ HCM-001  │ all     │ all     │ 55,000  │ VND  │ base    │
│  Trà Đào         │ HCM-002  │ all     │ all     │ 55,000  │ VND  │↓ inherit│
│                                                                              │
│  Source legend:                                                               │
│   base    = defined at this scope                                            │
│   ↓ region = inherited from region                                           │
│   ↓ inherit = inherited from parent scope                                    │
│   ✎ outlet = overridden at outlet                                            │
│   ✎ daypart = overridden for daypart                                         │
│                                                                              │
│  ◀ 1 2 3 ▶  (234 price rules)                                              │
│                                                                              │
│  ── Promotions ─────────────────────────────────────────────────────────── │
│  (Same scope lens applies)                                                   │
│  Promotion              │ Type       │ Value │ Outlets │ Window      │ Stat │
│  ───────────────────────┼────────────┼───────┼─────────┼─────────────┼──── │
│  HCM Coffee Happy Hour  │ percentage │ 10%   │ 2       │ Mar-Apr 2026│ ●   │
│  Lunch Bundle Deal      │ combo      │ 89k   │ all HCM │ ongoing     │ ●   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.5 Menu Assignment Builder

```
┌─ Menu Assignment ───────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌─ Menu List (25%) ──────────────┐  ┌─ Menu Detail (75%) ─────────────────┐│
│  │                                 │  │                                     ││
│  │ [+ New Menu]                    │  │ All-Day Menu                        ││
│  │                                 │  │ Scope: Corporate (inherited to all) ││
│  │ All-Day Menu       ● 3 outlets │  │ Status: ●active                     ││
│  │ Breakfast Menu     ● 2 outlets │  │ ────────────────────────────────── ││
│  │ Delivery Menu      ○ draft     │  │                                     ││
│  │ Happy Hour Menu    ● 1 outlet  │  │ [Categories] [Outlets] [Preview]    ││
│  │                                 │  │                                     ││
│  └─────────────────────────────────┘  │ ── Categories + Products ──         ││
│                                        │                                     ││
│                                        │ ▼ Hot Drinks (5 items)              ││
│                                        │   1. ☕ Cà Phê Sữa Đá    ● all    ││
│                                        │   2. ☕ Bạc Xỉu            ● all    ││
│                                        │   3. 🍵 Trà Đào           ● all    ││
│                                        │   4. ☕ Cà Phê Đen        ● all    ││
│                                        │   5. 🍵 Trà Sen           ● HCM   ││
│                                        │   [+ Add Product]  [↕ Reorder]     ││
│                                        │                                     ││
│                                        │ ▼ Cold Drinks (3 items)             ││
│                                        │   1. 🧃 Sinh Tố Bơ       ● all    ││
│                                        │   2. 🧃 Sinh Tố Xoài     ● all    ││
│                                        │   3. 🧃 Nước Ép Cam      ○ draft  ││
│                                        │   [+ Add Product]  [↕ Reorder]     ││
│                                        │                                     ││
│                                        │ [+ Add Category]                    ││
│                                        │ ────────────────────────────────── ││
│                                        │                                     ││
│                                        │ ── Outlets Tab ──                   ││
│                                        │ Which outlets use this menu:        ││
│                                        │ ☑ HCM-001 (inherited) [3 excluded] ││
│                                        │ ☑ HCM-002 (inherited) [0 excluded] ││
│                                        │ ☑ DN-001  (inherited) [1 excluded] ││
│                                        │ ☐ NYC-001 (not assigned)            ││
│                                        │                                     ││
│                                        │ Excluded at HCM-001:                ││
│                                        │  • Trà Sen (outlet override)        ││
│                                        │  • Nước Ép Cam (draft product)      ││
│                                        │  • Cà Phê Đen (out of stock flag)   ││
│                                        └─────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.6 Scope Override Manager

```
┌─ Scope Overrides ───────────────────────────────────────────────────────────┐
│                                                                              │
│  Entity: [All ▾]  Scope: [HCM Region ▾]  Status: [Active ▾]                │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Entity         │ Field    │ Base Value  │ Override     │ Scope     │ By    │
│  ───────────────┼──────────┼─────────────┼──────────────┼───────────┼────── │
│  Cà Phê Sữa Đá │ price    │ ₫45,000     │ ₫50,000      │ HCM-001   │ admin │
│    └ source:    │          │ region base │ outlet ovrd  │ delivery  │       │
│                 │          │             │              │           │       │
│  Cà Phê Sữa Đá │ recipe   │ v1 (corp)   │ v2 (draft)   │ HCM region│ pm   │
│    └ source:    │          │ corporate   │ region ovrd  │           │       │
│                 │          │             │              │           │       │
│  Bạc Xỉu        │ avail    │ ✓ enabled   │ ✗ disabled   │ DN-001    │ om   │
│    └ source:    │          │ corp default│ outlet ovrd  │           │       │
│                 │          │             │              │           │       │
│  ⚠ CONFLICT                                                                 │
│  Cà Phê Đen     │ price    │ ₫40,000     │ ₫42,000 (rgn)│ HCM region│       │
│                 │          │             │ ₫38,000 (out)│ HCM-001   │       │
│    └ resolution:│          │ Most specific wins → ₫38,000 at HCM-001       │
│                                                                              │
│  ── Detail Drawer (click row) ─────────────────────────────────────────── │
│  │                                                                        │ │
│  │  Override Detail                                                       │ │
│  │                                                                        │ │
│  │  Entity:    Cà Phê Sữa Đá (BEV-001)                                   │ │
│  │  Field:     price (delivery channel)                                   │ │
│  │                                                                        │ │
│  │  ┌─ Inheritance Path ──────────────────────────────────────┐           │ │
│  │  │ Corporate base:    ₫45,000  (set 2024-03-01)           │           │ │
│  │  │   ↓                                                     │           │ │
│  │  │ Region HCM:        ₫45,000  (inherited)                │           │ │
│  │  │   ↓                                                     │           │ │
│  │  │ Outlet HCM-001:    ₫45,000  (inherited)                │           │ │
│  │  │   ↓                                                     │           │ │
│  │  │ Delivery channel:  ₫50,000  ✎ OVERRIDDEN               │           │ │
│  │  │                    (set by admin, 2026-04-10)           │           │ │
│  │  └─────────────────────────────────────────────────────────┘           │ │
│  │                                                                        │ │
│  │  Impact: This override affects 1 outlet (HCM-001) delivery channel     │ │
│  │                                                                        │ │
│  │  [Remove Override (→ inherit ₫45,000)]     [Edit Override]             │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.7 Publish Center

```
┌─ Publish Center ────────────────────────────────────────────────────────────┐
│                                                                              │
│  [+ New Draft]  [Draft Workspace] [Review Queue] [History] [Rollback]       │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  ── Draft Workspace ─────────────────────────────────────────────────────── │
│                                                                              │
│  Draft: "April Menu Refresh"                        Status: ○ draft         │
│  Created by: Product Manager · 2026-04-14                                    │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Changes in this draft (7):                                                  │
│                                                                              │
│  # │ Entity          │ Change Type │ Scope       │ Summary                  │
│  ──┼─────────────────┼─────────────┼─────────────┼────────────────────────── │
│  1 │ Sinh Tố Bơ      │ NEW product │ corporate   │ New product created       │
│  2 │ Sinh Tố Bơ      │ NEW recipe  │ corporate   │ v1 with 4 ingredients     │
│  3 │ Sinh Tố Bơ      │ NEW price   │ HCM-001     │ ₫65,000 from 2026-05-01  │
│  4 │ Sinh Tố Bơ      │ NEW price   │ HCM-002     │ ₫65,000 from 2026-05-01  │
│  5 │ Sinh Tố Bơ      │ MENU assign │ All-Day Menu│ Added to "Cold Drinks"   │
│  6 │ Cà Phê Sữa Đá   │ PRICE change│ HCM-001     │ ₫45,000 → ₫48,000       │
│  7 │ Trà Đào          │ AVAIL change│ DN-001      │ enabled → disabled       │
│                                                                              │
│  ── Impact Preview ──────────────────────────────────────────────────────── │
│                                                                              │
│  Outlets affected:  3 (HCM-001, HCM-002, DN-001)                           │
│  Products affected: 3 (Sinh Tố Bơ, Cà Phê Sữa Đá, Trà Đào)               │
│  Price changes:     2                                                        │
│  Menu changes:      1                                                        │
│  Availability:      1                                                        │
│                                                                              │
│  ── Diff View ───────────────────────────────────────────────────────────── │
│                                                                              │
│  Cà Phê Sữa Đá · Price at HCM-001:                                         │
│  ┌──────────────────┬──────────────────┐                                    │
│  │ CURRENT          │ AFTER PUBLISH    │                                    │
│  │ ₫45,000          │ ₫48,000          │                                    │
│  │ effective: Mar 1 │ effective: May 1 │                                    │
│  └──────────────────┴──────────────────┘                                    │
│                                                                              │
│  [Submit for Review]                                                         │
│  [Schedule Publish: 2026-05-01 00:00]                                       │
│  [Publish Now]                                                               │
│                                                                              │
│  ── Review Queue ────────────────────────────────────────────────────────── │
│  │ "April Menu Refresh" · 7 changes · submitted by PM · 2 hours ago        │ │
│  │   [Approve]  [Request Changes]  [View Diff]                             │ │
│  │                                                                          │ │
│  │ "NYC Price Correction" · 2 changes · submitted by PM · 1 day ago        │ │
│  │   [Approve]  [Request Changes]  [View Diff]                             │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ── History ─────────────────────────────────────────────────────────────── │
│  │ v2026.04.12 · published · 14 changes · by admin · [View] [Rollback?]   │ │
│  │ v2026.04.01 · published · 23 changes · by admin · [View]               │ │
│  │ v2026.03.15 · rolled back · 5 changes · by admin · [View]              │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### E.8 Ingredient Library

```
┌─ Ingredients ───────────────────────────────────────────────────────────────┐
│                                                                              │
│  [+ Add Ingredient]  🔍 Search  [Category ▾]  [Unit ▾]  [Status ▾]         │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  ☐ │ Code     │ Name            │ Category   │ UOM │ Min  │ Max  │ Status  │
│  ──┼──────────┼─────────────────┼────────────┼─────┼──────┼──────┼──────── │
│  ☐ │ ING-001  │ Coffee Beans    │ ingredient │ kg  │ 5.00 │ 50.0 │ ●active │
│  ☐ │ ING-002  │ Fresh Milk      │ ingredient │ ml  │ 10.0 │ —    │ ●active │
│  ☐ │ ING-003  │ Condensed Milk  │ ingredient │ ml  │ 5.00 │ 20.0 │ ●active │
│  ☐ │ ING-004  │ Coconut Cream   │ ingredient │ ml  │ 2.00 │ —    │ ●active │
│  ☐ │ ING-005  │ Tapioca Pearls  │ ingredient │ kg  │ 3.00 │ 15.0 │ ●active │
│                                                                              │
│  Bulk: [Change Status ▾]  [Export]     ◀ 1 2 3 ▶ (87 items)                │
│                                                                              │
│  ┌─ Detail Drawer ─────────────────────────────────────────────────────────┐│
│  │ Coffee Beans · ING-001                                         [✕]     ││
│  │ ───────────────────────────────────────────────────────────────────── ││
│  │                                                                       ││
│  │ ── Properties ──                                                      ││
│  │ Category:    ingredient                                               ││
│  │ Base UOM:    kg                                                       ││
│  │ Min Stock:   5.00 kg                                                  ││
│  │ Max Stock:   50.00 kg                                                 ││
│  │                                                                       ││
│  │ ── UOM Conversions ──                                                 ││
│  │ 1 kg = 1,000 g                                                        ││
│  │                                                                       ││
│  │ ── Used in Recipes (3) ──                                             ││
│  │ • Cà Phê Sữa Đá (v1, active) — 18g / cup                             ││
│  │ • Bạc Xỉu (v1, active) — 15g / cup                                    ││
│  │ • Cà Phê Đen (v1, active) — 20g / cup                                 ││
│  │ ⚠ Changing this item affects 3 active recipes                          ││
│  │                                                                       ││
│  │ ── Stock Levels (read-only from inventory) ──                         ││
│  │ HCM-001: 12.5 kg │ HCM-002: 8.2 kg │ DN-001: 3.1 kg                  ││
│  │                                                                       ││
│  └───────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## F. UX Rules — Mandatory

| # | Rule | Implementation | Severity |
|---|------|---------------|----------|
| 1 | **No blind override** | Every override shows inheritance path: base → … → current | Critical |
| 2 | **Data origin on every cell** | Badge or icon: base / ↓inherited / ✎overridden / ⚠conflict | Critical |
| 3 | **Scope confirmation on write** | Modal or inline: "This change applies to [scope badges] affecting [N] outlets" | Critical |
| 4 | **Impact preview before publish** | Diff view + affected entity/outlet count before any publish action | Critical |
| 5 | **Distinguish editable vs inherited** | Inherited fields: muted style + lock icon + "Set at [parent scope]" | High |
| 6 | **Dependency warnings** | Before status change: "This product has active recipes (3), prices (12), menu assignments (2)" | High |
| 7 | **Bulk operations with safeguard** | Bulk actions require confirmation step showing full impact count | High |
| 8 | **Draft lifecycle enforced** | New products start as draft → must meet minimum requirements → then can be activated | High |
| 9 | **Empty ≠ Zero** | "Not priced" (no rule) shows grey dash; "Price = 0" (free) shows "₫0.00" | Medium |
| 10 | **Override is removable** | Every override has "[Remove override → inherit from parent]" action | Medium |
| 11 | **Conflict surfacing** | When two overrides compete at same level, show ⚠ with resolution explanation | Medium |
| 12 | **Audit trail accessible** | Every entity has "History" tab or link showing change log | Medium |

---

## G. Permission Model — Target State

| Action | superadmin | product_manager | region_manager | outlet_manager | staff |
|--------|-----------|----------------|---------------|---------------|-------|
| View catalog (read) | ✓ all | ✓ region | ✓ region (read) | ✓ outlet | ✓ outlet |
| Create/edit product master | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create/edit ingredient | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create/edit recipe (base) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create recipe override (region) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Set base price | ✓ | ✓ | ✗ | ✗ | ✗ |
| Set outlet price override | ✓ | ✓ | ✗ | view only | ✗ |
| Manage menu structure | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage outlet menu exclusions | ✓ | ✓ | ✗ | ✓ | ✗ |
| Toggle outlet availability | ✓ | ✓ | ✗ | ✓ | ✗ |
| Create draft (publish) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Submit draft for review | ✓ | ✓ | ✗ | ✗ | ✗ |
| Approve/reject draft | ✓ | ✗ | ✓ | ✗ | ✗ |
| Publish/schedule release | ✓ | ✓ (after approval) | ✗ | ✗ | ✗ |
| Rollback published version | ✓ | ✗ | ✗ | ✗ | ✗ |
| View change history | ✓ | ✓ | ✓ | ✓ (own outlet) | ✗ |

---

## H. Product Lifecycle — Target State

```
                    ┌─────────┐
        create →    │  DRAFT  │ ← incomplete, not sellable
                    └────┬────┘
                         │ complete required fields
                         │ + recipe (or mark no-recipe)
                         │ + at least 1 price rule
                         │ + at least 1 menu assignment
                         ▼
                    ┌─────────┐
     validate →     │ READY   │ ← meets minimum, can be activated
                    └────┬────┘
                         │ submit for review (in publish draft)
                         │ or activate directly (if permissions allow)
                         ▼
                    ┌─────────┐
     activate →     │ ACTIVE  │ ← sellable at configured outlets
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌─────────┐ ┌────────┐ ┌──────────────┐
         │INACTIVE │ │SEASONAL│ │DISCONTINUED  │
         │(paused) │ │(timed) │ │(permanent)   │
         └─────────┘ └────────┘ └──────────────┘
              │                       │
              └───── reactivate ──────┘ (except discontinued)
```

**Minimum requirements to activate:**
1. Product has code + name
2. At least one active recipe version OR marked as `no_recipe_required`
3. At least one price rule at any outlet
4. (Target state) Assigned to at least one menu

---

## I. Current-State Gap Analysis

### I.1 What backend has NOW

| Capability | Status | DB table | API endpoint |
|-----------|--------|----------|-------------|
| Product CRUD | ✓ Create + Read | `product` | `GET/POST /product/products` |
| Item CRUD | ✓ Create + Read | `item` | `GET/POST /product/items` |
| Recipe CRUD | ✓ Create + Read + Upsert | `recipe`, `recipe_item` | `GET/PUT /product/recipes/{id}` |
| Per-outlet pricing | ✓ Upsert + Read | `product_price` | `GET/PUT /product/prices` |
| Product availability | ✓ DB table exists | `product_outlet_availability` | **No API** |
| Tax rates | ✓ DB + read | `tax_rate` | Read-only in reports |
| Promotions | ✓ Partial (create + deactivate) | `promotion`, `promotion_scope` | `GET/POST /sales/promotions` |
| Categories | ✓ DB only | `product_category`, `item_category` | **No API** |
| UOM + conversions | ✓ DB only | `unit_of_measure`, `uom_conversion` | **No API** |

### I.2 What backend NEEDS for target state

| Capability | Priority | New DB tables | New API endpoints |
|-----------|----------|-------------|------------------|
| **Product UPDATE** | P0 | — | `PUT /product/products/{id}` |
| **Item UPDATE** | P0 | — | `PUT /product/items/{id}` |
| **Availability API** | P0 | — (table exists) | `GET/PUT /product/availability` |
| **Category API** | P1 | — (table exists) | `GET/POST/PUT /product/categories` |
| **Promotion UPDATE** | P1 | — | `PUT /sales/promotions/{id}` |
| **Variant** | P1 | `product_variant` | CRUD endpoints |
| **Modifier Group** | P1 | `modifier_group`, `modifier_option` | CRUD endpoints |
| **Menu** | P2 | `menu`, `menu_category`, `menu_item` | CRUD + assignment endpoints |
| **Channel** | P2 | `channel` | Reference + assignment |
| **Daypart** | P2 | `daypart` | Reference + pricing integration |
| **Scope Override** | P2 | `catalog_override` | CRUD + resolution query |
| **Publish Version** | P3 | `publish_version`, `publish_item` | Workflow endpoints |
| **Change History** | P3 | `catalog_audit_log` | Query endpoint |

### I.3 Implementation phases

**Phase 1 — Backend-honest MVP** (current backend)
- Products: master-detail, create, read, status badge
- Ingredients: grid, create, read, drawer with recipe usage
- Recipes: studio, create/upsert, version management
- Pricing: outlet-scoped grid, price upsert, promotions read
- Availability: infer from pricing (read-only note)
- Control Tower: basic metrics from existing data

**Phase 2 — Core enterprise** (requires backend work listed as P0 + P1)
- Product/Item update endpoints
- Availability toggle API
- Category management
- Variant + Modifier support
- Promotion editing
- Product lifecycle enforcement (draft → ready → active)

**Phase 3 — Full operating model** (requires P2 backend work)
- Menu entity + assignment builder
- Channel + daypart support
- Scope override manager with inheritance visualization
- Price rules with full scope dimensions

**Phase 4 — Enterprise governance** (requires P3 backend work)
- Publish center with draft/review/approve/schedule/publish workflow
- Change history / audit trail
- Rollback capability
- Impact analysis engine

---

## J. Operational Flows — Target State

### Flow 1: Create new product (complete)

```
1. Catalog → Products → [+ Add Product]
2. Fill: Code, Name, Category → Save as DRAFT
3. Product detail opens → status shows ○draft
4. Identity tab: complete description, image
5. Recipe tab → [Create Recipe] → opens Recipe Studio
   - Add ingredient lines, set yield → Save → status ●active
6. Pricing tab → [Set Price] for target outlets
   - Select outlet → enter price → effective_from → Save
7. (Phase 3) Menus tab → assign to menu + category
8. (Phase 3) Availability tab → enable at target outlets
9. Product validation: check all minimum requirements met
   - ✓ Has recipe
   - ✓ Has pricing at ≥1 outlet
   - (Phase 3) ✓ Assigned to ≥1 menu
10. Change status: draft → active
11. (Phase 4) OR: add to publish draft → submit review → approve → publish
```

### Flow 2: Outlet price override

```
1. Catalog → Price Rules
2. Scope lens: select region + outlet
3. Find product in price grid
4. Click row → see current price + source badge (↓inherited from region)
5. [Override Price] → enter new price + effective_from
6. Confirmation: "Setting price ₫50,000 for Cà Phê Sữa Đá at HCM-001 (delivery)
   effective 2026-05-01. This overrides regional price ₫45,000."
7. Save → price grid shows ✎outlet badge
8. To revert: [Remove Override] → price returns to ↓inherited ₫45,000
```

### Flow 3: Bulk publish changes to multiple outlets

```
1. Catalog → Publish Center → [+ New Draft]
2. Name draft: "Q2 Price Adjustment"
3. Add changes:
   - From Price Rules: select 15 products × 5 outlets → new prices
   - From Products: 2 new products with recipes
   - From Menu Assignment: add new products to All-Day Menu
4. Review draft: 22 changes across 5 outlets
5. Preview diff: side-by-side current vs proposed for each change
6. Impact analysis: "Affects 5 outlets, 17 products, 3 menus"
7. [Submit for Review]
8. Reviewer (admin/region_manager) reviews diff → [Approve]
9. Product manager: [Schedule Publish: 2026-05-01 00:00]
10. System publishes at scheduled time
11. If issues: admin can [Rollback] from history → reverts all 22 changes
```

---

## K. UI Component Patterns

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Master-detail split** | Products, Menus | Browse + deep-dive without page navigation |
| **Data grid** (sortable, filterable, bulk-select) | Products, Ingredients, Prices, Overrides | Enterprise-grade data management |
| **Detail drawer** | Ingredients, Override detail | Lightweight inspection for reference data |
| **Scope lens** (filter bar) | Price Rules, Availability, Overrides | Filter data by scope dimensions |
| **Source badge** (`base` / `↓inherited` / `✎overridden` / `⚠conflict`) | Every table with scoped data | Data origin clarity |
| **Inheritance path** | Override detail drawer | Visual cascade: corporate → region → outlet → channel |
| **Diff view** (side-by-side) | Publish center | Compare current vs proposed state |
| **Impact card** | Publish preview, destructive actions | "Affects N outlets, M products" |
| **Status badge** (color-coded) | Everywhere | Lifecycle state indicator |
| **Dependency card** | Product detail | Cross-entity count summary |
| **Scope pill** | Write confirmations | Explicit "applying to [scope]" |
| **Effective date chip** | Price rules, promotions | Time-validity indicator |
| **Bulk action bar** | Grid footers | Sticky bar appears on checkbox selection |
| **Read-only section** | Inherited data, cross-service data | Lock icon + source label |
| **Conflict banner** | Override manager | Warning with resolution explanation |
| **Empty state** | All lists | Guided CTA: "No prices set. [Set first price]" |
| **Warning banner** | Backend gaps | "This feature requires [API]. Available in Phase N." |

---

## L. Anti-patterns Checklist

| # | Anti-pattern | Risk | Prevention |
|---|-------------|------|-----------|
| 1 | Confusing product with ingredient | Wrong entity type, recipe corruption | Separate modules, different icons, different create flows |
| 2 | Pricing = Availability | "Has price" ≠ "can sell" | Separate availability entity/tab |
| 3 | Menu assignment = Availability | "In menu" ≠ "can sell" | Both needed: menu defines what shows, availability defines what's sellable |
| 4 | Edit inherited data directly | Silently overwrites parent scope | Inherited fields locked + "Create override" action |
| 5 | Scope-blind writes | User changes price without knowing which outlet | Scope confirmation on every write |
| 6 | Active without minimum data | Ghost products in POS with no price/recipe | Draft lifecycle enforcement |
| 7 | Generic CRUD form for all entities | One form tries to handle 7 entity types | Purpose-built workspace per entity |
| 8 | Hiding dependencies | Delete ingredient breaks recipes | Dependency count + warning before destructive action |
| 9 | No diff before publish | Unknown impact of bulk changes | Mandatory diff view before publish |
| 10 | Override without remove path | Override becomes permanent, can't revert | Every override has explicit "Remove → inherit" action |

---

## M. Final Module Blueprint Tree

```
catalog/
├── ControlTower/
│   └── CatalogControlTower.tsx         ← Health dashboard + alerts
│
├── Products/
│   ├── ProductList.tsx                  ← Master data grid (left panel)
│   ├── ProductDetail.tsx                ← Detail view (right panel)
│   ├── ProductIdentityTab.tsx           ← Info + dependencies
│   ├── ProductVariantsTab.tsx           ← Variants + modifiers (Phase 2)
│   ├── ProductRecipeTab.tsx             ← Linked recipe summary
│   ├── ProductPricingTab.tsx            ← Per-outlet pricing
│   ├── ProductMenusTab.tsx              ← Menu assignments (Phase 3)
│   └── ProductAvailabilityTab.tsx       ← Outlet availability
│
├── Ingredients/
│   ├── IngredientGrid.tsx               ← Data grid
│   └── IngredientDrawer.tsx             ← Detail + usage + stock
│
├── Recipes/
│   ├── RecipeProductList.tsx            ← Product selector
│   └── RecipeBuilder.tsx                ← Builder + lines + cost
│
├── PriceRules/
│   ├── PriceRuleGrid.tsx               ← Scoped price table
│   ├── PriceEditor.tsx                  ← Set/override price
│   └── PromotionManager.tsx             ← Promotion list
│
├── MenuAssignment/ (Phase 3)
│   ├── MenuList.tsx                     ← Menu selector
│   ├── MenuBuilder.tsx                  ← Category + item ordering
│   └── AssignmentMatrix.tsx             ← Product × menu × outlet
│
├── ScopeOverrides/ (Phase 3)
│   ├── OverrideExplorer.tsx             ← Grid with source badges
│   ├── OverrideDetail.tsx               ← Inheritance path + compare
│   └── ConflictResolver.tsx             ← Conflict resolution UI
│
├── PublishCenter/ (Phase 4)
│   ├── DraftWorkspace.tsx               ← Draft change set editor
│   ├── ReviewQueue.tsx                  ← Approval queue
│   ├── DiffViewer.tsx                   ← Side-by-side compare
│   ├── PublishHistory.tsx               ← Release log
│   └── RollbackManager.tsx              ← Rollback UI
│
├── ChangeHistory/ (Phase 4)
│   └── ChangeLog.tsx                    ← Filterable audit trail
│
└── shared/
    ├── SourceBadge.tsx                  ← base / inherited / overridden / conflict
    ├── ScopePill.tsx                    ← Scope context badge
    ├── ScopeLens.tsx                    ← Multi-dimension scope filter bar
    ├── InheritancePath.tsx              ← Visual cascade diagram
    ├── DependencyCard.tsx               ← Cross-entity count summary
    ├── ImpactCard.tsx                   ← "Affects N outlets, M products"
    ├── DiffBlock.tsx                    ← Side-by-side value compare
    ├── StatusBadge.tsx                  ← Color-coded lifecycle badge
    ├── BulkActionBar.tsx                ← Sticky bulk action footer
    └── EffectiveDateChip.tsx            ← Date range badge
```
