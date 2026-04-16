# FERN IAM Module — UI/UX Blueprint

> Last updated: 2026-04-16
>
> This document is the canonical UI/UX specification for the FERN IAM module.
> It is designed to be handed off to product, design, and frontend teams.

---

## 1. Design Principles

### Triết lý thiết kế

FERN IAM không phải một hệ thống RBAC generic. Nó là một **domain-aware authorization layer** cho chuỗi F&B vận hành nhiều outlet, với các đặc thù:

**A. Fan-out / Collapse là trung tâm của scope model.**
Khi admin gán "Region Manager cho HCM Region", backend ghi N rows (1 per outlet). Khi đọc lại, policy layer collapse thành 1 region assignment. UI phải:
- Hiển thị assignment ở mức region (human-friendly)
- Cung cấp fan-out preview trước khi commit (để admin hiểu DB sẽ ghi gì)
- Hiển thị effective outlet list sau khi gán (để verify)
- Cảnh báo khi outlet mới được thêm vào region (auto-inherit hay không)

**B. Role-first, permission-second.**
10 canonical roles cover 95% use cases. Direct permissions chỉ là fallback cho edge cases. UI phải đặt role assignment làm primary flow, direct permissions là secondary/advanced.

**C. Assignment khác Effective Access.**
"Được gán role X" không đồng nghĩa "có quyền Y". Effective access là kết quả tính toán từ: canonical role + scope + direct permissions + outlet membership read floor + legacy mapping. UI phải tách bạch 2 khái niệm này.

**D. Domain-specific separation of duties.**
- Procurement: write ≠ approve
- Payroll: prepare (HR) ≠ approve (Finance)
- Admin: governance ≠ business operations

UI phải thể hiện các separation này bằng visual cues, không để user nhầm.

**E. Honest với backend.**
Chỉ 3 scope runtime: Global, Region, Outlet. Không bịa thêm. Legacy roles hiện hữu nhưng không assignable mới. Internal service bypass là technical concern, không phải business role.

---

## 2. Information Architecture

```
IAM (sidebar section)
├── Overview                          ← Dashboard / health summary
├── Users
│   ├── User Directory                ← Search, filter, list all users
│   ├── Invite / Activate             ← Onboard new user
│   └── Locked / Suspended            ← Deactivated accounts
├── Roles
│   ├── Canonical Roles               ← 10 role cards, read-only definitions
│   ├── Legacy Mapping                ← Legacy → canonical mapping table
│   └── Compare Roles                 ← Side-by-side domain access comparison
├── Assignments
│   ├── Assign by Outlet              ← Single-outlet role assignment
│   ├── Assign by Region              ← Region fan-out assignment
│   └── Fan-out Preview               ← Inline in assignment flow, also standalone
├── Direct Permissions
│   ├── Permission Catalog            ← 8 permission codes, read-only reference
│   └── Permission Grants             ← Assign/revoke direct permissions per user
├── Effective Access
│   ├── By User                       ← Full access breakdown for 1 user
│   ├── By Outlet                     ← Who has what at outlet X
│   └── Access Explanation            ← Deep-dive why allow/deny for specific check
├── Audit & Reviews
│   ├── Permission Change Log         ← Role/permission assignment changes
│   ├── Sensitive Access Log          ← Sensitive permission usage
│   └── Login / MFA Events           ← Authentication events
└── Security Settings
    ├── MFA Configuration             ← Enforce/manage MFA
    ├── Session Policies              ← Timeout, concurrent sessions
    ├── PIN / Passcode                ← POS PIN management
    └── Internal Service Accounts     ← Technical view, service tokens
```

### Audience per Section

| Section | Primary Users | Actions |
|---------|--------------|---------|
| Overview | superadmin, admin | Scan health, spot anomalies |
| User Directory | superadmin, admin | Find users, navigate to detail |
| Invite/Activate | superadmin, admin | Onboard users |
| Locked/Suspended | superadmin, admin | Review, reactivate |
| Canonical Roles | superadmin, admin, region_manager (read) | Understand role definitions |
| Legacy Mapping | superadmin, admin | Understand legacy accounts |
| Compare Roles | superadmin, admin | Decision support for assignment |
| Assign by Outlet | superadmin, admin | Assign role at 1 outlet |
| Assign by Region | superadmin, admin | Assign role across region |
| Direct Permissions | superadmin, admin | Grant fallback permissions |
| Effective Access | superadmin, admin, region_manager (read) | Audit, troubleshoot access |
| Audit & Reviews | superadmin, admin, region_manager | Compliance, incident response |
| Security Settings | superadmin, admin | Policy configuration |

---

## 3. Screen-by-Screen Design

---

### 3.1 Overview

**Goal:** Snapshot IAM health. Detect anomalies quickly.

**Users:** superadmin, admin

**Layout:** 4-column metric bar + 2-column content area

**Top metrics bar (4 cards):**
- Total Active Users (number + trend)
- Pending Invitations (number, click → Invite/Activate)
- Locked Accounts (number, click → Locked/Suspended)
- Recent Permission Changes (last 7 days count, click → Change Log)

**Left column (60%):**
- **Role Distribution** — horizontal bar chart showing user count per canonical role. Click role → filter User Directory.
- **Scope Distribution** — pie/donut: Global vs Region vs Outlet assignments count.
- **Recent Activity** — last 10 permission changes as timeline (who, what, when). Each row clickable → Change Log detail.

**Right column (40%):**
- **Alerts / Attention Needed**
  - Users with no role assignment
  - Users with legacy-only roles (no canonical mapping)
  - Superadmin count (if > 3, yellow warning)
  - Users with sensitive permissions (purchase.approve, auth.user.write, auth.role.write)
- **Quick Actions**
  - Invite User
  - Assign Role
  - Review Effective Access

**Empty state:** "No users configured yet. Start by inviting your first user."

**Error state:** If API fails, show inline error per section with retry button, not full-page error.

---

### 3.2 User Directory

**Goal:** Find and browse users. Entry point to User Detail.

**Users:** superadmin, admin

**Layout:** Full-width data table with filter bar

**Filter bar:**
- Search (name, email, employee ID)
- Role (multi-select dropdown, canonical roles only)
- Scope Type (Global / Region / Outlet)
- Region (dropdown, only if scope filter = Region or All)
- Outlet (dropdown)
- Status (Active / Invited / Locked / Suspended)
- Has Legacy Role (yes/no toggle)

**Table columns:**

| Column | Description |
|--------|-------------|
| Name | Full name, clickable → User Detail |
| Email | |
| Primary Role | Highest canonical role. If multiple, show primary + "+N" badge |
| Scope | Pill: Global / Region name / Outlet name |
| Status | Badge: Active (green), Invited (blue), Locked (red), Suspended (gray) |
| Legacy | If has legacy role: amber badge "Legacy: cashier → Staff" |
| Last Login | Relative time |
| Actions | ••• menu: View Detail, Assign Role, Lock, Suspend |

**CTA:** "Invite User" button (top right)

**Pagination:** Server-side, 25/50/100 per page

**Warning state:** Banner if users with unmapped legacy roles: "N users have legacy roles that could not be mapped. Review in Legacy Mapping."

**Empty state:** "No users match your filters." / "No users yet. Invite your first user."

---

### 3.3 User Detail

**Goal:** Full profile + assignments + effective access for 1 user. Most important screen.

**Users:** superadmin, admin (write); region_manager (read-only for users in their region)

**Layout:** Header + tabbed content area

**Header:**
- Avatar, Name, Email, Employee ID, Status badge
- Last login timestamp
- Quick actions: Edit Profile, Lock/Unlock, Reset Password

