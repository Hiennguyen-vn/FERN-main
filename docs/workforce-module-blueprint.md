# Workforce Module — Implementation Blueprint

> Aligned with current FERN codebase. Minimize DB changes — maximize frontend logic.

---

## 1. Current State — What We Already Have

### DB tables (V1__core_schema.sql)

**`core.shift`** — shift template per outlet
- id, outlet_id, code, name, start_time, end_time, break_minutes

**`core.work_shift`** — employee assignment to a shift on a date
- shift_id, user_id, work_date
- schedule_status: `scheduled | confirmed | cancelled`
- attendance_status: `pending | present | late | absent | leave`
- approval_status: `pending | approved | rejected`
- actual_start_time, actual_end_time
- assigned_by_user_id, approved_by_user_id, note

**`core.payroll_timesheet`** — aggregated hours per employee per period
- payroll_period_id, user_id, outlet_id
- work_days, work_hours, overtime_hours, overtime_rate
- late_count, absent_days

**`core.payroll_period`** — payroll cycle dates
**`core.payroll`** — salary calculation + status
**`core.audit_log`** — full audit trail for all entities

### Backend (hr-service)

- `ShiftService` — CRUD for `core.shift`
- `WorkShiftService` — CRUD + attendance update + approve/reject
- Endpoints: shifts, work-shifts, contracts, time-off

### Frontend

- `types/scheduling.ts` — Shift, ShiftAssignment, SwapRequest, TimeOffRequest
- `types/workforce.ts` — AttendanceRecord, OvertimeRecord, LeaveRequest
- `api/hr-api.ts` — ShiftView, WorkShiftView, queries
- `workforce/shift-schedule-board.ts` — lane-based board logic (good foundation)
- `WorkforceModule.tsx` — tabs: attendance, overtime, leave
- `SchedulingModule.tsx` — tabs: shifts, assignments, time-off, swaps

---

## 2. DB Changes — Minimal

### Nguyên tắc: chỉ thêm cái mà frontend KHÔNG THỂ derive từ data hiện có

**Cần thêm:**

| Change | Why | Can't avoid? |
|--------|-----|-------------|
| `work_shift.work_role` | Biết staff làm role gì trong ca. Không thể derive — phải do manager gán | ✅ Yes |
| `shift.daypart` | Group shifts theo daypart. Có thể derive từ start_time, nhưng lưu explicit thì chính xác hơn và manager có thể override | Optional — recommend yes |
| `shift.headcount_required` | Biết ca cần bao nhiêu người. Không thể derive | ✅ Yes |

**KHÔNG cần thêm:**

| Bỏ | Lý do |
|----|-------|
| ~~schedule table~~ | Frontend group work_shifts theo outlet + week. "Publish" = tất cả work_shift trong tuần đó có schedule_status ≠ cancelled |
| ~~break_record table~~ | `shift.break_minutes` đã define allowed break. Track break thực tế → phase 2 |
| ~~attendance_exception table~~ | Frontend derive exceptions từ `attendance_status` + `actual_start_time` vs `shift.start_time`. Không cần persist |
| ~~punch_adjustment table~~ | Dùng `core.audit_log` cho edit history. Manager edit trực tiếp `actual_start_time/actual_end_time` |
| ~~timesheet_closure table~~ | `payroll_timesheet` + `work_shift.approval_status` đã đủ. Frontend tính "ready to close" = tất cả work_shifts approved |

### Migration file: `V17__workforce_enhancements.sql`

```sql
-- Work role enum (role within a shift, NOT IAM role)
CREATE TYPE core.work_role_enum AS ENUM (
  'cashier', 'kitchen_staff', 'prep', 'support', 'closing_support'
);

-- Daypart enum
CREATE TYPE core.daypart_enum AS ENUM (
  'opening', 'breakfast', 'lunch_peak', 'afternoon', 'closing'
);

-- Add columns to shift (template)
ALTER TABLE core.shift ADD COLUMN daypart core.daypart_enum;
ALTER TABLE core.shift ADD COLUMN headcount_required INT NOT NULL DEFAULT 1;

-- Role requirements per shift (which roles and how many)
CREATE TABLE core.shift_role_requirement (
  id BIGINT PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES core.shift(id) ON DELETE CASCADE,
  work_role core.work_role_enum NOT NULL,
  required_count INT NOT NULL DEFAULT 1 CHECK (required_count >= 0),
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_shift_role UNIQUE (shift_id, work_role)
);

-- Add work_role to work_shift (which role this person fills in this shift)
ALTER TABLE core.work_shift ADD COLUMN work_role core.work_role_enum;
```

