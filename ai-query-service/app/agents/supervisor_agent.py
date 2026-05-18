"""Single-call Supervisor Agent — replaces 4 LLM hops in the legacy graph.

Flow (Finch-style):

1. Deterministic shortcuts run first (no LLM):
   - Standalone social (greeting / thanks).
   - Verified query asset by regex pattern → emit ``template_key`` and stop.
2. One LLM call (``gpt-5.5-mini`` class) returns:
   {
     "route": "data_query|hr_staff|docs_question|social|export_request|visualization_request",
     "intent": "...",
     "time_range": {"from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD"},
     "raw_entities": {...},
     "template_key": "T01_..." | null,
     "template_params": {...},
     "needs_sql_writer": bool,
     "clarification_question": "..." | null
   }
3. Light deterministic post-processing:
   - Normalise time_range against the local clock (timezone-aware).
   - Validate ``template_key`` exists in registry; clear it if not.
   - Force ``needs_sql_writer=False`` for HR/social/docs lanes.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import date
from typing import Any

from app.config import get_settings
from app.graph.nodes.preprocess import detect_standalone_social
from app.graph.nodes.supervisor import _install_planning_frame, _make_planning_frame
from app.graph.question_frame import build_question_frame
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json
from app.query_policy import intent_for_route_and_template, intent_for_template, select_verified_query
from app.rbac.policy import check_template_access
from app.templates.registry import TEMPLATES, list_templates
from app.time_utils import (
    build_time_context,
    has_time_expression,
    parse_time_range,
    parse_two_quarter_ranges_in_order,
    today_local,
)

logger = logging.getLogger(__name__)


_SUPERVISOR_SCHEMA: dict[str, Any] = {
    "name": "supervisor_agent_decision",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "route": {
                "type": "string",
                "enum": [
                    "data_query",
                    "docs_question",
                    "hr_staff",
                    "export_request",
                    "visualization_request",
                    "social",
                    "clarification",
                ],
            },
            "intent": {
                "type": "string",
                "enum": [
                    "revenue",
                    "inventory",
                    "product_mix",
                    "pnl",
                    "outlet_compare",
                    "trend",
                    "lookup",
                    "hr_staff",
                    "export_request",
                    "visualization_request",
                    "greeting",
                    "thanks",
                    "unknown",
                ],
            },
            "confidence": {"type": "number"},
            "time_range": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                },
                "required": ["from_date", "to_date"],
                "additionalProperties": False,
            },
            "raw_entities": {
                "type": "object",
                "properties": {
                    "outlet_names": {"type": "array", "items": {"type": "string"}},
                    "product_names": {"type": "array", "items": {"type": "string"}},
                    "categories": {"type": "array", "items": {"type": "string"}},
                    "employee_names": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["outlet_names", "product_names", "categories", "employee_names"],
                "additionalProperties": False,
            },
            "template_key": {"type": ["string", "null"]},
            "template_params": {
                "type": "object",
                "properties": {
                    "from_date": {"type": ["string", "null"]},
                    "to_date": {"type": ["string", "null"]},
                    "limit": {"type": ["integer", "null"]},
                    "threshold": {"type": ["integer", "null"]},
                },
                "required": ["from_date", "to_date", "limit", "threshold"],
                "additionalProperties": False,
            },
            "needs_sql_writer": {"type": "boolean"},
            "clarification_question": {"type": ["string", "null"]},
        },
        "required": [
            "route",
            "intent",
            "confidence",
            "time_range",
            "raw_entities",
            "template_key",
            "template_params",
            "needs_sql_writer",
            "clarification_question",
        ],
        "additionalProperties": False,
    },
}


def _system_prompt() -> str:
    today = today_local().isoformat()
    template_lines = "\n".join(f"- {k}: {','.join(meta.required_params)}" for k, meta in TEMPLATES.items())
    return f"""Bạn là Supervisor Agent cho FERN AI Query Assistant (chuỗi F&B Việt Nam). Hôm nay là {today}.

**VAI TRÒ:** Phân tích câu hỏi của user một cách kỹ lưỡng, xác định ý định thực sự, rồi ra quyết định xử lý trong **một** JSON.

**PHÂN TÍCH CÂU HỎI — trước khi quyết định route:**
- Câu hỏi hỏi về metric gì? (doanh thu, tồn kho, nhân viên, P&L, sản phẩm...?)
- Thời gian nào? (hôm nay, tuần, tháng, quý, hoặc chưa rõ?)
- Phạm vi nào? (cả chuỗi, outlet cụ thể, region?)
- Câu hỏi có đủ thông tin để trả lời, hay cần hỏi thêm?

QUY TẮC:

1. ROUTE:
   - data_query: cần truy số liệu kinh doanh (doanh thu, tồn kho, P&L, sản phẩm, outlet, growth…).
   - hr_staff: nhân viên, ca làm, payroll, headcount, thâm niên — đi qua lane HR static.
   - docs_question: hỏi định nghĩa/quy tắc/policy nội bộ ("AOV là gì?", "RBAC hoạt động thế nào?").
   - export_request: xuất file/CSV/Excel.
   - visualization_request: vẽ biểu đồ/chart.
   - social: chào hỏi, cảm ơn, câu xã giao ngắn.
   - clarification: câu hỏi data_query nhưng thiếu thông tin quan trọng không thể suy ra.

2. INTENT: revenue / inventory / product_mix / pnl / outlet_compare / trend / lookup / hr_staff / export_request / visualization_request / greeting / thanks / unknown.

3. TIME_RANGE (YYYY-MM-DD):
   - "hôm nay" → from=to={today}.
   - "hôm qua" → from=to={today} trừ 1 ngày.
   - "tuần này" → from = thứ Hai tuần này; to = {today}.
   - "tuần trước" → toàn bộ tuần lịch trước.
   - "tháng này" → from = ngày 1 tháng hiện tại; to = {today}.
   - "tháng trước" → toàn bộ tháng trước.
   - "quý này / quý 1 / quý 2…" → khoảng quý lịch tương ứng.
   - "năm nay" → from = 01-01 năm hiện tại; to = {today}.
   - "7 ngày qua / 30 ngày qua" → rolling window đến {today}.
   - Không có thời gian → from=to={today} chỉ với social/docs/HR. Với data_query thiếu thời gian → route=clarification.