**Tabs:**

**Tab 1: Role Assignments**
- Table of all current role assignments:

| Role | Scope Type | Scope Target | Assigned By | Assigned At | Source | Actions |
|------|-----------|-------------|-------------|-------------|--------|---------|
| outlet_manager | Outlet | Saigon Centre | admin@fern.io | 2026-03-01 | Canonical | Revoke |
| finance | Region | HCM Region | super@fern.io | 2026-02-15 | Canonical | Revoke |

- Source column badges: `Canonical` (blue), `Legacy Mapped` (amber with tooltip showing original code)
- "Assign Role" CTA → opens assignment drawer
- If user has legacy role: info banner explaining mapping

**Tab 2: Direct Permissions**
- Table of granted direct permissions:

| Permission | Label | Outlet | Granted By | Granted At | Sensitive | Actions |
|-----------|-------|--------|------------|------------|-----------|---------|
| purchase.approve | Procurement Approval | Saigon Centre | admin@fern.io | 2026-03-10 | Yes | Revoke |

- "Grant Permission" CTA → opens permission grant drawer
- Sensitive permissions highlighted with amber badge

**Tab 3: Effective Access**
- Full effective access breakdown (see Section 3.11 for detail)
- Domain-grouped table showing all allow/deny with source explanation
- This is read-only, computed view

**Tab 4: Activity Log**
- Filtered audit log for this user only
- Permission changes, login events, role changes

**Warning states:**
- If user has no role assignments: red banner "This user has no role assignments and can only access data via outlet membership read floor."
- If user has superadmin: amber banner "This user has superadmin access. All domain restrictions are bypassed."
- If user has legacy role: info banner "This user has legacy role `cashier` which is mapped to canonical role `Staff`. Legacy roles cannot be newly assigned."

---

### 3.4 Canonical Roles

**Goal:** Reference view for 10 canonical roles. Not editable.

**Users:** superadmin, admin, region_manager (read)

**Layout:** Card grid (2 columns) or expandable list

**Each role card shows:**
- Role name + code
- Default scope pill (Global / Region / Outlet)
- Purpose (1 sentence)
- Key capabilities (bulleted)
- Hard limits (red text, bulleted)
- Badge/warning if applicable (governance-only, no approve, minimal access, etc.)
- "Compare" button → adds to compare queue
- "View Users" → filters User Directory by this role

**Role card details: see Section 6.**

**Read-only explanation:** "Canonical roles are system-defined and cannot be modified. To grant additional access, use Direct Permissions."

---

### 3.5 Legacy Mapping

**Goal:** Explain legacy → canonical mapping. Support migration review.

**Users:** superadmin, admin

**Layout:** Two-column mapping table + affected users count

**Table:**

| Legacy Code | Canonical Role | Affected Users | Status |
|-------------|---------------|----------------|--------|
| cashier | Staff | 12 | Mapped |
| staff_pos | Staff | 3 | Mapped |
| procurement_officer | Procurement | 7 | Mapped |
| hr_manager | HR | 2 | Mapped |
| finance_manager | Finance | 4 | Mapped |
| finance_approver | Finance | 1 | Mapped |
| regional_finance | Finance | 2 | Mapped |
| accountant | Finance | 1 | Mapped |
| regional_manager | Region Manager | 3 | Mapped |
| system_admin | Admin | 1 | Mapped |
| technical_admin | Admin | 0 | Mapped |
| inventory_clerk | — | 2 | Compatibility only |

- "Affected Users" clickable → User Directory filtered by legacy code
- "Compatibility only" row highlighted amber: "This code has no canonical mapping. Existing accounts function via compatibility layer but these roles are hidden from the business catalog."

**Info banner:** "Legacy roles are not assignable in the new IAM. Users with legacy roles will continue to function via automatic mapping. To explicitly assign canonical roles, go to User Detail → Assign Role."

---

### 3.6 Compare Roles

**Goal:** Side-by-side comparison for role selection decision support.

**Users:** superadmin, admin

**Layout:** Role selector bar + comparison table

**Top bar:** 2-4 role selector dropdowns. Pre-fill if navigated from role cards.

**Comparison table (domain access matrix):**

| Domain | Role A | Role B | Role C |
|--------|--------|--------|--------|
| Org read | R | R (outlet) | R (outlet) |
| Org mutate | W | - | - |
| Catalog read | R (outlet) | R (region) | R (outlet) |
| Catalog mutate | - | - | W |
| Sales write | - | - | - |
| ... | ... | ... | ... |

- Cell colors: Green (W/A), Blue (R), Red dash (-)
- Scope shown inline in cell
- Highlight differences between selected roles

**Below table:**
- Key differences summary (auto-generated text)

---

### 3.7 Assign by Outlet

**Goal:** Assign 1 role to 1 user at 1 outlet.

**Users:** superadmin, admin

**Layout:** Drawer (slides from right) or modal

**Steps:**
1. Select User (search autocomplete, or pre-filled if from User Detail)
2. Select Role (dropdown of 10 canonical roles, with inline role summary)
3. Select Outlet (dropdown grouped by region)
4. Review & Confirm

**Review panel shows:**
- User name
- Role + role badge (e.g., "Governance only" for admin)
- Outlet name + region
- Effective change summary: "This will grant [role] access at [outlet]. 1 row will be written to user_role."
- If user already has this role at other outlets: info note

**CTA:** "Assign Role"

**Warning states:**
- If assigning superadmin: red confirmation dialog
- If assigning admin: amber note "Admin is governance-only."
- If user already has the same role at this outlet: error

---

### 3.8 Assign by Region

**Goal:** Assign role to user at all outlets in 1 region (fan-out).

**Users:** superadmin, admin

**Layout:** Drawer or dedicated page (recommended page for clarity)

**Steps:**
1. Select User
2. Select Role (dropdown, with note about typical region-scoped roles)
3. Select Region
4. **Fan-out Preview (mandatory step)** — see 3.9
5. Confirm

**Fan-out preview is mandatory before confirm.** User must see outlet list.

**Warning states:**
- If region has 0 outlets: error "This region has no outlets."
- If user already has role at some outlets in region: amber warning with count

---

### 3.9 Fan-out Preview

**Goal:** Show exactly what DB will write for region-scoped assignment. Key transparency layer.

**Users:** superadmin, admin (mandatory step in region assignment flow)

**Layout:** Inline panel in assignment flow + standalone accessible

**Summary bar:**
- "Assigning **[role]** to **[user]** across **[region]** will create **N** outlet-level records."

**Outlet table:**

| # | Outlet | Status | Note |
|---|--------|--------|------|
| 1 | Saigon Centre | New | Will be created |
| 2 | Thao Dien | New | Will be created |
| 3 | District 7 | Already exists | User already has this role here |
| 4 | Phu My Hung | New | Will be created |

- Green rows: new assignments
- Gray rows: already exists (no-op)
- Count summary: "3 new assignments, 1 existing (no change)"

**Explanation text:**
> "FERN stores all role assignments at the outlet level. When you assign a role by region, the system creates one record per outlet in that region. The policy layer will collapse these back into a single region-scoped assignment when reading. If a new outlet is added to this region later, you will need to re-run the region assignment to include it."

**CTA:** "Confirm Assignment (3 new records)"

**Note about future outlets:** Info callout: "New outlets added to [region] after this assignment will NOT automatically inherit this role."

---

### 3.10 Direct Permissions

**Goal:** Manage 8 fallback permissions. Secondary flow after role assignment.

**Users:** superadmin, admin

**Layout:** Two sections — Permission Catalog (reference) + Permission Grants (management)

**Permission Catalog (read-only reference):**

