"""Structured reasoning outline before template selection (no SQL generation)."""

import logging
import re
import unicodedata

from typing import Any

from app.config import get_settings
from app.graph.nodes.catalog_digest import format_catalog_digest_for_prompt
from app.graph.nodes.data_coverage import format_data_coverage_for_prompt
from app.graph.nodes.metadata_context import format_metadata_context_for_prompt
from app.graph.question_frame import question_text
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_json
from app.query_policy import candidate_tables_for_prompt, select_verified_query
from app.time_utils import format_time_context_for_prompt

logger = logging.getLogger(__name__)

_OUTLET_LOOKUP_RE = re.compile(
    r"(có\s+(các|những)\s+(cửa\s*hàng|cua\s*hang|outlet|chi\s*nhánh|chi\s*nhanh)"
    r"|co\s+(cac|nhung)\s+(cua\s*hang|outlet|chi\s*nhanh)"
    r"|danh\s*sách\s+(cửa|cua|outlet|chi\s+nhánh|chi\s+nhanh)"
    r"|danh\s*sach\s+(cua|outlet|chi\s+nhanh)"
    r"|liệt\s*kê\s+(outlet|cửa|cua)|liet\s*ke\s+(outlet|cua)"
    r")",
    re.IGNORECASE,
)
_OUTLET_CODE_RE = re.compile(r"\b[A-Z]{2,}(?:-[A-Z0-9]+){1,}-OUT-\d{1,6}\b", re.IGNORECASE)
_OUTLET_DETAIL_RE = re.compile(
    r"(thông\s*tin|thong\s*tin|chi\s*tiết|chi\s*tiet|detail|details?|info|profile)",
    re.IGNORECASE,
)
_BUSINESS_DATA_RE = re.compile(
    r"(doanh\s*thu|doanh\s*số|doanh\s*so|revenue|sales?|bán\s*hàng|ban\s*hang|"
    r"đơn\s*hàng|don\s*hang|hóa\s*đơn|hoa\s*don|đơn\s*mua\s*hàng|don\s*mua\s*hang|"
    r"tồn\s*kho|ton\s*kho|inventory|payment|thanh\s*toán|thanh\s*toan)",
    re.IGNORECASE,
)
_REVENUE_RE = re.compile(r"\b(doanh\s*thu|doanh\s*số|doanh\s*so|revenue|sales|gmv)\b", re.IGNORECASE)
_PEAK_HOUR_RE = re.compile(
    r"(giờ\s*cao\s*điểm|gio\s*cao\s*diem|khung\s*giờ\s*cao\s*điểm|khung\s*gio\s*cao\s*diem|"
    r"cao\s*điểm.*(bán\s*hàng|ban\s*hang|doanh\s*thu|sales|revenue)|"
    r"cao\s*diem.*(bán\s*hàng|ban\s*hang|doanh\s*thu|sales|revenue)|"
    r"(bán\s*hàng|ban\s*hang|doanh\s*thu|sales|revenue).*cao\s*điểm|"
    r"(bán\s*hàng|ban\s*hang|doanh\s*thu|sales|revenue).*cao\s*diem|"
    r"peak\s*hour|peak\s*sales\s*hour|giờ\s*vàng|gio\s*vang|khung\s*giờ\s*vàng|khung\s*gio\s*vang|"
    r"đông\s*khách\s*nhất|dong\s*khach\s*nhat|khách\s*đông\s*nhất|khach\s*dong\s*nhat|"
    r"bán\s*chạy\s*theo\s*giờ|ban\s*chay\s*theo\s*gio|"
    r"(giờ|gio|khung\s*giờ|khung\s*gio).*(bán\s*chạy\s*nhất|ban\s*chay\s*nhat|"
    r"doanh\s*thu\s*cao\s*nhất|doanh\s*thu\s*cao\s*nhat|nhiều\s*đơn\s*nhất|nhieu\s*don\s*nhat))",
    re.IGNORECASE,
)
_PAYMENT_CONTEXT_RE = re.compile(
    r"\b("
    r"thanh\s*toan|payment(?:\s+method)?|phuong\s+thuc\s+thanh\s+toan|"
    r"tien\s+mat|cash|card|bank\s*transfer|ewallet|thu\s+tien|capture|"
    r"the\s+(tin\s+dung|ghi\s+no|ngan\s+hang|atm)"
    r")\b",
    re.IGNORECASE,
)
_DETERMINISTIC_TEMPLATE_HINT_RE = re.compile(
    r"(cao\s+nhất|cao\s+nhat|nhiều\s+nhất|nhieu\s+nhat|top|xếp\s+hạng|xep\s+hang|ranking|rank|"
    r"cửa\s+hàng\s+nào|cua\s+hang\s+nao|outlet\s+nào|outlet\s+nao|"
    r"theo\s+(cửa\s+hàng|cua\s+hang|outlet|chi\s+nhánh|chi\s+nhanh)|"
    r"tổng\s+doanh\s+thu|tong\s+doanh\s+thu|tổng\s+cộng|tong\s+cong|toàn\s+bộ|toan\s+bo|"
    r"theo\s+ngày|theo\s+ngay|hằng\s+ngày|hang\s+ngay|xu\s+hướng|xu\s+huong|trend|"
    r"so\s+với|so\s+voi|so\s+sánh|so\s+sanh|compare|cùng\s+kỳ|cung\s+ky|same\s+period|"
    r"hủy\s+đơn|huy\s+don|cancel|thanh\s+toán|thanh\s+toan|payment|aov|basket|"
    r"số\s+đơn|so\s+don|giao\s+dịch|giao\s+dich)",
    re.IGNORECASE,
)
_STRICT_BUSINESS_TEMPLATE_RE = re.compile(
    r"(không\s+phát\s+sinh\s+doanh\s+thu|khong\s+phat\s+sinh\s+doanh\s+thu|"
    r"không\s+có\s+doanh\s+thu|khong\s+co\s+doanh\s+thu|zero\s+revenue|"
    r"chi\s*tiết\s*bán\s*hàng|chi\s*tiet\s*ban\s*hang|sales?\s*detail|order\s*detail|"
    r"đơn\s+mua\s+hàng|don\s*mua\s*hang|hóa\s*đơn\s*bán\s*hàng|hoa\s*don\s*ban\s*hang)",
    re.IGNORECASE,
)