4. RAW_ENTITIES: trích chuỗi gốc tên outlet / sản phẩm / danh mục / nhân viên nếu có.

5. TEMPLATE_KEY (chọn 1 hoặc null):
   - Chỉ chọn khi câu hỏi rõ chỉ số + thời gian + grain.
   - Không tự bịa. Không đặt outlet_id vào params (backend tự inject).
   - Nếu route ∈ (hr_staff, social, docs_question, clarification) → template_key=null.
   - Nếu chọn template: điền template_params.from_date/to_date theo time_range.

6. NEEDS_SQL_WRITER:
   - true: route=data_query/export_request/visualization_request, KHÔNG match template, câu hỏi đủ thông tin để sinh SQL.
   - false: route ∈ (social, hr_staff, docs_question, clarification) hoặc template_key đã chọn.

7. CLARIFICATION_QUESTION — khi route=clarification:
   - Hỏi đúng 1 trục thiếu. Ưu tiên: thời gian → metric cụ thể → outlet/phạm vi.
   - Phải gợi ý ví dụ cụ thể để user dễ trả lời. Ví dụ:
     * Thiếu thời gian: "Bạn muốn xem dữ liệu trong khoảng thời gian nào? Ví dụ: tháng này, tháng trước, quý 1..."
     * Thiếu metric: "Bạn muốn xem chỉ số nào? Ví dụ: doanh thu ròng, số giao dịch, AOV, tỷ lệ hủy đơn..."
     * Quá mơ hồ: "Bạn muốn xem báo cáo gì? Tôi có thể giúp: doanh thu, sản phẩm bán chạy, tồn kho, so sánh outlet..."
   - KHÔNG hỏi nhiều câu một lúc. Ngắn gọn, thân thiện.
   - Đừng clarify nếu có thể suy ra hợp lý (ví dụ "doanh thu hôm nay" → rõ ràng, không cần hỏi thêm).

DANH SÁCH TEMPLATE_KEY và required_params:
{template_lines}

Trả về JSON đúng schema. Không bao gồm bất kỳ giải thích nào ngoài JSON.
"""


_INVESTIGATIVE_RE = re.compile(
    r"\b(vì\s*sao|vi\s*sao|tại\s*sao|tai\s*sao|sao\s*lại|sao\s*lai|do\s*đâu|do\s*dau|"
    r"why|phân\s*tích|phan\s*tich|đánh\s*giá|danh\s*gia|nhận\s*định|nhan\s*dinh|"
    r"vì\s*lý\s*do|vi\s*ly\s*do|nguyên\s*nhân|nguyen\s*nhan|"
    r"yếu|yeu|tệ|te|kém|kem|tốt|tot|bất\s*thường|bat\s*thuong|outlier)\b",
    re.IGNORECASE,
)


def _detect_investigative_intent(text: str) -> bool:
    if not text:
        return False
    q = _fold_text(text)
    # Outlet ranking / superlatives (T22) often contain "yếu/tệ/tốt... nhất" — not a root-cause ask.
    if re.search(
        r"\b(cua\s*hang|outlet)\b.{0,52}\b(yeu|te|kem|tot|manh|cao|thap)\s+nhat\b",
        q,
    ) and not re.search(r"\b(tai\s*sao|vi\s*sao|nguyen\s*nhan|why)\b", q):
        return False
    return bool(_INVESTIGATIVE_RE.search(q))


def _investigative_safe_revenue_trend_template(
    question: str,
    time_range: dict[str, Any] | None,
) -> tuple[str, dict[str, str]] | None:
    """If wording triggers investigative mode but the ask is a bounded revenue series
    (daily/weekly), keep a verified template instead of SQL writer."""
    q = _fold_text(question)
    fd = str((time_range or {}).get("from_date") or "").strip()
    td = str((time_range or {}).get("to_date") or "").strip()
    if not fd or not td:
        return None
    params = {"from_date": fd, "to_date": td}
    weeklyish = any(
        x in q
        for x in (
            "theo tuan",
            "tung tuan",
            "moi tuan",
            "weekly",
            "per week",
        )
    )
    if weeklyish and "T35_weekly_revenue_trend" in TEMPLATES:
        return "T35_weekly_revenue_trend", params
    seriesish = any(
        x in q
        for x in (
            "xu huong",
            "trend",
            "theo ngay",
            "hang ngay",
            "daily",
            "bieu do",
            "chart",
        )
    )
    if seriesish and "T01_daily_revenue" in TEMPLATES:
        return "T01_daily_revenue", params
    return None


def _normalise_template_key(key: str | None) -> str | None:
    if not key:
        return None
    if key in TEMPLATES:
        return key
    if key in list_templates():
        return key
    return None


def _fold_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _default_time_range() -> dict[str, str]:
    today = today_local().isoformat()
    return {"from_date": today, "to_date": today}


def _clear_data_lane(state: GraphState) -> None:
    state["needs_sql_writer"] = False
    state["template_key"] = None
    state["template_params"] = {}
    state["template_confidence"] = 0.0


def _commit_no_sql(
    state: GraphState,
    *,
    route: str,
    intent: str = "unknown",
    message: str,
    trace_reason: str,
    response_kind: str = "clarification",
    time_range: dict[str, str] | None = None,
) -> GraphState:
    from app.agents.personas import detect_audience as _detect_audience
    state["agent_route"] = route
    state["intent"] = intent
    state["raw_entities"] = {
        "outlet_names": [],
        "product_names": [],
        "categories": [],
        "employee_names": [],
    }
    state["time_range"] = time_range or state.get("time_range") or _default_time_range()
    state["time_context"] = {**(state.get("time_context") or {}), **state["time_range"]}
    _clear_data_lane(state)
    state["visualization_requested"] = False
    state["response_kind"] = response_kind
    state["clarification_question"] = message if response_kind == "clarification" else None
    state["audience"] = _detect_audience(state.get("auth"))
    state.setdefault("trace", []).append(
        {"node": "supervisor_agent", "deterministic_gate": trace_reason, "route": route, "intent": intent}
    )
    return state


_ADVERSARIAL_RE = re.compile(
    r"("
    r"\bselect\s+\*\s+from\b|"
    r"\bsystem\.[a-z_][\w.]*|"
    r"\bremote\s*\(|"
    r"\bwith\s+\w+\s+as\b|"
    r"\bunion\b|"
    r"\bschema\s+khac\b|"
    r"\b(drop|truncate|delete|update|insert|alter)\b|"
    r"\bpasswords?\b|\bmat\s+khau\b|\bcccd\b|"
    r"\bbo\s+(?:qua\s+)?rbac\b|"
    r"\bbo\s+outlet\s+filter\b|"
    r"\bignore\s+(previous|prior|above)\b|"
    r"\bdump\b"
    r")",
    re.IGNORECASE,
)


def _is_adversarial_or_raw_sql(question: str) -> bool:
    q = _fold_text(question)
    if _ADVERSARIAL_RE.search(q):
        return True
    if "'" in question and "--" in question:
        return True
    if "toi la chu" in q and ("bo qua" in q or "rbac" in q):
        return True
    if "join voi schema khac" in q:
        return True
    return False


_CAPABILITIES_RE = re.compile(
    r"\b(ban\s*co\s*the|co\s*the\s*lam\s*gi|lam\s*duoc\s*gi|phan\s*tich\s*gi|"
    r"ho\s*tro\s*gi|giup\s*gi\s*duoc|kha\s*nang|tinh\s*nang|chuc\s*nang|"
    r"what\s*can\s*you|what\s*do\s*you\s*do|capabilities|features|what\s*is\s*your|"
    r"biet\s*gi|hieu\s*gi|ngu\s*canh|lam\s*the\s*nao|ban\s*la\s*ai|you\s*are|who\s*are\s*you)\b",
    re.IGNORECASE,
)

_CAPABILITIES_ANSWER = """Mình là FERN AI Analyst — trợ lý phân tích dữ liệu kinh doanh của hệ thống FERN.