| Permission | Label | Business Meaning | Scope | Sensitive |
|-----------|-------|-----------------|-------|-----------|
| product.catalog.write | Catalog Write | Create/edit products, prices, recipes | Outlet | No |
| sales.order.write | Sales Write | Submit/process sales orders | Outlet | No |
| purchase.write | Procurement Write | Create POs, goods receipts, invoices | Outlet | No |
| purchase.approve | Procurement Approve | Approve POs, goods receipts | Outlet | Yes |
| inventory.write | Inventory Write | Stock counts, waste records | Outlet | No |
| hr.schedule | HR Schedule | Manage shift schedules | Outlet | No |
| auth.user.write | User Mgmt | Create/modify user accounts | Global | Yes |
| auth.role.write | Role Mgmt | Assign/revoke roles | Global | Yes |

**Explanation banner:** "Direct permissions are fallback grants for edge cases where canonical roles don't provide the needed access. In most cases, assigning the correct role is preferred."

**Permission Grants (management):**
- Filter by: User, Permission, Outlet
- Table with User, Permission, Outlet, Granted By, Date, Actions (Revoke)
- "Grant Permission" CTA → drawer with user/permission/outlet selection + confirmation for sensitive

---

### 3.11 Effective Access — By User

**Goal:** Computed read-only view showing everything a user can and cannot do, with source explanation.

**Users:** superadmin, admin (write context); region_manager (read-only for their region)

**Layout:** User selector + domain-grouped access table

**Filter bar:**
- Domain (Org, Catalog, Sales, Procurement, Inventory, Finance, Payroll, HR, Audit, Reports)
- Effect (Allow / Deny)
- Source (Role Grant, Direct Permission, Read Floor, Legacy Mapping)
- Scope (Global, Region, Outlet)

**Access table (grouped by domain):**

| Capability | Effect | Scope | Source | Explanation |
|-----------|--------|-------|--------|-------------|
| Procurement write | Allow | Saigon Centre | Role: procurement | procurement role at outlet grants PO creation |
| Procurement approve | Deny | — | Role limit | procurement role cannot approve. Requires outlet_manager or purchase.approve permission. |
| Procurement read | Allow | Saigon Centre | Read floor | Outlet membership basic read access |

**Source badges:**
- Blue `Role: [role_name]` — canonical role grant
- Yellow `Perm: [code]` — direct permission fallback
- Green `Read floor` — outlet membership basic read
- Orange `Legacy: [code] → [canonical]` — legacy mapped role
- Red `Denied` — not granted

**Deny explanations must be actionable** — tell user what to do to grant access.

---

### 3.12 Effective Access — By Outlet

**Goal:** See all users with access at 1 outlet, grouped by capability.

**Layout:** Outlet selector + user access table

| User | Role(s) | Scope Type | Domain Access Summary | Source |
|------|---------|------------|----------------------|--------|
| john@fern | outlet_manager | Outlet | Sales W, Procurement W+A, Inventory W | Canonical |
| jane@fern | procurement | Outlet | Procurement W (no approve) | Canonical |
| bob@fern | staff | Outlet | Sales W, basic reads | Canonical |
| anyone@fern | (no role) | Outlet | Catalog R, Reports R, Inventory R | Read floor |

---

### 3.13 Audit & Reviews

**Goal:** Compliance trail for permission changes and security events.

**Users:** superadmin, admin, region_manager

**Layout:** Tabbed view

**Tab 1: Permission Change Log**

| Timestamp | Actor | Action | Target User | Detail | Scope |
|-----------|-------|--------|-------------|--------|-------|
| 2026-04-15 14:30 | admin@fern | Assigned role | john@fern | outlet_manager @ Saigon Centre | Outlet |
| 2026-04-14 09:00 | super@fern | Revoked role | bob@fern | finance @ HCM Region (5 outlets) | Region |

- Filters: Date range, Actor, Action type, Target user, Role, Scope
- Fan-out actions show outlet count in detail

**Tab 2: Sensitive Access Log**
- Filtered to sensitive permissions only: purchase.approve, auth.user.write, auth.role.write

**Tab 3: Login / MFA Events**
- Login success/failure, MFA enrollment, password reset
- Filters: User, Event type, Date range, Status

---

### 3.14 Security Settings

**Goal:** System-wide security policies.

**Users:** superadmin, admin

**Layout:** Settings form grouped by category

**MFA Configuration:**
- Enforce MFA for roles: multi-select
- MFA methods: TOTP, SMS (toggles)
- Grace period: dropdown

**Session Policies:**
- Session timeout, Max concurrent sessions, Force re-auth for sensitive actions

**PIN / Passcode (POS):**
- PIN length, expiry, allow PIN-only for POS

**Internal Service Accounts:**
- Read-only table of service accounts with last used timestamp and token rotation status
- "This section shows technical service accounts used for internal service-to-service communication."

---

## 4. Text-Based Wireframes

