"""Controlled HR query lane.

HR questions intentionally do not go through GenSQL. The node classifies a small
set of supported HR questions, applies role/outlet scope programmatically, then
runs static Postgres SELECTs with bound parameters.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import logging
import re
import unicodedata
from typing import Callable

from app.auth.context import AuthContext
from app.clients import postgres as pg
from app.config import get_settings
from app.graph.nodes.contextualizer import effective_question as contextual_effective_question
from app.graph.nodes.data_coverage import coverage_window_for_template, ensure_data_source_context
from app.graph.question_frame import question_text
from app.graph.state import GraphState
from app.rbac.policy import compute_allowed_outlets
from app.time_utils import has_time_expression, is_time_followup, parse_time_range, today_local

logger = logging.getLogger(__name__)

_PAYROLL_ROLES = frozenset({"hr", "finance", "admin", "superadmin"})
_STAFF_ROLES = frozenset({"hr", "finance", "outlet_manager", "admin", "superadmin"})
_ATTENDANCE_ROLES = frozenset({"hr", "finance", "outlet_manager", "region_manager", "admin", "superadmin"})
_TENURE_ROLES = _STAFF_ROLES
_EMPLOYEE_WORK_HOURS_ROLES = _ATTENDANCE_ROLES
_TIME_BOUND_HR_TEMPLATES = frozenset(
    {"HR_employee_work_hours", "HR_work_hours_total", "HR_attendance_top", "HR_payroll_total"}
)

_OUTLET_CODE_RE = re.compile(r"\b[A-Z]{2}-[A-Z]{2,}(?:-[A-Z]+)?-\d{1,4}\b", re.IGNORECASE)
_OUTLET_PHRASE_RE = re.compile(
    r"\boutlet\s+([A-Z]{2}-[A-Z]{2,}(?:-[A-Z]+)?-\d{1,4}|\d{1,4})\b",
    re.IGNORECASE,
)
_EMPLOYEE_TERM_TRAILING_CONTEXT_RE = re.compile(
    r"\s+(?:"
    r"hôm\s*nay|hom\s*nay|hôm\s*qua|hom\s*qua|tuần\s*này|tuan\s*nay|"
    r"tuần\s*trước|tuan\s*truoc|tháng\s*này|thang\s*nay|tháng\s*trước|thang\s*truoc|"
    r"năm\s*nay|nam\s*nay|năm\s*trước|nam\s*truoc|năm\s+\d{4}|nam\s+\d{4}|"
    r"từ\s+ngày|tu\s+ngay|đến\s+ngày|den\s+ngay|"
    r"đã\s+làm|da\s+lam|đã\s+nhận|da\s+nhan|được\s+nhận|duoc\s+nhan|"
    r"đã\b|da\b|nhận\b|nhan\b|được\b|duoc\b|trong\b"
    r").*$",
    re.IGNORECASE,
)
_EMPLOYEE_CONTEXT_REFERENCE_RE = re.compile(
    r"\b(nhân\s*viên\s*này|nhan\s*vien\s*nay|người\s*này|nguoi\s*nay|"
    r"người\s*đó|nguoi\s*do|bạn\s*này|ban\s*nay|anh\s*này|anh\s*nay|"
    r"chị\s*này|chi\s*nay)\b",
    re.IGNORECASE,
)
_EMPLOYEE_ORDINAL_REFERENCE_RE = re.compile(
    r"\b(?:nhân\s*viên|nhan\s*vien|người|nguoi|dòng|dong|mục|muc)\s+"
    r"(?:thứ\s*)?(?P<n>\d{1,2})\b",
    re.IGNORECASE,
)


_OUTLETS_MISSING_STAFF_SQL = """
WITH scoped AS (
  SELECT unnest(%(outlet_ids)s::bigint[]) AS outlet_id
),
staff_counts AS (
  SELECT outlet_id, COUNT(DISTINCT user_id) AS cnt
  FROM (
    SELECT ur.outlet_id, ur.user_id
    FROM core.user_role ur
    JOIN core.app_user u ON u.id = ur.user_id
    WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
      AND u.deleted_at IS NULL
      AND u.status = 'active'
    UNION
    SELECT s.outlet_id, ws.user_id
    FROM core.work_shift ws
    JOIN core.shift s ON s.id = ws.shift_id
    JOIN core.app_user u ON u.id = ws.user_id
    WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
      AND s.deleted_at IS NULL
      AND u.deleted_at IS NULL
      AND u.status = 'active'
  ) t
  GROUP BY outlet_id
)
SELECT o.id AS outlet_id, o.code AS outlet_code, o.name AS outlet_name
FROM core.outlet o
JOIN scoped sc ON sc.outlet_id = o.id
LEFT JOIN staff_counts c ON c.outlet_id = o.id
WHERE o.deleted_at IS NULL
  AND COALESCE(c.cnt, 0) = 0
ORDER BY o.id
"""


_TENURE_HEADCOUNT_SQL = """
WITH staff_users AS (
  SELECT DISTINCT u.id AS user_id
  FROM core.app_user u
  JOIN core.user_role ur ON ur.user_id = u.id
  WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL
    AND u.status = 'active'
  UNION
  SELECT DISTINCT u.id AS user_id
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  JOIN core.app_user u ON u.id = ws.user_id
  WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND s.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.status = 'active'
),
first_hire AS (
  SELECT ec.user_id,
         MIN(COALESCE(ec.hire_date, ec.start_date))::date AS first_start
  FROM core.employee_contract ec
  WHERE ec.deleted_at IS NULL
  GROUP BY ec.user_id
)
SELECT COUNT(*)::int AS employee_count,
       (SELECT COUNT(DISTINCT su.user_id)::int FROM staff_users su
         LEFT JOIN first_hire fh ON fh.user_id = su.user_id
        WHERE fh.first_start IS NULL) AS without_contract_date_count
FROM staff_users su
JOIN first_hire fh ON fh.user_id = su.user_id
WHERE (%(at_least)s::boolean AND fh.first_start <= (CURRENT_DATE - (%(years)s::int * INTERVAL '1 year'))::date)
   OR (NOT %(at_least)s::boolean AND fh.first_start > (CURRENT_DATE - (%(years)s::int * INTERVAL '1 year'))::date)
"""


_TENURE_LIST_SQL = """
WITH staff_scope AS (
  SELECT DISTINCT u.id AS user_id,
         u.full_name,
         u.username,
         u.employee_code,
         u.status,
         ur.outlet_id,
         o.code AS outlet_code,
         o.name AS outlet_name
  FROM core.app_user u
  JOIN core.user_role ur ON ur.user_id = u.id
  JOIN core.outlet o ON o.id = ur.outlet_id
  WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL
    AND u.status = 'active'
    AND o.deleted_at IS NULL

  UNION

  SELECT DISTINCT u.id AS user_id,
         u.full_name,
         u.username,
         u.employee_code,
         u.status,
         s.outlet_id,
         o.code AS outlet_code,
         o.name AS outlet_name
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  JOIN core.app_user u ON u.id = ws.user_id
  JOIN core.outlet o ON o.id = s.outlet_id
  WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND s.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.status = 'active'
    AND o.deleted_at IS NULL
),
first_hire AS (
  SELECT ec.user_id,
         MIN(COALESCE(ec.hire_date, ec.start_date))::date AS first_start
  FROM core.employee_contract ec
  WHERE ec.deleted_at IS NULL
  GROUP BY ec.user_id
)
SELECT ss.user_id,
       ss.full_name,
       ss.username,
       ss.employee_code,
       ss.status,
       ss.outlet_id,
       ss.outlet_code,
       ss.outlet_name,
       fh.first_start AS first_start_date,
       (CURRENT_DATE - fh.first_start)::int AS tenure_days
FROM staff_scope ss
JOIN first_hire fh ON fh.user_id = ss.user_id
WHERE (%(at_least)s::boolean AND fh.first_start <= (CURRENT_DATE - (%(months)s::int * INTERVAL '1 month'))::date)
   OR (NOT %(at_least)s::boolean AND fh.first_start > (CURRENT_DATE - (%(months)s::int * INTERVAL '1 month'))::date)
ORDER BY fh.first_start ASC, ss.outlet_name, ss.full_name
LIMIT %(limit)s
"""


_NEW_CONTRACTS_LIST_SQL = """
WITH staff_scope AS (
  SELECT DISTINCT u.id AS user_id,
         u.full_name,
         u.username,
         u.employee_code,
         u.status,
         ur.outlet_id,
         o.code AS outlet_code,
         o.name AS outlet_name
  FROM core.app_user u
  JOIN core.user_role ur ON ur.user_id = u.id
  JOIN core.outlet o ON o.id = ur.outlet_id
  WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL
    AND u.status = 'active'
    AND o.deleted_at IS NULL

  UNION

  SELECT DISTINCT u.id AS user_id,
         u.full_name,
         u.username,
         u.employee_code,
         u.status,
         s.outlet_id,
         o.code AS outlet_code,
         o.name AS outlet_name
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  JOIN core.app_user u ON u.id = ws.user_id
  JOIN core.outlet o ON o.id = s.outlet_id
  WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND s.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.status = 'active'
    AND o.deleted_at IS NULL
),
contract_starts_year AS (
  SELECT ec.user_id,
         MIN(COALESCE(ec.hire_date, ec.start_date)::date) AS contract_start_date
  FROM core.employee_contract ec
  WHERE ec.deleted_at IS NULL
    AND ec.status = 'active'
    AND COALESCE(ec.hire_date, ec.start_date)::date >= %(year_start)s::date
    AND COALESCE(ec.hire_date, ec.start_date)::date <= %(year_end)s::date
  GROUP BY ec.user_id
)
SELECT ss.user_id,
       ss.full_name,
       ss.username,
       ss.employee_code,
       ss.status,
       ss.outlet_id,
       ss.outlet_code,
       ss.outlet_name,
       cs.contract_start_date