**Tổng: 2 ALTER + 1 CREATE TABLE + 2 CREATE TYPE. Không sửa data hiện có.**

---

## 3. Backend Changes — Minimal

### Extend existing services (không tạo service mới)

**ShiftService — thêm:**
- Khi create/update shift: nhận `daypart`, `headcount_required`
- CRUD `shift_role_requirement`: set roles cho shift

**WorkShiftService — thêm:**
- Khi create work_shift: nhận `work_role`
- Endpoint mới: `GET /api/v1/hr/work-shifts/daily-summary?outletId=&date=`
  - Trả về: shifts + assignments + computed coverage cho 1 ngày
  - Đây là endpoint duy nhất thực sự mới

**Endpoints mới/sửa:**

```
# Shift role requirements (thêm vào shift endpoints hiện có)
PUT  /api/v1/hr/shifts/{shiftId}/roles     — set role requirements (array)
GET  /api/v1/hr/shifts/{shiftId}/roles     — get role requirements

# Daily summary (endpoint mới duy nhất)
GET  /api/v1/hr/work-shifts/daily-summary?outletId=&date=
Response: {
  shifts: ShiftView[],            // shifts of this outlet
  assignments: WorkShiftView[],   // work_shifts for this date
  roleRequirements: { shiftId, workRole, requiredCount }[]
}
```

**Không cần backend mới cho:**
- Exceptions → frontend tính từ attendance_status + timestamps
- Break tracking → dùng shift.break_minutes (track thực tế = phase 2)
- Punch edit → dùng existing `PUT /work-shifts/{id}/attendance` + audit_log
- Timesheet close → dùng existing approve flow + payroll_timesheet

---

## 4. Frontend — Module Restructure

### Gộp 2 module thành 1

**Current:** WorkforceModule + SchedulingModule (overlap nhiều)

**Target:** 1 `WorkforceModule` với 4 tabs

```
/workforce
├── ?tab=schedule     → Schedule Planner
├── ?tab=daily-board  → Daily Board (default)
├── ?tab=attendance   → Time & Attendance
└── ?tab=review       → Labor Review
```

---

## 5. Screen Designs

### 5a. Schedule Planner (`?tab=schedule`)

**Purpose:** Manager lập lịch tuần — assign staff vào shifts.

**Layout:** Week grid — rows = shifts (nhóm theo daypart), columns = Mon–Sun.

```
┌─────────────────────────────────────────────────────────────────┐
│ SCHEDULE PLANNER                                                 │
│ Outlet: [Downtown ▼]   ◄ Apr 13–19, 2026 ►   [Day] [Week]     │
├─────────────────────────────────────────────────────────────────┤
│ SUMMARY: Shifts: 20 │ Assigned: 15/20 │ Gaps: 5               │
├──────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬────┤
│          │ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │ Sat  │ Sun  │    │
├──────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤    │
│ OPENING  │      │      │      │      │      │      │      │    │
│ 06–09    │ 2/2 ✓│ 2/2 ✓│ 2/2 ✓│ 2/2 ✓│ 1/2 ⚠│ 2/2 ✓│  —  │    │
├──────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤    │
│ LUNCH    │      │      │      │      │      │      │      │    │
│ 11–15    │ 4/5 ⚠│ 5/5 ✓│ 3/5 ⚠│ 5/5 ✓│ 4/5 ⚠│ 5/5 ✓│ 3/4 │    │
├──────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤    │
│ CLOSING  │      │      │      │      │      │      │      │    │
│ 20–23    │ 1/1 ✓│ 1/1 ✓│ 0/1 ⚠│ 1/1 ✓│ 1/1 ✓│ 1/1 ✓│ 1/1 │    │
└──────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴────┘
```