### 4.1 User Directory

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Users > User Directory                              [Invite User] │
├──────────────────────────────────────────────────────────────────────────┤
│ Search name, email, ID...                                               │
│ Role: [All]  Scope: [All]  Region: [All]  Status: [All]                │
│ [ ] Has Legacy Role                                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ ! 2 users have unmapped legacy roles. Review in Legacy Mapping ->       │
├────────┬───────────┬───────────────┬──────────────┬────────┬──────┬─────┤
│ Name   │ Email     │ Primary Role  │ Scope        │ Status │Legacy│ ... │
├────────┼───────────┼───────────────┼──────────────┼────────┼──────┼─────┤
│ John D │ john@fern │ outlet_manager│ * Saigon Ctr │ Active │      │ ... │
│ Jane P │ jane@fern │ finance +1    │ ~ HCM Region │ Active │      │ ... │
│ Bob K  │ bob@fern  │ staff         │ * District 7 │ Active │!cash │ ... │
│ Amy L  │ amy@fern  │ —             │ —            │Invited │      │ ... │
├────────┴───────────┴───────────────┴──────────────┴────────┴──────┴─────┤
│ Showing 1-25 of 142                              [< 1 2 3 4 5 ... >]   │
└──────────────────────────────────────────────────────────────────────────┘
* = Outlet scope   ~ = Region scope   @ = Global scope
```

### 4.2 User Detail

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Users > John Doe                    [Edit Profile] [Lock] [Reset] │
├──────────────────────────────────────────────────────────────────────────┤
│ John Doe          john@fern.io          EMP-0042                        │
│ * Active          Last login: 2 hours ago                               │
├──────────────────────────────────────────────────────────────────────────┤
│ [Role Assignments] [Direct Permissions] [Effective Access] [Activity]   │
├──────────────────────────────────────────────────────────────────────────┤
│                        TAB: Role Assignments                            │
│                                                            [Assign Role]│
│ ┌───────────────────┬──────────┬──────────────┬──────────┬──────┬──────┐│
│ │ Role              │ Scope    │ Target       │ Source   │ Date │ Act. ││
│ ├───────────────────┼──────────┼──────────────┼──────────┼──────┼──────┤│
│ │ outlet_manager    │ *Outlet  │ Saigon Centre│ Canonical│ Mar 1│Revoke││
│ │ finance           │ ~Region  │ HCM Region   │ Canonical│ Feb15│Revoke││
│ │                   │          │ (5 outlets)  │          │      │      ││
│ └───────────────────┴──────────┴──────────────┴──────────┴──────┴──────┘│
│                                                                         │
│ i Region assignments are stored as outlet-level records. "HCM Region"   │
│   represents 5 outlet records collapsed by the policy layer.            │
│   View fan-out detail ->                                                │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Assign by Region

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Assignments > Assign by Region                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step 1: User         [Search user...                   ]               │
│                       Selected: Jane Pham (jane@fern.io)                │
│                                                                         │
│  Step 2: Role         [finance                          ]               │
│                       i Finance: Financial operations, expense          │
│                         management, payroll approval within region.     │
│                                                                         │
│  Step 3: Region       [HCM Region                       ]               │
│                                                                         │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 4: FAN-OUT PREVIEW (mandatory)                                    │
│                                                                         │
│  Assigning finance to jane@fern.io across HCM Region                    │
│  will create 5 outlet-level records:                                    │
│                                                                         │
│  ┌────┬──────────────────┬──────────────┬──────────────────────────────┐│
│  │ #  │ Outlet           │ Status       │ Note                         ││
│  ├────┼──────────────────┼──────────────┼──────────────────────────────┤│
│  │ 1  │ Saigon Centre    │ New          │ Will be created              ││
│  │ 2  │ Thao Dien        │ New          │ Will be created              ││
│  │ 3  │ District 7       │ Exists       │ Already assigned (no change) ││
│  │ 4  │ Phu My Hung      │ New          │ Will be created              ││
│  │ 5  │ Binh Thanh       │ New          │ Will be created              ││
│  └────┴──────────────────┴──────────────┴──────────────────────────────┘│
│                                                                         │
│  Summary: 4 new assignments, 1 existing (no change)                     │
│                                                                         │
│  i FERN stores all assignments at outlet level. The policy layer will   │
│    collapse these into a single region-scoped assignment. New outlets    │
│    added to HCM Region later will NOT auto-inherit this role.           │
│                                                                         │
│                               [Cancel]  [Confirm Assignment (4 new)]    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Fan-out Preview (standalone)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Assignments > Fan-out Preview                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ View the outlet-level breakdown of any region-scoped assignment.        │
│                                                                         │
│ User: [Search...     ]   Role: [All]   Region: [All]                   │
├──────────────────────────────────────────────────────────────────────────┤
│ Jane Pham — finance @ HCM Region                                        │
│ Collapsed from 5 outlet-level records:                                  │
│                                                                         │
│ ┌────┬──────────────────┬────────────────┬──────────────────┐           │
│ │ #  │ Outlet           │ Assigned Date  │ Status           │           │
│ ├────┼──────────────────┼────────────────┼──────────────────┤           │
│ │ 1  │ Saigon Centre    │ 2026-02-15     │ Active           │           │
│ │ 2  │ Thao Dien        │ 2026-02-15     │ Active           │           │
│ │ 3  │ District 7       │ 2026-02-15     │ Active           │           │
│ │ 4  │ Phu My Hung      │ 2026-02-15     │ Active           │           │
│ │ 5  │ Binh Thanh       │ 2026-04-01     │ Active           │           │
│ └────┴──────────────────┴────────────────┴──────────────────┘           │
│                                                                         │
│ ! Binh Thanh was added to HCM Region after initial assignment.          │
│   It was included via a subsequent region re-assignment on 2026-04-01.  │
│                                                                         │
│ i If HCM Region gains new outlets, they will NOT auto-inherit this      │
│   role. Re-run "Assign by Region" to include new outlets.               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Direct Permissions

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Direct Permissions                              [Grant Permission]│
├──────────────────────────────────────────────────────────────────────────┤
│ i Direct permissions are fallback grants for edge cases. In most cases, │
│   assigning the correct canonical role is preferred.                    │
├──────────────────────────────────────────────────────────────────────────┤
│                     PERMISSION CATALOG (reference)                      │
│ ┌─────────────────────┬────────────────────┬────────┬──────────────────┐│
│ │ Permission          │ Business Meaning   │ Scope  │ Sensitive        ││
│ ├─────────────────────┼────────────────────┼────────┼──────────────────┤│
│ │ product.catalog.write│ Catalog mutation   │ Outlet │                  ││
│ │ sales.order.write   │ Sales processing   │ Outlet │                  ││
│ │ purchase.write      │ Procurement create │ Outlet │                  ││
│ │ purchase.approve    │ Procurement approve│ Outlet │ ! Sensitive      ││
│ │ inventory.write     │ Inventory mutation │ Outlet │                  ││
│ │ hr.schedule         │ Shift scheduling   │ Outlet │                  ││
│ │ auth.user.write     │ User management    │ Global │ ! Sensitive      ││
│ │ auth.role.write     │ Role management    │ Global │ ! Sensitive      ││
│ └─────────────────────┴────────────────────┴────────┴──────────────────┘│
├──────────────────────────────────────────────────────────────────────────┤
│                      ACTIVE GRANTS                                      │
│ Search User...   Permission: [All]   Outlet: [All]                     │
│ ┌────────┬───────────────────┬──────────────┬──────────┬───────┬───────┐│
│ │ User   │ Permission        │ Outlet       │ Granted  │ Date  │ Act.  ││
│ ├────────┼───────────────────┼──────────────┼──────────┼───────┼───────┤│
│ │ Jane P │ purchase.approve  │ Saigon Ctr   │ admin@   │ Mar 10│Revoke ││
│ │        │ ! Sensitive       │              │          │       │       ││
│ │ Bob K  │ inventory.write   │ District 7   │ admin@   │ Mar 12│Revoke ││
│ └────────┴───────────────────┴──────────────┴──────────┴───────┴───────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Effective Access

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Effective Access > By User                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ User: [Jane Pham (jane@fern.io)                  ]                      │
│ Domain: [All]  Effect: [All]  Source: [All]  Scope: [All]              │
├──────────────────────────────────────────────────────────────────────────┤
│ > PROCUREMENT                                                           │
│ ┌──────────────────┬────────┬───────────────┬────────────┬─────────────┐│
│ │ Capability       │ Effect │ Scope         │ Source     │ Explanation ││
│ ├──────────────────┼────────┼───────────────┼────────────┼─────────────┤│
│ │ Procurement write│ Allow  │ *Saigon Ctr   │ Role:      │ procurement ││
│ │                  │        │               │ procurement│ role grants ││
│ │                  │        │               │            │ PO creation ││
│ ├──────────────────┼────────┼───────────────┼────────────┼─────────────┤│
│ │ Procurement      │ Allow  │ *Saigon Ctr   │ Perm:      │ Direct      ││
│ │ approve          │        │               │ purchase.  │ permission  ││
│ │                  │        │               │ approve    │ fallback    ││
│ │                  │        │               │ !Sensitive │             ││
│ ├──────────────────┼────────┼───────────────┼────────────┼─────────────┤│
│ │ Procurement read │ Allow  │ *Saigon Ctr   │ Read floor │ Outlet      ││
│ │                  │        │               │            │ membership  ││
│ │                  │        │               │            │ basic read  ││
│ ├──────────────────┼────────┼───────────────┼────────────┼─────────────┤│
│ │ Procurement write│ Deny   │ *District 7   │ —          │ No role or  ││
│ │                  │        │               │            │ permission  ││
│ │                  │        │               │            │ -> Assign   ││
│ │                  │        │               │            │ role or     ││
│ │                  │        │               │            │ grant perm  ││
│ └──────────────────┴────────┴───────────────┴────────────┴─────────────┘│
│                                                                         │
│ > PAYROLL                                                               │
│ ┌──────────────────┬────────┬───────────────┬────────────┬─────────────┐│
│ │ Payroll prepare  │ Deny   │ —             │ —          │ Only hr     ││
│ │                  │        │               │            │ role can    ││
│ │                  │        │               │            │ prepare     ││
│ ├──────────────────┼────────┼───────────────┼────────────┼─────────────┤│
│ │ Payroll approve  │ Allow  │ ~HCM Region   │ Role:      │ finance     ││
│ │                  │        │               │ finance    │ role grants ││
│ │                  │        │               │            │ approval.   ││
│ │                  │        │               │            │ HR prepares,││
│ │                  │        │               │            │ Finance     ││
│ │                  │        │               │            │ approves.   ││
│ └──────────────────┴────────┴───────────────┴────────────┴─────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.7 Role Compare

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Roles > Compare Roles                                             │
├──────────────────────────────────────────────────────────────────────────┤
│ Compare: [outlet_manager]  vs  [procurement]  vs  [+ Add role]         │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┬───────────────────┬──────────────────┐         │
│ │                      │ outlet_manager    │ procurement      │         │
│ │                      │ *Outlet           │ *Outlet          │         │
│ ├──────────────────────┼───────────────────┼──────────────────┤         │
│ │ Org read             │ R (outlet)        │ R (outlet)       │         │
│ │ Org mutate           │ -                 │ -                │         │
│ │ Catalog read         │ R (outlet)        │ R (outlet)       │         │
│ │ Catalog mutate       │ -                 │ -                │         │
│ │ Sales write          │ W (outlet)    <<  │ -                │  diff   │
│ │ Sales read           │ R (outlet)        │ R (outlet)       │         │
│ │ Procurement write    │ W (outlet)        │ W (outlet)       │         │
│ │ Procurement approve  │ A (outlet)    <<  │ -                │  diff   │
│ │ Procurement read     │ R (outlet)        │ R (outlet)       │         │
│ │ Inventory write      │ W (outlet)    <<  │ -                │  diff   │
│ │ Inventory read       │ R (outlet)        │ R (outlet)       │         │
│ │ Finance write        │ W             <<  │ -                │  diff   │
│ │ Finance read         │ R             <<  │ -                │  diff   │
│ │ HR schedule          │ W (outlet)    <<  │ -                │  diff   │
│ │ HR contracts         │ W (limited)   <<  │ -                │  diff   │
│ │ Audit read           │ -                 │ -                │         │
│ │ Report read          │ R (outlet)        │ R (outlet)       │         │
│ ├──────────────────────┴───────────────────┴──────────────────┤         │
│ │ KEY DIFFERENCES:                                            │         │
│ │ * outlet_manager can approve procurement; procurement cannot│         │
│ │ * outlet_manager has sales, inventory, finance, HR access   │         │
│ │ * procurement is limited to procurement write only          │         │
│ │ * Neither role has audit read or catalog mutate             │         │
│ └─────────────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.8 Audit Log

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IAM > Audit & Reviews > Permission Change Log                           │
├──────────────────────────────────────────────────────────────────────────┤
│ Date: [2026-04-01] to [2026-04-16]                                     │
│ Actor: [All]  Action: [All]  Target: [All]  Role: [All]                │
│ [ ] Sensitive only                                                      │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────┬──────────┬────────────┬──────────┬──────────────────┐│
│ │ Timestamp      │ Actor    │ Action     │ Target   │ Detail           ││
│ ├────────────────┼──────────┼────────────┼──────────┼──────────────────┤│
│ │ Apr 15, 14:30  │ admin@   │ Assign role│ john@    │ outlet_manager   ││
│ │                │          │            │          │ @ Saigon Centre  ││
│ ├────────────────┼──────────┼────────────┼──────────┼──────────────────┤│
│ │ Apr 15, 14:28  │ admin@   │ Grant perm │ jane@    │ purchase.approve ││
│ │                │          │ !Sensitive │          │ @ District 7     ││
│ ├────────────────┼──────────┼────────────┼──────────┼──────────────────┤│
│ │ Apr 14, 09:00  │ super@   │ Revoke role│ bob@     │ finance          ││
│ │                │          │ (region)   │          │ @ HCM Region     ││
│ │                │          │            │          │ (5 outlets)      ││
│ ├────────────────┼──────────┼────────────┼──────────┼──────────────────┤│
│ │ Apr 13, 11:00  │ admin@   │ Assign role│ amy@     │ hr @ HCM Region  ││
│ │                │          │ (region)   │          │ (5 outlets)      ││
│ │                │          │            │          │ Fan-out: 5 new   ││
│ └────────────────┴──────────┴────────────┴──────────┴──────────────────┘│
│ Showing 1-25 of 89                                [< 1 2 3 4 >]        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Scope Matrix

| Scope Type | Active | Backend Implementation | UI Display | UX Risk |
|-----------|--------|----------------------|-----------|---------|
| **Global** | Yes | superadmin assigned to all active outlets | Pill: "@ Global" | User may not realize this means ALL outlets. Show outlet count. |
| **Region** | Yes | Fan-out: 1 user_role row per outlet in region. Collapsed at read time. | Pill: "~ Region Name (N outlets)" | User may think 1 DB row = 1 region. Must show fan-out preview. Must warn new outlets don't auto-inherit. |
| **Outlet** | Yes | 1 user_role row with outlet_id | Pill: "* Outlet Name" | Simplest case. No confusion expected. |
| Subregion | **No** | Not supported | Do not show | Do not create UI for subregion scope. |
| Custom group | **No** | Not supported | Do not show | Do not create UI for custom outlet groups. |

---

## 6. Role Cards

### Superadmin
- **Code:** `superadmin`
- **Default scope:** Global
- **Purpose:** Full system access. Emergency override.
- **Key capabilities:** All domains — read, write, approve. No restrictions.
- **Hard limits:** None (unrestricted)
- **Badge:** FULL ACCESS — "Grants unrestricted access to all domains across all outlets."

### Admin
- **Code:** `admin`
- **Default scope:** Outlet / Region
- **Purpose:** IAM governance within scope. No business operations.
- **Key capabilities:** Org read/mutate, IAM user/role management, Audit read
- **Hard limits:** No sales, no procurement, no inventory, no finance operations, no HR operations, no catalog mutation
- **Badge:** GOVERNANCE ONLY — "This role manages users and organization structure. It cannot perform business operations."

### Region Manager
- **Code:** `region_manager`
- **Default scope:** Region
- **Purpose:** Operational oversight and read access across a region.
- **Key capabilities:** Region-scoped read for org, sales, reports, audit. No write access to business domains.
- **Hard limits:** No write/approve in any business domain
- **Badge:** READ OVERSIGHT — "Read-only operational visibility across the region."

### Outlet Manager
- **Code:** `outlet_manager`
- **Default scope:** Outlet
- **Purpose:** Store-level business owner. Final approver.
- **Key capabilities:** Sales write, Procurement write + approve, Inventory write, Finance write, HR schedule, HR contracts (limited roles: staff, procurement, kitchen_staff, outlet_manager)
- **Hard limits:** Cannot create contracts for hr, finance, region_manager, product_manager. No catalog mutation. No audit read. No payroll prepare/approve.
- **Badge:** None (standard business role)

### Staff
- **Code:** `staff`
- **Default scope:** Outlet
- **Purpose:** POS/cashier operator. Sales order flow only.
- **Key capabilities:** Sales write at outlet
- **Hard limits:** No procurement, no inventory, no finance, no HR, no catalog, no audit
- **Badge:** POS ONLY — "Limited to sales/POS operations at assigned outlet."

### Product Manager
- **Code:** `product_manager`
- **Default scope:** Region
- **Purpose:** Catalog/menu/pricing management within a region.
- **Key capabilities:** Catalog read + mutate within region
- **Hard limits:** No sales, no procurement, no inventory, no finance, no HR, no audit
- **Badge:** CATALOG ONLY

### Procurement
- **Code:** `procurement`
- **Default scope:** Outlet
- **Purpose:** Purchase order creation and processing. No final approval.
- **Key capabilities:** Procurement write at outlet, Procurement read
- **Hard limits:** Cannot approve POs or goods receipts. No sales, no inventory write, no finance, no HR, no audit.
- **Badge:** REQUESTER ONLY — NO APPROVAL — "Can create purchase orders but cannot approve them. Approval requires outlet_manager or purchase.approve permission."

### Finance
- **Code:** `finance`
- **Default scope:** Region
- **Purpose:** Financial operations, expense management, payroll approval within a region.
- **Key capabilities:** Finance read/write, Payroll approve (region), Report read
- **Hard limits:** Cannot prepare payroll (HR prepares). No sales, no procurement, no inventory, no catalog, no audit.
- **Badge:** PAYROLL APPROVER — "Separation of duties: HR prepares payroll, Finance approves."

### HR
- **Code:** `hr`
- **Default scope:** Region
- **Purpose:** Employee contracts, scheduling, payroll preparation within a region.
- **Key capabilities:** Payroll prepare (region), HR schedule (region), HR contracts (all roles, region)
- **Hard limits:** Cannot approve payroll (Finance approves). No sales, no procurement, no inventory, no finance write, no audit.
- **Badge:** PAYROLL PREPARER — "Separation of duties: HR prepares payroll, Finance approves."

### Kitchen Staff
- **Code:** `kitchen_staff`
- **Default scope:** Outlet
- **Purpose:** Kitchen fulfillment. No business operations beyond outlet membership.
- **Key capabilities:** Outlet membership read (catalog prices, reports, inventory balances at assigned outlet)
- **Hard limits:** No write access in any domain. No business operations.
- **Badge:** MINIMAL ACCESS — "Read-only outlet membership. No business operations."

---

## 7. Permission Labels

| Permission Code | Short Label | Long Label | Business Meaning | Scope | Sensitive | UI Display |
|----------------|------------|-----------|-----------------|-------|-----------|-----------|
| `product.catalog.write` | Catalog Write | Product Catalog Mutation | Create/edit products, items, prices, recipes at outlet | Outlet | No | Standard badge |
| `sales.order.write` | Sales Write | Sales Order Processing | Submit, process, cancel sales orders at outlet | Outlet | No | Standard badge |
| `purchase.write` | Procurement Write | Purchase Order Creation | Create POs, goods receipts, invoices at outlet | Outlet | No | Standard badge |
| `purchase.approve` | Procurement Approve | Purchase Order Approval | Approve POs and goods receipts at outlet | Outlet | **Yes** | Amber badge + confirm dialog |
| `inventory.write` | Inventory Write | Inventory Mutation | Stock counts, waste records, adjustments at outlet | Outlet | No | Standard badge |
| `hr.schedule` | HR Schedule | Shift Schedule Management | Create/edit shift schedules at outlet | Outlet | No | Standard badge |
| `auth.user.write` | User Mgmt | IAM User Management | Create/modify/deactivate user accounts | Global | **Yes** | Amber badge + confirm dialog |
| `auth.role.write` | Role Mgmt | IAM Role Management | Assign/revoke roles and permissions | Global | **Yes** | Amber badge + confirm dialog |

---

## 8. Effective Access Model

### Source Types

| Source Type | Badge Color | Badge Text | Meaning |
|------------|------------|-----------|---------|
| Canonical Role | Blue | `Role: [role_name]` | Access from one of the 10 canonical roles |
| Direct Permission | Yellow | `Perm: [code]` | Fallback permission grant |
| Read Floor | Green | `Read floor` | Outlet membership basic read |
| Legacy Mapping | Orange | `Legacy: [old] -> [new]` | Access via legacy role mapped to canonical |
| Denied | Red | `Denied` | No grant from any source |

### Table Columns

| Column | Description |
|--------|------------|
| Capability | Domain action (e.g., "Procurement write") |
| Effect | Allow / Deny |
| Scope | Scope pill (Global/Region/Outlet with name) |
| Source | Badge per source type above |
| Explanation | Full sentence: why allowed/denied + actionable next step for deny |

### Filters
- Domain (multi-select)
- Effect (Allow / Deny / All)
- Source (Role / Permission / Read Floor / Legacy / All)
- Scope (Global / Region / Outlet / specific name)

### Explanation Copy Patterns

**Allow from role:**
> "[role] role at [scope] grants [capability]. This is the standard access path for this role."

**Allow from direct permission:**
> "Direct permission [code] granted at [outlet] provides [capability]. This is a fallback grant, not from role assignment."

**Allow from read floor:**
> "User has [outlet] in scope via outlet membership. Basic read access is granted as a read floor. This does not include write or approve capabilities."

**Allow from legacy mapping:**
> "User has legacy role [old_code] which is mapped to canonical role [new_role]. Access is equivalent to [new_role] at [scope]."

**Deny — no grant:**
> "No role or permission grants [capability] at [scope]. To enable: assign [suggested_role] at [scope], or grant [suggested_permission] permission."

**Deny — role limitation:**
> "[role] role does not include [capability]. [Specific reason, e.g., 'procurement role cannot approve. Requires outlet_manager or purchase.approve permission.']"

---

## 9. UX Rules for Frontend

### CTA Visibility
| Rule | Condition | Action |
|------|-----------|--------|
| Hide "Assign Role" button | Current user is not superadmin/admin | Hide button entirely |
| Hide "Grant Permission" button | Current user is not superadmin/admin | Hide button entirely |
| Hide "Revoke" action | Current user doesn't have auth.role.write at target scope | Hide action in row |
| Show read-only state | region_manager viewing users in their region | Show all data, hide all mutation CTAs, show banner "Read-only" |

### Warning Banners
| Trigger | Banner |
|---------|--------|
| Assigning superadmin | Red: "Superadmin grants unrestricted access to all domains across all outlets." |
| Assigning admin | Amber: "Admin is governance-only. This role does not grant business operations access." |
| User has no roles | Red: "This user has no role assignments. Access is limited to outlet membership read floor." |
| User has legacy role | Info: "This user has legacy role [code] mapped to [canonical]. Legacy roles cannot be newly assigned." |
| Superadmin count > 3 | Amber on Overview: "There are N superadmin users. Consider reducing to minimize security risk." |
| Granting sensitive permission | Amber: "This is a sensitive permission. Ensure this grant is intentional and reviewed." |

### Mandatory Fan-out Preview
- **Always show** when assigning by region (Step 4 in flow)
- **Always show** outlet count in region-scoped assignment displays
- **Always show** "new outlets won't auto-inherit" note

### Confirmation Dialogs Required
| Action | Dialog? | Reason |
|--------|---------|--------|
| Assign superadmin | Yes, red | Highest privilege |
| Grant sensitive permission | Yes, amber | purchase.approve, auth.user.write, auth.role.write |
| Revoke role (any) | Yes, standard | Destructive |
| Revoke region assignment | Yes, with fan-out count | "This will remove [role] from N outlets in [region]." |
| Lock/suspend user | Yes, amber | Account access removal |

### Source Badge Display
- **Always show** source badge in Effective Access views
- **Always show** source badge in User Detail > Role Assignments tab (Canonical vs Legacy Mapped)
- **Always show** scope pill next to every assignment and access entry
- **Never show** source badge in User Directory list (too noisy)

---

## 10. Component Inventory

| Component | Purpose | Used In |
|-----------|---------|---------|
| `DataGrid` | Paginated, sortable, filterable table | User Directory, Audit Log, Permission Grants, Effective Access |
| `AssignmentDrawer` | Right-slide drawer for role/permission assignment | Assign by Outlet, Grant Permission |
| `AssignmentPage` | Full-page flow with steps | Assign by Region |
| `TabBar` | Horizontal tabs | User Detail, Audit & Reviews |
| `RoleBadge` | Colored pill with role name | Everywhere roles are displayed |
| `ScopePill` | * Outlet / ~ Region / @ Global with name | All assignment and access views |
| `SourceBadge` | Colored badge: Role (blue), Perm (yellow), Read floor (green), Legacy (orange), Denied (red) | Effective Access, User Detail |
| `SensitiveBadge` | Amber badge | Permission Catalog, Permission Grants, Effective Access |
| `FanOutPreview` | Table showing outlet-level breakdown of region assignment | Assign by Region, Fan-out Preview standalone |
| `RoleCard` | Card with role definition, capabilities, limits, badges | Canonical Roles |
| `CompareTable` | Side-by-side domain access matrix with diff highlighting | Compare Roles |
| `WarningBanner` | Top-of-section contextual warning (red/amber/info) | Multiple screens |
| `ConfirmDialog` | Modal confirmation with severity level (standard/amber/red) | All destructive/sensitive actions |
| `ExplanationCell` | Expandable cell with full-sentence explanation | Effective Access |
| `MetricCard` | Number + label + trend + click target | Overview |
| `AlertList` | Stacked alert cards | Overview attention section |
| `AuditTimeline` | Chronological event list with actor/action/detail | User Detail Activity tab, Audit log |
| `EmptyState` | Illustration + message + CTA | All screens when no data |
| `FilterBar` | Horizontal filter strip with dropdowns/search | All list views |
| `PermissionSummaryBar` | Compact bar showing permission counts by type | User Detail header or Overview |
| `DiffMarker` | Indicator for changed cells | Compare Roles |
| `StatusBadge` | Active (green), Invited (blue), Locked (red), Suspended (gray) | User Directory, User Detail |
| `LegacyBadge` | Amber badge "Legacy: [old] -> [new]" | User Directory, User Detail, Legacy Mapping |

---

## 11. Final Handoff Summary

### MVP (Phase 1) — Must ship

| Screen | Reason |
|--------|--------|
| User Directory | Core navigation |
| User Detail (all 4 tabs) | Central management point |
| Assign by Outlet | Basic assignment flow |
| Assign by Region + Fan-out Preview | Region assignment without fan-out preview = confusion |
| Canonical Roles | Reference for admins |
| Effective Access by User | Troubleshooting is day-1 need |
| Direct Permissions (Catalog + Grants) | Fallback grants needed for edge cases |
| Permission Change Log (Audit) | Compliance requirement |

### Phase 2

| Screen | Reason |
|--------|--------|
| Overview dashboard | Nice-to-have health view |
| Legacy Mapping | Migration support, not daily operation |
| Compare Roles | Decision support, not blocking |
| Effective Access by Outlet | Useful but by-user covers most cases |
| Locked/Suspended management | Low frequency |
| Sensitive Access Log | Subset of Change Log |
| Login/MFA Events | Security audit, not daily operation |
| Security Settings | Configuration, set once |

### Non-Negotiable Implementation Rules

1. **Fan-out preview MUST be mandatory** in region assignment flow.
2. **Effective Access MUST show source badges** (Role / Permission / Read Floor / Legacy).
3. **Admin role MUST show governance-only badge** everywhere.
4. **Procurement MUST show "no approve" badge**.
5. **Payroll MUST show prepare vs approve separation** with role labels.
6. **Deny explanations MUST be actionable**.
7. **Legacy roles MUST NOT be assignable** in new UI.
8. **Sensitive permissions MUST require confirmation dialog**.
9. **Region assignments MUST show outlet count**.
10. **Read floor MUST be visually distinct** from role grants.

---

## Appendix A: Frontend-Ready Notes

### User Directory
- **Data:** `GET /api/iam/users` — paginated, server-side filter/sort
- **Query params:** `search`, `role`, `scopeType`, `regionId`, `outletId`, `status`, `hasLegacyRole`, `page`, `pageSize`
- **Mutations:** None (read-only list)
- **Loading:** Skeleton rows (10 rows), filter bar active
- **Pagination:** Server-side cursor or offset, 25/50/100 options

### User Detail
- **Data:** `GET /api/iam/users/:id` (profile + assignments + permissions)
- **Effective Access:** `GET /api/iam/users/:id/effective-access` — computed endpoint, may be slow
- **Activity:** `GET /api/audit/events?userId=:id` — paginated
- **Mutations:**
  - `POST /api/iam/users/:id/roles` — assign role
  - `DELETE /api/iam/users/:id/roles/:assignmentId` — revoke role
  - `POST /api/iam/users/:id/permissions` — grant permission
  - `DELETE /api/iam/users/:id/permissions/:grantId` — revoke permission
  - `PATCH /api/iam/users/:id` — edit profile
  - `POST /api/iam/users/:id/lock` / `unlock`
- **Loading:** Header loads first, tabs lazy-load. Effective Access tab shows spinner.

### Assign by Region
- **Data:** `GET /api/org/regions`, `GET /api/org/regions/:id/outlets`
- **Fan-out preview:** `POST /api/iam/assignments/preview` — body: `{userId, roleCode, regionId}`
- **Mutation:** `POST /api/iam/assignments/region` — body: `{userId, roleCode, regionId}`
- **Loading:** Step-by-step. Outlet list loads on region select.

### Effective Access
- **Data:** `GET /api/iam/users/:id/effective-access?domain=&effect=&source=`
- **Response:** `{ domains: [{ name, capabilities: [{ capability, effect, scope, source, explanation }] }] }`
- **Loading:** Full spinner on initial load. Filter changes trigger re-fetch.

### Audit Log
- **Data:** `GET /api/audit/iam-events` — paginated, server-filtered
- **Query params:** `dateFrom`, `dateTo`, `actorId`, `action`, `targetId`, `roleCode`, `sensitiveOnly`, `page`, `pageSize`
- **Loading:** Skeleton rows. Default last 7 days.

### Canonical Roles
- **Data:** `GET /api/iam/roles/canonical` — cacheable, static
- **Mutations:** None

### Compare Roles
- **Data:** `GET /api/iam/roles/compare?roles=role1,role2,role3`
- **Loading:** Table skeleton. Re-fetches on role selector change.

### Direct Permissions
- **Data:** `GET /api/iam/permissions/catalog` (reference), `GET /api/iam/permissions/grants` (filterable)
- **Mutations:** `POST /api/iam/permissions/grants`, `DELETE /api/iam/permissions/grants/:id`

---

## Appendix B: UI Copy

### Warning Banners

| Context | Copy |
|---------|------|
| Assigning superadmin | "Superadmin grants unrestricted access to all domains across all outlets. This should be limited to emergency use." |
| Assigning admin | "Admin is a governance-only role. It manages users and organization structure but cannot perform business operations like sales, procurement, or inventory." |
| No role assigned | "This user has no role assignments. Their access is limited to basic read data at outlets where they have membership." |
| Legacy role detected | "This user has legacy role `[code]` which is automatically mapped to `[canonical]`. Legacy roles cannot be newly assigned in this interface." |
| Excessive superadmins | "There are [N] superadmin users. Consider reducing to minimize security exposure." |
| Sensitive permission | "You are about to grant a sensitive permission. Ensure this has been reviewed and approved." |

### Confirmation Dialogs

| Action | Title | Body | Confirm Button |
|--------|-------|------|---------------|
| Assign superadmin | Grant Superadmin Access | "[User] will have unrestricted access to all domains and outlets." | "Yes, Grant Superadmin" |
| Grant purchase.approve | Grant Procurement Approval | "[User] will be able to approve purchase orders at [outlet]. This is sensitive." | "Grant Approval Permission" |
| Grant auth.user.write | Grant User Management | "[User] will be able to create and modify user accounts. This is sensitive." | "Grant User Management" |
| Revoke role | Revoke Role Assignment | "Remove [role] from [user] at [scope]? Takes effect immediately." | "Revoke Role" |
| Revoke region role | Revoke Region Assignment | "Remove [role] from [user] across [region]? Deletes [N] outlet-level records." | "Revoke from [N] Outlets" |
| Lock user | Lock User Account | "[User] will be unable to log in. Active sessions terminated." | "Lock Account" |

### Read-Only Explanations
- "You have read-only access to IAM. Contact a superadmin or admin to make changes."
- "Canonical roles are system-defined and cannot be modified."
- "Legacy role mappings are automatic and cannot be changed from this interface."

### Fan-out Preview
- "FERN stores all role assignments at the outlet level. Assigning by region creates one record per outlet."
- "The policy layer will collapse these outlet records into a single region-scoped view."
- "New outlets added to [region] after this assignment will not automatically inherit this role."

---

## Appendix C: Business Rule to UI Mapping

| Business Rule | UI Manifestation | Screen | Component | Risk if Omitted |
|--------------|-----------------|--------|-----------|----------------|
| Admin is governance-only | "GOVERNANCE ONLY" badge | Role Cards, User Detail, Assignment | `RoleBadge` | Admins assigned expecting business access |
| Procurement cannot approve | "REQUESTER ONLY — NO APPROVAL" badge | Role Cards, User Detail, Effective Access | `RoleBadge`, `ExplanationCell` | Users expect procurement to approve POs |
| HR prepares / Finance approves payroll | Separation callout | Role Cards, Effective Access | `RoleBadge`, `ExplanationCell` | Users assign HR expecting approval power |
| Region assignment = fan-out | Mandatory fan-out preview | Assign by Region, Fan-out Preview, User Detail | `FanOutPreview`, `ScopePill` | Users think 1 DB record |
| New outlets don't auto-inherit | Warning note | Assign by Region, Fan-out Preview | `WarningBanner` | New outlet staff have no manager |
| Legacy roles not assignable | Legacy badge + info banner | User Detail, Legacy Mapping, Assignment drawers | `LegacyBadge`, `WarningBanner` | Legacy roles assigned; inconsistent state |
| Outlet membership read floor | "Read floor" badge | Effective Access | `SourceBadge` | Users think no access = blocked |
| Audit read limited to 3 roles | Deny explanation | Effective Access | `ExplanationCell` | Users request audit access unnecessarily |
| Sensitive permissions (3 codes) | Amber badge + confirmation | Permission Catalog, Grants, Assignment | `SensitiveBadge`, `ConfirmDialog` | Sensitive permissions granted carelessly |
| Superadmin = all access | "FULL ACCESS" badge + confirmation | Role Cards, Assignment, User Detail | `RoleBadge`, `ConfirmDialog` | Superadmin proliferation |

---

## Appendix D: Color/Badge Semantics

| Semantic | Color | Badge Style | Hex | Usage |
|----------|-------|-------------|-----|-------|
| Role Grant | Blue | Solid pill | `#2563EB` | Source badge in Effective Access |
| Direct Permission | Yellow/Amber | Solid pill | `#D97706` | Source badge in Effective Access |
| Read Floor | Green | Outlined pill | `#059669` | Source badge in Effective Access |
| Denied | Red | Solid pill | `#DC2626` | Effect badge in Effective Access |
| Legacy Mapping | Orange | Outlined pill | `#EA580C` | Source badge, User Directory |
| Sensitive | Amber | Outlined + icon | `#D97706` | Permission Catalog, Grants |
| Allow | Green | Inline icon | `#059669` | Effect column |
| Scope: Global | Purple | Solid pill | `#7C3AED` | Scope pills |
| Scope: Region | Indigo | Solid pill | `#4F46E5` | Scope pills |
| Scope: Outlet | Slate | Solid pill | `#475569` | Scope pills |
| Status: Active | Green | Dot + text | `#059669` | User Directory |
| Status: Invited | Blue | Dot + text | `#2563EB` | User Directory |
| Status: Locked | Red | Dot + text | `#DC2626` | User Directory |
| Status: Suspended | Gray | Dot + text | `#6B7280` | User Directory |
| Governance Only | Yellow | Outlined badge | `#D97706` | Role cards, assignments |
| No Approval | Yellow | Outlined badge | `#D97706` | Role cards, assignments |
| Minimal Access | Blue | Outlined badge | `#2563EB` | Role cards |
| Full Access | Red | Solid badge | `#DC2626` | Role cards |

