# FERN Finance Module — Profit Control Center Blueprint

> Version: 1.0 | Date: 2026-04-16
> Author: Principal Product Designer + Staff UX Architect
> Scope: Full UI/UX redesign of the Finance module for FERN F&B ERP

---

## A. Design Principles

### Vì sao current screen chưa đủ

Current Finance module có hai màn: **Expense Ledger** và **Payroll Review**.
Đây là hai màn giao dịch — chúng trả lời "đã chi gì" và "lương đã duyệt chưa".
Chúng không trả lời được:

- Tháng này chuỗi đang lãi hay lỗ?
- Outlet nào đang kéo margin xuống?
- Labor cost đang vượt mức an toàn ở đâu?
- Kỳ nào chưa close được?

Một module finance chỉ có ledger và payroll là một module kế toán phổ thông, không phải một công cụ vận hành chuỗi F&B.

### Vì sao Finance không thể chỉ là Expense Ledger

Expense Ledger là **record of cost** — nó ghi lại những gì đã xảy ra.
Finance module trong context chuỗi F&B phải là **control surface** — nơi ra quyết định:

- Phân bổ ngân sách cho outlet nào tháng tới?
- Labor cost outlet HCM-01 đang ở 38% sales — có đáng lo không?
- Prime cost tháng 3 tăng 4% — do COGS hay labor?
- Kỳ tháng 3 đã sẵn sàng submit cho kế toán chưa?

Nếu Finance = Expense Ledger, Finance lead phải mở Excel để làm tất cả những điều trên.
Đây là dấu hiệu sản phẩm đang hỗ trợ data entry, không hỗ trợ decision making.

### Vì sao phải có cross-metric layer

F&B là ngành có cấu trúc chi phí cố định:
- **Prime cost** = COGS + Labor. Ngành chuẩn: dưới 60–65%.
- **Labor %** = Labor / Net Sales. Ngành chuẩn: 25–35%.
- **Other OpEx %** = Rent + Utilities + Marketing + Misc.

Không có cross-metric layer, người dùng không thể:
- Biết expense tăng vì sales tăng (bình thường) hay vì cost control kém (cần xử lý).
- So sánh hai outlet có doanh thu khác nhau một cách công bằng.
- Phát hiện outlet nào đang operate ngoài ngưỡng an toàn.

Cross-metric layer biến raw numbers thành **performance signals**.

### Vì sao phải tách current-state và target-state

Backend hiện tại chưa có:
- Revenue aggregation từ sales-service vào finance dashboard.
- COGS aggregation từ procurement/inventory.
- Labor hours tracking chi tiết.
- Automated prime cost calculation.

Nếu UI thiết kế như thể tất cả đã có sẵn, khi handoff dev sẽ phát hiện gap và phải workaround hoặc fake data.

**Rule:** Mỗi màn phải rõ ràng:
- `[CURRENT]` — đã có backend support, có thể ship MVP.
- `[TARGET]` — cần backend work, phải đánh dấu phase 2/3.
- Không được render target-state với real-looking data khi backend chưa có.

---

## B. Final Information Architecture

### Module Structure

```
Finance (Profit Control Center)
├── 1. Finance Overview          [DASHBOARD]
├── 2. Revenue Analytics         [READ — needs sales-service integration]
├── 3. Labor & Payroll           [MIXED — payroll current, labor analytics target]
├── 4. Operating Expenses        [CURRENT — expense ledger lives here]
├── 5. Prime Cost & Variance     [TARGET — needs cross-service aggregation]
└── 6. Period Close              [CURRENT (payroll) + TARGET (full close)]
```

---

### Workspace 1: Finance Overview / Flash Dashboard

| | |
|---|---|
| **Mục tiêu** | Trả lời nhanh: chuỗi đang ở đâu về tài chính trong kỳ này |
| **Ai dùng** | superadmin, finance (region), region_manager (read), outlet_manager (outlet-scoped read) |
| **Hành động chính** | Scan KPIs → Detect variance → Drill down vào workspace cụ thể |
| **Liên hệ workspace khác** | Entry point cho tất cả 5 workspace còn lại. Mỗi KPI card có link drill-down |

### Workspace 2: Revenue Analytics

| | |
|---|---|
| **Mục tiêu** | Hiểu revenue đến từ đâu, channel nào, outlet nào, kỳ nào |
| **Ai dùng** | superadmin, finance, region_manager, outlet_manager (outlet-scoped) |
| **Hành động chính** | Filter by outlet/region/period → Compare periods → Export |
| **Liên hệ workspace khác** | Revenue là mẫu số cho Labor % và Prime Cost % — feeds Workspace 5 |

### Workspace 3: Labor & Payroll

| | |
|---|---|
| **Mục tiêu** | Quản lý toàn bộ labor cost: từ scheduling hours đến payroll approval |
| **Ai dùng** | hr (prepare), finance (approve), superadmin, outlet_manager (outlet-level read) |
| **Hành động chính** | HR: tạo period → tạo timesheet → submit. Finance: review → approve/reject |
| **Liên hệ workspace khác** | Labor total feeds Workspace 1 (KPIs) và Workspace 5 (prime cost) |

**Separation of duties — bắt buộc:**
- HR tab: Create period, manage timesheet, submit for approval
- Finance tab: Review submitted payroll, approve/reject
- Hai tab phân biệt, không merge thành một workflow

### Workspace 4: Operating Expenses

| | |
|---|---|
| **Mục tiêu** | Expense ledger hiện tại — ghi nhận, phân loại, và track chi phí vận hành |
| **Ai dùng** | superadmin, finance (W), outlet_manager (W at outlet), region_manager (R) |
| **Hành động chính** | Create expense → Categorize → Review → Export |
| **Liên hệ workspace khác** | Expense rows feed Workspace 1 (total OpEx) và Workspace 5 (prime cost denominator) |

### Workspace 5: Prime Cost & Variance

| | |
|---|---|
| **Mục tiêu** | Cross-metric view: prime cost %, outlet comparison, period-over-period variance |
| **Ai dùng** | superadmin, finance, region_manager |
| **Hành động chính** | Identify variance → Drill to source (labor/COGS/expense) → Flag for review |
| **Liên hệ workspace khác** | Aggregates data từ Workspace 2 (revenue), 3 (labor), 4 (expenses) |

### Workspace 6: Period Close / Finance Controls

| | |
|---|---|
| **Mục tiêu** | Checklist để close một kỳ tài chính. Track readiness từng outlet |
| **Ai dùng** | superadmin, finance |
| **Hành động chính** | Review checklist → Resolve blockers → Mark period closed |
| **Liên hệ workspace khác** | Aggregate status từ Workspace 3 (payroll approved?), 4 (expenses categorized?), 5 (variance reviewed?) |

---

## C. Screen-by-Screen Redesign

---

### Screen 1: Finance Overview / Flash Dashboard

**Mục tiêu:** Single-screen executive view. Ai cũng cần vào đây trước.

**Ai dùng:**
- `superadmin` / `finance`: toàn bộ region/outlet
- `region_manager`: region của mình
- `outlet_manager`: outlet của mình

**Layout (Desktop, 1440px):**