**Click cell → Side panel:**
```
┌─ Lunch Peak │ Wed Apr 15 ──────────────────┐
│                                             │
│ ROLE COVERAGE                               │
│ cashier:       1/2 ⚠  [+ Assign]          │
│ kitchen_staff: 1/2 ⚠  [+ Assign]          │
│ support:       1/1 ✓                       │
│                                             │
│ ASSIGNED                                    │
│ ● Cuong Le — cashier                [✕]    │
│ ● Em Vo — support                   [✕]    │
│ ● Binh Tran — kitchen_staff         [✕]    │
│                                             │
│ ALERTS                                      │
│ ⚠ Huy Ngo has time-off this day            │
└─────────────────────────────────────────────┘
```

**Data source:**
- `GET /shifts?outletId=` → shift templates (rows)
- `GET /shifts/{id}/roles` → role requirements
- `GET /work-shifts?outletId=&startDate=&endDate=` → assignments for the week
- Frontend groups by shift + date, computes `assigned/required`

**Key logic (frontend):**

```typescript
// Daypart grouping — derive from shift.start_time if daypart column is null
function inferDaypart(startTime: string): Daypart {
  const hour = parseInt(startTime.split(':')[0]);
  if (hour < 9) return 'opening';
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch_peak';
  if (hour < 20) return 'afternoon';
  return 'closing';
}

// Coverage per cell
function computeCoverage(shift: ShiftView, assignments: WorkShiftView[], date: string) {
  const dayAssignments = assignments.filter(a =>
    a.shiftId === shift.id && a.workDate === date && a.scheduleStatus !== 'cancelled'
  );
  return {
    assigned: dayAssignments.length,
    required: shift.headcountRequired ?? 1,
    gap: Math.max(0, (shift.headcountRequired ?? 1) - dayAssignments.length),
  };
}
```

---

### 5b. Daily Board (`?tab=daily-board`) — MAIN SCREEN