FROM staff_scope ss
JOIN contract_starts_year cs ON cs.user_id = ss.user_id
ORDER BY cs.contract_start_date ASC, ss.outlet_name, ss.full_name, ss.user_id
LIMIT %(limit)s
"""


_EMPLOYMENT_TYPE_HEADCOUNT_SQL = """
WITH staff_users AS (
  SELECT DISTINCT u.id AS user_id
  FROM core.app_user u
  JOIN core.user_role ur ON ur.user_id = u.id
  WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL
    AND u.status = 'active'
  UNION
  SELECT DISTINCT u.id AS user_id
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  JOIN core.app_user u ON u.id = ws.user_id
  WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND s.deleted_at IS NULL
    AND u.deleted_at IS NULL
    AND u.status = 'active'
),
matched AS (
  SELECT DISTINCT su.user_id
  FROM staff_users su
  WHERE EXISTS (
    SELECT 1
    FROM core.employee_contract ec
    WHERE ec.user_id = su.user_id
      AND ec.deleted_at IS NULL
      AND ec.status = 'active'
      AND ec.employment_type::text = %(employment_type)s
  )
)
SELECT (SELECT COUNT(*)::int FROM matched) AS employee_count,
       GREATEST(
         (SELECT COUNT(*)::int FROM staff_users) - (SELECT COUNT(*)::int FROM matched),
         0
       ) AS not_this_type_count
"""


_STAFF_LIST_SQL = """
WITH staff_scope AS (
  SELECT u.id AS user_id, u.full_name, u.username, u.employee_code, u.status,
         ur.outlet_id, o.code AS outlet_code, o.name AS outlet_name,
         NULL::date AS last_work_date
  FROM core.app_user u
  JOIN core.user_role ur ON ur.user_id = u.id
  JOIN core.outlet o ON o.id = ur.outlet_id
  WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL
    AND o.deleted_at IS NULL

  UNION

  SELECT u.id AS user_id, u.full_name, u.username, u.employee_code, u.status,
         s.outlet_id, o.code AS outlet_code, o.name AS outlet_name,
         max(ws.work_date) AS last_work_date
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  JOIN core.outlet o ON o.id = s.outlet_id
  JOIN core.app_user u ON u.id = ws.user_id
  WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND s.deleted_at IS NULL
    AND o.deleted_at IS NULL
    AND u.deleted_at IS NULL
  GROUP BY u.id, u.full_name, u.username, u.employee_code, u.status, s.outlet_id, o.code, o.name
)
SELECT DISTINCT ON (user_id, outlet_id)
       user_id, full_name, username, employee_code, status,
       outlet_id, outlet_code, outlet_name, last_work_date
FROM staff_scope
WHERE status = 'active'
ORDER BY outlet_id, user_id, last_work_date DESC NULLS LAST, full_name
LIMIT %(limit)s
"""


_STAFF_MANAGEMENT_LIST_SQL = """
SELECT u.id AS user_id,
       u.full_name,
       u.username,
       u.employee_code,
       u.status,
       ur.outlet_id,
       o.code AS outlet_code,
       o.name AS outlet_name,
       string_agg(DISTINCT ur.role_code::text, ', ' ORDER BY ur.role_code::text) AS management_roles
FROM core.app_user u
JOIN core.user_role ur ON ur.user_id = u.id
JOIN core.outlet o ON o.id = ur.outlet_id
WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
  AND ur.role_code IN ('outlet_manager', 'region_manager')
  AND u.deleted_at IS NULL
  AND o.deleted_at IS NULL
  AND u.status = 'active'
GROUP BY u.id, u.full_name, u.username, u.employee_code, u.status, ur.outlet_id, o.code, o.name
ORDER BY o.name, u.full_name
LIMIT %(limit)s
"""


_EMPLOYEE_SEARCH_SQL = """
WITH scoped_employee AS (
  SELECT u.id AS user_id, u.full_name, u.username, u.employee_code
  FROM core.app_user u
  JOIN core.user_role ur ON ur.user_id = u.id
  WHERE ur.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL

  UNION

  SELECT u.id AS user_id, u.full_name, u.username, u.employee_code
  FROM core.payroll_timesheet pt
  JOIN core.app_user u ON u.id = pt.user_id
  WHERE pt.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND u.deleted_at IS NULL

  UNION

  SELECT u.id AS user_id, u.full_name, u.username, u.employee_code
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  JOIN core.app_user u ON u.id = ws.user_id
  WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
    AND s.deleted_at IS NULL
    AND u.deleted_at IS NULL
)
SELECT DISTINCT user_id, full_name, username, employee_code,
       CASE
         WHEN lower(COALESCE(employee_code, '')) = lower(%(term)s) THEN 0
         WHEN lower(username) = lower(%(term)s) THEN 1
         WHEN lower(full_name) = lower(%(term)s) THEN 2
         ELSE 3
       END AS match_rank
FROM scoped_employee
WHERE full_name ILIKE %(pattern)s
   OR username ILIKE %(pattern)s
   OR COALESCE(employee_code, '') ILIKE %(pattern)s
ORDER BY match_rank, full_name, employee_code, username
LIMIT 6
"""


_PAYROLL_TOTAL_SQL = """
SELECT u.id AS user_id,
       u.full_name,
       u.username,
       u.employee_code,
       p.currency_code,
       COALESCE(SUM(p.net_salary), 0) AS total_net_salary,
       COALESCE(SUM(p.base_salary_amount), 0) AS total_base_salary,
       COUNT(*) AS payroll_count,
       MIN(pp.start_date) AS first_period_start,
       MAX(pp.end_date) AS last_period_end,
       COUNT(*) FILTER (WHERE p.status = 'paid') AS paid_count,
       COUNT(*) FILTER (WHERE p.status = 'approved') AS approved_count
FROM core.payroll p
JOIN core.payroll_timesheet pt ON pt.id = p.payroll_timesheet_id
JOIN core.payroll_period pp ON pp.id = pt.payroll_period_id
JOIN core.app_user u ON u.id = pt.user_id
WHERE pt.user_id = %(user_id)s
  AND pt.outlet_id = ANY(%(outlet_ids)s::bigint[])
  AND pp.start_date <= %(to_date)s::date
  AND pp.end_date >= %(from_date)s::date
  AND p.status IN ('approved', 'paid')
GROUP BY u.id, u.full_name, u.username, u.employee_code, p.currency_code
ORDER BY p.currency_code
"""


_EMPLOYEE_TENURE_SQL = """
SELECT u.id AS user_id,
       u.full_name,
       u.username,
       u.employee_code,
       MIN(COALESCE(ec.hire_date, ec.start_date)) AS first_start_date,
       MIN(ec.start_date) AS first_contract_start_date,
       MAX(ec.start_date) AS latest_contract_start_date,
       COUNT(ec.id) FILTER (WHERE ec.deleted_at IS NULL) AS contract_count,
       COUNT(ec.id) FILTER (WHERE ec.deleted_at IS NULL AND ec.status = 'active') AS active_contract_count,
       string_agg(DISTINCT ec.employment_type::text, ', ' ORDER BY ec.employment_type::text)
         FILTER (WHERE ec.deleted_at IS NULL) AS employment_types,
       string_agg(DISTINCT ec.status::text, ', ' ORDER BY ec.status::text)
         FILTER (WHERE ec.deleted_at IS NULL) AS contract_statuses
FROM core.app_user u
LEFT JOIN core.employee_contract ec ON ec.user_id = u.id
WHERE u.id = %(user_id)s
  AND u.deleted_at IS NULL
GROUP BY u.id, u.full_name, u.username, u.employee_code
"""


_ATTENDANCE_TOP_SQL = """
SELECT u.id AS user_id,
       u.full_name,
       u.username,
       u.employee_code,
       COUNT(DISTINCT ws.work_date) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS attended_days,
       COUNT(*) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS attended_shifts,
       ROUND(SUM(
         CASE
           WHEN ws.attendance_status IN ('present', 'late')
            AND ws.actual_start_time IS NOT NULL
            AND ws.actual_end_time IS NOT NULL
             THEN GREATEST(EXTRACT(EPOCH FROM (ws.actual_end_time - ws.actual_start_time)) / 3600.0, 0)
           WHEN ws.attendance_status IN ('present', 'late')
             THEN GREATEST(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0 - (s.break_minutes / 60.0), 0)
           ELSE 0
         END
       )::numeric, 2) AS total_work_hours,
       COUNT(*) FILTER (WHERE ws.attendance_status = 'late') AS late_shifts,
       COUNT(*) FILTER (WHERE ws.attendance_status = 'absent') AS absent_shifts,
       MIN(ws.work_date) AS first_work_date,
       MAX(ws.work_date) AS last_work_date,
       COALESCE(ec.employment_type::text, 'unknown') AS employment_type,
       string_agg(DISTINCT o.code, ', ' ORDER BY o.code) AS outlet_codes,
       string_agg(DISTINCT o.name || ' (' || o.code || ')', ', ' ORDER BY o.name || ' (' || o.code || ')') AS outlet_labels
FROM core.work_shift ws
JOIN core.shift s ON s.id = ws.shift_id
JOIN core.outlet o ON o.id = s.outlet_id
JOIN core.app_user u ON u.id = ws.user_id
LEFT JOIN LATERAL (
  SELECT ec.employment_type
  FROM core.employee_contract ec
  WHERE ec.user_id = u.id
    AND ec.deleted_at IS NULL
    AND ec.start_date <= %(to_date)s::date
    AND (ec.end_date IS NULL OR ec.end_date >= %(from_date)s::date)
  ORDER BY
    CASE WHEN ec.status = 'active' THEN 0 ELSE 1 END,
    ec.start_date DESC,
    ec.created_at DESC
  LIMIT 1
) ec ON TRUE
WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
  AND ws.work_date BETWEEN %(from_date)s::date AND %(to_date)s::date
  AND s.deleted_at IS NULL
  AND o.deleted_at IS NULL
  AND u.deleted_at IS NULL
  AND (%(employment_type)s::text IS NULL OR ec.employment_type::text = %(employment_type)s::text)