```
[Finance Scope Bar — xem Section E]

[Period: March 2026] [Region: All] [Compare: Feb 2026]  [Export] [Alert: 3 variances]

─── KPI Row (6 cards) ────────────────────────────────────────────────────────
│ Net Sales        │ Labor Cost       │ Other OpEx       │
│ ₫1.24B           │ ₫312M            │ ₫184M            │
│ ↑ 8% vs Feb      │ 25.2% of sales ⚠ │ 14.8% of sales   │
│ [→ Revenue]      │ [→ Labor]        │ [→ Expenses]     │
─────────────────────────────────────────────────────────
│ Prime Cost       │ Gross Margin     │ Variance Flags   │
│ ₫496M            │ ₫744M            │ 3 outlets        │
│ 40.0% ✓          │ 60.0%            │ outside target   │
│ [→ Prime Cost]   │ [→ Prime Cost]   │ [→ Prime Cost]   │
──────────────────────────────────────────────────────────

─── Left Panel (60%) ─────────────────────── Right Panel (40%) ──────────────
│ Outlet Performance Table              │ Expense Source Breakdown           │
│ Outlet | Sales | Labor% | OpEx% | PC% │ [Donut chart]                      │
│ HCM-01 | 340M  | 24%  ✓ | 12% ✓ | 36% │ • Manual entry: 42%                │
│ HCM-02 | 290M  | 31% ⚠ | 16% ⚠ | 47% │ • Invoice approved: 35%            │
│ HN-01  | 210M  | 27%  ✓ | 15% ✓ | 42% │ • Payroll approved: 18%            │
│ HN-02  | 180M  | 38% ✗ | 18% ⚠ | 56% │ • System/imported: 5%             │
│ [View all outlets]                    │                                    │
│                                       │ Period Close Status                │
│ Trend Chart (line, 6 months)          │ [Progress bar] 3/5 outlets ready   │
│ Net Sales vs Prime Cost %             │ HCM-01 ✓ HCM-02 ⚠ HN-01 ✓        │
│ [Toggle: all outlets / by outlet]     │ HN-02 ✗ [View Period Close]        │
─────────────────────────────────────────────────────────────────────────────
```

**Filters:**
- Period (month/quarter/custom range)
- Region (if superadmin/finance)
- Outlet (multi-select, scoped by role)
- Compare period (previous period / same period last year)

**CTA chính:**
- Drill-down links từ mỗi KPI card
- "View all outlets" → Workspace 5
- "View Period Close" → Workspace 6
- "Export Flash Report" → PDF/CSV

**Current-state support `[CURRENT]`:**
- Expense total (from expense ledger)
- Payroll total (from approved payrolls)
- Period close status (from payroll approval state)

**Target-state `[TARGET - Phase 2]`:**
- Net Sales (needs sales-service aggregation API)
- Labor % / Prime Cost % (needs cross-service calculation)
- COGS (needs inventory/procurement aggregation)
- Trend chart (needs historical aggregation)

**Warning / Error states:**
- `[!]` Labor % > 35%: amber badge
- `[✗]` Labor % > 40%: red badge
- `[!]` Expense rows uncategorized: banner "X rows need categorization"
- `[Empty]` No data for period: "No financial data found. Check expense entries or period settings."
- `[Lock]` Period closed: banner "March 2026 is closed. Viewing read-only data."

---

### Screen 2: Revenue Analytics

**Mục tiêu:** Hiểu revenue structure — không phải chỉ tổng doanh thu mà còn breakdown.

**Ai dùng:**
- `superadmin`, `finance`: full visibility
- `region_manager`: region-scoped
- `outlet_manager`: outlet-scoped

**Current-state:** `[TARGET — Phase 2]` — cần sales-service integration.
**MVP treatment:** Show placeholder state với message rõ ràng.

**Layout:**

```
[Finance Scope Bar]

[Period] [Region/Outlet] [Channel: All / Dine-in / Delivery / Takeout] [Export]

─── KPI Row ─────────────────────────────────────────────────────────────────
│ Gross Sales │ Discounts   │ Refunds     │ Voids       │ Net Sales   │
│ ₫1.31B      │ ₫42M (3.2%) │ ₫18M (1.4%) │ ₫7M (0.5%)  │ ₫1.24B      │
─────────────────────────────────────────────────────────────────────────────

─── Main Chart ───────────────────────────────── Right Panel ─────────────────
│ Daily Revenue Trend (bar chart)           │ Payment Mix                    │
│ [Toggle: Gross / Net / Discounts]         │ [Pie chart]                    │
│ [Compare toggle: previous period]         │ Cash: 28%                      │
│                                           │ Card: 45%                      │
│                                           │ E-wallet: 27%                  │
─────────────────────────────────────────────────────────────────────────────

─── Outlet Revenue Table ────────────────────────────────────────────────────
│ Outlet  │ Gross Sales │ Discounts │ Refunds │ Voids │ Net Sales │ vs Prior │
│ HCM-01  │ 360M        │ 15M       │ 5M      │ 0M    │ 340M      │ ↑ 12%    │
│ HCM-02  │ 308M        │ 12M       │ 4M      │ 2M    │ 290M      │ ↑ 3%     │
│ [Export table]                                                              │
─────────────────────────────────────────────────────────────────────────────
```

**MVP Placeholder State (before sales integration):**

```
┌─────────────────────────────────────────────────────────┐
│  Revenue Analytics                                      │
│                                                         │
│  [Icon: chart with construction sign]                   │
│  Revenue data requires integration with Sales module.   │
│  Current period expense and payroll data are available  │
│  in Operating Expenses and Labor & Payroll workspaces.  │
│                                                         │
│  [View Expenses]  [View Payroll]                        │
└─────────────────────────────────────────────────────────┘
```

---

### Screen 3: Labor & Payroll

**Mục tiêu:** Manage toàn bộ labor cost lifecycle — từ timesheet đến payroll approval.

**Ai dùng:**
- `hr` (region): prepare payroll, manage timesheet — chỉ thấy HR tab
- `finance` (region): approve/reject payroll — chỉ thấy Finance tab
- `superadmin`: thấy cả hai tab
- `outlet_manager`: read-only view, outlet-scoped

**CRITICAL — Separation of Duties:**

Tab HR và tab Finance là hai view riêng biệt.
Không có user nào (ngoài superadmin) thấy cả hai tab đầy đủ.

**Layout:**

```
[Finance Scope Bar]

[Tab: HR View (prepare)] | [Tab: Finance View (approve)]
                           ↑ visible to finance & superadmin only
         ↑ visible to hr & superadmin only

─── HR View Tab ─────────────────────────────────────────────────────────────

[Period: March 2026] [Region: HCM] [Status: All ▼]  [+ New Payroll Period]

─── Summary Cards ───────────────────────────────────────────────────────────
│ Active Employees │ Payroll Periods │ Timesheets      │ Submitted        │
│ 84               │ 3 created       │ 84 submitted    │ 2/3 periods      │
─────────────────────────────────────────────────────────────────────────────

─── Payroll Period Table ────────────────────────────────────────────────────
│ Period       │ Outlet   │ Employees │ Total Amount │ Status     │ Action  │
│ Mar W1 2026  │ HCM-01   │ 28        │ ₫82M         │ Submitted  │ View    │
│ Mar W1 2026  │ HCM-02   │ 24        │ ₫71M         │ Draft      │ Edit    │
│ Mar W1 2026  │ HN-01    │ 18        │ ₫53M         │ Approved ✓ │ View    │
│ [+ Create period]                                                          │
─────────────────────────────────────────────────────────────────────────────

─── Finance View Tab ────────────────────────────────────────────────────────

[Period: March 2026] [Region: HCM] [Status: Pending Approval ▼]  [Export]

─── Approval Queue ──────────────────────────────────────────────────────────
│ Period       │ Outlet   │ HR Owner  │ Total Amount │ Submitted   │ Action        │
│ Mar W1 2026  │ HCM-01   │ Nguyen V. │ ₫82M         │ Apr 3       │ [Review]      │
│ Mar W2 2026  │ HCM-02   │ Tran T.   │ ₫71M         │ Apr 4       │ [Review]      │
│ [Export pending list]                                                             │
─────────────────────────────────────────────────────────────────────────────

─── Payroll Detail (drill-down) ─────────────────────────────────────────────
│ Employee     │ Role        │ Base Pay  │ Overtime │ Deductions │ Net Pay  │
│ Nguyen A.    │ staff       │ ₫8.5M     │ ₫0.5M    │ ₫0.85M     │ ₫8.15M  │
│ Tran B.      │ kitchen_s.  │ ₫7.0M     │ ₫1.0M    │ ₫0.70M     │ ₫7.30M  │
│                                                                             │
│ [Approve] [Reject with note]                                                │
│ (Finance role only — CTA hidden from HR view)                               │
─────────────────────────────────────────────────────────────────────────────
```

