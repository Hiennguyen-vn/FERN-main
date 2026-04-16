# IAM Module — Manual Test Scenarios

> Login as `test.superadmin` / `Workflow#2026!` (has full access)

---

## 1. Assign Role to Existing User

**Steps:**
1. Go to IAM > Users
2. Click on "HQ Product Manager" (or any user with "No roles")
3. User Detail drawer opens → Roles tab shows "No roles"
4. Click **"Assign Role"** button (top right of Roles tab)
5. Assign Role sheet opens on the right
6. Select Role: **Outlet Manager**
7. Select Outlet: **Outlet VN-HCM-1** (or any outlet)
8. Confirm preview text shows correct info
9. Click **"Assign Role"**

**Expected:**
- Toast: "Role outlet_manager assigned successfully"
- Drawer refreshes → Roles tab now shows the assignment
- User list Role column updates

**If error:**
- Check browser console for network error
- Check backend logs for `enforceRoleMutation` errors
- Verify the outlet exists and the role code is valid

---

## 2. Grant Permission to Existing User

**Steps:**
1. Go to IAM > Users
2. Click on "HCM2 Cashier" (or any user)
3. Click **Permissions** tab
4. Click **"Grant Permission"** button
5. Grant Permission sheet opens
6. Select Permission: **purchase.approve — Procurement Approve (sensitive)**
7. Select Outlet: **Outlet VN-HCM-2**
8. Confirm sensitive warning appears
9. Click **"Grant Permission"**

**Expected:**
- Toast: "Permission purchase.approve granted successfully"
- Drawer refreshes → Permissions tab shows the new grant with "!" sensitive badge
- Effective Access tab recalculates to include this permission

---

## 3. Revoke Role

**Steps:**
1. Find a user with existing roles (e.g., "HCM Manager" or test.admin)
2. Open User Detail → Roles tab
3. Click **"Revoke"** button on an outlet-level assignment

**Expected:**
- Toast: "Role revoked"
- The role disappears from the list
- User's effective access updates accordingly

---

## 4. Revoke Permission

**Steps:**
1. Find a user with direct permissions (or grant one first per scenario 2)
2. Open User Detail → Permissions tab
3. Click **"Revoke"** next to a permission

**Expected:**
- Toast: "Permission revoked"
- The permission disappears from the list

---

## 5. Lock / Unlock User

**Steps:**
1. Go to IAM > Users
2. Click the **⋯** menu on any user row
3. Click **"Lock"**

**Expected:**
- Toast: "User locked"
- Status column changes to "locked" (red dot)

4. Click **⋯** menu again → now shows **"Unlock"**
5. Click "Unlock"

**Expected:**
- Status returns to "active" (green dot)

---

## 6. Assign Role from Assignments View

**Steps:**
1. Go to IAM > Assignments (left sidebar)
2. In the left panel "Assign to Existing User" section:
   - Select User from dropdown
   - Select Role
   - Select Outlet
3. Click **"Assign Role"**

**Expected:**
- Toast: "Role assigned"
- Current Assignments table on the right refreshes with new entry

---

## 7. Create New User with Role

**Steps:**
1. Click **"Invite User"** button (top right)
2. Fill in: Username, Password, Full Name, Email
3. Select scope mode: **Outlet** or **Region**
4. Select Role and Outlet/Region
5. If Region: verify fan-out preview shows outlets
6. Click **"Create User"**

**Expected:**
- Toast: "User created"
- User appears in Users list
- Opening the user shows their role assignment

---

## 8. Filter Users by Region

**Steps:**
1. Go to IAM > Users
2. Select a specific region from the "All regions" dropdown

**Expected:**
- Only users with assignments in that region's outlets are shown
- Count updates (e.g., "5 of 847")

---

## 9. Filter Users by Role

**Steps:**
1. Select "Finance" from the "All roles" dropdown

**Expected:**
- Only users with primary role "Finance" shown
- "Loading roles..." spinner appears briefly while scope data loads

---

## 10. Roles View — No Duplicates

**Steps:**
1. Go to IAM > Roles > Canonical Roles tab

**Expected:**
- Exactly 10 role cards: Superadmin, Admin, Region Manager, Outlet Manager, Staff, Product Manager, Procurement, Finance, HR, Kitchen Staff
- No legacy codes like `cashier`, `procurement_officer`, `finance_approver` etc.
- Each card shows proper badge, capabilities, and limits

---

## 11. Effective Access

**Steps:**
1. Go to IAM > Effective Access > By User tab
2. Select a user with roles (e.g., test.finance)
3. Check domain-grouped table

**Expected:**
- Rows grouped by domain (Finance, Procurement, etc.)
- Each row shows Allow/Deny badge, scope pill, source badge, explanation
- Deny rows have actionable explanation (what to do to grant access)

---

## 12. Audit Log

**Steps:**
1. Go to IAM > Audit Log
2. Check Change Log tab for recent entries
3. After performing actions (assign role, grant permission), refresh

**Expected:**
- New entries appear for each mutation
- Entries show timestamp, actor, action, target, detail

---

## Troubleshooting

If "Resource not found" appears:
1. **Backend not restarted** — rebuild and restart auth-service after code changes
2. **Missing DB seed** — run seed 011 to ensure roles and permissions exist in DB
3. **Missing permission** — check `core.permission` table has all 8 IAM codes
4. **Missing role** — check `core.role` table has all 10 canonical stored codes

Run seed:
```bash
psql -U fern -d fern_db -f db/seeds/011_role_test_accounts_seed.sql
```

Check roles exist:
```sql
SELECT code, name FROM core.role ORDER BY code;
-- Should include: admin, cashier, finance, hr, kitchen_staff,
-- outlet_manager, procurement_officer, product_manager,
-- region_manager, superadmin
```

Check permissions exist:
```sql
SELECT code, name FROM core.permission WHERE code IN (
  'product.catalog.write', 'sales.order.write', 'purchase.write',
  'purchase.approve', 'inventory.write', 'hr.schedule',
  'auth.user.write', 'auth.role.write'
);
-- Should return 8 rows
```