**Purpose:** Manager điều hành ca trong ngày. Decision screen.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ DAILY BOARD        Thu, Apr 16, 2026       [◄ Wed] [Fri ►]          │
│ Outlet: Downtown                                                     │
├──────────────────────────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│ │ON FLOOR│ │COVERAGE│ │ LATE   │ │NO-SHOW │ │PENDING │             │
│ │  4/6   │ │ 67% ⚠  │ │ 1  🟡  │ │ 1  🔴  │ │ 2 rvw  │             │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ▼ OPENING 06:00–09:00                              ✅ Completed     │
│   Coverage: 2/2  │ cashier 1/1 ✓ │ prep 1/1 ✓                      │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │ ✅ An Nguyen      cashier    In: 05:58  Out: 09:02      │       │
│   │ ✅ Binh Tran      prep       In: 06:01  Out: 09:05      │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                      │
│ ▼ LUNCH PEAK 11:00–15:00                           🟢 In Progress  │
│   Coverage: 3/5  │ cashier 1/2 ⚠ │ kitchen 1/2 ⚠ │ support 1/1 ✓  │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │ 🟢 Cuong Le       cashier    In: 10:58                  │       │
│   │ 🟡 Dung Pham      kitchen    In: 11:14  LATE +14m [Ack] │       │
│   │ 🟢 Em Vo          support    In: 11:02                  │       │
│   │ 🔴 ── OPEN ──     cashier          [Assign ▼]           │       │
│   │ 🔴 ── OPEN ──     kitchen          [Assign ▼]           │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                      │
│ ▶ AFTERNOON 15:00–20:00                            ⏳ Not Started   │
│   Coverage: 3/3 ✓                                                   │
│                                                                      │
│ ▶ CLOSING 20:00–23:00                              ⏳ Not Started   │
│   Coverage: 1/1 ✓                                                   │
│                                                                      │
├──── ISSUES (3) ──────────────────────────────────────────────────────┤
│ 🔴 Huy Ngo — Lunch/kitchen — NO-SHOW 11:00          [Mark Absent]  │
│ 🟡 Dung Pham — Lunch/kitchen — LATE +14min           [Acknowledge]  │
│ 🟡 Lunch/cashier — 1 UNFILLED                        [Assign ▼]    │
└──────────────────────────────────────────────────────────────────────┘
```

**Summary Strip metrics — all computed on frontend:**

```typescript
function computeDailyMetrics(shifts: ShiftView[], assignments: WorkShiftView[], now: Date): DailyMetrics {
  const activeAssignments = assignments.filter(a => a.scheduleStatus !== 'cancelled');
  const checkedIn = activeAssignments.filter(a => a.attendanceStatus === 'present' && !a.actualEndTime);
  const late = activeAssignments.filter(a => a.attendanceStatus === 'late');
  const absent = activeAssignments.filter(a => a.attendanceStatus === 'absent');
  const pendingApproval = activeAssignments.filter(a => a.approvalStatus === 'pending');

  const totalRequired = shifts.reduce((sum, s) => sum + (s.headcountRequired ?? 1), 0);
  const totalAssigned = activeAssignments.length;

  return {
    onFloor: checkedIn.length,
    totalAssigned,
    coveragePercent: totalRequired > 0 ? Math.round((totalAssigned / totalRequired) * 100) : 100,
    lateCount: late.length,
    noShowCount: absent.length,
    pendingReview: pendingApproval.length,
  };
}
```

**Shift progress status — derived from time:**

```typescript
function getShiftProgress(shift: ShiftView, date: string, now: Date): 'not_started' | 'in_progress' | 'completed' {
  const start = parseShiftDateTime(date, shift.startTime);
  const end = parseShiftDateTime(date, shift.endTime);
  if (now < start) return 'not_started';
  if (now > end) return 'completed';
  return 'in_progress';
}
```

**Assignment live status — derived from existing fields:**

```typescript
function deriveLiveStatus(a: WorkShiftView, shift: ShiftView, date: string, now: Date): LiveStatus {
  if (a.scheduleStatus === 'cancelled') return 'cancelled';
  if (a.actualEndTime) return 'completed';
  if (a.attendanceStatus === 'absent') return 'no_show';
  if (a.attendanceStatus === 'late') return 'late';
  if (a.attendanceStatus === 'present') return 'checked_in';
  if (a.attendanceStatus === 'leave') return 'on_leave';

  // Still pending — check if shift started
  const shiftStart = parseShiftDateTime(date, shift.startTime);
  if (now > addMinutes(shiftStart, 30)) return 'no_show';  // 30min threshold
  if (now > shiftStart) return 'late';                       // shift started, not checked in
  return 'assigned';
}
```

**Issues list — derived, not stored:**

```typescript
function deriveExceptions(shifts: ShiftView[], assignments: WorkShiftView[],
                          roleReqs: RoleRequirement[], date: string, now: Date): Exception[] {
  const issues: Exception[] = [];

  for (const a of assignments) {
    const shift = shifts.find(s => s.id === a.shiftId);
    if (!shift) continue;
    const status = deriveLiveStatus(a, shift, date, now);

    if (status === 'no_show') {
      issues.push({ type: 'no_show', severity: 'critical', employee: a, shift });
    }
    if (status === 'late') {
      issues.push({ type: 'late', severity: 'warning', employee: a, shift });
    }
  }

  // Unfilled roles
  for (const shift of shifts) {
    const reqs = roleReqs.filter(r => r.shiftId === shift.id);
    for (const req of reqs) {
      const assigned = assignments.filter(a =>
        a.shiftId === shift.id && a.workRole === req.workRole && a.scheduleStatus !== 'cancelled'
      ).length;
      if (assigned < req.requiredCount) {
        issues.push({ type: 'unfilled', severity: 'warning', shift, workRole: req.workRole,
                       gap: req.requiredCount - assigned });
      }
    }
  }

  return issues.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));
}
```

**Data source:** `GET /work-shifts/daily-summary?outletId=&date=` (hoặc 2 calls riêng: shifts + work-shifts)

**Actions — all use existing endpoints:**
- [Mark Absent] → `PUT /work-shifts/{id}/attendance` body: `{ attendanceStatus: 'absent' }`
- [Acknowledge Late] → `PUT /work-shifts/{id}/attendance` body: `{ note: 'acknowledged' }`
- [Assign] → `POST /work-shifts` body: `{ shiftId, userId, workDate, workRole }`

---

### 5c. Attendance (`?tab=attendance`)

**Purpose:** Xem + chỉnh sửa giờ làm thực tế.

**Layout:** Master-detail: list bên trái, detail bên phải.

```
┌─────────────────────────────┬────────────────────────────────────────┐
│ TIMECARDS — Thu Apr 16      │ DETAIL: Dung Pham                      │
│ [Filter: All ▼] [Exc only]  │                                        │
│                              │ Shift: Lunch Peak 11:00–15:00         │
│ ┌──────────────────────────┐│ Role: kitchen_staff                    │
│ │🔴 Huy Ngo    kitchen     ││                                        │
│ │   Lunch 11–15  NO-SHOW   ││ SCHEDULED  11:00 — 15:00              │
│ └──────────────────────────┘│ ACTUAL     11:14 — (still on shift)    │
│ ┌──────────────────────────┐│ BREAK      30 min allowed              │
│ │🟡 Dung Pham  kitchen   ◄─┤│                                        │
│ │   Lunch 11–15  LATE +14m ││ HOURS                                  │
│ └──────────────────────────┘│ Scheduled: 4h 00m                      │
│ ┌──────────────────────────┐│ Actual:    3h 46m (in progress)        │
│ │🟢 Cuong Le   cashier    ││ Variance:  -14m                        │
│ │   Lunch 11–15  ON SHIFT  ││                                        │
│ └──────────────────────────┘│ STATUS                                 │
│ ┌──────────────────────────┐│ Attendance: late                       │
│ │✅ An Nguyen  cashier     ││ Approval: pending                      │
│ │   Open 06–09  DONE       ││                                        │
│ └──────────────────────────┘│ NOTE                                   │
│                              │ (none)                                 │
│                              │                                        │
│                              │ [Edit Clock-In] [Edit Clock-Out]      │
│                              │ [Add Note] [Approve] [Reject]         │
└─────────────────────────────┴────────────────────────────────────────┘
```

**Edit punch flow (simple):**
1. Manager clicks [Edit Clock-In]
2. Modal: new time + reason (text field)
3. Submit → `PUT /work-shifts/{id}/attendance` with new `actual_start_time`
4. System logs change in `core.audit_log` automatically

**Approve flow:**
- Manager reviews timecard → [Approve] → `POST /work-shifts/{id}/approve`
- Sets `approval_status = 'approved'`

**Data source:** Same `GET /work-shifts?outletId=&startDate=&endDate=` + shift data

---

### 5d. Labor Review (`?tab=review`)

**Purpose:** Cuối ngày/tuần — review hours, approve, prepare for payroll.

```
┌──────────────────────────────────────────────────────────────────────┐
│ LABOR REVIEW          Period: Apr 13–19, 2026                        │
│ Outlet: Downtown      [Daily ▼]                                     │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│ │SCHEDULED │ │ ACTUAL   │ │ OVERTIME │ │ APPROVAL │                │
│ │  148.0h  │ │ 152.5h   │ │  4.5h ⚠  │ │ 12/20 ✓  │                │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘                │
├──────────────────────────────────────────────────────────────────────┤
│ DAY       SCHED  ACTUAL  +/-    OT    LATE  ABSENT  APPROVED       │
│ ─────────────────────────────────────────────────────────────       │
│ Mon 13    28.0h  28.5h  +0.5h   0     0     0       5/5 ✅        │
│ Tue 14    30.0h  31.0h  +1.0h  1.0h   1     0       5/5 ✅        │
│▶Wed 15    28.0h  29.5h  +1.5h  1.5h   0     1       3/5 🟡        │
│ ┌────────────────────────────────────────────────────────────┐      │
│ │ An Nguyen    cashier    8.0h   8.0h   —    ✅ approved    │      │
│ │ Binh Tran    kitchen    8.0h   8.5h  +30m  ✅ approved    │      │
│ │ Em Vo        support    4.0h   4.0h   —    ✅ approved    │      │
│ │ Cuong Le     cashier    8.0h   9.0h  +1h   🟡 pending    │      │
│ │ Huy Ngo      kitchen    8.0h   0h     —    🟡 absent      │      │
│ │                                                            │      │
│ │                          [Approve All Pending] [Add Note] │      │
│ └────────────────────────────────────────────────────────────┘      │
│ Thu 16    32.0h   —       —      —     —     —       0/6 ⬜        │
│ Fri 17    30.0h   —       —      —     —     —       0/5 ⬜        │
├──────────────────────────────────────────────────────────────────────┤
│ PAYROLL READINESS                                                    │
│ ⚠ 8 work shifts pending approval                                   │
│ ⚠ 3 days incomplete                                                │
│ When all shifts approved → [Generate Payroll Timesheet]             │
└──────────────────────────────────────────────────────────────────────┘
```

**All computed on frontend:**

```typescript
function computeDaySummary(shifts: ShiftView[], assignments: WorkShiftView[], date: string) {
  const dayAssignments = assignments.filter(a => a.workDate === date && a.scheduleStatus !== 'cancelled');

  const scheduled = dayAssignments.reduce((sum, a) => {
    const shift = shifts.find(s => s.id === a.shiftId);
    if (!shift) return sum;
    return sum + diffHours(shift.startTime, shift.endTime);
  }, 0);

  const actual = dayAssignments.reduce((sum, a) => {
    if (!a.actualStartTime) return sum;
    const end = a.actualEndTime ?? now();
    return sum + diffHours(a.actualStartTime, end);
  }, 0);

  return {
    scheduled,
    actual,
    variance: actual - scheduled,
    overtime: Math.max(0, actual - scheduled), // simplified
    lateCount: dayAssignments.filter(a => a.attendanceStatus === 'late').length,
    absentCount: dayAssignments.filter(a => a.attendanceStatus === 'absent').length,
    approvedCount: dayAssignments.filter(a => a.approvalStatus === 'approved').length,
    totalCount: dayAssignments.length,
  };
}
```

**Payroll flow:**
1. Manager approves all work_shifts for the period
2. All approved → [Generate Payroll Timesheet] enabled
3. Click → backend aggregates into existing `core.payroll_timesheet`
4. From there, existing payroll flow takes over

---

## 6. Frontend Types

### New/updated types (add to `types/workforce.ts`)

```typescript
// Work roles within a shift (NOT business/IAM roles)
export type WorkRole = 'cashier' | 'kitchen_staff' | 'prep' | 'support' | 'closing_support';
export type Daypart = 'opening' | 'breakfast' | 'lunch_peak' | 'afternoon' | 'closing';