**Labor Analytics `[TARGET — Phase 2]`:**
```
─── Labor vs Sales (when revenue data available) ────────────────────────────
│ Outlet  │ Net Sales │ Payroll  │ Labor %  │ Target  │ Status    │
│ HCM-01  │ ₫340M     │ ₫82M     │ 24.1%    │ < 30%   │ ✓ Good    │
│ HCM-02  │ ₫290M     │ ₫89M     │ 30.7%    │ < 30%   │ ⚠ Watch   │
│ HN-02   │ ₫180M     │ ₫68M     │ 37.8%    │ < 30%   │ ✗ Over    │
─────────────────────────────────────────────────────────────────────────────
```

**Warning states:**
- `[⚠ Separation warning]` nếu user cố gắng access tab không thuộc role của mình
- `[!]` Payroll period quá hạn submit: "HCM-02 March W2 — overdue submission"
- `[Lock]` Kỳ đã được approve: không thể edit timesheet

---

### Screen 4: Operating Expenses

**Mục tiêu:** Expense Ledger hiện tại — upgrade với source awareness và phân loại rõ.

**Ai dùng:**
- `superadmin`, `finance`: full W/R
- `outlet_manager`: W/R tại outlet của mình
- `region_manager`: R only

**Layout:**

```
[Finance Scope Bar]

[Period] [Outlet/Region] [Category ▼] [Source ▼] [Status ▼]   [+ New Expense]

─── Summary Cards ───────────────────────────────────────────────────────────
│ Total Expenses  │ Manual Entry    │ Invoice-linked  │ Payroll-linked  │
│ ₫184M           │ ₫77M (42%)      │ ₫64M (35%)      │ ₫33M (18%)      │
─────────────────────────────────────────────────────────────────────────────

─── Expense Table ───────────────────────────────────────────────────────────
│ Date     │ Outlet  │ Category        │ Amount  │ Source        │ Status   │ Action │
│ Apr 1    │ HCM-01  │ Utilities       │ ₫12M    │ 🔵 Manual     │ Posted   │ View   │
│ Apr 1    │ HCM-02  │ Payroll         │ ₫71M    │ 🟣 Payroll    │ Posted   │ View   │
│ Apr 2    │ HN-01   │ Supplier Invoice│ ₫24M    │ 🟠 Invoice    │ Posted   │ View   │
│ Apr 3    │ HCM-01  │ Marketing       │ ₫8M     │ 🔵 Manual     │ Draft    │ Edit   │
│ Apr 3    │ HN-02   │ [Uncategorized] │ ₫3.5M   │ 🔵 Manual     │ ⚠ Review │ Categorize │
│                                                                              │
│ [Load more] [Export CSV]                                                     │
─────────────────────────────────────────────────────────────────────────────
```

**Source Labels:**
- `🔵 Manual` — created by user
- `🟠 Invoice` — created from approved invoice (procurement-service event)
- `🟣 Payroll` — created from approved payroll (payroll-service event)
- `⚫ System` — imported/synced from external

**Expense Create Form:**
```
─── New Expense ─────────────────────────────────────────────────────────────
│ Date *          [Apr 3, 2026]                                              │
│ Outlet *        [HCM-01 ▼]   (scoped to user's outlets)                   │
│ Category *      [Utilities ▼] [Marketing ▼] [Rent ▼] [Other ▼]           │
│ Amount *        [₫ __________]                                             │
│ Description     [_________________________________]                        │
│ Attachment      [Upload receipt]                                           │
│ Source          Auto: Manual (cannot be changed by user)                   │
│                                                                             │
│ [Save Draft]  [Post Expense]                                               │
─────────────────────────────────────────────────────────────────────────────
```

**Warning states:**
- `[⚠]` Row uncategorized: highlight row, show "Categorize" CTA
- `[Lock]` Period closed: "+ New Expense" hidden, table read-only
- `[Empty]` No expenses: "No expenses recorded for this period and outlet."

---

### Screen 5: Prime Cost & Variance

**Mục tiêu:** Cross-metric view — outlet comparison, period variance, prime cost breakdown.

**Ai dùng:**
- `superadmin`, `finance`, `region_manager`: full view
- `outlet_manager`: outlet-scoped (thấy outlet mình, không thấy cross-outlet comparison)

**Current-state:** Phần lớn `[TARGET — Phase 2]`. Cần sales-service + inventory aggregation.
**MVP treatment:** Show expense-only view với placeholder cho COGS và Revenue.

**Layout (Target State):**

```
[Finance Scope Bar]

[Period] [Region/Outlet] [Threshold: 65% ▼]      [Flag for review] [Export]

─── Prime Cost Summary ──────────────────────────────────────────────────────
│ Chain Prime Cost  │ COGS Total   │ Labor Total  │ Net Sales    │ PC %    │
│ ₫496M             │ ₫184M        │ ₫312M        │ ₫1.24B       │ 40.0% ✓ │
─────────────────────────────────────────────────────────────────────────────

─── Outlet Heatmap Table ────────────────────────────────────────────────────
│ Outlet  │ Net Sales │ COGS    │ COGS%  │ Labor   │ Labor%  │ PC%    │ vs Target │
│ HCM-01  │ ₫340M     │ ₫85M    │ 25%  ✓ │ ₫82M    │ 24% ✓   │ 49%  ✓ │ -11%      │
│ HCM-02  │ ₫290M     │ ₫87M    │ 30%  ✓ │ ₫89M    │ 31% ⚠   │ 61%  ⚠ │ -4%       │
│ HN-01   │ ₫210M     │ ₫68M    │ 32%  ⚠ │ ₫53M    │ 25% ✓   │ 57%  ✓ │ -8%       │
│ HN-02   │ ₫180M     │ ₫72M    │ 40%  ✗ │ ₫68M    │ 38% ✗   │ 78%  ✗ │ +13%      │
│ [Sort by PC%]  [Filter: only over threshold]                                │
─────────────────────────────────────────────────────────────────────────────

─── Period Comparison Chart ─────────────────────────────────────────────────
│ Bar chart: PC% by outlet, current vs prior period                          │
│ [Toggle: by outlet / by category / trend 6 months]                         │
─────────────────────────────────────────────────────────────────────────────

─── Variance Flags ──────────────────────────────────────────────────────────
│ ✗ HN-02: Prime cost 78% — 13pts above threshold. Labor 38% + COGS 40%.    │
│ ⚠ HCM-02: Labor 31% — 1pt above target. Monitor.                          │
│ [Mark as reviewed] [Add note] [Escalate]                                   │
─────────────────────────────────────────────────────────────────────────────
```

**MVP State (expense-only, no revenue/COGS):**
```
─── MVP Prime Cost View ─────────────────────────────────────────────────────
│ Outlet  │ Payroll  │ Other Expenses │ Total OpCost │ Revenue    │ PC%      │
│ HCM-01  │ ₫82M     │ ₫42M           │ ₫124M        │ — (Phase 2)│ — (Phase 2) │
│                                                                              │
│ [ⓘ] Revenue and COGS integration required for prime cost calculation.      │
│     Showing expense breakdown only.  [Learn more]                           │
─────────────────────────────────────────────────────────────────────────────
```