**Mình có thể giúp sếp:**
- **Doanh thu & hiệu suất**: Doanh thu ngày/tuần/tháng, so sánh kỳ, top outlets, AOV, tỷ lệ hủy đơn
- **Sản phẩm**: Top sản phẩm bán chạy/chậm, đóng góp theo danh mục, xu hướng theo giờ/ca
- **Tài chính**: P&L, operating margin, COGS, chi phí vận hành
- **Tồn kho**: Tình trạng hàng tồn, cảnh báo sắp hết hàng, vòng quay tồn kho
- **Nhân sự**: Chuyên cần, ca làm việc, phân tích theo nhân viên
- **Phân tích nguyên nhân**: Vì sao doanh thu giảm, outlet nào yếu, giờ nào peak

**Cách hỏi hiệu quả:**
- Kèm theo khoảng thời gian (tháng 4, tuần này, Q1 2026)
- Chỉ rõ phạm vi (tất cả outlets, khu vực HCM, cụ thể outlet X)
- Hỏi thẳng vào số liệu cần ("doanh thu tháng 4 theo outlet")"""


def _is_capabilities_question(question: str) -> bool:
    q = _fold_text(question)
    return bool(_CAPABILITIES_RE.search(q))


def _is_docs_question(question: str) -> bool:
    q = _fold_text(question)
    return bool(
        re.search(r"\b(la gi|dinh nghia|definition|chinh sach|policy|quy tac|khi nao dung|when to use)\b", q)
        or re.search(r"\bduoc tinh nhu the nao\b", q)
    )


def _is_bare_metric(question: str) -> bool:
    q = _fold_text(question).strip(" \t\r\n'\"`’‘“”.,!?;:")
    return q in {"doanh thu", "revenue"}


def _invalid_time_reason(question: str) -> str | None:
    raw = question or ""
    q = _fold_text(raw)
    if re.search(r"\bthang\s*(?:1[3-9]|[2-9]\d)\b", q):
        return "invalid_month"

    iso_dates: list[date] = []
    for iso_text in re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b", raw):
        try:
            iso_dates.append(date.fromisoformat(iso_text))
        except ValueError:
            return "invalid_iso_date"

    raw_without_iso_dates = re.sub(r"\b20\d{2}-\d{2}-\d{2}\b", " ", raw)
    for match in re.finditer(
        r"(?<![\d/-])(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(20\d{2}))?(?![\d/-])",
        raw_without_iso_dates,
    ):
        day = int(match.group(1))
        month = int(match.group(2))
        year = int(match.group(3) or today_local().year)
        try:
            date(year, month, day)
        except ValueError:
            return "invalid_numeric_date"

    if len(iso_dates) >= 2:
        if iso_dates[0] > iso_dates[1]:
            return "inverted_range"
        if (iso_dates[1] - iso_dates[0]).days > 2557:
            return "range_too_long"

    year_range = re.search(r"\b(20\d{2})\b\s*(?:den|toi|to|-)\s*\b(20\d{2})\b", q)
    if year_range:
        start_year = int(year_range.group(1))
        end_year = int(year_range.group(2))
        if start_year > end_year:
            return "inverted_year_range"
        if end_year - start_year > 7:
            return "range_too_long"

    years = [int(y) for y in re.findall(r"\b(?:nam\s*)?(19\d{2}|20\d{2})\b", q)]
    if any(y < 2020 for y in years):
        return "year_too_old"
    return None


def _has_role(state: GraphState, allowed: set[str]) -> bool:
    auth = state.get("auth")
    roles = set(getattr(auth, "roles", frozenset()) or frozenset())
    return bool(roles & allowed)


def _roles(state: GraphState) -> frozenset[str]:
    auth = state.get("auth")
    return frozenset(getattr(auth, "roles", frozenset()) or frozenset())


def _is_product_entity_profit_question(question: str) -> bool:
    """True when profit/margin/cogs is about products/items/SKUs, not outlet-level P&L.

    Keeps questions like best-selling product profit on the analytics/SQL-writer path
    instead of finance template T24 (which triggers stricter finance RBAC).
    """
    q = _fold_text(question)
    if not re.search(r"\b(lai lo|loi nhuan|profit|margin|cogs)\b", q):
        return False
    if any(
        tok in q
        for tok in (
            "san pham",
            "mat hang",
            "hang hoa",
            "ma hang",
            "sku",
            "ban chay",
            "ban duoc nhieu",
            "top san",
            "best seller",
            "mat hang ban",
        )
    ):
        return True
    if re.search(r"\bsp\b", q) and ("ban" in q or "chay" in q or "top" in q):
        return True
    return False


def _finance_template_for_question(question: str) -> str | None:
    q = _fold_text(question)
    if "payroll cost" in q or "chi phi luong" in q or "labor cost" in q:
        return "T27_payroll_cost_by_outlet"
    if "phieu nhap" in q or "goods receipt" in q:
        return "T26_goods_receipt_summary"
    if (
        "expense" in q
        or "chi phi theo loai" in q
        or "tong chi phi" in q
        or "chi phi hoat dong" in q
        or "bao cao finance" in q
    ):
        return "T25_expense_breakdown"
    if re.search(r"\b(p&l|pnl|lai lo|loi nhuan|profit|margin|cogs)\b", q):
        if _is_product_entity_profit_question(question):
            return None
        return "T24_daily_pnl_summary"
    return None


def _is_hr_payroll_bulk_request(question: str) -> bool:
    q = _fold_text(question)
    has_payroll = "payroll" in q or "luong" in q or "salary" in q
    bulk = "tat ca nhan vien" in q or "xem het" in q or "ca cong ty" in q or "cong ty" in q
    return has_payroll and bulk


def _is_raw_payment_dump_request(question: str) -> bool:
    q = _fold_text(question)
    return "cdc.payment" in q and ("toan bo" in q or "bang" in q or "dump" in q or "raw" in q)


def _is_hr_staff_question(question: str) -> bool:
    q = _fold_text(question)
    if any(
        token in q
        for token in (
            "nhan su",
            "nhan vien",
            "employee",
            "headcount",
            "hire date",
            "tenure",
            "tham nien",
            "personnel",
            "workforce",
        )
    ):
        return True
    if any(
        token in q
        for token in (
            "hop dong",
            "employee contract",
            "contract lao dong",
            "fulltime",
            "full time",
            "parttime",
            "part time",
            "toan thoi gian",
            "ban thoi gian",
        )
    ):
        return True
    if any(token in q for token in ("tong gio lam", "gio lam", "work hours", "attendance", "di lam nhieu nhat")):
        return True
    if any(token in q for token in ("payroll cho username", "luong thang nay cua user", "salary cua user")):
        return True
    return False


def _deterministic_template_override(question: str) -> str | None:
    q = _fold_text(question)
    categoryish = any(token in q for token in ("danh muc", "category", "nhom san pham", "nhom mon"))
    if re.search(r"\b(bao cao ban hang|cho xem doanh thu tuan nay)\b", q):
        return "T01_daily_revenue"
    if "xu huong doanh thu 30 ngay qua" in q or "daily revenue trend" in q:
        return "T01_daily_revenue"
    if "ban duoc bao nhieu" in q:
        return "T32_period_revenue_summary"
    if (
        ("top cua hang" in q or "outlet tot nhat" in q or "cua hang tot nhat" in q or "cua hang yeu nhat" in q)
        or (("outlet" in q or "cua hang" in q) and "doanh thu" in q and ("cao nhat" in q or "thap nhat" in q))
    ):
        return "T22_outlet_rank"
    if ("dong gop" in q or "contribution" in q) and categoryish:
        return "T17_category_contribution"
    if categoryish and ("doanh thu" in q or "revenue" in q):
        return "T03_revenue_by_category"
    finance_template = _finance_template_for_question(question)
    if finance_template:
        return finance_template
    return None


def _deterministic_preflight(state: GraphState, question: str) -> GraphState | None:
    if _is_capabilities_question(question):
        # Use clarification route so _route_after_supervisor → answer_formatter,
        # then answer_formatter copies clarification_question → answer_text directly.
        result = _commit_no_sql(
            state,
            route="social",
            intent="greeting",
            message=_CAPABILITIES_ANSWER,
            trace_reason="capabilities_question",
            response_kind="clarification",
        )
        return result

    if _is_docs_question(question):
        return _commit_no_sql(
            state,
            route="docs_question",
            intent="unknown",
            message="Tôi sẽ trả lời theo tài liệu/định nghĩa nội bộ, không truy vấn dữ liệu.",
            trace_reason="docs_question",
            response_kind="answer",
        )

    if _is_adversarial_or_raw_sql(question):
        return _commit_no_sql(
            state,
            route="clarification",
            intent="unknown",
            message="Yêu cầu này không thể xử lý vì vi phạm chính sách an toàn truy vấn.",
            trace_reason="adversarial_or_raw_sql",
        )

    if _is_bare_metric(question):
        return _commit_no_sql(
            state,
            route="clarification",
            intent="unknown",
            message="Bạn muốn xem doanh thu cho khoảng thời gian nào?",
            trace_reason="bare_metric_missing_time",
        )

    invalid_time = _invalid_time_reason(question)
    if invalid_time:
        return _commit_no_sql(
            state,
            route="clarification",
            intent="unknown",
            message="Khoảng thời gian trong câu hỏi chưa hợp lệ hoặc vượt quá phạm vi cho phép.",
            trace_reason=f"time_{invalid_time}",
        )

    if _is_raw_payment_dump_request(question):
        return _commit_no_sql(
            state,
            route="data_query",
            intent="revenue",
            message="Tôi không thể dump bảng thanh toán raw. Hãy hỏi một chỉ số tổng hợp theo thời gian/outlet.",
            trace_reason="raw_payment_dump",
        )

    finance_template = _finance_template_for_question(question)
    if finance_template and not check_template_access(finance_template, _roles(state)):
        return _commit_no_sql(
            state,
            route="data_query",
            intent="pnl",
            message="Bạn không có quyền xem dữ liệu finance/payroll này.",
            trace_reason=f"finance_rbac_{finance_template}",
        )

    if _is_hr_payroll_bulk_request(question) and not _has_role(state, {"hr", "finance", "admin", "superadmin"}):
        return _commit_no_sql(
            state,
            route="clarification",
            intent="unknown",
            message="Bạn không có quyền xem payroll của toàn bộ nhân viên.",
            trace_reason="hr_payroll_rbac",
        )

    if _is_hr_staff_question(question):
        ctx = (state.get("conversation_context") or "").strip()
        time_ctx = build_time_context(
            current_question=question,
            effective_question=question,
            conversation_context=ctx,
            today=today_local(),
        )
        state["time_context"] = time_ctx
        return _commit_no_sql(
            state,
            route="hr_staff",
            intent="hr_staff",
            message="",
            trace_reason="hr_staff",
            response_kind="answer",
            time_range={
                "from_date": str(time_ctx["from_date"]),
                "to_date": str(time_ctx["to_date"]),
            },
        )

    return None


def _custom_sql_writer_override(question: str) -> tuple[bool, str | None]:
    """Return an intent when a question is explicitly outside template scope.

    Verified/template matching is intentionally broad for common revenue
    summaries. A few L4 cases ask for a custom comparison that mentions a
    template phrase ("theo outlet") but still needs SQL Writer logic.
    """
    q = _fold_text(question)
    if (
        ("doanh thu" in q or "revenue" in q)
        and re.search(r"\b(gio|hour|hourly)\b", q)
        and ("cung gio" in q or "same hour" in q)
        and ("tuan truoc" in q or "last week" in q)
    ):
        return True, "revenue"
    if (
        ("growth" in q or "tang truong" in q)
        and any(token in q for token in ("category", "danh muc", "nhom san pham", "nhom mon"))
        and ("mom" in q or "month over month" in q or "so voi thang truoc" in q)
    ):
        return True, "product_mix"
    if (
        ("growth" in q or "tang truong" in q)
        and ("doanh thu" in q or "revenue" in q)
        and (
            "so voi thang truoc" in q
            or "thang nay so voi thang truoc" in q
            or "mom" in q
            or "month over month" in q
        )
    ):
        return True, None
    if (
        ("margin" in q or "bien loi nhuan" in q)
        and ("outlet" in q or "cua hang" in q)
        and (" vs " in q or "so voi" in q or "compare" in q)
    ):
        return True, "pnl"
    if (
        ("cogs/revenue" in q or ("cogs" in q and "revenue" in q))
        and ("theo thang" in q or "monthly" in q or re.search(r"\b20\d{2}\b", q))
    ):
        return True, "pnl"
    if (
        ("ty le" in q or "ratio" in q)
        and ("thanh toan" in q or "payment" in q)
        and ("the" in q or "card" in q)
        and ("tien mat" in q or "cash" in q)
    ):
        return True, None
    if (
        ("ty le giam gia" in q or "discount ratio" in q or "discount rate" in q)
        and ("trung binh" in q or "average" in q or "avg" in q)
        and ("outlet" in q or "cua hang" in q)
    ):
        return True, "revenue"
    if (
        ("cap gia" in q or "price band" in q or "price bucket" in q or "low/mid/high" in q)
        and ("doanh thu" in q or "revenue" in q)
    ):
        return True, "revenue"
    if (
        ("payment method" in q or "phuong thuc thanh toan" in q)
        and ("cao nhat" in q or "highest" in q or "top" in q)
        and re.search(r"\b(gio|hour|hourly)\b", q)
    ):
        return True, None
    if (
        ("san pham" in q or "product" in q)
        and ("doanh thu cao" in q or "high revenue" in q)
        and ("so don it" in q or "low volume" in q or "few orders" in q)
    ):
        return True, "product_mix"
    if (
        ("ton kho" in q or "inventory" in q)
        and ("tang/giam" in q or "tang giam" in q or "delta" in q)
        and ("san pham ban chay" in q or "best seller" in q or "top selling" in q)
    ):
        return True, "inventory"
    if "ton am" in q or "negative stock" in q or "negative inventory" in q:
        return True, "inventory"
    if (
        ("churn ton kho" in q or "inventory churn" in q)
        and ("outlet" in q or "cua hang" in q)
    ):
        return True, "inventory"
    if (
        ("operating profit" in q or "loi nhuan hoat dong" in q)
        and ("am" in q or "negative" in q)
        and ("lien tuc" in q or "consecutive" in q)
    ):
        return True, "pnl"
    if (
        ("quay lai" in q or "repeat" in q or "mua lai" in q)
        and ("don" in q or "order" in q or "transaction" in q)
        and ("> 1" in q or "hon 1" in q or "nhieu hon 1" in q or "more than 1" in q)
    ):
        return True, "revenue"
    if (
        ("outlet nao" in q or "cua hang nao" in q)
        and ("nam o" in q or "khu vuc" in q or "region" in q or "area" in q or "ha noi" in q)
    ):
        return True, "lookup"
    return False, None


def _is_revenue_growth_driver_question(question: str) -> bool:
    q = _fold_text(question)
    driverish = any(
        x in q
        for x in (
            "thanh phan nao",
            "nguyen nhan",
            "do dau",
            "vi sao",
            "tai sao",
            "tac dong",
            "phan ra",
            "giai thich them",
            "do thanh phan",
        )
    )
    growthish = any(
        x in q
        for x in (
            "tang truong",
            "cao hon",
            "thap hon",
            "doanh thu",
            "ket luan",
            "quy",
            "q1",
            "q2",
            "q3",
            "q4",
        )
    )
    return driverish and growthish


def _revenue_driver_bridge_verified(question: str, ctx: str) -> dict[str, Any] | None:
    if "T36_revenue_period_driver_bridge" not in TEMPLATES:
        return None
    if not _is_revenue_growth_driver_question(question):
        return None
    combined = "\n".join(x for x in (ctx.strip(), question.strip()) if x)
    pair = parse_two_quarter_ranges_in_order(combined)
    if not pair:
        return None
    ra, rb = pair
    params = {
        "from_date_a": ra["from_date"],
        "to_date_a": ra["to_date"],
        "from_date_b": rb["from_date"],
        "to_date_b": rb["to_date"],
    }
    return {
        "template_key": "T36_revenue_period_driver_bridge",
        "template_params": params,
        "confidence": 0.94,
        "asset": {
            "template_key": "T36_revenue_period_driver_bridge",
            "metric_ids": ["net_revenue", "txn_count", "outlet_count", "aov"],
            "time_column": "business_date",
            "outlet_column": "outlet_id",
            "golden_cases": [],
        },
    }


def _investigative_revenue_driver_bridge(
    question: str,
    ctx: str,
) -> tuple[str, dict[str, str]] | None:
    hit = _revenue_driver_bridge_verified(question, ctx)
    if not hit:
        return None
    return hit["template_key"], dict(hit["template_params"])


def _intent_for_template(template_key: str | None) -> str | None:
    return intent_for_template(template_key)


def _blocked_outlet_contact_request(question: str) -> bool:
    q = _fold_text(question)
    has_outlet = "outlet" in q or "cua hang" in q or "chi nhanh" in q
    wants_blocked_contact = (
        "address" in q
        or "dia chi" in q
        or "phone" in q
        or "so dien thoai" in q
        or "sdt" in q
    )
    return has_outlet and wants_blocked_contact


def _ensure_template_params(
    template_key: str | None,
    raw_params: dict[str, Any] | None,
    time_range: dict[str, str],
) -> dict[str, Any]:
    if not template_key or template_key not in TEMPLATES:
        return {}
    meta = TEMPLATES[template_key]
    params = {k: v for k, v in (raw_params or {}).items() if v not in (None, "")}
    for required in meta.required_params:
        if not params.get(required) and required in time_range:
            params[required] = time_range[required]
    return params


def _rank_direction_from_question(question: str) -> str | None:
    q = _fold_text(question)
    if any(
        term in q
        for term in (
            "thap nhat",
            "yeu nhat",
            "kem nhat",
            "te nhat",
            "lowest",
            "worst",
            "bottom",
        )
    ):
        return "asc"
    return None


def _apply_question_derived_template_params(
    template_key: str | None,
    params: dict[str, Any],
    question: str,
) -> dict[str, Any]:
    if template_key != "T22_outlet_rank":
        return params
    rank_direction = _rank_direction_from_question(question)
    if not rank_direction:
        return params
    return {**params, "rank_direction": rank_direction}


def _verified_query_shortcut(
    *, question: str, intent: str | None, time_range: dict[str, str]
) -> dict[str, Any] | None:
    """Run the deterministic verified-query matcher; if a hit is found, the
    caller may skip the LLM entirely.
    """
    try:
        match = select_verified_query(question=question, intent=intent, time_range=time_range)
    except Exception as exc:  # noqa: BLE001
        logger.warning("verified_query lookup failed: %s", exc)
        return None
    if not match:
        return None
    return {
        "template_key": match.template_key,
        "template_params": dict(match.params),
        "confidence": match.confidence,
        "asset": {
            "template_key": match.asset.template_key,
            "metric_ids": list(match.asset.metric_ids),
            "time_column": match.asset.time_column,
            "outlet_column": match.asset.outlet_column,
            "golden_cases": list(match.asset.golden_cases),
        },
    }


async def supervisor_agent(state: GraphState) -> GraphState:
    """Single-call supervisor that drives the simplified graph."""
    s = get_settings()
    raw = str(state.get("raw_question") or "").strip()
    state.setdefault("trace", [])

    if state.get("response_kind") == "clarification" and state.get("clarification_question"):
        state["agent_route"] = "clarification"
        state["intent"] = state.get("intent") or "unknown"
        state["needs_sql_writer"] = False
        state["template_key"] = None
        state["template_params"] = {}
        state["trace"].append({"node": "supervisor_agent", "skipped": "preprocess_clarification"})
        return state

    # ---- Pre-flight: standalone social → no LLM, no further nodes ----
    social_kind = detect_standalone_social(raw)
    if social_kind:
        state["agent_route"] = social_kind
        state["intent"] = social_kind
        state["social_kind"] = social_kind
        state["needs_sql_writer"] = False
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["response_kind"] = "answer"
        state["trace"].append({"node": "supervisor_agent", "shortcut": "social", "kind": social_kind})
        return state

    # ---- Build time context (deterministic, used to override LLM dates) ----
    current = state.get("normalized_question") or raw
    ctx = (state.get("conversation_context") or "").strip()

    deterministic_gate = _deterministic_preflight(state, current)
    if deterministic_gate is not None:
        return deterministic_gate

    if _blocked_outlet_contact_request(current):
        state["agent_route"] = "clarification"
        state["intent"] = "unknown"
        state["needs_sql_writer"] = False
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["response_kind"] = "clarification"
        state["clarification_question"] = (
            "Tôi không thể cung cấp address hoặc phone của outlet. "
            "Bạn có thể hỏi danh sách outlet với mã/tên/trạng thái/khu vực."
        )
        state["trace"].append({"node": "supervisor_agent", "blocked": "outlet_contact_columns"})
        return state

    time_ctx = build_time_context(
        current_question=current,
        effective_question=current,
        conversation_context=ctx,
        today=today_local(),
    )
    deterministic_time = {
        "from_date": str(time_ctx["from_date"]),
        "to_date": str(time_ctx["to_date"]),
    }
    state["time_context"] = time_ctx
    state["time_range"] = deterministic_time

    # ---- Pre-flight: verified-query asset (regex) → bypass LLM matching ----
    intent_hint = state.get("intent")
    driver_v = _revenue_driver_bridge_verified(current, ctx)
    verified = driver_v or _verified_query_shortcut(
        question=current, intent=intent_hint, time_range=deterministic_time
    )
    template_override = _deterministic_template_override(current)

    # ---- LLM call (always run for route + entities + intent normalisation) ----
    user_prompt = (
        f"Câu hỏi: {current}\n"
        f"Ngữ cảnh hội thoại gần đây:\n{ctx}\n" if ctx else f"Câu hỏi: {current}\n"
    )
    user_prompt += f"\nGợi ý thời gian backend đã giải mã: {deterministic_time}"
    if verified:
        user_prompt += (
            f"\nĐã match verified template `{verified['template_key']}`; "
            f"hãy giữ nguyên `template_key`/`template_params` này."
        )

    try:
        parsed, usage = await llm_call_json(
            system_prompt=_system_prompt(),
            user_prompt=user_prompt,
            json_schema=_SUPERVISOR_SCHEMA,
            temperature=0.1,
            max_tokens=600,
            agent="supervisor",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("supervisor_agent LLM failed, falling back to verified-only: %s", exc)
        parsed, usage = (
            {
                "route": "clarification" if not verified else "data_query",
                "intent": intent_hint or "unknown",
                "confidence": 0.0,
                "time_range": deterministic_time,
                "raw_entities": {
                    "outlet_names": [],
                    "product_names": [],
                    "categories": [],
                    "employee_names": [],
                },
                "template_key": verified["template_key"] if verified else None,
                "template_params": verified["template_params"] if verified else {},
                "needs_sql_writer": False,
                "clarification_question": None
                if verified
                else "Bạn vui lòng diễn đạt lại câu hỏi với khoảng thời gian rõ hơn nhé.",
            },
            {"error": type(exc).__name__, "latency_ms": 0, "tokens_in": 0, "tokens_out": 0},
        )

    # ---- Apply deterministic time override when the user actually expressed time ----
    user_expressed_time = has_time_expression(current) or has_time_expression(raw)
    if user_expressed_time:
        parsed["time_range"] = deterministic_time
    else:
        # Trust the LLM only if route is data_query and no time hint at all.
        try:
            parse_time_range(current, today=today_local(), context_text=ctx)
        except Exception:  # noqa: BLE001
            pass

    # ---- Normalise template_key against registry ----
    raw_template = parsed.get("template_key")
    template_key = _normalise_template_key(raw_template)
    if template_override:
        template_key = template_override
    elif verified:
        template_key = verified["template_key"]

    template_params = _ensure_template_params(
        template_key,
        verified["template_params"] if verified else parsed.get("template_params"),
        parsed.get("time_range") or deterministic_time,
    )

    # ---- Lock invariants per route ----
    route = parsed.get("route") or "data_query"
    intent = parsed.get("intent") or intent_hint or "unknown"
    parsed_intent = intent
    if template_override and route == "clarification":
        route = "data_query"
    if template_key:
        intent = intent_for_route_and_template(
            route=route,
            template_key=template_key,
            question=current,
            current_intent=intent,
        )
    if route in {"social", "hr_staff", "docs_question", "clarification"}:
        template_key = None
        template_params = {}
        intent = intent_for_route_and_template(
            route=route,
            template_key=None,
            question=current,
            current_intent=intent,
        )

    # LLM sometimes picks outlet P&L template (T24) for product-level profit — wrong grain.
    if (
        route in {"data_query", "export_request", "visualization_request"}
        and template_key == "T24_daily_pnl_summary"
        and _is_product_entity_profit_question(current)
    ):
        template_key = None
        template_params = {}
        intent = intent_for_route_and_template(
            route=route,
            template_key=None,
            question=current,
            current_intent=intent,
        )

    if route in {"data_query", "export_request", "visualization_request"} and template_key:
        finance_template = _finance_template_for_question(current)
        template_to_check = finance_template or template_key
        if not check_template_access(template_to_check, _roles(state)):
            return _commit_no_sql(
                state,
                route="data_query",
                intent="pnl",
                message="Bạn không có quyền xem dữ liệu finance/payroll này.",
                trace_reason=f"finance_rbac_{template_to_check}",
                time_range=parsed.get("time_range") or deterministic_time,
            )

    needs_sql_writer = bool(parsed.get("needs_sql_writer"))
    if template_key:
        needs_sql_writer = False
    if (
        route in {"data_query", "export_request", "visualization_request"}
        and not template_key
        and _is_product_entity_profit_question(current)
    ):
        needs_sql_writer = True
    if route in {"social", "hr_staff", "docs_question", "clarification"}:
        needs_sql_writer = False
    force_codegen, forced_codegen_intent = _custom_sql_writer_override(current)
    if force_codegen and route == "clarification":
        route = "data_query"
    if force_codegen and route in {"data_query", "export_request", "visualization_request"}:
        if forced_codegen_intent:
            intent = forced_codegen_intent
        else:
            intent = parsed_intent
        template_key = None
        template_params = {}
        needs_sql_writer = True
    if route == "visualization_request":
        intent = intent_for_route_and_template(
            route=route,
            template_key=template_key,
            question=current,
            current_intent=intent,
        )
        template_key = None
        template_params = {}
        needs_sql_writer = True

    clar = parsed.get("clarification_question") or None
    if route != "clarification":
        clar = None

    investigative = _detect_investigative_intent(current) and route in {
        "data_query",
        "export_request",
        "visualization_request",
    }
    investigative_mode_flag = bool(investigative)
    if investigative and get_settings().investigative_mode_enabled:
        bridge_tpl = _investigative_revenue_driver_bridge(current, ctx)
        if bridge_tpl:
            template_key, safe_params = bridge_tpl
            template_params = _ensure_template_params(template_key, safe_params, {})
            needs_sql_writer = False
            intent = intent_for_route_and_template(
                route=route,
                template_key=template_key,
                question=current,
                current_intent=intent,
            )
            investigative_mode_flag = False
        else:
            safe_trend = _investigative_safe_revenue_trend_template(
                current, parsed.get("time_range") or deterministic_time
            )
            if safe_trend:
                template_key, safe_params = safe_trend
                template_params = _ensure_template_params(
                    template_key,
                    safe_params,
                    parsed.get("time_range") or deterministic_time,
                )
                needs_sql_writer = False
                intent = intent_for_route_and_template(
                    route=route,
                    template_key=template_key,
                    question=current,
                    current_intent=intent,
                )
                investigative_mode_flag = False
            else:
                # When user asks "why/how/what's happening", encourage SQL writer instead
                # of falling back to a single template: the investigative system prompt
                # nudges the agent toward dimension breakdown.
                template_key = None
                template_params = {}
                needs_sql_writer = True

    template_params = _apply_question_derived_template_params(template_key, template_params, current)

    # ---- Commit to state ----
    from app.agents.personas import detect_audience as _detect_audience  # avoid circular at import time
    state["agent_route"] = route
    state["intent"] = intent
    state["investigative_mode"] = investigative_mode_flag
    state["audience"] = _detect_audience(state.get("auth"))
    state["raw_entities"] = parsed.get("raw_entities") or {
        "outlet_names": [],
        "product_names": [],
        "categories": [],
        "employee_names": [],
    }
    state["time_range"] = parsed.get("time_range") or deterministic_time
    state["time_context"] = {**time_ctx, **state["time_range"]}
    state["template_key"] = template_key
    state["template_params"] = template_params
    state["template_confidence"] = float(verified["confidence"] if verified else parsed.get("confidence") or 0.0)
    state["needs_sql_writer"] = needs_sql_writer
    state["visualization_requested"] = route == "visualization_request"
    state["response_kind"] = "clarification" if route == "clarification" else "answer"
    state["clarification_question"] = clar
    if verified:
        state["verified_query_asset"] = verified["asset"]

    # Align Finch with legacy supervisor: structured planning_frame + slot gate before SQL writer.
    skip_slot_gate = bool(force_codegen) or bool(investigative_mode_flag)
    if template_key:
        state["planning_frame"] = {
            "next_action": "template_match",
            "ambiguities": [],
            "task_type": "metric_summary",
            "route": route,
            "intent": intent,
            "confidence": float(state.get("template_confidence") or 0.0),
            "router_layer": "finch_llm",
            "executor_brief_vi": (
                "**Planner (Finch):** Supervisor đã ghim template verified.\n"
                f"- **template_key:** `{template_key}`\n"
                "- **Thực thi:** Điền `from_date`/`to_date` đúng `time_range` trong state; không đổi loại báo cáo."
            ),
            "executor_directives": [
                f"Chạy đúng template_key={template_key}.",
                "Khớp tham số thời gian với state['time_range'].",
                "Không sinh báo cáo khác ngoài template đã ghim trừ khi matcher từ chối.",
            ],
        }
    elif route == "clarification":
        state["planning_frame"] = {
            "next_action": "ask_clarification",
            "ambiguities": [],
            "route": route,
            "intent": intent,
            "confidence": float(state.get("template_confidence") or 0.0),
            "router_layer": "finch_llm",
            "executor_brief_vi": "**Planner (Finch):** Thiếu slot — chưa thực thi số liệu.",
            "executor_directives": [
                "Chỉ trả lời làm rõ; không gọi matcher/SQL.",
                "Thu thập đúng một slot (thời gian / metric / phạm vi) rồi hỏi lại.",
            ],
        }
    elif route in {"data_query", "export_request", "visualization_request"}:
        build_question_frame(
            state,
            effective_question=current,
            current_question=current,
            intent=intent,
            time_range=state["time_range"],
            time_context=state["time_context"],
            raw_entities=state["raw_entities"],
        )
        planning = _make_planning_frame(
            route=route,
            intent=intent,
            text=current,
            current=current,
            time_range=state["time_range"],
            time_context=state["time_context"],
            entities=state["raw_entities"],
            confidence=float(state.get("template_confidence") or 0.0),
            router_layer="finch_llm",
            state=state,
        )
        state["planning_frame"] = planning
        if planning.get("next_action") == "ask_clarification" and not skip_slot_gate:
            _install_planning_frame(state, planning)
            state["needs_sql_writer"] = False
            state["template_key"] = None
            state["template_params"] = {}
            state["agent_route"] = "clarification"
    else:
        state["planning_frame"] = {
            "next_action": "hr_static" if route == "hr_staff" else "answer_social",
            "ambiguities": [],
            "route": route,
            "intent": intent,
            "router_layer": "finch_llm",
            "executor_brief_vi": (
                "**Planner (Finch):** Luồng HR / xã giao — không qua template analytics."
                if route == "hr_staff"
                else "**Planner (Finch):** Phản hồi xã giao hoặc không cần pipeline số liệu."
            ),
            "executor_directives": (
                [
                    "Chuyển sang hr_query (SQL tĩnh); bám time_range nếu câu hỏi có thời gian.",
                    "Giữ RBAC outlet; không dùng GenSQL cho lane HR trừ khi product bật codegen HR.",
                ]
                if route == "hr_staff"
                else ["Trả lời ngắn; không khởi chạy matcher hay SQL."]
            ),
        }

    state["trace"].append(
        {
            "node": "supervisor_agent",
            "route": state.get("agent_route"),
            "intent": intent,
            "template_key": state.get("template_key"),
            "needs_sql_writer": state.get("needs_sql_writer"),
            "verified_hit": bool(verified),
            "forced_codegen": bool(force_codegen),
            "planning_next_action": (state.get("planning_frame") or {}).get("next_action"),
            **(usage if isinstance(usage, dict) else {}),
        }
    )
    return state