---

## Appendix E: QA Checklist

### Permission Visibility
- [ ] All 10 canonical roles visible in Canonical Roles screen
- [ ] All 8 direct permissions visible in Permission Catalog
- [ ] Sensitive permissions (purchase.approve, auth.user.write, auth.role.write) show warning badge
- [ ] Legacy roles show mapping badge, not raw code
- [ ] No permission codes beyond the 8 defined appear in UI

### Scope Correctness
- [ ] Global scope shows @ pill with "all outlets" indication
- [ ] Region scope shows ~ pill with region name + outlet count
- [ ] Outlet scope shows * pill with outlet name
- [ ] No "subregion" or "custom group" scope appears anywhere
- [ ] Region assignment always shows fan-out preview before confirmation
- [ ] Fan-out preview shows correct outlet count

### Effective Access Explanation
- [ ] Every Allow row has a source badge (Role/Permission/Read Floor/Legacy)
- [ ] Every Deny row has an actionable explanation
- [ ] Read floor entries are visually distinct from role grants
- [ ] Legacy mapping shows both old and new role codes
- [ ] All filters work correctly (domain, source, effect)

### Region Fan-out Preview
- [ ] Fan-out preview is mandatory (cannot skip)
- [ ] Preview shows each outlet with New/Existing status
- [ ] Preview shows correct count: "N new, M existing"
- [ ] Warning about new outlets not auto-inheriting is displayed
- [ ] Confirm button shows count of new records