---

### Screen 6: Period Close / Finance Controls

**Mục tiêu:** Checklist-driven close process. Finance lead biết kỳ nào ready.

**Ai dùng:**
- `superadmin`, `finance`: full close authority
- `region_manager`: read-only close status
- `outlet_manager`: thấy status của outlet mình

**Layout:**

```
[Finance Scope Bar]

[Period: March 2026 ▼]  [Region: All]             [Close Period] (disabled if not ready)

─── Period Readiness Overview ───────────────────────────────────────────────
│ Overall Readiness: 3/5 outlets ready to close                              │
│ [████████░░░░░░░░░░░░] 60%                                                 │
─────────────────────────────────────────────────────────────────────────────

─── Outlet Checklist Table ──────────────────────────────────────────────────
│ Outlet  │ Payroll Approved │ Expenses OK │ Variances Reviewed │ Ready     │
│ HCM-01  │ ✓ Apr 5          │ ✓           │ ✓                  │ ✓ Ready   │
│ HCM-02  │ ✓ Apr 5          │ ⚠ 2 uncateg.│ -                  │ ✗ Blocked │
│ HN-01   │ ✓ Apr 4          │ ✓           │ ✓                  │ ✓ Ready   │
│ HN-02   │ ✗ Not submitted  │ ⚠ 3 uncateg.│ -                  │ ✗ Blocked │
│ DA-01   │ ✓ Apr 6          │ ✓           │ ✓                  │ ✓ Ready   │
─────────────────────────────────────────────────────────────────────────────

─── Blockers Panel ──────────────────────────────────────────────────────────
│ HCM-02                                                                     │
│   • 2 expense rows uncategorized → [Categorize now]                        │
│                                                                             │
│ HN-02                                                                       │
│   • Payroll March W1 not submitted by HR → [Notify HR]                     │
│   • 3 expense rows uncategorized → [Categorize now]                        │
│   • Variance flagged but not reviewed → [Review now]                       │
─────────────────────────────────────────────────────────────────────────────

─── Close History ───────────────────────────────────────────────────────────
│ Period      │ Closed By      │ Date        │ Status      │               │
│ Feb 2026    │ finance@fern   │ Mar 7 2026  │ Closed ✓   │ [View report] │
│ Jan 2026    │ finance@fern   │ Feb 5 2026  │ Closed ✓   │ [View report] │
─────────────────────────────────────────────────────────────────────────────
```

**Close Period Confirmation Dialog:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Close Period: March 2026                                       │
│                                                                 │
│  This will lock all expense entries for March 2026.             │
│  No new expenses or payroll changes can be made after closing.  │
│                                                                 │
│  3 outlets are ready. 2 outlets have unresolved blockers:       │
│  • HCM-02: uncategorized expenses                               │
│  • HN-02: payroll not submitted                                 │
│                                                                 │
│  Do you want to close for ready outlets only?                   │
│                                                                 │
│  [Close Ready Outlets Only]  [Resolve Blockers First]  [Cancel] │
└─────────────────────────────────────────────────────────────────┘
```

---

## D. Wireframe Text-Based

### Finance Overview Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ FERN ERP   [Finance]                                    [user] [settings]  │
├────────────────────────────────────────────────────────────────────────────┤
│ ◉ Overview  ○ Revenue  ○ Labor & Payroll  ○ Expenses  ○ Prime Cost  ○ Close│
├────────────────────────────────────────────────────────────────────────────┤
│ Scope: [All Regions ▼] [March 2026 ▼] [vs Feb 2026 ▼] [All Outlets ▼]    │
│                                                     [Export ▼] [⚠ 3 flags] │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│ │Net Sales │ │Labor Cost│ │Other OpEx│ │Prime Cost│ │  Margin  │ │Flags │ │
│ │ ₫1.24B   │ │ ₫312M    │ │ ₫184M    │ │ ₫496M    │ │ 60.0%    │ │  3   │ │
│ │ ↑8% ✓    │ │ 25.2% ⚠  │ │ 14.8% ✓  │ │ 40.0% ✓  │ │ ↑1.2pts │ │outlt │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────┘ │
├────────────────────────────────────────────────────────┬───────────────────┤
│  Outlet Performance Table                              │ Expense Sources   │
│  ┌──────┬──────┬───────┬───────┬──────┐               │  ┌──────────────┐ │
│  │Outlet│Sales │Labor% │OpEx%  │PC%   │               │  │   Donut      │ │
│  ├──────┼──────┼───────┼───────┼──────┤               │  │   Chart      │ │
│  │HCM-01│340M  │24% ✓  │12% ✓  │36% ✓ │               │  │              │ │
│  │HCM-02│290M  │31% ⚠  │16% ⚠  │47% ⚠ │               │  └──────────────┘ │
│  │HN-01 │210M  │27% ✓  │15% ✓  │42% ✓ │               │  Manual:  42%    │
│  │HN-02 │180M  │38% ✗  │18% ⚠  │56% ✗ │               │  Invoice: 35%    │
│  └──────┴──────┴───────┴───────┴──────┘               │  Payroll: 18%    │
│  [View all outlets →]                                  │  System:   5%    │
│                                                        ├───────────────────┤
│  ┌────────────────────────────────────────┐            │  Period Close     │
│  │  Trend: Net Sales vs Prime Cost %      │            │  ██████░░░░ 60%  │
│  │  [Line chart — 6 months]               │            │  3/5 ready       │
│  │  [● Sales  ● Prime Cost%]              │            │  [View Close →]  │
│  └────────────────────────────────────────┘            │                  │
└────────────────────────────────────────────────────────┴───────────────────┘
```