// Live status — derived on frontend, not stored in DB
export type LiveStatus =
  | 'assigned' | 'confirmed' | 'checked_in' | 'late'
  | 'no_show' | 'on_leave' | 'completed' | 'cancelled';

export type ShiftProgress = 'not_started' | 'in_progress' | 'completed';

// Role requirement (from shift_role_requirement table)
export interface ShiftRoleRequirement {
  shiftId: string;
  workRole: WorkRole;
  requiredCount: number;
  isOptional: boolean;
}

// Role coverage — computed on frontend
export interface RoleCoverage {
  workRole: WorkRole;
  required: number;
  assigned: number;
  checkedIn: number;
}

// Exception — computed on frontend, not stored
export interface DerivedException {
  type: 'no_show' | 'late' | 'unfilled' | 'overtime_risk';
  severity: 'critical' | 'warning' | 'info';
  employeeId?: string;
  employeeName?: string;
  shiftId: string;
  shiftName: string;
  workRole?: WorkRole;
  detail: string; // e.g., "+14min", "1 unfilled"
}

// Daily board metrics — computed on frontend
export interface DailyBoardMetrics {
  onFloor: number;
  totalAssigned: number;
  coveragePercent: number;
  lateCount: number;
  noShowCount: number;
  pendingReview: number;
}