_REASONING_SCHEMA: dict[str, Any] = {
    "name": "planning_decision",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "selected_domain": {"type": "string"},
            "selected_metric_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "selected_dataset_candidates": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "required_slots": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "missing_slots": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
            "recommended_template_keys": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
            "reject_reason_vi": {"type": "string"},
            "problem_paraphrase_vi": {"type": "string"},
            "grain_hypothesis_vi": {"type": "string"},
        },
        "required": [
            "selected_domain",
            "selected_metric_ids",
            "selected_dataset_candidates",
            "required_slots",
            "missing_slots",
            "recommended_template_keys",
            "reject_reason_vi",
            "problem_paraphrase_vi",
            "grain_hypothesis_vi",
        ],
        "additionalProperties": False,
    },
}


_SYSTEM = """Bạn là reasoning planner cho AI báo cáo vận hành/kế toán của F&B FERN.

NHIỆM VỤ: phân rã câu hỏi thành một dự thảo có cấu trúc để Matcher chọn **template báo cáo** phù hợp trong hệ.

QUY TẮC:
- KHÔNG sinh SQL.
- Chỉ chọn dataset candidate nếu có trong metadata/candidate tables được cung cấp.
- Nếu thiếu slot quan trọng, điền `missing_slots`; không cố chọn báo cáo gần đúng.
- `recommended_template_keys` chỉ là gợi ý; template matcher/verified asset vẫn quyết định cuối.
"""