### Revenue Analytics Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Finance > Revenue Analytics                                [Export ▼]      │
├────────────────────────────────────────────────────────────────────────────┤
│ Scope: [HCM Region ▼] [March 2026 ▼] [vs Feb 2026 ▼] [Channel: All ▼]   │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌────────┐ ┌──────────┐ ┌─────────┐ ┌───────┐ ┌──────────┐               │
│ │ Gross  │ │Discounts │ │ Refunds │ │ Voids │ │Net Sales │               │
│ │₫1.31B  │ │ ₫42M     │ │ ₫18M    │ │ ₫7M   │ │ ₫1.24B   │               │
│ │        │ │ 3.2%     │ │ 1.4%    │ │ 0.5%  │ │          │               │
│ └────────┘ └──────────┘ └─────────┘ └───────┘ └──────────┘               │
├──────────────────────────────────────────────────────┬─────────────────────┤
│  Daily Revenue (Bar chart)                           │  Payment Mix        │
│  [████ ████ ▓▓▓▓ ████ ███ ████ ████]                │  ┌───────────────┐  │
│  [Toggle: Gross / Net / Discounts]                   │  │  Pie chart    │  │
│  [Compare: show/hide prior period]                   │  │               │  │
│                                                      │  └───────────────┘  │
│                                                      │  Cash:   28%        │
│                                                      │  Card:   45%        │
│                                                      │  Wallet: 27%        │
├──────────────────────────────────────────────────────┴─────────────────────┤
│  Outlet Revenue Breakdown                                                  │
│  ┌──────┬──────────┬──────────┬─────────┬───────┬──────────┬──────────┐   │
│  │Outlet│GrossSales│Discounts │ Refunds │ Voids │Net Sales │ vs Prior │   │
│  ├──────┼──────────┼──────────┼─────────┼───────┼──────────┼──────────┤   │
│  │HCM-01│ ₫360M    │ ₫15M     │ ₫5M     │ ₫0M   │ ₫340M    │  ↑ 12%  │   │
│  │HCM-02│ ₫308M    │ ₫12M     │ ₫4M     │ ₫2M   │ ₫290M    │  ↑  3%  │   │
│  └──────┴──────────┴──────────┴─────────┴───────┴──────────┴──────────┘   │
│  [TARGET - Phase 2: Requires sales-service aggregation API]                │
└────────────────────────────────────────────────────────────────────────────┘
```

### Labor & Payroll Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Finance > Labor & Payroll                                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ [HR View — Prepare] │ [Finance View — Approve]                            │
│ ^^^^^^^^^^^^^^^^^^^                                                        │
│ (active tab for hr role)                                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ Scope: [HCM Region ▼] [March 2026 ▼] [Status: All ▼]  [+ New Period]     │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│ │Active Empls  │ │Periods       │ │Timesheets    │ │Submitted     │      │
│ │     84       │ │  3 created   │ │ 84 submitted │ │ 2 / 3        │      │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
├────────────────────────────────────────────────────────────────────────────┤
│  Payroll Periods                                                           │
│  ┌────────────┬─────────┬───────────┬─────────────┬────────────┬────────┐ │
│  │Period      │Outlet   │Employees  │Total Amount │Status      │Action  │ │
│  ├────────────┼─────────┼───────────┼─────────────┼────────────┼────────┤ │
│  │Mar W1 2026 │ HCM-01  │ 28        │ ₫82M        │ Submitted  │ View   │ │
│  │Mar W1 2026 │ HCM-02  │ 24        │ ₫71M        │ Draft      │ Edit   │ │
│  │Mar W1 2026 │ HN-01   │ 18        │ ₫53M        │ Approved ✓ │ View   │ │
│  └────────────┴─────────┴───────────┴─────────────┴────────────┴────────┘ │
│  [+ Create payroll period]                                                 │
├────────────────────────────────────────────────────────────────────────────┤
│  ⚠ Separation of duties: HR prepares → Finance approves.                  │
│  You can submit payroll for approval. You cannot approve it.               │
└────────────────────────────────────────────────────────────────────────────┘
```

### Operating Expenses Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Finance > Operating Expenses                          [+ New Expense]      │
├────────────────────────────────────────────────────────────────────────────┤
│ [HCM Region ▼] [March 2026 ▼] [Category: All ▼] [Source: All ▼]          │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐  │
│ │ Total Expenses│ │ Manual        │ │ Invoice-linked│ │ Payroll-linked│  │
│ │    ₫184M      │ │  ₫77M (42%)   │ │  ₫64M (35%)   │ │  ₫33M (18%)   │  │
│ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘  │
├────────────────────────────────────────────────────────────────────────────┤
│  ┌──────┬─────────┬─────────────────┬─────────┬──────────────┬───────┬──┐ │
│  │Date  │Outlet   │Category         │Amount   │Source        │Status │  │ │
│  ├──────┼─────────┼─────────────────┼─────────┼──────────────┼───────┼──┤ │
│  │Apr 1 │ HCM-01  │ Utilities       │ ₫12M    │🔵 Manual     │Posted │⋮ │ │
│  │Apr 1 │ HCM-02  │ Payroll         │ ₫71M    │🟣 Payroll    │Posted │⋮ │ │
│  │Apr 2 │ HN-01   │ Supplier Invoice│ ₫24M    │🟠 Invoice    │Posted │⋮ │ │
│  │Apr 3 │ HCM-01  │ Marketing       │ ₫8M     │🔵 Manual     │Draft  │⋮ │ │
│  │Apr 3 │ HN-02   │ [Uncategorized] │ ₫3.5M   │🔵 Manual     │⚠Review│⋮ │ │
│  └──────┴─────────┴─────────────────┴─────────┴──────────────┴───────┴──┘ │
│  [Load more]                                              [Export CSV]     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Prime Cost & Variance Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Finance > Prime Cost & Variance          [Threshold: 65% ▼]  [Export]     │
├────────────────────────────────────────────────────────────────────────────┤
│ [All Regions ▼] [March 2026 ▼] [vs Feb 2026 ▼]                            │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│ │Chain PC        │ │COGS Total  │ │Labor Total │ │Net Sales   │           │
│ │₫496M / 40.0% ✓ │ │ ₫184M      │ │ ₫312M      │ │ ₫1.24B     │           │
│ └────────────────┘ └────────────┘ └────────────┘ └────────────┘           │
├────────────────────────────────────────────────────────────────────────────┤
│  Outlet Heatmap                                                            │
│  ┌──────┬──────────┬──────┬───────┬──────┬───────┬──────┬─────────────┐  │
│  │Outlet│Net Sales │COGS  │COGS%  │Labor │Labor% │PC%   │vs Target    │  │
│  ├──────┼──────────┼──────┼───────┼──────┼───────┼──────┼─────────────┤  │
│  │HCM-01│ ₫340M    │₫85M  │ 25% ✓ │₫82M  │ 24% ✓ │ 49%✓ │   -11%      │  │
│  │HCM-02│ ₫290M    │₫87M  │ 30% ✓ │₫89M  │ 31% ⚠ │ 61%⚠ │    -4%      │  │
│  │HN-01 │ ₫210M    │₫68M  │ 32% ⚠ │₫53M  │ 25% ✓ │ 57%✓ │    -8%      │  │
│  │HN-02 │ ₫180M    │₫72M  │ 40% ✗ │₫68M  │ 38% ✗ │ 78%✗ │   +13% ✗   │  │
│  └──────┴──────────┴──────┴───────┴──────┴───────┴──────┴─────────────┘  │
├────────────────────────────────────────────────────────────────────────────┤
│  Variance Flags                                                            │
│  ✗ HN-02: Prime cost 78% — 13pts above threshold. [Review] [Escalate]    │
│  ⚠ HCM-02: Labor 31% — 1pt over target.           [Review] [Dismiss]     │
│  [ⓘ TARGET: Requires revenue + COGS integration from sales/inventory]     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Period Close Wireframe

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Finance > Period Close                     [Close Period] (disabled ✗)    │
├────────────────────────────────────────────────────────────────────────────┤
│ Period: [March 2026 ▼]   Region: [All ▼]                                  │
│ Overall readiness: 3/5 outlets ready   [██████████░░░░░░░░░░] 60%         │
├────────────────────────────────────────────────────────────────────────────┤
│  ┌──────┬──────────────────┬────────────┬──────────────────┬──────────┐   │
│  │Outlet│Payroll Approved  │Expenses OK │Variances Reviewed│Ready     │   │
│  ├──────┼──────────────────┼────────────┼──────────────────┼──────────┤   │
│  │HCM-01│ ✓ Apr 5          │ ✓          │ ✓                │ ✓ Ready  │   │
│  │HCM-02│ ✓ Apr 5          │ ⚠ 2 uncatg │ —                │ ✗ Blocked│   │
│  │HN-01 │ ✓ Apr 4          │ ✓          │ ✓                │ ✓ Ready  │   │
│  │HN-02 │ ✗ Not submitted  │ ⚠ 3 uncatg │ —                │ ✗ Blocked│   │
│  │DA-01 │ ✓ Apr 6          │ ✓          │ ✓                │ ✓ Ready  │   │
│  └──────┴──────────────────┴────────────┴──────────────────┴──────────┘   │
├────────────────────────────────────────────────────────────────────────────┤
│  Blockers                                                                  │
│  HCM-02: 2 uncategorized expenses → [Go to Expenses]                      │
│  HN-02: Payroll not submitted → [Notify HR]  |  3 uncategorized → [Fix]   │
├────────────────────────────────────────────────────────────────────────────┤
│  Close History                                                             │
│  Feb 2026 │ finance@fern │ Mar 7, 2026 │ Closed ✓ │ [View report]         │
│  Jan 2026 │ finance@fern │ Feb 5, 2026 │ Closed ✓ │ [View report]         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## E. Finance Scope Bar