GROUP BY u.id, u.full_name, u.username, u.employee_code, ec.employment_type
HAVING COUNT(*) FILTER (WHERE ws.attendance_status IN ('present', 'late')) > 0
ORDER BY total_work_hours DESC, attended_days DESC, attended_shifts DESC, late_shifts ASC, full_name
LIMIT %(limit)s
"""


_EMPLOYEE_WORK_HOURS_SQL = """
SELECT u.id AS user_id,
       u.full_name,
       u.username,
       u.employee_code,
       COUNT(DISTINCT ws.work_date) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS attended_days,
       COUNT(*) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS attended_shifts,
       ROUND(SUM(
         CASE
           WHEN ws.attendance_status IN ('present', 'late')
            AND ws.actual_start_time IS NOT NULL
            AND ws.actual_end_time IS NOT NULL
             THEN GREATEST(EXTRACT(EPOCH FROM (ws.actual_end_time - ws.actual_start_time)) / 3600.0, 0)
           WHEN ws.attendance_status IN ('present', 'late')
             THEN GREATEST(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0 - (s.break_minutes / 60.0), 0)
           ELSE 0
         END
       )::numeric, 2) AS total_work_hours,
       COUNT(*) FILTER (WHERE ws.attendance_status = 'late') AS late_shifts,
       COUNT(*) FILTER (WHERE ws.attendance_status = 'absent') AS absent_shifts,
       MIN(ws.work_date) AS first_work_date,
       MAX(ws.work_date) AS last_work_date,
       COALESCE(ec.employment_type::text, 'unknown') AS employment_type,
       string_agg(DISTINCT o.code, ', ' ORDER BY o.code) AS outlet_codes,
       string_agg(DISTINCT o.name || ' (' || o.code || ')', ', ' ORDER BY o.name || ' (' || o.code || ')') AS outlet_labels
FROM core.work_shift ws
JOIN core.shift s ON s.id = ws.shift_id
JOIN core.outlet o ON o.id = s.outlet_id
JOIN core.app_user u ON u.id = ws.user_id
LEFT JOIN LATERAL (
  SELECT ec.employment_type
  FROM core.employee_contract ec
  WHERE ec.user_id = u.id
    AND ec.deleted_at IS NULL
    AND ec.start_date <= %(to_date)s::date
    AND (ec.end_date IS NULL OR ec.end_date >= %(from_date)s::date)
  ORDER BY
    CASE WHEN ec.status = 'active' THEN 0 ELSE 1 END,
    ec.start_date DESC,
    ec.created_at DESC
  LIMIT 1
) ec ON TRUE
WHERE ws.user_id = %(user_id)s
  AND s.outlet_id = ANY(%(outlet_ids)s::bigint[])
  AND ws.work_date BETWEEN %(from_date)s::date AND %(to_date)s::date
  AND s.deleted_at IS NULL
  AND o.deleted_at IS NULL
  AND u.deleted_at IS NULL
GROUP BY u.id, u.full_name, u.username, u.employee_code, ec.employment_type
"""


_WORK_HOURS_TOTAL_SQL = """
SELECT COUNT(DISTINCT ws.user_id) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS employee_count,
       COUNT(DISTINCT ws.work_date) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS attended_days,
       COUNT(*) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS attended_shifts,
       ROUND(COALESCE(SUM(
         CASE
           WHEN ws.attendance_status IN ('present', 'late')
            AND ws.actual_start_time IS NOT NULL
            AND ws.actual_end_time IS NOT NULL
             THEN GREATEST(EXTRACT(EPOCH FROM (ws.actual_end_time - ws.actual_start_time)) / 3600.0, 0)
           WHEN ws.attendance_status IN ('present', 'late')
             THEN GREATEST(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0 - (s.break_minutes / 60.0), 0)
           ELSE 0
         END
       ), 0)::numeric, 2) AS total_work_hours,
       COUNT(*) FILTER (WHERE ws.attendance_status = 'late') AS late_shifts,
       COUNT(*) FILTER (WHERE ws.attendance_status = 'absent') AS absent_shifts,
       MIN(ws.work_date) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS first_work_date,
       MAX(ws.work_date) FILTER (WHERE ws.attendance_status IN ('present', 'late')) AS last_work_date,
       string_agg(DISTINCT o.code, ', ' ORDER BY o.code) AS outlet_codes,
       string_agg(DISTINCT o.name || ' (' || o.code || ')', ', ' ORDER BY o.name || ' (' || o.code || ')') AS outlet_labels
FROM core.work_shift ws
JOIN core.shift s ON s.id = ws.shift_id
JOIN core.outlet o ON o.id = s.outlet_id
JOIN core.app_user u ON u.id = ws.user_id
WHERE s.outlet_id = ANY(%(outlet_ids)s::bigint[])
  AND ws.work_date BETWEEN %(from_date)s::date AND %(to_date)s::date
  AND s.deleted_at IS NULL
  AND o.deleted_at IS NULL
  AND u.deleted_at IS NULL