def format_reasoning_outline_for_matcher(outline: dict[str, Any] | None) -> str:
    if not outline:
        return ""
    lines: list[str] = []

    pf = str(outline.get("problem_paraphrase_vi") or "").strip()
    dom = str(outline.get("domain") or "").strip()
    grain = str(outline.get("grain_hypothesis_vi") or "").strip()
    if pf:
        lines.append(f"- Diễn giải bài toán: {pf}")
    if dom:
        lines.append(f"- Lĩnh vực dự kiến: {dom}")
    if grain:
        lines.append(f"- Grain / chiều phân tích dự đoán: {grain}")

    for field, label in (
        ("metric_hypotheses_vi", "Chỉ số có thể cần"),
        ("implicit_filters_vi", "Bộ lọc ẩn / giả định"),
        ("verification_questions_vi", "Cần kiểm tra với người dùng"),
    ):
        vals = outline.get(field) or []
        if isinstance(vals, list) and vals:
            cleaned = [str(x).strip() for x in vals if str(x).strip()]
            if cleaned:
                lines.append(f"- {label}: {'; '.join(cleaned[:8])}")

    if not lines:
        return ""

    return "\nDự thảo tư duy (trước khi chọn template — căn cứ vào đây cùng câu hỏi gốc):\n" + "\n".join(lines) + "\n"


def format_planning_decision_for_matcher(
    decision: dict[str, Any] | None,
    *,
    planning_frame: dict[str, Any] | None = None,
) -> str:
    frame = planning_frame if isinstance(planning_frame, dict) else {}
    brief = str((decision or {}).get("executor_brief_vi") or frame.get("executor_brief_vi") or "").strip()
    directives = (decision or {}).get("executor_directives") or frame.get("executor_directives") or []
    if not isinstance(directives, list):
        directives = []

    blocks: list[str] = []
    if brief:
        blocks.append("Suy diễn planning — bắt buộc đọc trước khi chọn template/SQL:\n" + brief)
    dir_lines = [str(x).strip() for x in directives if str(x).strip()]
    if dir_lines:
        blocks.append(
            "Lệnh thực thi (Planner → agent dưới):\n" + "\n".join(f"{i + 1}. {d}" for i, d in enumerate(dir_lines[:10]))
        )

    if decision is None:
        return ("\n".join(blocks) + "\n") if blocks else ""

    lines: list[str] = []
    domain = str(decision.get("selected_domain") or "").strip()
    metrics = [str(x).strip() for x in (decision.get("selected_metric_ids") or []) if str(x).strip()]
    datasets = [str(x).strip() for x in (decision.get("selected_dataset_candidates") or []) if str(x).strip()]
    missing = [str(x).strip() for x in (decision.get("missing_slots") or []) if str(x).strip()]
    templates = [str(x).strip() for x in (decision.get("recommended_template_keys") or []) if str(x).strip()]
    if domain:
        lines.append(f"- Domain đã chọn: {domain}")
    if metrics:
        lines.append(f"- Metric IDs: {', '.join(metrics[:8])}")
    if datasets:
        lines.append(f"- Dataset candidates: {', '.join(datasets[:8])}")
    if templates:
        lines.append(f"- Template gợi ý: {', '.join(templates[:6])}")
    if missing:
        lines.append(f"- Missing slots: {', '.join(missing[:4])}")
    reject = str(decision.get("reject_reason_vi") or "").strip()
    if reject:
        lines.append(f"- Lý do chưa chạy: {reject}")
    spec = decision.get("report_spec")
    if isinstance(spec, dict) and spec:
        mode = str(spec.get("analysis_mode") or "")
        gb = spec.get("group_by")
        if mode or gb:
            lines.append(f"- Report spec: mode={mode or '?'}" + (f", group_by={gb}" if gb else ""))

    decision_block = ""
    if lines:
        decision_block = (
            "\nPlanning decision (authoritative; ask clarification if missing_slots non-empty):\n"
            + "\n".join(lines)
            + "\n"
        )
    head = ("\n".join(blocks) + "\n") if blocks else ""
    return head + decision_block