// Daypart section for Daily Board
export interface DaypartSection {
  daypart: Daypart;
  label: string;
  timeRange: string;
  shifts: {
    shift: ShiftView;
    assignments: WorkShiftView[];
    roleCoverage: RoleCoverage[];
    progress: ShiftProgress;
  }[];
}

// Day summary for Labor Review
export interface DaySummary {
  date: string;
  scheduledHours: number;
  actualHours: number;
  variance: number;
  overtimeHours: number;
  lateCount: number;
  absentCount: number;
  approvedCount: number;
  totalCount: number;
}
```

---

## 7. Component Inventory

### Shared

| Component | Props | Notes |
|-----------|-------|-------|
| `StatusBadge` | `status: LiveStatus` | Color-coded badge |
| `WorkRoleBadge` | `role: WorkRole` | Colored tag |
| `CoverageIndicator` | `assigned, required` | `3/5 ⚠` display |
| `RoleCoverageBar` | `coverage: RoleCoverage[]` | Horizontal role breakdown |
| `MetricCard` | `label, value, variant` | Top strip metric |
| `DateNav` | `date, onPrev, onNext` | Day navigation |
| `WeekNav` | `weekStart, onPrev, onNext` | Week navigation |

### Schedule Planner

| Component | Notes |
|-----------|-------|
| `SchedulePlannerView` | Main container, loads shifts + assignments |
| `WeekGrid` | Daypart rows × day columns |
| `ScheduleCell` | Clickable cell with coverage indicator |
| `ShiftDetailPanel` | Right drawer: role coverage + assigned list |
| `AssignStaffModal` | Employee picker with work role dropdown |
| `RoleRequirementEditor` | Edit role counts for a shift |

### Daily Board

| Component | Notes |
|-----------|-------|
| `DailyBoardView` | Main container, date picker, loads daily data |
| `SummaryStrip` | Row of MetricCards |
| `DaypartSection` | Collapsible, contains AssignmentCards |
| `AssignmentCard` | Employee + role + status + inline action |
| `UnfilledSlotCard` | Ghost card + [Assign] button |
| `IssuesPanel` | Bottom: derived exceptions sorted by severity |
| `QuickAssignModal` | Fast assign employee to unfilled slot |

### Attendance

| Component | Notes |
|-----------|-------|
| `AttendanceView` | Master-detail layout |
| `TimecardList` | Left panel, sortable/filterable |
| `TimecardDetail` | Right panel: times, hours, status, actions |
| `EditPunchModal` | Change actual_start/end + reason |

### Labor Review

| Component | Notes |
|-----------|-------|
| `LaborReviewView` | Period selector + summary + day table |
| `PeriodSummaryStrip` | Aggregated metrics |
| `DayBreakdownTable` | Expandable rows per day |
| `EmployeeHoursRow` | Per-employee detail within expanded day |
| `PayrollReadinessBar` | Bottom: approval status + generate button |

---

## 8. Role-Based Access

| Feature | outlet_manager | staff |
|---------|---------------|-------|
| Schedule Planner (view all) | ✓ | ✗ (sees own schedule only via existing My Schedule) |
| Schedule Planner (edit) | ✓ | ✗ |
| Daily Board | ✓ | ✗ |
| Attendance (view all) | ✓ | own only |
| Attendance (edit punch) | ✓ | ✗ |
| Attendance (approve) | ✓ | ✗ |
| Labor Review | ✓ | ✗ |
| Clock in/out | ✓ | own only |

Reuse existing `module-access-matrix.ts` — workforce module already requires `roles: ['hr', 'outlet_manager']`.

---

## 9. Implementation Order

### Phase 1: DB + Backend (1 migration, extend 2 services)

1. Create `V17__workforce_enhancements.sql` — 2 ALTERs + 1 CREATE TABLE + 2 enums
2. Extend `ShiftService` — daypart, headcount, role requirements CRUD
3. Extend `WorkShiftService` — work_role field, daily-summary endpoint
4. Update `ShiftDto` / `WorkShiftDto` — add new fields
5. Seed data update — add daypart + roles to existing demo shifts

### Phase 2: Frontend (rebuild WorkforceModule)

1. Update types + API client
2. Build shared components (StatusBadge, WorkRoleBadge, CoverageIndicator, etc.)
3. Build Daily Board (most important screen)
4. Build Schedule Planner
5. Build Attendance tab
6. Build Labor Review tab
7. Remove old SchedulingModule (functionality absorbed)

### Phase 3: Later

- Break tracking (actual break start/end)
- Shift swap / cover request UI
- Availability management
- Mobile staff view
- Labor cost analytics

---

## 10. Key Design Rules

1. **business_role ≠ work_role** — IAM = outlet_manager/staff. Shift role = cashier/kitchen/prep/support
2. **Frontend derives, DB stores facts** — exceptions, live status, coverage = computed. DB only stores: who, when, what role, actual times
3. **Existing tables first** — `shift` + `work_shift` + `payroll_timesheet` already cover 90% of needs
4. **Daypart = frontend grouping** — group shifts by start_time range or explicit daypart column
5. **Exception-first UI** — issues panel always visible, sorted by severity
6. **Coverage = role-aware** — show per-role breakdown, not just headcount
7. **Approve flow = existing** — `work_shift.approval_status` already exists, just use it
8. **Payroll bridge = existing** — approved work_shifts → aggregate into `payroll_timesheet`