"""


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _previous_user_question(state: GraphState) -> str:
    current = (state.get("normalized_question") or state.get("raw_question") or "").strip()
    turns = state.get("conversation_turns") or []
    for turn in reversed(turns):
        if (turn.get("role") or "").strip().lower() != "user":
            continue
        content = (turn.get("content") or "").strip()
        if content and content != current:
            return content
    return ""


def _effective_question(state: GraphState) -> str:
    """Use prior HR ask when the current message is only a clarification answer."""
    if isinstance(state.get("question_frame"), dict):
        framed = question_text(state)
        return framed
    contextual = contextual_effective_question(state)
    current_raw = (state.get("normalized_question") or state.get("raw_question") or "").strip()
    if contextual and contextual != current_raw:
        return contextual
    current = (state.get("normalized_question") or state.get("raw_question") or "").strip()
    previous = _previous_user_question(state)
    if previous and is_time_followup(current):
        return f"{previous} {current}"
    return current


def _context_employee_code_for_name(state: GraphState, employee_name: str) -> str | None:
    name_folded = _fold(employee_name)
    if not name_folded:
        return None
    codes: list[str] = []
    ctx = state.get("conversation_context") or ""
    for line in ctx.splitlines():
        if name_folded not in _fold(line):
            continue
        for match in re.finditer(r"\b[A-Z0-9-]*EMP[A-Z0-9-]*\b", line, flags=re.IGNORECASE):
            code = match.group(0)
            if code not in codes:
                codes.append(code)
    return codes[0] if len(codes) == 1 else None


def _employee_codes_from_context(state: GraphState) -> list[str]:
    codes: list[str] = []
    ctx = state.get("conversation_context") or ""
    for match in re.finditer(r"\b[A-Z0-9-]*EMP[A-Z0-9-]*\b", ctx, flags=re.IGNORECASE):
        code = match.group(0)
        if code not in codes:
            codes.append(code)
    return codes


def _context_employee_reference(state: GraphState, current_question: str) -> str | None:
    codes = _employee_codes_from_context(state)
    if not codes:
        return None

    if _EMPLOYEE_CONTEXT_REFERENCE_RE.search(current_question):
        return codes[0] if len(codes) == 1 else None

    ordinal = _EMPLOYEE_ORDINAL_REFERENCE_RE.search(current_question)
    if ordinal:
        idx = int(ordinal.group("n")) - 1
        if 0 <= idx < len(codes):
            return codes[idx]
    return None


def _is_outlets_missing_staff_question(question: str) -> bool:
    q = _fold(question)
    outlet_phrase = (
        "outlet" in q
        or "cua hang" in q
        or "chi nhanh" in q
        or "co so" in q
    )
    missing_phrase = any(
        t in q
        for t in (
            "thieu nhan",
            "thieu nhan su",
            "khong co nhan vien",
            "khong ai lam",
            "chua co nhan",
            "khong du nhan",
            "trong nhan su",
        )
    )
    if not missing_phrase:
        return False
    if "outlet nao" in q or "outlet nào" in question.lower():
        return True
    return outlet_phrase


def _is_tenure_headcount_question(question: str) -> bool:
    """True when the user asks for a count of employees by tenure (not a single person's tenure)."""
    q = _fold(question)
    tenure_hint = any(
        t in q
        for t in (
            "tham nien",
            "ngay vao lam",
            "ngay vao cong ty",
            "lam viec o cong ty",
            "lam viec tai cong ty",
            "tenure",
            "seniority",
        )
    )
    if not tenure_hint:
        return False
    headcount = any(
        t in q
        for t in (
            "bao nhieu nhan vien",
            "may nhan vien",
            "so luong nhan vien",
            "so nhan vien",
            "co bao nhieu",
            "bao nhieu nguoi",
            "dem nhan vien",
            "count employee",
            "how many employee",
            "headcount",
            "tong so nhan vien",
        )
    )
    if headcount:
        return True
    if "bao nhieu" in q or re.search(r"\bmay\s+nhan\b", q):
        return True
    if "nhan vien" in q and re.search(r"\d+\s*nam\b", q):
        return True
    if (
        re.search(r"\d+\s*nam\b", q)
        and re.search(r"\bnhan\b", q)
        and re.search(r"\b(bao\s*nhieu|may|so|tong|dem|so\s*luong)\b", q)
    ):
        return True
    if re.search(r"(tham\s*nien|tenure).{0,48}(tren|duoi|lon\s*hon|it\s*hon).{0,12}\d+\s*nam", q) and (
        "bao nhieu" in q or "may " in q or re.search(r"\bso\b", q)
    ):
        return True
    return False


def _is_new_contract_list_question(question: str) -> bool:
    """Danh sách nhân viên có hợp đồng (bắt đầu) trong năm — theo core.employee_contract."""
    q = _fold(question)
    raw_l = (question or "").lower()
    if any(
        t in q
        for t in (
            "bao nhieu nhan vien",
            "may nhan vien",
            "co bao nhieu",
            "so luong nhan vien",
            "so nhan vien",
            "dem nhan vien",
            "tong so nhan vien",
            "headcount",
            "how many employee",
        )
    ):
        return False
    if "bao nhieu" in q or re.search(r"\bmay\s+nhan\b", q):
        return False

    has_contract = any(
        t in q
        for t in (
            "ky hop dong",
            "ki hop dong",
            "ky hd",
            "ki hd",
            "hop dong",
            "hopdong",
            "contract",
        )
    ) or ("hợp đồng" in raw_l)
    if not has_contract:
        return False

    year_ok = (
        "nam nay" in q
        or "nam truoc" in q
        or bool(re.search(r"(?:nam|năm)\s*\d{4}\b", q + " " + raw_l))
        or ("năm nay" in raw_l)
        or ("năm trước" in raw_l)
    )
    moi_ok = "moi " in q or re.search(r"\bmoi\s+ky\b", q) or ("mới" in raw_l)
    if not year_ok and not moi_ok:
        return False

    list_ok = any(
        t in q
        for t in (
            "danh sach",
            "liet ke",
            "nhung nhan vien",
            "cac nhan vien",
            "nhan vien nao",
            "list",
            "which employee",
            "show employee",
        )
    ) or ("danh sách" in raw_l or "liệt kê" in raw_l)
    nhan_ok = "nhan vien" in q or "nhân viên" in raw_l
    return list_ok or nhan_ok


def _parse_new_contract_year_bounds(question: str) -> tuple[date, date, int]:
    q = _fold(question)
    raw_l = (question or "").lower()
    today = today_local()
    y = today.year
    if "nam truoc" in q or "năm trước" in raw_l:
        y = today.year - 1
    elif m := re.search(r"(?:nam|năm)\s*(\d{4})\b", f"{q} {raw_l}"):
        y = int(m.group(1))
    elif "nam nay" in q or "năm nay" in raw_l:
        y = today.year
    start = date(y, 1, 1)
    end = date(y, 12, 31)
    return start, end, y


def _format_new_contract_list_answer(rows: list[dict], year: int, limit: int) -> str:
    if not rows:
        return (
            f"Không tìm thấy nhân viên active trong phạm vi được xem có hợp đồng lao động "
            f"bắt đầu trong năm **{year}** (theo `COALESCE(hire_date, start_date)` trên hợp đồng **active**)."
        )

    lines = [
        f"Có **{len(rows)}** dòng nhân viên active có hợp đồng (status active) bắt đầu trong năm **{year}** "
        "(ngày hiệu lực: `COALESCE(hire_date, start_date)`):"
    ]
    for row in rows[: min(20, len(rows))]:
        sd = row.get("contract_start_date")
        lines.append(f"- {_employee_label(row)} - {_outlet_label(row)}; bắt đầu hợp đồng **{sd}**.")
    if len(rows) >= limit:
        lines.append(f"_Đang hiển thị tối đa {limit} dòng theo giới hạn HR query._")
    return "\n".join(lines)


def _is_tenure_list_question(question: str) -> bool:
    """True when the user wants a roster/list of employees filtered by tenure."""
    q = _fold(question)
    tenure_hint = any(
        t in q
        for t in (
            "tham nien",
            "ngay vao lam",
            "ngay vao cong ty",
            "lam viec o cong ty",
            "lam viec tai cong ty",
            "tenure",
            "seniority",
        )
    )
    if not tenure_hint:
        return False
    list_hint = any(
        t in q
        for t in (
            "danh sach",
            "liet ke",
            "nhung nhan vien",
            "cac nhan vien",
            "nhan vien nao",
            "ai ",
            "list",
            "which employee",
        )
    )
    threshold_hint = re.search(r"\d+\s*(thang|nam)\b", q) is not None
    return list_hint and threshold_hint


def _is_employment_type_headcount_question(question: str) -> bool:
    """Đếm nhân viên theo loại hợp đồng (full-time / part-time) trên employee_contract."""
    if _employment_type_filter(question) is None:
        return False
    q = _fold(question)
    contract_hint = any(
        t in q
        for t in (
            "hop dong",
            "contract",
            "loai hop dong",
            "employment",
            "lao dong",
        )
    )
    headcount = any(
        t in q
        for t in (
            "bao nhieu nhan vien",
            "may nhan vien",
            "so luong nhan vien",
            "so nhan vien",
            "co bao nhieu",
            "bao nhieu nguoi",
            "dem nhan vien",
            "headcount",
            "how many employee",
            "tong so nhan vien",
            "so luong",
        )
    )
    if headcount:
        return True
    if "bao nhieu" in q or re.search(r"\bmay\s+nhan\b", q):
        return True
    if re.search(r"\d+\s*nam\b", q) or re.search(r"\b(gio|ca|cham\s*cong)\b", q):
        return False
    if re.search(r"\b(bao\s*nhieu|may|so|tong|dem|so\s*luong)\b", q) and re.search(r"\bnhan\b", q):
        return True
    if contract_hint and re.search(r"\b(bao\s*nhieu|may|so|tong|dem)\b", q):
        return True
    if re.search(r"\bso\b", q) and "nhan" in q:
        return True
    return False


def _format_employment_type_headcount_answer(
    employee_count: int,
    not_this_type: int,
    employment_type: str,
) -> str:
    label = "full-time" if employment_type == "full_time" else "part-time"
    base = (
        f"Có **{employee_count}** nhân viên active trong phạm vi được xem có **hợp đồng lao động đang active loại {label}** "
        "(nguồn: hợp đồng nhân sự trong CSDL)."
    )
    if not_this_type > 0:
        base += (
            f" Còn **{not_this_type}** người active trong phạm vi **không** có hợp đồng active loại {label} "
            "(ví dụ loại khác, hoặc chưa có hợp đồng active)."
        )
    return base


def _employee_term_is_tenure_aggregate_noise(term: str) -> bool:
    """True when regex wrongly captured a tenure threshold as an employee 'name'."""
    f = _fold(term.strip())
    if not f:
        return False
    if re.match(r"^(tham\s*nien|ngay\s*vao\s*lam|tenure)(\s+|$)", f):
        return True
    if re.search(r"tham\s*nien\s+(tren|duoi|lon\s*hon|it\s*hon|tu\s*\d+)", f):
        return True
    if re.match(r"^(tren|duoi|lon\s*hon|it\s*hon)\s*\d+", f):
        return True
    return False


def _parse_tenure_headcount_params(question: str) -> tuple[int, bool]:
    """Years threshold and whether we want tenure >= N years (True) or < N years (False)."""
    q = _fold(question)
    m_under = re.search(r"(?:duoi|it\s*hon|nho\s*hon|chua\s*du)\s*(\d+)\s*nam\b", q)
    if m_under:
        return max(1, min(60, int(m_under.group(1)))), False
    m_num = re.search(r"(\d+)\s*nam\b", q)
    years = max(1, min(60, int(m_num.group(1)))) if m_num else 1
    return years, True


def _parse_tenure_list_params(question: str) -> tuple[int, str, bool]:
    """Months threshold, display label, and whether tenure >= threshold."""
    q = _fold(question)
    at_least = not re.search(r"(?:duoi|it\s*hon|nho\s*hon|chua\s*du)\s*\d+\s*(?:thang|nam)\b", q)
    m_month = re.search(r"(\d+)\s*thang\b", q)
    if m_month:
        months = max(1, min(600, int(m_month.group(1))))
        return months, f"{months} tháng", at_least
    m_year = re.search(r"(\d+)\s*nam\b", q)
    years = max(1, min(60, int(m_year.group(1)))) if m_year else 1
    return years * 12, f"{years} năm", at_least


def _format_tenure_headcount_answer(
    employee_count: int,
    without_contract: int,
    years: int,
    at_least: bool,
) -> str:
    cmp_vi = f"từ {years} năm trở lên" if at_least else f"dưới {years} năm"
    base = (
        f"Có **{employee_count}** nhân viên active trong phạm vi được xem có thâm niên {cmp_vi} "
        f"(tính theo ngày vào làm sớm nhất trên hợp đồng lao động)."
    )
    if without_contract > 0:
        base += (
            f" Ngoài ra có **{without_contract}** người trong phạm vi nhưng chưa có "
            "ngày vào làm trên hợp đồng nên không đưa vào đếm này."
        )
    return base


def _format_tenure_list_answer(rows: list[dict], threshold_label: str, at_least: bool, limit: int) -> str:
    cmp_vi = f"trên/từ {threshold_label}" if at_least else f"dưới {threshold_label}"
    if not rows:
        return (
            f"Không tìm thấy nhân viên active trong phạm vi được xem có thâm niên {cmp_vi} "
            "(tính theo ngày vào làm sớm nhất trên hợp đồng lao động)."
        )

    lines = [
        f"Có **{len(rows)}** dòng nhân viên active có thâm niên {cmp_vi} "
        "(tính theo ngày vào làm sớm nhất trên hợp đồng lao động):"
    ]
    for row in rows[: min(20, len(rows))]:
        first_start = row.get("first_start_date")
        tenure_days = int(row.get("tenure_days") or 0)
        tenure_text = _human_tenure(_as_date(first_start) or today_local(), today_local())
        lines.append(
            f"- {_employee_label(row)} - {_outlet_label(row)}; vào làm {first_start}; "
            f"thâm niên {tenure_text} ({tenure_days} ngày)."
        )
    if len(rows) >= limit:
        lines.append(f"_Đang hiển thị tối đa {limit} dòng theo giới hạn HR query._")
    return "\n".join(lines)


def _format_outlets_missing_staff_answer(rows: list[dict]) -> str:
    if not rows:
        return (
            "Không có outlet nào trong phạm vi bạn xem bị **0 nhân sự active** "
            "(theo gán outlet trên user_role hoặc có ca làm trong dữ liệu)."
        )
    lines = [
        f"Có **{len(rows)}** outlet trong phạm vi **không có nhân sự active** "
        "(0 người sau khi hợp user_role + lịch ca làm):"
    ]
    for row in rows[:30]:
        lines.append(
            f"- {_outlet_label(row)}"
        )
    if len(rows) > 30:
        lines.append(f"- … và {len(rows) - 30} outlet khác.")
    return "\n".join(lines)


def _is_management_staff_question(question: str) -> bool:
    """True when the user wants outlet/region managers, not the full staff roster."""
    q = _fold(question)
    raw_l = (question or "").lower()
    if not q.strip():
        return False
    # Counting managers is not the detailed list lane
    if ("bao nhieu" in q or "may " in q) and "quan ly" in q:
        return False
    if "bao nhieu nhan" in q or "headcount" in q:
        return False
    phrase_hits = (
        "nhan su quan ly",
        "doi ngu quan ly",
        "quan ly cua hang",
        "quan ly outlet",
        "truong cua hang",
        "truong outlet",
        "giam sat cua hang",
        "outlet manager",
        "store manager",
        "management staff",
    )
    if any(p in q for p in phrase_hits):
        return True
    if "quan ly" in q or "quản lý" in raw_l:
        if any(x in q for x in ("cua hang", "outlet", "chi nhanh")):
            return True
        if "cửa hàng" in raw_l or "chi nhánh" in raw_l:
            return True
    return False


def _question_kind(question: str) -> str:
    q = _fold(question)
    if (
        "nhieu gio nhat" in q
        or "gio nhieu nhat" in q
        or "most hours" in q
        or "highest hours" in q
    ):
        return "attendance_top"
    if re.search(r"\b(gio\s*lam|gio\s*cong|working\s*hours?|work\s*hours?)\b", q):
        return "employee_work_hours"
    if any(
        token in q
        for token in (
            "bao nhieu gio",
            "tong gio",
            "tong so gio",
            "so gio",
            "may gio",
            "lam bao nhieu",
            "lam duoc bao nhieu",
            "work hours",
            "worked hours",
            "total hours",
        )
    ):
        return "employee_work_hours"
    if _is_outlets_missing_staff_question(question):
        return "outlets_missing_staff"
    if _is_tenure_list_question(question):
        return "tenure_list"
    if _is_new_contract_list_question(question):
        return "new_contract_list"
    if _is_tenure_headcount_question(question):
        return "tenure_headcount"
    if _is_employment_type_headcount_question(question):
        return "employment_type_headcount"
    if any(
        token in q
        for token in (
            "bao lau",
            "tham nien",
            "ngay vao lam",
            "ngay vao cong ty",
            "lam viec o cong ty",
            "lam viec tai cong ty",
            "hire date",
            "start date",
            "tenure",
        )
    ):
        return "employee_tenure"
    if any(token in q for token in ("luong", "payroll", "salary", "thu nhap")):
        return "payroll_total"
    if (
        "di lam nhieu nhat" in q
        or "lam nhieu nhat" in q
        or "cham cong nhieu nhat" in q
        or "ca nhieu nhat" in q
        or "work days" in q
        or "attendance" in q
    ):
        return "attendance_top"
    if _is_management_staff_question(question):
        return "staff_management"
    return "staff_list"


def _employment_type_filter(question: str) -> str | None:
    q = _fold(question)
    if any(token in q for token in ("parttime", "part-time", "part time", "ban thoi gian", "part_time")):
        return "part_time"
    if any(token in q for token in ("fulltime", "full-time", "full time", "toan thoi gian", "full_time")):
        return "full_time"
    return None


def _has_explicit_time(question: str) -> bool:
    return has_time_expression(question)


def _time_range(state: GraphState) -> tuple[str, str]:
    question = _effective_question(state)
    today = today_local()

    tr = state.get("time_range") or {}
    if tr.get("from_date") and tr.get("to_date"):
        return str(tr["from_date"]), str(tr["to_date"])

    parsed = parse_time_range(question, today=today)
    return parsed["from_date"], parsed["to_date"]


def _extract_employee_term(state: GraphState) -> str | None:
    current_question = (state.get("normalized_question") or state.get("raw_question") or "").strip()
    context_reference = _context_employee_reference(state, current_question)
    if context_reference:
        return context_reference

    if state.get("contextualization_source") == "rule_employee_followup":
        followup_value = current_question.strip(" ?.,;:")
        if followup_value:
            return followup_value

    question = _effective_question(state)
    code_match = re.search(r"\b[A-Z0-9-]*EMP[A-Z0-9-]*\b", question, flags=re.IGNORECASE)
    if code_match:
        return code_match.group(0)
    username_match = re.search(r"\busername\s+(?P<username>[A-Za-z0-9_.-]{2,80})\b", question, flags=re.IGNORECASE)
    if username_match:
        return username_match.group("username")

    raw = state.get("raw_entities") or {}
    employees = raw.get("employee_names") if isinstance(raw, dict) else None
    if isinstance(employees, list):
        for item in employees:
            value = _clean_employee_term(str(item))
            if value:
                entity_code_match = re.search(r"\b[A-Z0-9-]*EMP[A-Z0-9-]*\b", value, flags=re.IGNORECASE)
                if entity_code_match:
                    return entity_code_match.group(0)
                if _is_employee_term_noise(value):
                    continue
                return _context_employee_code_for_name(state, value) or value

    patterns = [
        r"(?:nhân\s*viên|nhan\s*vien|employee)\s+(?:tên\s+|ten\s+|mã\s+|ma\s+)?(?P<name>.+?)\s+(?:đã|da|nhận|nhan|được|duoc|bao\s+nhiêu|bao\s+nhieu|trong|năm|nam|tháng|thang|$)",
        r"(?P<name>[A-Za-zÀ-ỹ0-9_. -]{2,80})\s+(?:đã|da)\s+(?:nhận|nhan|được|duoc).*(?:lương|luong|salary|payroll)",
        r"(?:lương|luong|salary|payroll)\s+(?:của|cua|cho)?\s*(?P<name>.+?)\s+(?:đã|da|nhận|nhan|trong|năm|nam|tháng|thang|$)",
        r"(?P<name>[A-Za-zÀ-ỹ0-9_. -]{2,80})\s+(?:đã|da)?\s*(?:làm\s*việc|lam\s*viec|công\s*tác|cong\s*tac).*(?:bao\s*lâu|bao\s*lau|thâm\s*niên|tham\s*nien)",
        r"(?:thâm\s*niên|tham\s*nien|ngày\s*vào\s*làm|ngay\s*vao\s*lam|tenure)\s+(?:của|cua|cho)?\s*(?P<name>.+?)\s*(?:là|la|bao\s*lâu|bao\s*lau|$)",
        r"(?P<name>[A-Za-zÀ-ỹ0-9_. -]{2,120})\s+(?:tháng|thang|tuần|tuan|năm|nam|hôm|hom|từ|tu|đến|den)?.*(?:bao\s*nhiêu\s*giờ|bao\s*nhieu\s*gio|tổng\s*giờ|tong\s*gio|số\s*giờ|so\s*gio|work\s*hours|total\s*hours)",
        r"(?:giờ\s*làm|gio\s*lam|giờ\s*công|gio\s*cong|work\s*hours|working\s*hours)\s+(?:của|cua|cho)?\s*(?P<name>.+?)\s*(?:tháng|thang|tuần|tuan|năm|nam|hôm|hom|từ|tu|đến|den|là|la|$)",
    ]
    for pattern in patterns:
        m = re.search(pattern, question, flags=re.IGNORECASE)
        if not m:
            continue
        value = _clean_employee_term(m.group("name"))
        if not _is_employee_term_noise(value):
            value_code_match = re.search(r"\b[A-Z0-9-]*EMP[A-Z0-9-]*\b", value, flags=re.IGNORECASE)
            if value_code_match:
                return value_code_match.group(0)
            return _context_employee_code_for_name(state, value) or value
    for code_match in re.finditer(r"\b[A-Z]{2,}(?:-[A-Z0-9]+){1,}\b", question):
        candidate = code_match.group(0)
        if not _is_outlet_like_code(candidate):
            return candidate
    return None


def _clean_employee_term(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip(" -?.,;:")
    cleaned = re.sub(r"\s*-\s*username\s+\S+.*$", "", cleaned, flags=re.IGNORECASE).strip(" -?.,;:")
    cleaned = re.sub(r"\s+username\s+\S+.*$", "", cleaned, flags=re.IGNORECASE).strip(" -?.,;:")
    cleaned = _EMPLOYEE_TERM_TRAILING_CONTEXT_RE.sub("", cleaned).strip(" ?.,;:")
    return cleaned


def _outlet_terms(state: GraphState) -> list[str]:
    raw = state.get("raw_entities") or {}
    terms: list[str] = []
    if isinstance(raw, dict):
        for item in raw.get("outlet_names", []) or []:
            value = str(item).strip()
            if value:
                terms.append(value)
    question = _effective_question(state)
    for match in _OUTLET_CODE_RE.findall(question):
        if match not in terms:
            terms.append(match)
    for match in _OUTLET_PHRASE_RE.findall(question):
        value = f"Outlet {match}"
        if value not in terms:
            terms.append(value)
    return terms


def _resolve_extra_outlet_ids(state: GraphState) -> list[int]:
    ids: list[int] = []
    for term in _outlet_terms(state):
        try:
            rows = pg.search_outlets(term, limit=3)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Postgres outlet fallback failed: %s", exc)
            rows = []
        for row in rows:
            outlet_id = int(row["outlet_id"])
            if outlet_id not in ids:
                ids.append(outlet_id)
    return ids


def _allowed_outlets(
    state: GraphState,
    all_outlet_ids_provider: Callable[[], list[int]] | None,
) -> tuple[list[int] | None, str | None]:
    auth = state["auth"]
    resolved = state.get("resolved_entities") or {}
    requested = list(resolved.get("outlet_ids") or [])
    for outlet_id in _resolve_extra_outlet_ids(state):
        if outlet_id not in requested:
            requested.append(outlet_id)

    if _outlet_terms(state) and not requested:
        return None, "Không tìm thấy outlet phù hợp trong phạm vi quyền của bạn. Bạn kiểm tra lại mã/tên outlet giúp tôi."

    try:
        allowed = compute_allowed_outlets(
            auth_outlet_ids=auth.outlet_ids,
            requested_outlet_ids=requested or None,
            roles=auth.roles,
            all_outlet_ids_provider=all_outlet_ids_provider,
        )
    except ValueError:
        return None, "Bạn không có quyền xem dữ liệu HR cho outlet đã yêu cầu."

    return allowed, None


def _has_any_role(auth: AuthContext, allowed_roles: frozenset[str]) -> bool:
    return bool(auth.roles & allowed_roles)


def _money(value: object, currency: object) -> str:
    amount = Decimal(str(value or "0"))
    code = str(currency or "VND")
    if code.upper() == "VND":
        return f"{amount.quantize(Decimal('1')):,.0f} VNĐ"
    return f"{amount:,.2f} {code}"


def _employee_label(row: dict) -> str:
    code = row.get("employee_code")
    suffix = f" ({code})" if code else ""
    return f"{row.get('full_name') or row.get('username')}{suffix}"


def _outlet_label(row: dict) -> str:
    name = row.get("outlet_name")
    code = row.get("outlet_code") or row.get("outlet_id")
    if name and code:
        return f"{name} ({code})"
    return str(name or code or "")


def _employment_label(value: object) -> str:
    text = str(value or "").strip()
    if text == "part_time":
        return "part-time"
    if text == "full_time":
        return "full-time"
    return text.replace("_", "-")


def _is_outlet_like_code(value: str) -> bool:
    text = value.strip()
    return bool(_OUTLET_CODE_RE.fullmatch(text)) or "-OUT-" in text.upper()


def _is_employee_term_noise(value: str) -> bool:
    folded = _fold(value).strip()
    if folded in {"nay", "do", "kia", "nao", "bao nhieu", "trong"}:
        return True
    if has_time_expression(value):
        return True
    return folded.startswith("outlet ") or _is_outlet_like_code(value)


def _search_employees(outlet_ids: list[int], employee_term: str) -> list[dict]:
    """Search scoped employees with an accent-insensitive fallback.

    Seed HR names in local/dev data are mostly ASCII, while users often ask with
    Vietnamese diacritics. Keep the SQL static and scoped, but retry with the
    folded term so "Hà Xuân Vân" can match "Ha Xuan Van".
    """

    found: list[dict] = []
    seen: set[int] = set()

    def run(term: str) -> None:
        rows = pg.execute_readonly(
            _EMPLOYEE_SEARCH_SQL,
            {"outlet_ids": outlet_ids, "term": term, "pattern": f"%{term}%"},
        )
        for row in rows:
            user_id = int(row["user_id"])
            if user_id in seen:
                continue
            seen.add(user_id)
            found.append(row)

    term = employee_term.strip()
    if not term:
        return []

    run(term)
    if found:
        return found[:6]

    folded = _fold(term).strip()
    if folded and folded != term and not re.search(r"\b[A-Z0-9-]*EMP[A-Z0-9-]*\b", term, flags=re.IGNORECASE):
        run(folded)
    return found[:6]


def _finish(
    state: GraphState,
    *,
    answer: str,
    kind: str = "answer",
    rows: list[dict] | None = None,
    template_key: str | None = None,
    hints: list[str] | None = None,
) -> GraphState:
    state["template_key"] = template_key
    if kind == "answer" and template_key in _TIME_BOUND_HR_TEMPLATES:
        answer = _append_hr_coverage_footer(state, answer)
    state["answer_text"] = answer
    state["response_kind"] = kind
    state["raw_result"] = rows or []
    state["template_confidence"] = 1.0 if kind == "answer" else 0.0
    state["citations"] = [{"source": "postgres_core_hr", "row_count": len(rows or [])}]
    state["skip_answer_formatter_llm"] = True
    state["response_hints"] = hints or []
    return state


def _parse_date(value: object) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _append_hr_coverage_footer(state: GraphState, answer: str) -> str:
    ctx = ensure_data_source_context(state) or {}
    window = coverage_window_for_template(state)
    max_date = _parse_date(window.get("max_date"))
    min_date = _parse_date(window.get("min_date"))
    tr = state.get("time_range") or {}
    requested_from = _parse_date(tr.get("from_date"))
    requested_to = _parse_date(tr.get("to_date"))

    footer: list[str] = []
    dataset = str(ctx.get("primary_dataset") or window.get("dataset") or "dữ liệu HR").strip()
    time_column = str(ctx.get("time_column") or window.get("time_column") or "").strip()
    semantics = str(ctx.get("time_semantics") or window.get("time_semantics") or "").strip()
    if max_date and min_date and time_column:
        sem = f" ({semantics})" if semantics else ""
        footer.append(
            f"_Nguồn thời gian: {time_column} trong {dataset}{sem}; dữ liệu hiện có {min_date.isoformat()} đến {max_date.isoformat()}._"
        )
    elif max_date:
        footer.append(f"_Nguồn: dữ liệu HR cập nhật đến {max_date.isoformat()}._")
    caveats: list[str] = []
    if requested_to and max_date and requested_to > max_date:
        caveats.append(
            f"bạn hỏi đến {requested_to.isoformat()}, nhưng dữ liệu HR hiện chỉ cập nhật đến {max_date.isoformat()}"
        )
    if requested_from and min_date and requested_from < min_date:
        caveats.append(f"dữ liệu HR hiện bắt đầu từ {min_date.isoformat()}")
    if caveats:
        footer.append("_Lưu ý: " + "; ".join(caveats) + "._")
    if requested_from and requested_to:
        footer.append(f"_Phạm vi: {requested_from.isoformat()} đến {requested_to.isoformat()}._")
    if not footer:
        return answer
    return answer.rstrip() + "\n" + "\n".join(footer)


def _format_management_staff_answer(rows: list[dict], outlet_ids: list[int], limit: int) -> str:
    if not rows:
        return (
            "Không có nhân sự nào được gán **role quản lý** (`outlet_manager` hoặc `region_manager`) "
            "tại các outlet trong phạm vi bạn xem (theo bảng `core.user_role`)."
        )

    shown = rows[: min(10, len(rows))]
    scope = ", ".join(sorted({_outlet_label(r) for r in rows if r.get("outlet_id")}))
    lines = [
        f"Có **{len(rows)}** dòng nhân sự quản lý (active, role outlet_manager/region_manager) "
        f"trong phạm vi {scope or outlet_ids}:"
    ]
    for row in shown:
        outlet = _outlet_label(row)
        roles = str(row.get("management_roles") or "").strip()
        role_text = f" — vai trò: {roles}" if roles else ""
        lines.append(f"- {_employee_label(row)} - {outlet}{role_text}")
    if len(rows) >= limit:
        lines.append(f"_Đang hiển thị tối đa {limit} dòng theo giới hạn HR query._")
    return "\n".join(lines)


def _format_staff_answer(rows: list[dict], outlet_ids: list[int], limit: int) -> str:
    if not rows:
        return "Không tìm thấy nhân viên active trong phạm vi outlet bạn được phép xem."

    shown = rows[: min(10, len(rows))]
    scope = ", ".join(sorted({_outlet_label(r) for r in rows if r.get("outlet_id")}))
    lines = [f"Có {len(rows)} nhân viên active trong phạm vi {scope or outlet_ids}:"]
    for row in shown:
        outlet = _outlet_label(row)
        last = row.get("last_work_date")
        last_text = f", ca gần nhất {last}" if last else ""
        lines.append(f"- {_employee_label(row)} - {outlet}{last_text}")
    if len(rows) >= limit:
        lines.append(f"_Đang hiển thị tối đa {limit} dòng theo giới hạn HR query._")
    return "\n".join(lines)


def _date_text(value: object) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "").strip()


def _period_from_work_rows(rows: list[dict], from_date: str, to_date: str) -> str:
    first_values = [_date_text(row.get("first_work_date")) for row in rows if isinstance(row, dict) and row.get("first_work_date")]
    last_values = [_date_text(row.get("last_work_date")) for row in rows if isinstance(row, dict) and row.get("last_work_date")]
    if first_values and last_values:
        first = min(first_values)
        last = max(last_values)
        return first if first == last else f"{first} đến {last}"
    return from_date if from_date == to_date else f"{from_date} đến {to_date}"


def _format_attendance_answer(
    rows: list[dict],
    from_date: str,
    to_date: str,
    employment_type_filter: str | None = None,
) -> str:
    if not rows:
        return f"Không có ca chấm công được tính giờ trong khoảng {from_date} đến {to_date}."

    top = rows[0]
    group = ""
    if employment_type_filter == "part_time":
        group = " part-time"
    elif employment_type_filter == "full_time":
        group = " full-time"
    period = _period_from_work_rows(rows, from_date, to_date)
    lines = [
        f"Trong khoảng {period}, nhân viên{group} có tổng giờ làm nhiều nhất là "
        f"{_employee_label(top)} với {top.get('total_work_hours')} giờ, "
        f"{top.get('attended_days')} ngày / {top.get('attended_shifts')} ca được tính giờ."
    ]
    for idx, row in enumerate(rows[:5], start=1):
        emp_type = _employment_label(row.get("employment_type"))
        emp_suffix = f", {emp_type}" if emp_type and emp_type != "unknown" else ""
        lines.append(
            f"{idx}. {_employee_label(row)} - {row.get('total_work_hours')} giờ, "
            f"{row.get('attended_days')} ngày, {row.get('attended_shifts')} ca, "
            f"đi trễ {row.get('late_shifts')} ca{emp_suffix}, "
            f"outlet {row.get('outlet_labels') or row.get('outlet_codes')}"
        )
    return "\n".join(lines)


def _format_hours(value: object) -> str:
    hours = Decimal(str(value or "0")).quantize(Decimal("0.01"))
    return f"{hours:,.2f}"


def _format_employee_work_hours_answer(employee: dict, rows: list[dict], from_date: str, to_date: str) -> str:
    row = rows[0] if rows else {}
    total_hours = Decimal(str(row.get("total_work_hours") or "0"))
    label = _employee_label(row or employee)
    if not rows or total_hours <= 0:
        return (
            f"Không có ca được tính giờ cho {label} "
            f"trong khoảng {from_date} đến {to_date} thuộc phạm vi outlet của bạn."
        )

    attended_days = int(row.get("attended_days") or 0)
    attended_shifts = int(row.get("attended_shifts") or 0)
    late_shifts = int(row.get("late_shifts") or 0)
    absent_shifts = int(row.get("absent_shifts") or 0)
    first_work = row.get("first_work_date")
    last_work = row.get("last_work_date")
    outlet_text = row.get("outlet_labels") or row.get("outlet_codes") or "outlet trong phạm vi quyền"
    actual_range = f"Dữ liệu ca thực tế ghi nhận từ {first_work} đến {last_work}" if first_work and last_work else "Dữ liệu ca thực tế đã được lọc theo kỳ hỏi"
    period = _period_from_work_rows(rows, from_date, to_date)

    return (
        f"{label} đã làm {_format_hours(total_hours)} giờ trong khoảng {period}.\n"
        f"Căn cứ: {attended_days} ngày / {attended_shifts} ca được tính giờ; "
        f"đi trễ {late_shifts} ca, vắng {absent_shifts} ca.\n"
        f"{actual_range}; outlet {outlet_text}."
    )


def _format_work_hours_total_answer(rows: list[dict], outlet_ids: list[int], from_date: str, to_date: str) -> str:
    row = rows[0] if rows else {}
    total_hours = Decimal(str(row.get("total_work_hours") or "0"))
    if not rows or total_hours <= 0:
        return (
            f"Không có ca được tính giờ trong khoảng {from_date} đến {to_date} "
            f"thuộc phạm vi outlet {outlet_ids}."
        )

    employee_count = int(row.get("employee_count") or 0)
    attended_days = int(row.get("attended_days") or 0)
    attended_shifts = int(row.get("attended_shifts") or 0)
    late_shifts = int(row.get("late_shifts") or 0)
    absent_shifts = int(row.get("absent_shifts") or 0)
    first_work = row.get("first_work_date")
    last_work = row.get("last_work_date")
    outlet_text = row.get("outlet_labels") or row.get("outlet_codes") or f"outlet {outlet_ids}"
    actual_range = f"Dữ liệu ca thực tế ghi nhận từ {first_work} đến {last_work}" if first_work and last_work else "Dữ liệu ca thực tế đã được lọc theo kỳ hỏi"
    period = _period_from_work_rows(rows, from_date, to_date)

    return (
        f"Tổng giờ làm trong khoảng {period} là {_format_hours(total_hours)} giờ.\n"
        f"Căn cứ: {employee_count} nhân viên, {attended_days} ngày / {attended_shifts} ca được tính giờ; "
        f"đi trễ {late_shifts} ca, vắng {absent_shifts} ca.\n"
        f"{actual_range}; outlet {outlet_text}."
    )


def _format_payroll_answer(employee: dict, rows: list[dict], from_date: str, to_date: str) -> str:
    if not rows:
        return (
            f"Không có kỳ lương đã duyệt hoặc đã thanh toán cho {_employee_label(employee)} "
            f"trong khoảng {from_date} đến {to_date} thuộc phạm vi outlet của bạn."
        )

    total = sum(Decimal(str(r.get("total_net_salary") or "0")) for r in rows)
    currency = rows[0].get("currency_code") if len(rows) == 1 else "mixed"
    periods = sum(int(r.get("payroll_count") or 0) for r in rows)
    paid = sum(int(r.get("paid_count") or 0) for r in rows)
    approved = sum(int(r.get("approved_count") or 0) for r in rows)
    if len(rows) == 1:
        total_text = _money(total, currency)
    else:
        total_text = " + ".join(_money(r.get("total_net_salary"), r.get("currency_code")) for r in rows)
    first = min(str(r.get("first_period_start")) for r in rows if r.get("first_period_start"))
    last = max(str(r.get("last_period_end")) for r in rows if r.get("last_period_end"))
    return (
        f"{_employee_label(employee)} có tổng lương ròng ghi nhận {total_text} "
        f"trong các kỳ payroll giao với {from_date} đến {to_date}.\n"
        f"Phạm vi kỳ thực tế: {first} đến {last}; {periods} kỳ payroll "
        f"({paid} đã thanh toán, {approved} đã duyệt)."
    )


def _add_months(d: date, months: int) -> date:
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    days_in_month = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return date(year, month, min(d.day, days_in_month[month - 1]))


def _human_tenure(start: date, end: date) -> str:
    if start > end:
        return "0 ngày"
    years = end.year - start.year
    try:
        anniversary = start.replace(year=start.year + years)
    except ValueError:
        anniversary = date(start.year + years, 2, 28)
    if anniversary > end:
        years -= 1
        try:
            anniversary = start.replace(year=start.year + years)
        except ValueError:
            anniversary = date(start.year + years, 2, 28)

    months = (end.year - anniversary.year) * 12 + (end.month - anniversary.month)
    month_mark = _add_months(anniversary, months)
    if month_mark > end:
        months -= 1
        month_mark = _add_months(anniversary, months)
    days = (end - month_mark).days

    parts: list[str] = []
    if years:
        parts.append(f"{years} năm")
    if months:
        parts.append(f"{months} tháng")
    if days or not parts:
        parts.append(f"{days} ngày")
    return " ".join(parts)


def _as_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if value:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None
    return None


def _format_tenure_answer(employee: dict, rows: list[dict], today: date) -> str:
    row = rows[0] if rows else {}
    start = _as_date(row.get("first_start_date"))
    if not start:
        return f"Chưa có thông tin ngày vào làm/hợp đồng cho {_employee_label(employee)} trong dữ liệu HR."

    tenure = _human_tenure(start, today)
    active_count = int(row.get("active_contract_count") or 0)
    total_contracts = int(row.get("contract_count") or 0)
    emp_types = str(row.get("employment_types") or "không rõ")
    statuses = str(row.get("contract_statuses") or "không rõ")
    latest = row.get("latest_contract_start_date")
    return (
        f"{_employee_label(employee)} bắt đầu làm việc từ {start.isoformat()}, "
        f"tính đến {today.isoformat()} là {tenure}.\n"
        f"Hợp đồng ghi nhận: {total_contracts} tổng, {active_count} active; loại: {emp_types}; trạng thái: {statuses}."
        + (f"\nHợp đồng gần nhất bắt đầu {latest}." if latest else "")
    )


def make_hr_query(all_outlet_ids_provider: Callable[[], list[int]] | None = None):
    def hr_query(state: GraphState) -> GraphState:
        s = get_settings()
        question = _effective_question(state)
        state.setdefault("trace", []).append({"node": "hr_query", "enabled": s.hr_query_enabled})

        if not s.hr_query_enabled:
            return _finish(
                state,
                answer="AI Analyst hiện chưa bật truy vấn HR chi tiết.",
                kind="unsupported",
                template_key=None,
            )

        kind = _question_kind(question)
        state["hr_query_kind"] = kind
        auth = state["auth"]

        required_roles = {
            "payroll_total": _PAYROLL_ROLES,
            "attendance_top": _ATTENDANCE_ROLES,
            "employee_work_hours": _EMPLOYEE_WORK_HOURS_ROLES,
            "employee_tenure": _TENURE_ROLES,
            "tenure_headcount": _TENURE_ROLES,
            "tenure_list": _TENURE_ROLES,
            "new_contract_list": _TENURE_ROLES,
            "employment_type_headcount": _STAFF_ROLES,
            "outlets_missing_staff": _STAFF_ROLES,
            "staff_list": _STAFF_ROLES,
            "staff_management": _STAFF_ROLES,
        }[kind]
        if not _has_any_role(auth, required_roles):
            return _finish(
                state,
                answer="Bạn không có quyền xem loại dữ liệu HR này. Vui lòng dùng tài khoản có quyền HR/finance phù hợp.",
                kind="unsupported",
                template_key=f"HR_{kind}",
            )

        allowed_outlets, scope_error = _allowed_outlets(state, all_outlet_ids_provider)
        if scope_error:
            return _finish(
                state,
                answer=scope_error,
                kind="clarification",
                template_key=f"HR_{kind}",
                hints=["outlet"],
            )
        assert allowed_outlets is not None
        state["allowed_outlet_ids"] = allowed_outlets

        limit = max(1, min(int(s.hr_query_max_rows), 100))
        from_date, to_date = _time_range(state)

        try:
            if kind == "outlets_missing_staff":
                rows = pg.execute_readonly(_OUTLETS_MISSING_STAFF_SQL, {"outlet_ids": allowed_outlets})
                return _finish(
                    state,
                    answer=_format_outlets_missing_staff_answer(rows),
                    rows=rows,
                    template_key="HR_outlets_missing_staff",
                )

            if kind == "tenure_headcount":
                years, at_least = _parse_tenure_headcount_params(question)
                agg_rows = pg.execute_readonly(
                    _TENURE_HEADCOUNT_SQL,
                    {"outlet_ids": allowed_outlets, "years": years, "at_least": at_least},
                )
                r0 = agg_rows[0] if agg_rows else {}
                return _finish(
                    state,
                    answer=_format_tenure_headcount_answer(
                        int(r0.get("employee_count") or 0),
                        int(r0.get("without_contract_date_count") or 0),
                        years,
                        at_least,
                    ),
                    rows=agg_rows,
                    template_key="HR_tenure_headcount",
                )

            if kind == "tenure_list":
                months, threshold_label, at_least = _parse_tenure_list_params(question)
                rows = pg.execute_readonly(
                    _TENURE_LIST_SQL,
                    {"outlet_ids": allowed_outlets, "months": months, "at_least": at_least, "limit": limit},
                )
                return _finish(
                    state,
                    answer=_format_tenure_list_answer(rows, threshold_label, at_least, limit),
                    rows=rows,
                    template_key="HR_tenure_list",
                )

            if kind == "new_contract_list":
                y_start, y_end, y_num = _parse_new_contract_year_bounds(question)
                rows = pg.execute_readonly(
                    _NEW_CONTRACTS_LIST_SQL,
                    {
                        "outlet_ids": allowed_outlets,
                        "year_start": y_start.isoformat(),
                        "year_end": y_end.isoformat(),
                        "limit": limit,
                    },
                )
                return _finish(
                    state,
                    answer=_format_new_contract_list_answer(rows, y_num, limit),
                    rows=rows,
                    template_key="HR_new_contracts_list",
                )

            if kind == "employment_type_headcount":
                et = _employment_type_filter(question)
                if et is None:
                    return _finish(
                        state,
                        answer="Bạn muốn đếm nhân viên **full-time** hay **part-time**?",
                        kind="clarification",
                        template_key="HR_employment_type_headcount",
                        hints=["employment_type"],
                    )
                agg_rows = pg.execute_readonly(
                    _EMPLOYMENT_TYPE_HEADCOUNT_SQL,
                    {"outlet_ids": allowed_outlets, "employment_type": et},
                )
                r0 = agg_rows[0] if agg_rows else {}
                return _finish(
                    state,
                    answer=_format_employment_type_headcount_answer(
                        int(r0.get("employee_count") or 0),
                        int(r0.get("not_this_type_count") or 0),
                        et,
                    ),
                    rows=agg_rows,
                    template_key="HR_employment_type_headcount",
                )

            if kind == "staff_management":
                rows = pg.execute_readonly(
                    _STAFF_MANAGEMENT_LIST_SQL, {"outlet_ids": allowed_outlets, "limit": limit}
                )
                return _finish(
                    state,
                    answer=_format_management_staff_answer(rows, allowed_outlets, limit),
                    rows=rows,
                    template_key="HR_staff_management_list",
                )

            if kind == "staff_list":
                rows = pg.execute_readonly(_STAFF_LIST_SQL, {"outlet_ids": allowed_outlets, "limit": limit})
                return _finish(
                    state,
                    answer=_format_staff_answer(rows, allowed_outlets, limit),
                    rows=rows,
                    template_key="HR_staff_list",
                )

            if kind == "employee_tenure":
                employee_term = _extract_employee_term(state)
                if employee_term and _employee_term_is_tenure_aggregate_noise(employee_term):
                    years, at_least = _parse_tenure_headcount_params(question)
                    agg_rows = pg.execute_readonly(
                        _TENURE_HEADCOUNT_SQL,
                        {"outlet_ids": allowed_outlets, "years": years, "at_least": at_least},
                    )
                    r0 = agg_rows[0] if agg_rows else {}
                    state["hr_query_kind"] = "tenure_headcount"
                    return _finish(
                        state,
                        answer=_format_tenure_headcount_answer(
                            int(r0.get("employee_count") or 0),
                            int(r0.get("without_contract_date_count") or 0),
                            years,
                            at_least,
                        ),
                        rows=agg_rows,
                        template_key="HR_tenure_headcount",
                    )
                if not employee_term:
                    return _finish(
                        state,
                        answer="Bạn muốn xem thâm niên của nhân viên nào? Hãy gửi tên, username hoặc mã nhân viên.",
                        kind="clarification",
                        template_key="HR_employee_tenure",
                        hints=["employee"],
                    )

                employees = _search_employees(allowed_outlets, employee_term)
                if not employees:
                    return _finish(
                        state,
                        answer=f"Không tìm thấy nhân viên khớp '{employee_term}' trong phạm vi outlet bạn được phép xem.",
                        kind="clarification",
                        template_key="HR_employee_tenure",
                        hints=["employee"],
                    )
                if len(employees) > 1:
                    lines = [f"Tìm thấy nhiều nhân viên khớp '{employee_term}'. Bạn muốn xem thâm niên của ai?"]
                    for row in employees[:6]:
                        lines.append(
                            f"- {_employee_label(row)} - username {row.get('username')}"
                        )
                    return _finish(
                        state,
                        answer="\n".join(lines),
                        kind="clarification",
                        rows=employees,
                        template_key="HR_employee_tenure",
                        hints=["employee"],
                    )

                employee = employees[0]
                tenure_rows = pg.execute_readonly(_EMPLOYEE_TENURE_SQL, {"user_id": int(employee["user_id"])})
                return _finish(
                    state,
                    answer=_format_tenure_answer(employee, tenure_rows, today_local()),
                    rows=tenure_rows,
                    template_key="HR_employee_tenure",
                )

            if not _has_explicit_time(question):
                return _finish(
                    state,
                    answer="Bạn muốn xem trong khoảng thời gian nào (hôm nay, tuần này, tháng này, hay năm nay)?",
                    kind="clarification",
                    template_key=f"HR_{kind}",
                    hints=["time_range"],
                )

            if kind == "attendance_top":
                employment_type = _employment_type_filter(question)
                rows = pg.execute_readonly(
                    _ATTENDANCE_TOP_SQL,
                    {
                        "outlet_ids": allowed_outlets,
                        "from_date": from_date,
                        "to_date": to_date,
                        "limit": min(limit, 10),
                        "employment_type": employment_type,
                    },
                )
                return _finish(
                    state,
                    answer=_format_attendance_answer(rows, from_date, to_date, employment_type),
                    rows=rows,
                    template_key="HR_attendance_top",
                )

            if kind == "employee_work_hours":
                employee_term = _extract_employee_term(state)
                if not employee_term:
                    rows = pg.execute_readonly(
                        _WORK_HOURS_TOTAL_SQL,
                        {
                            "outlet_ids": allowed_outlets,
                            "from_date": from_date,
                            "to_date": to_date,
                        },
                    )
                    return _finish(
                        state,
                        answer=_format_work_hours_total_answer(rows, allowed_outlets, from_date, to_date),
                        rows=rows,
                        template_key="HR_work_hours_total",
                    )

                employees = _search_employees(allowed_outlets, employee_term)
                if not employees:
                    return _finish(
                        state,
                        answer=f"Không tìm thấy nhân viên khớp '{employee_term}' trong phạm vi outlet bạn được phép xem.",
                        kind="clarification",
                        template_key="HR_employee_work_hours",
                        hints=["employee"],
                    )
                if len(employees) > 1:
                    lines = [f"Tìm thấy nhiều nhân viên khớp '{employee_term}'. Bạn muốn xem giờ làm của ai?"]
                    for row in employees[:6]:
                        lines.append(f"- {_employee_label(row)} - username {row.get('username')}")
                    return _finish(
                        state,
                        answer="\n".join(lines),
                        kind="clarification",
                        rows=employees,
                        template_key="HR_employee_work_hours",
                        hints=["employee"],
                    )

                employee = employees[0]
                work_rows = pg.execute_readonly(
                    _EMPLOYEE_WORK_HOURS_SQL,
                    {
                        "user_id": int(employee["user_id"]),
                        "outlet_ids": allowed_outlets,
                        "from_date": from_date,
                        "to_date": to_date,
                    },
                )
                return _finish(
                    state,
                    answer=_format_employee_work_hours_answer(employee, work_rows, from_date, to_date),
                    rows=work_rows,
                    template_key="HR_employee_work_hours",
                )

            employee_term = _extract_employee_term(state)
            if not employee_term:
                return _finish(
                    state,
                    answer="Bạn muốn xem lương của nhân viên nào? Hãy gửi tên, username hoặc mã nhân viên.",
                    kind="clarification",
                    template_key="HR_payroll_total",
                    hints=["employee"],
                )

            employees = _search_employees(allowed_outlets, employee_term)
            if not employees:
                return _finish(
                    state,
                    answer=f"Không tìm thấy nhân viên khớp '{employee_term}' trong phạm vi outlet bạn được phép xem.",
                    kind="clarification",
                    template_key="HR_payroll_total",
                    hints=["employee"],
                )
            if len(employees) > 1:
                lines = [f"Tìm thấy nhiều nhân viên khớp '{employee_term}'. Bạn muốn xem lương của ai?"]
                for row in employees[:5]:
                    lines.append(f"- {_employee_label(row)} - username {row.get('username')}")
                return _finish(
                    state,
                    answer="\n".join(lines),
                    kind="clarification",
                    rows=employees,
                    template_key="HR_payroll_total",
                    hints=["employee"],
                )

            employee = employees[0]
            payroll_rows = pg.execute_readonly(
                _PAYROLL_TOTAL_SQL,
                {
                    "user_id": int(employee["user_id"]),
                    "outlet_ids": allowed_outlets,
                    "from_date": from_date,
                    "to_date": to_date,
                },
            )
            return _finish(
                state,
                answer=_format_payroll_answer(employee, payroll_rows, from_date, to_date),
                rows=payroll_rows,
                template_key="HR_payroll_total",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("HR query failed")
            state.setdefault("trace", []).append({"node": "hr_query", "error": str(exc)})
            return _finish(
                state,
                answer="Không thể truy xuất dữ liệu HR lúc này. Vui lòng thử lại sau.",
                kind="answer",
                template_key=f"HR_{kind}",
            )

    return hr_query


hr_query = make_hr_query()