def _should_include_fallback_tables(state: GraphState, question: str) -> tuple[bool, int]:
    settings = get_settings()
    if not getattr(settings, "agent_extended_dataset_access_enabled", True):
        return False, 6
    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    task = str(frame.get("task_type") or "")
    domain = str(frame.get("domain") or "")
    metric_ids = [str(x).strip() for x in (frame.get("metric_ids") or []) if str(x).strip()]
    include_fallbacks = task in {"sales_detail", "peak_hour_analysis", "inventory", "pnl"} or domain in {
        "payment",
        "inventory",
        "pnl",
        "finance",
    }
    folded = _fold(question)
    if not include_fallbacks and any(
        x in folded
        for x in (
            "hoa don",
            "invoice",
            "supplier",
            "nha cung cap",
            "phieu nhap",
            "goods receipt",
            "expense",
            "chi phi",
            "chi tieu",
        )
    ):
        include_fallbacks = True
    if not include_fallbacks and any(x in folded for x in ("chi tiet", "detail", "event", "raw", "cdc")):
        include_fallbacks = True
    if not include_fallbacks and len(metric_ids) >= 2 and "net_revenue" in metric_ids and "txn_count" in metric_ids:
        include_fallbacks = True
    max_tables = int(getattr(settings, "agent_extended_dataset_max_tables", 10) or 10)
    return include_fallbacks, max(6, min(max_tables, 16))


def _selected_datasets(state: GraphState, intent: str | None, question: str) -> list[str]:
    include_fallbacks, max_tables = _should_include_fallback_tables(state, question)
    return candidate_tables_for_prompt(
        intent,
        question=question,
        max_tables=max_tables if include_fallbacks else 6,
        include_fallbacks=include_fallbacks,
    )


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _has_payment_context(folded_question: str) -> bool:
    return bool(_PAYMENT_CONTEXT_RE.search(folded_question))


def _is_product_revenue_ranking_question(folded: str) -> bool:
    productish = any(x in folded for x in ("san pham", "mat hang", "product"))
    revenueish = any(x in folded for x in ("doanh thu", "revenue", "sales"))
    rankish = any(x in folded for x in ("cao nhat", "nhieu nhat", "top", "xep hang", "ranking", "rank"))
    return productish and revenueish and rankish


def _is_inventory_question(folded: str, task: str) -> bool:
    return task == "inventory" or any(
        x in folded
        for x in (
            "ton kho",
            "ton am",
            "ton thap",
            "inventory",
            "stock",
            "hang con",
            "het hang",
            "sap het",
            "nguyen lieu",
        )
    )