Finance Scope Bar là shared component dùng chung toàn module.
Nó resolve context trước khi render bất kỳ màn nào.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 🏢 [All Regions ▼]  📍 [All Outlets ▼]  📅 [March 2026 ▼]  ⟺ [vs Feb ▼] │
│                                                          🔒 [Period: Open] │
└────────────────────────────────────────────────────────────────────────────┘
```

### Scope Dimensions

| Dimension | Control | Values | Behavior |
|---|---|---|---|
| **Org scope** | Region dropdown | All / Region name | Scoped by role — outlet_manager sees only outlet |
| **Outlet scope** | Outlet multi-select | All / specific outlets | Only outlets in user's auth context |
| **Period scope** | Period picker | Month / Quarter / Custom | Default: current calendar month |
| **Comparison scope** | Compare dropdown | Previous period / Same period LY / None | Optional, drives delta columns |
| **View lens** | (implicit from workspace) | N/A | Per-screen, not in scope bar |

### Scope Bar State Rules

| State | Visual | Trigger |
|---|---|---|
| **Read-only** | Scope bar greyed out, inputs disabled | Period is closed |
| **Lock indicator** | 🔒 badge + "Period Closed" label | Period close confirmed |
| **Region aggregate** | Region selected, outlet = "All" | Finance/superadmin viewing region roll-up |
| **Outlet detail** | Specific outlet selected | Drill-down or outlet_manager default |
| **Payroll lock** | 🔒 on period picker | Payroll for period is approved — no more timesheet edits |
| **Partial lock** | ⚠ badge | Some outlets closed, some open |

### Role-based Scope Bar Restrictions

| Role | Org scope | Outlet scope |
|---|---|---|
| `superadmin` | All regions | All outlets |
| `finance` | Region(s) assigned | All outlets in those regions |
| `region_manager` | Region(s) assigned | All outlets in those regions |
| `outlet_manager` | Outlet's region (read) | Only assigned outlet |
| `hr` | Region(s) assigned | All outlets in region (for payroll) |

---

## F. Current-State vs Target-State Matrix

| Capability | Current-State Support | Backend Support | UI Treatment | Roadmap Phase |
|---|---|---|---|---|
| Expense ledger (manual entry) | ✅ Full | ✅ Available | Full feature | MVP |
| Expense source label (manual/invoice/payroll) | ✅ Partial | ✅ Source stored in DB | Show source badge on rows | MVP |
| Payroll period management (HR prepare) | ✅ Full | ✅ Available | Full HR tab | MVP |
| Payroll approval (Finance approve) | ✅ Full | ✅ Available | Full Finance tab | MVP |
| Period close checklist | ✅ Partial | ✅ Payroll state + expense state | Checklist with payroll + expense items | MVP |
| Expense category breakdown | ✅ Full | ✅ Category stored | Category filter + donut chart | MVP |
| Total OpEx KPI (on Overview) | ✅ Full | ✅ Aggregation from expense table | KPI card | MVP |
| Total Payroll KPI (on Overview) | ✅ Full | ✅ From approved payrolls | KPI card | MVP |
| Revenue (Net Sales) | ❌ None | ❌ Needs sales-service API | Placeholder with "Phase 2" note | Phase 2 |
| Labor % of sales | ❌ None | ❌ Needs revenue | Show placeholder | Phase 2 |
| Prime Cost % | ❌ None | ❌ Needs revenue + COGS | Show expense-only breakdown | Phase 2 |
| COGS aggregation | ❌ None | ❌ Needs inventory/procurement | Placeholder | Phase 2 |
| Gross margin | ❌ None | ❌ Needs revenue | Placeholder | Phase 2 |
| Cross-outlet comparison (with %) | ❌ None | ❌ Needs revenue | Show raw amounts only | Phase 2 |
| Period-over-period trend chart | ❌ None | ❌ Needs historical aggregation | Placeholder | Phase 2 |
| Revenue channel breakdown | ❌ None | ❌ Needs sales analytics | Placeholder | Phase 3 |
| Labor hours tracking | ❌ None | ❌ Needs time-tracking feature | Placeholder | Phase 3 |
| Overtime tracking | ❌ None | ❌ Needs scheduling integration | Placeholder | Phase 3 |
| Budget vs actual | ❌ None | ❌ Needs budget management module | Placeholder | Phase 3 |
| Automated variance flags | ❌ None | ❌ Needs threshold configuration | Manual flag in Phase 2 | Phase 3 |

---

## G. Role-Based UX

### superadmin

- **Thấy gì:** Toàn bộ 6 workspaces, all regions, all outlets.
- **Tạo expense:** Có (tất cả outlets).
- **Prepare payroll:** Có (thấy cả HR tab và Finance tab).
- **Approve payroll:** Có.
- **Scope bar:** All regions + all outlets — không bị restrict.
- **Finance-sensitive detail:** Đầy đủ.
- **Payroll detail:** Đầy đủ.
- **Special:** Duy nhất thấy cả HR tab và Finance tab trong Workspace 3.

### finance (region-scoped)

- **Thấy gì:** Tất cả 6 workspaces, scoped to assigned region(s).
- **Tạo expense:** Có (trong region của mình).
- **Prepare payroll:** Không. Chỉ thấy Finance tab (approve) trong Workspace 3.
- **Approve payroll:** Có, trong region của mình.
- **Scope bar:** Region locked to assignment.
- **Finance-sensitive detail:** Đầy đủ.
- **Payroll detail:** Có thể xem full employee-level detail để approve.
- **Cross-outlet comparison:** Có, trong region.

### region_manager

- **Thấy gì:** Workspace 1 (read), 2 (read), 3 (read-only), 4 (read-only), 5 (read), 6 (read-only status).
- **Tạo expense:** Không.
- **Prepare payroll:** Không.
- **Approve payroll:** Không.
- **Scope bar:** Region locked.
- **Finance-sensitive detail:** Có (expense total, tổng payroll), không thấy employee-level payroll detail.
- **Cross-outlet comparison:** Có, trong region — nhưng không có percentage-based view cho đến Phase 2.

### outlet_manager

- **Thấy gì:** Workspace 1 (outlet-scoped KPIs), 3 (read-only, outlet view), 4 (W — tạo expense tại outlet), 6 (outlet status only).
- **Tạo expense:** Có, tại outlet của mình.
- **Prepare payroll:** Không (payroll là HR role).
- **Approve payroll:** Không.
- **Scope bar:** Outlet fixed — không thể thay đổi.
- **Finance-sensitive detail:** Tổng expense outlet. Không thấy cross-outlet data.
- **Payroll detail:** Không thấy employee-level payroll numbers. Chỉ thấy "Payroll approved: Yes/No" cho mục đích Period Close.

### hr (region-scoped)

- **Thấy gì:** Workspace 3 — HR tab only. Không thấy Finance tab.
- **Tạo expense:** Không.
- **Prepare payroll:** Có — tạo period, timesheet, submit.
- **Approve payroll:** Không. "Approve" CTA ẩn hoàn toàn.
- **Scope bar:** Region locked. Thấy outlets trong region.
- **Finance-sensitive detail:** Không thấy expense ledger, không thấy finance KPIs.
- **Warning:** Nếu cố access Finance tab → "This action requires Finance role."

### staff (nếu có read-only report)

- **Thấy gì:** Không có Finance module access theo default.
- **Exception:** Nếu được gán `report.read` permission tại outlet, thấy Report module riêng (không phải Finance module).
- **Finance module:** Toàn bộ Finance module ẩn — không render sidebar item.

---

## H. KPI Design

### Overview KPIs

| KPI | Formula | Target | Alert threshold | Source |
|---|---|---|---|---|
| Net Sales | Gross - Discounts - Refunds - Voids | — | — | [Phase 2] sales-service |
| Labor Cost | Sum of approved payrolls in period | — | — | payroll-service |
| Labor % | Labor Cost / Net Sales | < 30% | > 35% amber, > 40% red | [Phase 2] |
| Other OpEx | Sum of non-payroll expenses | — | — | finance-service |
| Other OpEx % | Other OpEx / Net Sales | < 20% | > 25% amber | [Phase 2] |
| Prime Cost | Labor + COGS | — | — | [Phase 2] |
| Prime Cost % | Prime Cost / Net Sales | < 65% | > 65% amber, > 70% red | [Phase 2] |
| Gross Margin | Net Sales - Prime Cost | — | — | [Phase 2] |
| Gross Margin % | Gross Margin / Net Sales | > 35% | < 30% amber | [Phase 2] |
| Variance Flags | Count of outlets > threshold | 0 | Any > 0 | [Phase 2] |

### Revenue KPIs

| KPI | Formula | Note |
|---|---|---|
| Gross Sales | Sum all sales transactions | [Phase 2] |
| Discounts | Sum discount amounts | [Phase 2] |
| Refunds | Sum refund amounts | [Phase 2] |
| Voids | Sum voided transactions | [Phase 2] |
| Net Sales | Gross - Disc - Ref - Void | [Phase 2] |
| Payment mix % | Channel breakdown | [Phase 2] |

### Labor KPIs

| KPI | Formula | Note |
|---|---|---|
| Payroll Total | Sum approved payrolls | [CURRENT] |
| Payroll pending | Sum submitted not approved | [CURRENT] |
| Labor % | Payroll / Net Sales | [Phase 2] |
| Labor hours | Sum timesheets (hours) | [Phase 3] |
| Overtime hours | Overtime hours logged | [Phase 3] |
| Cost per labor hour | Payroll / hours | [Phase 3] |

### Expense KPIs

| KPI | Formula | Note |
|---|---|---|
| Total operating expense | Sum expense rows | [CURRENT] |
| By source (manual/invoice/payroll/system) | Count + amount | [CURRENT] |
| Pending review | Uncategorized count | [CURRENT] |
| By category | Sum per category code | [CURRENT] |

### Prime Cost KPIs

| KPI | Formula | Note |
|---|---|---|
| Prime cost value | Labor + COGS | [Phase 2] |
| Prime cost % | PC / Net Sales | [Phase 2] |
| Outlet variance | PC% - chain average PC% | [Phase 2] |
| Period variance | Current PC% - prior PC% | [Phase 2] |

### Close KPIs

| KPI | Source | Note |
|---|---|---|
| Pending payroll approvals | Payroll pending count | [CURRENT] |
| Uncategorized expense rows | Expense rows without category | [CURRENT] |
| Outlets ready to close | Count where all checks pass | [CURRENT] |
| Period ready % | Ready outlets / total outlets | [CURRENT] |

---

## I. UX Rules Bắt Buộc

### Khi nào hide CTA

| CTA | Hide condition |
|---|---|
| `+ New Expense` | Period is closed OR user role cannot write expense at current outlet |
| `Approve` (payroll) | User does not have `finance` role OR `superadmin` |
| `Submit` (payroll period) | User does not have `hr` role OR `superadmin` |
| `Close Period` | Not all outlets ready OR user not `finance`/`superadmin` |
| `Categorize` | Period closed |
| `Edit` (expense row) | Source is `invoice` or `payroll` (system-generated, immutable) OR period closed |

### Khi nào read-only

| Scenario | Behavior |
|---|---|
| Period is closed | All expense forms disabled. No edit/delete. Read-only badge on scope bar. |
| Payroll approved | Timesheet rows locked. Cannot edit hours or amounts. |
| Source = invoice/payroll/system | Expense row cannot be edited by user. "System-generated" label. |
| Outlet outside user scope | Data filtered out, not rendered as locked. |

### Khi nào show scope pill

Show scope pill (e.g. `📍 HCM-01`) khi:
- User đang xem outlet-specific data (drill-down từ cross-outlet view).
- outlet_manager — luôn hiển thị outlet pill.
- Scope bar đang ở outlet-level filter.

### Khi nào show source label

Show source badge trên mọi expense row trong Workspace 4.
Source label: `🔵 Manual` | `🟠 Invoice` | `🟣 Payroll` | `⚫ System`
Không thể xóa source label — nó reflect backend origin.

### Khi nào show payroll separation warning

Show warning banner trong Workspace 3 khi:
- `hr` user cố access Finance tab: "Payroll approval requires Finance role."
- `finance` user cố submit timesheet (nếu bug): "Payroll preparation requires HR role."
- Tổng quát: mỗi khi action không thuộc role → show warning thay vì silent fail.

### Khi nào confirm dialog bắt buộc

| Action | Confirm dialog |
|---|---|
| Close Period | ✅ Required — nêu rõ outlets affected, blocking items |
| Approve Payroll | ✅ Required — amount, outlet, period, employee count |
| Reject Payroll | ✅ Required — require rejection note |
| Delete expense row (if allowed) | ✅ Required |
| Bulk categorize expenses | ✅ Required — show count of rows affected |

### Khi nào show variance badge

Show variance badge `⚠` khi:
- Labor % > 35% (amber), > 40% (red).
- Prime Cost % > 65% (amber), > 70% (red). [Phase 2]
- Expense row không có category → `⚠ Review`.
- Period variance > ±5pts vs prior period. [Phase 2]

### Khi nào lock editing vì close state

| State | Lock behavior |
|---|---|
| Period = Closed | All expense/payroll edits locked for that period |
| Payroll = Approved | Timesheet for that period locked |
| Partial close | Only closed-outlet data locked; open outlets still editable |

---

## J. Anti-Patterns — Phải Tránh

### 1. Finance = Expense Ledger
**Lỗi:** Toàn bộ Finance module chỉ là một bảng expense.
**Hệ quả:** Finance lead phải dùng Excel cho mọi analysis. Sản phẩm chỉ là data entry tool.

### 2. Payroll và Expense trộn thành một workflow
**Lỗi:** Tạo một màn "Manage Costs" với cả expense và payroll trong cùng một table.
**Hệ quả:** Vi phạm separation of duties. HR không nên thấy expense detail. Finance không nên tạo payroll.

### 3. Không có Revenue layer
**Lỗi:** Finance module không có Revenue Analytics.
**Hệ quả:** Không thể tính Labor %, Prime Cost %. Không thể biết outlet đang lãi hay lỗ.

### 4. Không có Labor vs Sales
**Lỗi:** Payroll module chỉ show tổng tiền, không có % của sales.
**Hệ quả:** ₫312M payroll không có ý nghĩa gì nếu không biết sales là bao nhiêu.

### 5. Không có Prime Cost / Margin / Variance
**Lỗi:** Không có cross-metric KPI.
**Hệ quả:** Không phát hiện được outlet đang operate outside safe zone.

### 6. Không có Close State
**Lỗi:** Tháng nào cũng "open". Không có close workflow.
**Hệ quả:** Expense có thể được edit sau khi báo cáo đã gửi. Data không trustworthy.

### 7. Scope mơ hồ
**Lỗi:** Không rõ số đang hiển thị là cho outlet nào, region nào, period nào.
**Hệ quả:** Finance lead không biết con số họ đang nhìn đại diện cho gì.

### 8. Payroll prepare/approve bị trộn
**Lỗi:** Một màn "Payroll" có cả Create và Approve trong cùng một view, không phân tab.
**Hệ quả:** Vi phạm separation of duties. HR có thể approve lương của mình.

### 9. Biến target-state thành current-state
**Lỗi:** Render Prime Cost % chart với placeholder data khi backend chưa có.
**Hệ quả:** Dev đặt câu hỏi "data này lấy từ đâu?" và phải fake. Trust bị phá vỡ.

### 10. Outlet_manager thấy cross-outlet data
**Lỗi:** outlet_manager thấy performance comparison của các outlet khác.
**Hệ quả:** Data leak. Vi phạm scope isolation.

---

## K. Final Blueprint

### Module Structure (Chốt)

```
Finance Module (Profit Control Center)
│
├── 1. Finance Overview          MVP   [Expense + Payroll KPIs only]
│                                P2    [+ Revenue, Labor%, Prime Cost%]
│
├── 2. Revenue Analytics         P2    [Full — needs sales-service]
│   (Placeholder in MVP with clear note)
│
├── 3. Labor & Payroll           MVP   [Full — HR tab + Finance tab separate]
│   ├── HR View (prepare)              [HR role only]
│   └── Finance View (approve)         [Finance role only]
│
├── 4. Operating Expenses        MVP   [Full — upgraded from current ledger]
│   ├── Expense table with source labels
│   ├── Category filter
│   └── Create expense form
│
├── 5. Prime Cost & Variance     P2    [Needs revenue + COGS integration]
│   (Expense-only breakdown in MVP with clear Phase 2 note)
│
└── 6. Period Close              MVP   [Payroll + expense close checklist]
                                 P2    [+ Variance reviewed check]