### Role Badge Correctness
- [ ] Admin always shows "GOVERNANCE ONLY"
- [ ] Procurement always shows "REQUESTER ONLY — NO APPROVAL"
- [ ] Finance shows "PAYROLL APPROVER"
- [ ] HR shows "PAYROLL PREPARER"
- [ ] Kitchen Staff shows "MINIMAL ACCESS"
- [ ] Superadmin shows "FULL ACCESS"
- [ ] Staff shows "POS ONLY"
- [ ] Product Manager shows "CATALOG ONLY"

### Sensitive Permission Warnings
- [ ] Granting purchase.approve triggers confirmation dialog
- [ ] Granting auth.user.write triggers confirmation dialog
- [ ] Granting auth.role.write triggers confirmation dialog
- [ ] Assigning superadmin triggers red confirmation dialog
- [ ] Revoking any role triggers standard confirmation dialog

### Separation of Duties
- [ ] Payroll section shows prepare vs approve distinction
- [ ] Finance role card mentions "cannot prepare payroll"
- [ ] HR role card mentions "cannot approve payroll"
- [ ] Procurement role card mentions "cannot approve"
- [ ] Admin Effective Access shows deny for all business operations

### Edge Cases
- [ ] User with no roles shows red warning banner + read floor only
- [ ] User with only legacy role shows legacy badge + mapping explanation
- [ ] Region with 0 outlets shows error in Assign by Region
- [ ] Assigning role user already has shows error
- [ ] Read-only view for region_manager shows all data but no mutation CTAs