def _report_spec_for_question(state: GraphState, question: str) -> dict[str, Any]:
    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    folded = _fold(question)
    task = str(frame.get("task_type") or "")
    metric_ids = [str(x).strip() for x in (frame.get("metric_ids") or []) if str(x).strip()]
    spec: dict[str, Any] = {
        "analysis_mode": "summary",
        "metric_focus": metric_ids[:4],
        "group_by": None,
        "time_axis": None,
        "comparison_mode": None,
        "ranking_mode": None,
        "needs_series": False,
    }

    if task == "sales_detail":
        spec.update({"analysis_mode": "detail_list", "group_by": "sale_line"})
        return spec
    if task == "zero_revenue_outlets":
        spec.update({"analysis_mode": "exception_list", "group_by": "outlet"})
        return spec
    if task == "peak_hour_analysis":
        spec.update({"analysis_mode": "distribution", "group_by": "hour_of_day", "time_axis": "hour_of_day", "ranking_mode": "top"})
        return spec

    if _is_inventory_question(folded, task):
        spec.update(
            {
                "analysis_mode": "snapshot",
                "metric_focus": ["qty_on_hand"],
                "group_by": "inventory_item",
                "time_axis": "latest_snapshot",
                "ranking_mode": "lowest",
            }
        )
        if any(x in folded for x in ("ton am", "am nhieu", "am nhat", "negative")):
            spec.update({"analysis_mode": "exception_list", "metric_focus": ["negative_stock", "qty_on_hand"]})
        elif any(x in folded for x in ("het hang", "sap het", "ton thap", "low stock", "reorder")):
            spec.update({"analysis_mode": "exception_list", "metric_focus": ["low_stock", "qty_on_hand"]})
        return spec

    if _has_payment_context(folded):
        spec.update({"analysis_mode": "breakdown", "group_by": "payment_method", "ranking_mode": "top"})
        return spec
    if any(x in folded for x in ("aov", "basket", "gia tri don hang trung binh", "trung binh don")):
        spec.update({"analysis_mode": "summary", "metric_focus": ["avg_basket_size"]})
        return spec
    if any(x in folded for x in ("so don", "so luong don", "transaction", "giao dich")):
        spec.update({"analysis_mode": "summary", "metric_focus": ["txn_count"]})
        return spec
    if any(x in folded for x in ("huy don", "cancel", "cancellation", "ty le huy")):
        spec.update({"analysis_mode": "summary", "metric_focus": ["cancellation_rate"]})
        return spec
    if any(x in folded for x in ("p&l", "lai lo", "loi nhuan", "profit", "margin")):
        spec.update({"analysis_mode": "summary", "metric_focus": ["operating_profit"]})
        return spec
    if any(x in folded for x in ("hoa don nha cung cap", "supplier invoice", "invoice approved", "hoa don da duyet")):
        spec.update({"analysis_mode": "event_summary", "metric_focus": ["supplier_invoice_approved"], "time_axis": "invoiceDate"})
        return spec
    if any(x in folded for x in ("phieu nhap", "nhap hang", "goods receipt", "gr posted")):
        spec.update({"analysis_mode": "event_summary", "metric_focus": ["goods_receipt"], "time_axis": "businessDate"})
        return spec
    if any(x in folded for x in ("chi phi", "expense", "khoan chi", "chi tieu")):
        spec.update({"analysis_mode": "event_summary", "metric_focus": ["expense_breakdown"], "time_axis": "createdAt"})
        return spec
    if any(x in folded for x in ("top san pham", "san pham ban chay", "best seller", "mat hang ban chay")) or _is_product_revenue_ranking_question(folded):
        spec.update({"analysis_mode": "ranking", "group_by": "product", "ranking_mode": "top"})
        return spec
    if any(x in folded for x in ("danh muc", "category", "nhom san pham", "nhom mon")):
        spec.update({"analysis_mode": "breakdown", "group_by": "category", "ranking_mode": "top"})
        return spec
    if any(x in folded for x in ("so voi", "so sanh", "compare", "cung ky", "same period")):
        spec.update({"analysis_mode": "comparison", "comparison_mode": "same_period_last_year"})
        return spec
    if any(
        x in folded
        for x in (
            "theo tuan",
            "tung tuan",
            "moi tuan",
            "weekly",
            "per week",
        )
    ):
        spec.update({"analysis_mode": "time_series", "time_axis": "week_start", "needs_series": True})
        return spec
    if any(x in folded for x in ("theo ngay", "hang ngay", "daily", "xu huong", "trend", "bieu do", "chart")):
        spec.update({"analysis_mode": "time_series", "time_axis": "business_date", "needs_series": True})
        return spec
    if any(x in folded for x in ("theo cua hang", "theo outlet", "theo chi nhanh", "so sanh cua hang", "so sanh outlet")):
        spec.update({"analysis_mode": "breakdown", "group_by": "outlet", "ranking_mode": "top"})
        return spec
    if any(x in folded for x in ("cao nhat", "nhieu nhat", "top", "xep hang", "ranking", "rank", "outlet nao", "cua hang nao")):
        spec.update({"analysis_mode": "ranking", "group_by": "outlet", "ranking_mode": "top"})
        return spec
    return spec