```

### MVP Scope

Ship these in MVP:

1. **Finance Overview** — KPI cards: Total Expense (from ledger) + Total Payroll (from approved). Outlet expense breakdown table. Period close status widget.
2. **Labor & Payroll** — Full HR prepare / Finance approve separation. Payroll period table. Employee-level detail for finance approval.
3. **Operating Expenses** — Full upgrade of current expense ledger. Source labels. Category filter. Uncategorized warning.
4. **Period Close** — Checklist per outlet: payroll approved? Expenses categorized? Progress bar. Close confirm dialog.
5. **Scope Bar** — Shared component across all screens.

**Do NOT ship in MVP:**
- Revenue Analytics workspace (no backend).
- Prime Cost % (no revenue/COGS data).
- Labor % of sales.
- Cross-outlet heatmap with percentage comparison.

### Phase 2

1. **Sales-service integration** — Net Sales KPI on Overview. Revenue Analytics workspace.
2. **Labor % and Prime Cost % calculation** — Cross-metric layer in Overview and Prime Cost workspace.
3. **Cross-outlet comparison with %** — Outlet heatmap in Prime Cost & Variance.
4. **Period-over-period trend chart** — 6-month trend on Overview.
5. **Variance flags** — Automated amber/red badges when outlets exceed thresholds.

### Phase 3

1. **COGS aggregation** — From inventory/procurement for full prime cost breakdown.
2. **Labor hours tracking** — Scheduling integration for hours-based labor analytics.
3. **Budget vs actual** — Budget module integration.
4. **Revenue channel breakdown** — Dine-in / Delivery / Takeout split.
5. **Automated anomaly detection** — Machine learning-based variance flagging.

---

### Workflow: Finance Lead (Daily Review)

```
Open Finance Overview
→ Scan KPI row (expense total, payroll status)
→ Check outlet expense table for outliers
→ If uncategorized expenses → Go to Operating Expenses → Categorize
→ Check Period Close status widget
→ If blockers → Resolve from Close workspace
```

### Workflow: Outlet Manager (Weekly)

```
Open Finance > Operating Expenses (scoped to outlet)
→ Create new manual expenses
→ Review uncategorized rows
→ Check Period Close status (outlet only)
```

### Workflow: HR Prepare Payroll

```
Open Finance > Labor & Payroll > HR View
→ Create payroll period for outlet
→ Add/verify timesheets
→ Review total amount
→ Submit for approval
→ Status changes to "Submitted"
```

### Workflow: Finance Approve Payroll

```
Open Finance > Labor & Payroll > Finance View
→ Review approval queue
→ Click Review on submitted period
→ Verify employee breakdown
→ Approve (with confirm dialog: amount + outlet + period)
→ Status changes to "Approved"
→ Expense row auto-created (source: Payroll)
```

### Workflow: Period Close Review

```
Open Finance > Period Close
→ Select period
→ Review checklist by outlet
→ Resolve blockers:
   - Notify HR for unsubmitted payroll
   - Categorize expenses inline
   - [Phase 2] Review variance flags