def _recommended_templates_from_spec(spec: dict[str, Any], question: str, *, intent: str) -> list[str]:
    folded = _fold(question)
    mode = str(spec.get("analysis_mode") or "")
    group_by = str(spec.get("group_by") or "")
    comparison = str(spec.get("comparison_mode") or "")
    metric_focus = {str(x).strip() for x in (spec.get("metric_focus") or []) if str(x).strip()}
    if group_by == "inventory_item" or "negative_stock" in metric_focus or "low_stock" in metric_focus or intent == "inventory":
        if mode == "exception_list" or "negative_stock" in metric_focus or "low_stock" in metric_focus:
            return ["T12_inventory_low_stock"]
        return ["T11_inventory_current_stock"]
    if mode == "detail_list":
        return ["T34_sales_detail_by_day"]
    if mode == "exception_list" and group_by == "outlet":
        return ["T33_zero_revenue_outlets"]
    if mode == "distribution" and group_by == "hour_of_day":
        return ["T23_peak_hour_analysis"]
    if mode == "comparison" and comparison == "same_period_last_year":
        return ["T07_revenue_comparison_yoy"]
    if group_by == "payment_method" and _has_payment_context(folded):
        return ["T08_revenue_by_payment_method"]
    if metric_focus == {"avg_basket_size"}:
        return ["T09_avg_basket_size"]
    if metric_focus == {"txn_count"}:
        return ["T10_transaction_count"]
    if metric_focus == {"cancellation_rate"}:
        return ["T30_sale_cancellation_rate"]
    if "operating_profit" in metric_focus:
        return ["T24_daily_pnl_summary"]
    if mode == "ranking" and group_by == "product":
        return ["T04_top_products"]
    if (
        intent == "product_mix"
        or group_by in {"category", "product_category"}
        or any(x in folded for x in ("danh muc", "category", "nhom san pham", "nhom mon"))
    ):
        return ["T03_revenue_by_category"]
    if mode == "time_series":
        if str(spec.get("time_axis") or "") == "week_start":
            return ["T35_weekly_revenue_trend"]
        return ["T01_daily_revenue"]
    if mode == "ranking" and group_by == "outlet":
        return ["T22_outlet_rank"]
    if mode == "breakdown" and group_by == "outlet":
        return ["T02_revenue_by_outlet"]
    if intent == "outlet_compare":
        if mode == "ranking" or any(
            x in folded for x in ("top", "cao nhat", "thap nhat", "tot nhat", "yeu nhat", "xep hang", "ranking", "rank")
        ):
            return ["T22_outlet_rank"]
        return ["T02_revenue_by_outlet"]
    if intent in {"revenue", "trend", "outlet_compare"}:
        return ["T32_period_revenue_summary"]
    return []


def _decision_from_frame(state: GraphState, question: str) -> dict[str, Any]:
    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    intent = str(state.get("intent") or frame.get("intent") or "")
    time_range = state.get("time_range") or {}
    required: list[str] = []
    if intent not in {"lookup", "greeting", "thanks", "hr_staff"}:
        required.append("time_range")
    missing = [str(x).strip() for x in (frame.get("ambiguities") or []) if str(x).strip()]
    report_spec = _report_spec_for_question(state, question)
    spec_templates = _recommended_templates_from_spec(report_spec, question, intent=intent)
    verified = select_verified_query(question=question, intent=intent, time_range=time_range if isinstance(time_range, dict) else {})
    templates: list[str] = []
    if verified and not (
        verified.template_key == "T32_period_revenue_summary"
        and spec_templates
        and spec_templates[0] in {"T22_outlet_rank", "T02_revenue_by_outlet", "T03_revenue_by_category"}
    ):
        templates.append(verified.template_key)
    elif frame.get("next_action") == "verified_template":
        task = str(frame.get("task_type") or "")
        if task == "sales_detail":
            templates.append("T34_sales_detail_by_day")
        elif task == "zero_revenue_outlets":
            templates.append("T33_zero_revenue_outlets")
        elif task == "peak_hour_analysis":
            templates.append("T23_peak_hour_analysis")
    if not templates:
        templates = spec_templates
    out: dict[str, Any] = {
        "selected_domain": str(frame.get("domain") or ""),
        "selected_metric_ids": list(frame.get("metric_ids") or []),
        "selected_dataset_candidates": _selected_datasets(state, intent, question),
        "required_slots": required,
        "missing_slots": missing,
        "recommended_template_keys": templates,
        "report_spec": report_spec,
        "reject_reason_vi": "Thiếu " + ", ".join(missing) if missing else "",
        "problem_paraphrase_vi": question,
        "grain_hypothesis_vi": str(frame.get("grain") or ""),
    }
    eb = str(frame.get("executor_brief_vi") or "").strip()
    if eb:
        out["executor_brief_vi"] = eb
    ed = frame.get("executor_directives")
    if isinstance(ed, list) and ed:
        out["executor_directives"] = list(ed)
    return out


def _clarification_for_missing(missing: list[str]) -> str:
    first = missing[0] if missing else ""
    if first == "time_range":
        return "Bạn muốn xem khoảng thời gian nào (hôm nay, 7 ngày gần nhất, hay tháng này)?"
    if first == "metric_or_report":
        return "Bạn muốn xem báo cáo/chỉ số nào?"
    if first == "comparison_target":
        return "Bạn muốn so sánh chỉ số nào và với kỳ nào?"
    return "Bạn vui lòng làm rõ thêm báo cáo cần xem."


def _install_planning_decision(state: GraphState, decision: dict[str, Any]) -> None:
    state["planning_decision"] = decision
    missing = [str(x).strip() for x in (decision.get("missing_slots") or []) if str(x).strip()]
    if missing:
        state["response_kind"] = "clarification"
        state["response_hints"] = missing
        state["clarification_question"] = _clarification_for_missing(missing)


async def query_reasoner(state: GraphState) -> GraphState:
    if not get_settings().query_reasoning_enabled:
        state.setdefault("trace", []).append({"node": "query_reasoner", "skipped": True, "reason": "disabled"})
        return state

    intent = state.get("intent") or ""
    if intent == "hr_staff":
        state.setdefault("trace", []).append({"node": "query_reasoner", "skipped": True, "reason": "hr_staff"})
        return state
    if intent in ("greeting", "thanks"):
        state.setdefault("trace", []).append({"node": "query_reasoner", "skipped": True, "reason": "social"})
        return state

    normalized = question_text(state)
    if not normalized:
        state.setdefault("trace", []).append({"node": "query_reasoner", "skipped": True, "reason": "empty_question"})
        return state

    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    if frame:
        decision = _decision_from_frame(state, normalized)
        _install_planning_decision(state, decision)
        if decision.get("missing_slots"):
            state["reasoning_outline"] = {}
            state.setdefault("trace", []).append(
                {
                    "node": "query_reasoner",
                    "source": "planning_frame",
                    "next_action": "ask_clarification",
                    "reason": "missing_slots",
                }
            )
            return state

    if intent in ("lookup", "unknown") and not _BUSINESS_DATA_RE.search(normalized) and (
        _OUTLET_LOOKUP_RE.search(normalized)
        or (_OUTLET_CODE_RE.search(normalized) and _OUTLET_DETAIL_RE.search(normalized))
    ):
        _install_planning_decision(state, _decision_from_frame(state, normalized))
        state["reasoning_outline"] = {}
        state.setdefault("trace", []).append({"node": "query_reasoner", "skipped": True, "reason": "deterministic_outlet_lookup"})
        return state

    time_range = state.get("time_range") or {}
    if (
        intent in {"revenue", "outlet_compare", "trend"}
        and isinstance(time_range, dict)
        and time_range.get("from_date")
        and time_range.get("to_date")
        and (
            _REVENUE_RE.search(normalized)
            or _DETERMINISTIC_TEMPLATE_HINT_RE.search(normalized)
            or _STRICT_BUSINESS_TEMPLATE_RE.search(normalized)
            or _PEAK_HOUR_RE.search(normalized)
        )
    ):
        _install_planning_decision(state, _decision_from_frame(state, normalized))
        state["reasoning_outline"] = {}
        state.setdefault("trace", []).append(
            {"node": "query_reasoner", "skipped": True, "reason": "deterministic_template_shortcut"}
        )
        return state

    if intent == "inventory" or _is_inventory_question(_fold(normalized), str(frame.get("task_type") or "")):
        _install_planning_decision(state, _decision_from_frame(state, normalized))
        state["reasoning_outline"] = {}
        state.setdefault("trace", []).append(
            {"node": "query_reasoner", "skipped": True, "reason": "deterministic_inventory_shortcut"}
        )
        return state

    ctx = (state.get("conversation_context") or "").strip()
    ctx_block = f"Ngữ cảnh gần đây:\n{ctx}\n" if ctx else ""
    catalog_block = format_catalog_digest_for_prompt(state.get("catalog_digest"))
    metadata_block = format_metadata_context_for_prompt(state.get("metadata_context"))
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))
    candidate_tables = _selected_datasets(state, intent, normalized)
    candidate_block = f"Candidate datasets được phép cho planner: {candidate_tables}\n" if candidate_tables else ""

    original = (state.get("normalized_question") or "").strip()
    original_block = f"Câu hỏi gốc: {original}\n" if original and original != normalized else ""

    user_prompt = f"""{original_block}Câu hỏi hiệu lực: {normalized}
Supervisor intent: {intent}
Khoảng thời gian (supervisor): {time_range}
{candidate_block}{time_block}{coverage_block}{metadata_block}{catalog_block}{ctx_block}
"""

    try:
        parsed, usage = await llm_call_json(
            system_prompt=_SYSTEM,
            user_prompt=user_prompt,
            json_schema=_REASONING_SCHEMA,
            temperature=0.15,
            max_tokens=600,
            agent="sql_planner",
        )
        decision = parsed if isinstance(parsed, dict) else {}
        allowed = set(_selected_datasets(state, intent, normalized))
        decision["selected_dataset_candidates"] = [
            str(x).strip()
            for x in (decision.get("selected_dataset_candidates") or [])
            if str(x).strip() in allowed
        ]
        if "report_spec" not in decision or not isinstance(decision.get("report_spec"), dict):
            decision["report_spec"] = _report_spec_for_question(state, normalized)
        if not decision.get("recommended_template_keys"):
            decision["recommended_template_keys"] = _recommended_templates_from_spec(
                decision.get("report_spec") or {},
                normalized,
                intent=intent,
            )
        pframe = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
        if pframe.get("executor_brief_vi"):
            decision["executor_brief_vi"] = pframe["executor_brief_vi"]
        if pframe.get("executor_directives"):
            decision["executor_directives"] = pframe["executor_directives"]
        _install_planning_decision(state, decision)
        state["reasoning_outline"] = {
            "problem_paraphrase_vi": str(decision.get("problem_paraphrase_vi") or ""),
            "domain": str(decision.get("selected_domain") or "other"),
            "grain_hypothesis_vi": str(decision.get("grain_hypothesis_vi") or ""),
            "metric_hypotheses_vi": list(decision.get("selected_metric_ids") or []),
            "implicit_filters_vi": [],
            "verification_questions_vi": list(decision.get("missing_slots") or []),
        }
        ext = usage if isinstance(usage, dict) else {}
        state.setdefault("trace", []).append(
            {
                "node": "query_reasoner",
                **ext,
                "next_action": "ask_clarification" if decision.get("missing_slots") else "template_match",
            }
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("query_reasoner LLM failed: %s", e)
        _install_planning_decision(state, _decision_from_frame(state, normalized))
        state["reasoning_outline"] = {}
        state.setdefault("trace", []).append(
            {"node": "query_reasoner", "tokens_in": 0, "tokens_out": 0, "latency_ms": 0, "error": str(e)[:160]}
        )
    return state