→ When all outlets ready → Close Period (confirm dialog)
→ Period locked → all edits disabled
```

---

## 5 Phần Kết

### 1. North-Star UI của module này

> **Finance = Profit Control Center của chuỗi F&B.**
>
> Finance lead mở ra, trong 30 giây biết: chuỗi đang ở đâu, outlet nào cần xử lý, kỳ nào đã sẵn sàng close. Không cần Excel. Không cần tổng hợp thủ công. Mọi con số đều có context, có scope, và có action.

### 2. Vì sao nó hợp với chuỗi F&B nhiều outlet

Chuỗi F&B có đặc điểm:
- **Labor cost biến động cao** theo mùa, sự kiện, outlet location — cần theo dõi % liên tục.
- **Outlet diversity** — cùng brand nhưng HCM-01 và HN-02 có cost structure rất khác. Cross-outlet comparison là bắt buộc.
- **Prime cost là KPI sống còn** — ngành F&B thua lỗ vì prime cost vượt ngưỡng mà không ai biết đủ sớm.
- **Monthly close** là chu kỳ vận hành — không có close state thì báo cáo tháng không trustworthy.
- **Separation of duties** (HR prepare / Finance approve) là governance thực tế trong chuỗi có nhiều nhân viên.

### 3. Ba rủi ro lớn nhất nếu vẫn giữ Finance = Expense Ledger

1. **Finance lead dùng Excel làm mọi analysis** — ERP không hỗ trợ decision making, chỉ hỗ trợ data entry. Adoption thấp, churn cao.
2. **Không phát hiện outlet đang lỗ** — không có prime cost / labor % tracking, chain có thể vận hành outlet thua lỗ nhiều tháng mà không biết.
3. **Payroll governance không được enforce** — nếu không có separation of duties rõ ràng trong UI, quy trình phê duyệt lương bị bypass hoặc bị thực hiện sai người.

### 4. Ba việc nên làm ngay trong MVP

1. **Upgrade Expense Ledger thành Operating Expenses workspace** — thêm source labels, category filter, uncategorized warning. Không cần backend mới.
2. **Tách HR tab / Finance tab trong Labor & Payroll** — enforce separation of duties ngay tại UI layer. Backend đã có.
3. **Build Period Close checklist** — aggregate trạng thái payroll approved + expenses categorized theo outlet. Không cần new API — chỉ cần aggregate existing states.

### 5. Ba việc nên để Phase 2

1. **Sales-service integration** — Net Sales vào Overview, Revenue Analytics workspace, và Labor % / Prime Cost % calculation.
2. **Cross-outlet heatmap với %** — Prime Cost & Variance workspace full version. Cần revenue denominator.
3. **Automated variance badges** — threshold configuration và auto-flag khi outlet vượt ngưỡng. Cần historical data và configurable rules.
