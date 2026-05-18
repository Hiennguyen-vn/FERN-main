"""Pick best SQL template via OpenSearch + GPT-4.1."""
import logging
import re
import unicodedata
from datetime import date, timedelta

from app.clients.opensearch import hybrid_search_templates
from app.config import get_settings
from app.query_policy import select_learned_scenario, select_sql_writer_scenario, select_verified_query
from app.graph.state import GraphState
from app.graph.nodes.catalog_digest import format_catalog_digest_for_prompt
from app.graph.nodes.data_coverage import format_data_coverage_for_prompt
from app.graph.nodes.metadata_context import format_metadata_context_for_prompt
from app.graph.nodes.query_reasoner import format_planning_decision_for_matcher, format_reasoning_outline_for_matcher
from app.graph.question_frame import question_text, question_time_range
from app.knowledge.lexicon import format_lexicon_hints
from app.llm.openai_client import embed, llm_call_json
from app.templates.registry import TEMPLATES, list_templates
from app.time_utils import format_time_context_for_prompt, has_time_expression

logger = logging.getLogger(__name__)


_TIME_HINT = re.compile(
    r"\b(hôm nay|hom nay|hôm qua|hom qua|tuần này|tuan nay|tuần trước|tuan truoc|"
    r"tháng này|thang nay|tháng trước|thang truoc|quý|quy|năm|nam|7 ngày|7 ngay|"
    r"30 ngày|30 ngay|yesterday|today|week|month|year|từ ngày|tu ngay|đến ngày|den ngay)\b",
    re.IGNORECASE,
)
_GENERIC_METRIC_QUESTION = re.compile(
    r"^\s*(doanh\s*(thu|số)|revenue|sales|tồn\s*kho|ton\s*kho|inventory|"
    r"chi\s*phí|chi\s*phi|lãi\s*lỗ|lai\s*lo|p&l|profit|top\s+sản\s*phẩm|top\s+san\s+pham)"
    r"\s*[?!.]*\s*$",
    re.IGNORECASE,
)

_OUTLET_LIST_QUESTION = re.compile(
    r"(có\s+những\s+(cửa\s*hàng|cua\s*hang)|co\s+nhung\s+(cửa\s*hàng|cua\s*hang)|"
    r"những\s+(cửa\s*hàng|cua\s*hang)\s+nào|(cửa\s*hàng|cua\s*hang)\s+nào|"
    r"danh\s*sách\s+(cửa|cua|outlet|chi\s+nhánh|chi\s+nhanh)|liệt\s*kê\s+(outlet|cửa|cua)|"
    r"(outlet|chi\s+nhánh|chi\s+nhanh)\s+(nào|có\s+gì|trong\s+hệ\s+thống|trong\s+he\s+thong)|"
    r"(hệ\s+thống|he\s+thong)\s+có\s+(những\s+)?(cửa\s*hàng|cua\s*hang|outlet)|"
    r"tất\s+cả\s+(cửa\s*hàng|cua\s*hang|outlet)|store\s+list|list\s+outlets?)",
    re.IGNORECASE,
)
_OUTLET_CODE_RE = re.compile(r"\b[A-Z]{2,}(?:-[A-Z0-9]+){1,}-OUT-\d{1,6}\b", re.IGNORECASE)
_OUTLET_DETAIL_RE = re.compile(
    r"(thông\s*tin|thong\s*tin|chi\s*tiết|chi\s*tiet|detail|details?|info|profile|hồ\s*sơ|ho\s*so)",
    re.IGNORECASE,
)
_BUSINESS_DETAIL_RE = re.compile(
    r"(chi\s*tiết\s*bán\s*hàng|chi\s*tiet\s*ban\s*hang|sales?\s*detail|order\s*detail|"
    r"chi\s*tiết.*(đơn\s*hàng|don\s*hang|hóa\s*đơn|hoa\s*don|đơn\s*mua\s*hàng|don\s*mua\s*hang)|"
    r"(các\s*)?(đơn\s*hàng|don\s*hang|hóa\s*đơn|hoa\s*don|đơn\s*mua\s*hàng|don\s*mua\s*hang))",
    re.IGNORECASE,
)
_BUSINESS_DATA_RE = re.compile(
    r"(doanh\s*thu|doanh\s*số|doanh\s*so|revenue|sales?|bán\s*hàng|ban\s*hang|"
    r"đơn\s*hàng|don\s*hang|hóa\s*đơn|hoa\s*don|đơn\s*mua\s*hàng|don\s*mua\s*hang|"
    r"tồn\s*kho|ton\s*kho|inventory|payment|thanh\s*toán|thanh\s*toan)",
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


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _has_payment_context(folded_question: str) -> bool:
    return bool(_PAYMENT_CONTEXT_RE.search(folded_question))


def _params_from_time_range(time_range: dict) -> dict[str, str]:
    fd = str(time_range.get("from_date") or "").strip()
    td = str(time_range.get("to_date") or "").strip()
    return {"from_date": fd, "to_date": td} if fd and td else {}


def _rank_direction_from_folded_question(folded_question: str) -> str | None:
    if any(
        term in folded_question
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


def _outlet_rank_params(params: dict[str, str | int], folded_question: str) -> dict[str, str | int]:
    rank_direction = _rank_direction_from_folded_question(folded_question)
    if not rank_direction:
        return dict(params)
    return {**params, "rank_direction": rank_direction}


def _split_time_range_for_period_bridge(from_date: str, to_date: str) -> dict[str, str] | None:
    """Split inclusive [from_date, to_date] into earlier half (B) and later half (A) for T36.

    Period A is the more recent segment (driver-bridge prose compares B → A).
    A single-day window compares that day (A) vs the previous calendar day (B).
    """
    try:
        fd = date.fromisoformat(from_date[:10])
        td = date.fromisoformat(to_date[:10])
    except ValueError:
        return None
    if td < fd:
        return None
    total_days = (td - fd).days + 1
    if total_days < 1:
        return None
    if total_days == 1:
        prev_day = fd - timedelta(days=1)
        return {
            "from_date_a": fd.isoformat(),
            "to_date_a": fd.isoformat(),
            "from_date_b": prev_day.isoformat(),
            "to_date_b": prev_day.isoformat(),
        }
    half = total_days // 2
    if half < 1:
        return None
    to_b = fd + timedelta(days=half - 1)
    from_a = fd + timedelta(days=half)
    return {
        "from_date_b": fd.isoformat(),
        "to_date_b": to_b.isoformat(),
        "from_date_a": from_a.isoformat(),
        "to_date_a": td.isoformat(),
    }


def _limit_from_question(question_folded: str, *, default: int = 10, cap: int = 100) -> int:
    m = re.search(r"\b(?:top|limit)\s+(\d{1,3})\b", question_folded)
    if not m:
        m = re.search(r"\b(\d{1,3})\s+(?:san pham|mat hang|items?|products?)\b", question_folded)
    if not m:
        return default
    try:
        value = int(m.group(1))
    except ValueError:
        return default
    return max(1, min(value, cap))


def _inventory_fast_match(question_folded: str) -> tuple[str, dict[str, str | int], float] | None:
    inventoryish = any(
        x in question_folded
        for x in (
            "ton kho",
            "inventory",
            "stock",
            "hang con",
            "het hang",
            "sap het",
            "mat hang",
            "nguyen lieu",
        )
    )
    if not inventoryish:
        return None

    params: dict[str, str | int] = {}
    if any(x in question_folded for x in ("ton am", "am nhieu", "am nhat", "negative")):
        params["threshold"] = 0
        return "T12_inventory_low_stock", params, 0.92
    if any(x in question_folded for x in ("het hang", "sap het", "ton thap", "low stock", "reorder")):
        threshold_match = re.search(r"\b(?:duoi|nho hon|less than|threshold)\s+(-?\d{1,6})\b", question_folded)
        params["threshold"] = int(threshold_match.group(1)) if threshold_match else 10
        return "T12_inventory_low_stock", params, 0.9
    if any(x in question_folded for x in ("hien tai", "current", "bay gio", "con bao nhieu", "dang con")):
        params["limit"] = _limit_from_question(question_folded, default=100, cap=500)
        return "T11_inventory_current_stock", params, 0.88
    return None


def _sales_detail_fast_match(question_folded: str, params: dict[str, str]) -> tuple[str, dict[str, str | int], float] | None:
    if not params:
        return None
    detailish = any(
        x in question_folded
        for x in (
            "chi tiet ban hang",
            "sales detail",
            "sale detail",
            "order detail",
            "chi tiet don hang",
            "chi tiet hoa don",
            "don mua hang",
            "cac don mua hang",
            "hoa don ban hang",
        )
    )
    if detailish:
        return "T34_sales_detail_by_day", dict(params), 0.96

    asks_listing = any(x in question_folded for x in ("liet ke", "danh sach", "chi tiet", "cac don"))
    sales_orderish = any(
        x in question_folded
        for x in (
            "don hang",
            "hoa don",
            "ban hang",
            "sale record",
            "sales order",
        )
    )
    if asks_listing and sales_orderish:
        return "T34_sales_detail_by_day", dict(params), 0.94
    return None


def _zero_revenue_fast_match(question_folded: str, params: dict[str, str]) -> tuple[str, dict[str, str | int], float] | None:
    if not params:
        return None
    outletish = any(x in question_folded for x in ("cua hang", "outlet", "chi nhanh"))
    zeroish = any(
        x in question_folded
        for x in (
            "khong phat sinh doanh thu",
            "khong co doanh thu",
            "chua co doanh thu",
            "doanh thu bang 0",
            "zero revenue",
            "khong ban duoc",
            "chua ban duoc",
            "khong co giao dich",
        )
    )
    if outletish and zeroish:
        return "T33_zero_revenue_outlets", dict(params), 0.96
    return None


def _peak_hour_fast_match(question_folded: str, params: dict[str, str]) -> tuple[str, dict[str, str | int], float] | None:
    if not params:
        return None
    peakish = any(
        x in question_folded
        for x in (
            "gio cao diem",
            "khung gio cao diem",
            "cao diem ban hang",
            "cao diem doanh thu",
            "ban hang cao diem",
            "doanh thu cao diem",
            "peak hour",
            "peak sales hour",
            "gio vang",
            "khung gio vang",
            "dong khach nhat",
            "khach dong nhat",
            "ban chay theo gio",
        )
    )
    peak_salesish = (
        "cao diem" in question_folded
        and any(x in question_folded for x in ("ban hang", "doanh thu", "sales", "revenue"))
    )
    hour_sales_rankish = (
        any(x in question_folded for x in ("gio", "khung gio"))
        and any(
            x in question_folded
            for x in (
                "ban chay nhat",
                "doanh thu cao nhat",
                "nhieu don nhat",
                "giao dich nhieu nhat",
            )
        )
    )
    if peakish or peak_salesish or hour_sales_rankish:
        return "T23_peak_hour_analysis", dict(params), 0.95
    return None


def _has_explicit_or_context_time(state: GraphState, effective_question: str) -> bool:
    time_ctx = state.get("time_context")
    if isinstance(time_ctx, dict):
        if time_ctx.get("current_has_time_expression") or time_ctx.get("is_time_followup"):
            return True
    frame = state.get("question_frame")
    if isinstance(frame, dict) and frame.get("followup_source"):
        return True
    current = str(state.get("normalized_question") or state.get("raw_question") or "").strip()
    if has_time_expression(current):
        return True
    return bool(current and effective_question != current and has_time_expression(effective_question))


def _fast_template_match(question: str, intent: str | None, time_range: dict) -> tuple[str, dict[str, str | int], float] | None:
    """Deterministic shortcuts for common, unambiguous template questions."""
    q = _fold(question)
    params = _params_from_time_range(time_range)
    intent_key = (intent or "").strip().lower()

    if intent_key in {"greeting", "thanks", "hr_staff"}:
        return None

    inventory_fast = _inventory_fast_match(q)
    if inventory_fast:
        return inventory_fast

    if not params:
        return None

    sales_detail_fast = _sales_detail_fast_match(q, params)
    if sales_detail_fast:
        return sales_detail_fast

    zero_revenue_fast = _zero_revenue_fast_match(q, params)
    if zero_revenue_fast:
        return zero_revenue_fast

    peak_hour_fast = _peak_hour_fast_match(q, params)
    if peak_hour_fast:
        return peak_hour_fast

    revenueish = any(x in q for x in ("doanh thu", "doanh so", "revenue", "sales", "gmv"))
    txn_or_aovish = any(
        x in q
        for x in (
            "aov",
            "basket",
            "gia tri don hang trung binh",
            "trung binh don",
            "giao dich",
            "transaction",
            "so don",
            "so luong don",
        )
    )
    revenueish = revenueish or txn_or_aovish
    rankish = any(
        x in q
        for x in (
            "cao nhat",
            "thap nhat",
            "yeu nhat",
            "kem nhat",
            "te nhat",
            "nhieu nhat",
            "top",
            "lowest",
            "worst",
            "bottom",
            "xep hang",
            "ranking",
            "rank",
            "cua hang nao",
            "outlet nao",
        )
    )
    outletish = any(
        x in q
        for x in (
            "theo cua hang",
            "theo outlet",
            "theo chi nhanh",
            "outlet ",
            "cua hang ",
            "chi nhanh ",
            "giua cac outlet",
            "so sanh",
            "xep hang outlet",
            "ranking outlet",
        )
    )
    dailyish = any(x in q for x in ("theo ngay", "hang ngay", "daily", "xu huong", "trend", "bieu do", "chart"))
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
    fixed_window_trendish = any(x in q for x in ("7 ngay", "30 ngay"))
    comparisonish = any(x in q for x in ("so voi", "so sanh", "compare", "cung ky"))
    yoyish = any(x in q for x in ("cung ky", "nam ngoai", "last year"))
    summaryish = any(
        x in q
        for x in (
            "tat ca cua hang",
            "all outlets",
            "toan bo",
            "tong doanh thu",
            "tong cong",
            "total revenue",
            "ca he thong",
        )
    )

    if revenueish:
        if comparisonish and yoyish:
            return "T07_revenue_comparison_yoy", params, 0.94
        if any(x in q for x in ("danh muc", "category", "nhom san pham", "nhom mon")):
            return "T03_revenue_by_category", params, 0.88
        if rankish:
            return "T22_outlet_rank", _outlet_rank_params(params, q), 0.94
        if any(x in q for x in ("huy don", "cancel", "cancellation")):
            return "T30_sale_cancellation_rate", params, 0.9
        if _has_payment_context(q):
            return "T08_revenue_by_payment_method", params, 0.9
        changeish = any(x in q for x in ("thay doi", "bien dong", "chenh lech"))
        driver_metricish = txn_or_aovish or any(
            x in q for x in ("doanh thu", "doanh so", "revenue", "tang truong", "suy giam", "giam manh")
        )
        if (
            changeish
            and driver_metricish
            and params.get("from_date")
            and params.get("to_date")
        ):
            bridge_params = _split_time_range_for_period_bridge(params["from_date"], params["to_date"])
            if bridge_params:
                return "T36_revenue_period_driver_bridge", bridge_params, 0.93
        if any(x in q for x in ("aov", "basket", "gia tri don hang trung binh", "trung binh don")):
            return "T09_avg_basket_size", params, 0.9
        if any(x in q for x in ("so don", "so luong don", "transaction", "giao dich")):
            return "T10_transaction_count", params, 0.9
        if summaryish and not dailyish:
            return "T32_period_revenue_summary", params, 0.93
        if outletish:
            return "T02_revenue_by_outlet", params, 0.94
        if "7 ngay" in q and fixed_window_trendish:
            return "T05_revenue_trend_7d", {}, 0.92
        if "30 ngay" in q and fixed_window_trendish:
            return "T06_revenue_trend_30d", {}, 0.92
        if weeklyish:
            return "T35_weekly_revenue_trend", params, 0.91
        if dailyish or intent_key == "trend":
            return "T01_daily_revenue", params, 0.93
        return "T32_period_revenue_summary", params, 0.9

    if any(x in q for x in ("top san pham", "san pham ban chay", "best seller", "mat hang ban chay")):
        out = dict(params)
        out["limit"] = _limit_from_question(q, default=10)
        return "T04_top_products", out, 0.92

    if any(x in q for x in ("p&l", "lai lo", "loi nhuan", "profit", "margin")):
        return "T24_daily_pnl_summary", params, 0.88

    implicit_series = params and (
        intent_key in {"trend", "revenue"} or dailyish or weeklyish
    )
    if implicit_series:
        if weeklyish:
            return "T35_weekly_revenue_trend", params, 0.87
        if dailyish or intent_key in {"trend", "revenue"}:
            return "T01_daily_revenue", params, 0.86

    return None


def _template_from_planning_decision(
    decision: dict[str, object] | None,
    *,
    question: str,
    intent: str | None,
    time_range: dict[str, object],
) -> tuple[str, dict[str, str | int], float] | None:
    if not isinstance(decision, dict):
        return None
    question_folded = _fold(question)
    params = _params_from_time_range(time_range)

    recommended = [str(x).strip() for x in (decision.get("recommended_template_keys") or []) if str(x).strip()]
    for key in recommended:
        if key in TEMPLATES:
            meta = TEMPLATES[key]
            if any(p in {"from_date", "to_date"} for p in meta.required_params) and not params:
                continue
            out = dict(params)
            if key == "T04_top_products":
                out["limit"] = _limit_from_question(question_folded, default=10)
            elif key == "T11_inventory_current_stock":
                out["limit"] = _limit_from_question(question_folded, default=100, cap=500)
            elif key == "T12_inventory_low_stock":
                out["threshold"] = 0 if any(x in question_folded for x in ("ton am", "am nhieu", "am nhat", "negative")) else 10
            if key == "T08_revenue_by_payment_method" and not _has_payment_context(question_folded):
                continue
            return key, out, 0.91

    spec = decision.get("report_spec")
    if not isinstance(spec, dict):
        return None

    mode = str(spec.get("analysis_mode") or "")
    group_by = str(spec.get("group_by") or "")
    comparison = str(spec.get("comparison_mode") or "")
    metric_focus = {str(x).strip() for x in (spec.get("metric_focus") or []) if str(x).strip()}
    out = dict(params)

    if group_by == "inventory_item" or "negative_stock" in metric_focus or "low_stock" in metric_focus or (intent or "").strip().lower() == "inventory":
        if mode == "exception_list" or "negative_stock" in metric_focus or "low_stock" in metric_focus:
            out["threshold"] = 0 if "negative_stock" in metric_focus or "ton am" in question_folded else 10
            return "T12_inventory_low_stock", out, 0.9
        out["limit"] = _limit_from_question(question_folded, default=100, cap=500)
        return "T11_inventory_current_stock", out, 0.89
    if not params:
        return None
    if mode == "detail_list":
        return "T34_sales_detail_by_day", out, 0.9
    if mode == "exception_list" and group_by == "outlet":
        return "T33_zero_revenue_outlets", out, 0.9
    if mode == "distribution" and group_by == "hour_of_day":
        return "T23_peak_hour_analysis", out, 0.9
    if mode == "comparison" and comparison == "same_period_last_year":
        return "T07_revenue_comparison_yoy", out, 0.9
    if group_by == "payment_method" and _has_payment_context(question_folded):
        return "T08_revenue_by_payment_method", out, 0.89
    if "avg_basket_size" in metric_focus:
        return "T09_avg_basket_size", out, 0.89
    if metric_focus == {"txn_count"}:
        return "T10_transaction_count", out, 0.89
    if "cancellation_rate" in metric_focus:
        return "T30_sale_cancellation_rate", out, 0.88
    if "operating_profit" in metric_focus:
        return "T24_daily_pnl_summary", out, 0.88
    if mode == "ranking" and group_by == "product":
        out["limit"] = _limit_from_question(_fold(question), default=10)
        return "T04_top_products", out, 0.88
    if (
        (intent or "").strip().lower() == "product_mix"
        or group_by in {"category", "product_category"}
        or any(x in question_folded for x in ("danh muc", "category", "nhom san pham", "nhom mon"))
    ):
        return "T03_revenue_by_category", out, 0.88
    if mode == "time_series":
        if str(spec.get("time_axis") or "") == "week_start":
            return "T35_weekly_revenue_trend", out, 0.88
        return "T01_daily_revenue", out, 0.88
    if mode == "ranking" and group_by == "outlet":
        return "T22_outlet_rank", _outlet_rank_params(out, question_folded), 0.88
    if mode == "breakdown" and group_by == "outlet":
        return "T02_revenue_by_outlet", out, 0.88
    if (intent or "").strip().lower() == "outlet_compare":
        if mode == "ranking" or any(
            x in question_folded for x in ("top", "cao nhat", "thap nhat", "tot nhat", "yeu nhat", "xep hang", "ranking", "rank")
        ):
            return "T22_outlet_rank", _outlet_rank_params(out, question_folded), 0.88
        return "T02_revenue_by_outlet", out, 0.88
    if (intent or "").strip().lower() in {"revenue", "trend", "outlet_compare"}:
        return "T32_period_revenue_summary", out, 0.86
    return None


_SQL_WRITER_ONLY_METRICS = frozenset({
    "supplier_invoice_approved",
    "goods_receipt",
    "expense_breakdown",
})


def _planning_requires_sql_writer(decision: dict[str, object] | None) -> bool:
    if not isinstance(decision, dict):
        return False
    metric_focus: set[str] = {
        str(x).strip()
        for x in [
            *(decision.get("selected_metric_ids") or []),
            *((decision.get("report_spec") or {}).get("metric_focus") if isinstance(decision.get("report_spec"), dict) else []),
        ]
        if str(x).strip()
    }
    if metric_focus & _SQL_WRITER_ONLY_METRICS:
        return True
    spec = decision.get("report_spec")
    if isinstance(spec, dict) and str(spec.get("analysis_mode") or "") == "event_summary":
        return True
    return False


def _schema(allowed_keys: list[str]) -> dict:
    return {
        "name": "template_match_result",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "template_key": {"type": ["string", "null"], "enum": [*allowed_keys, None]},
                "params": {
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
                "confidence": {"type": "number"},
                "missing_info": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["template_key", "params", "confidence", "missing_info"],
            "additionalProperties": False,
        },
    }


_SYSTEM = """Bạn là Template Matcher cho AI Query Assistant của FERN.

NHIỆM VỤ: chọn 1 template_key phù hợp nhất từ danh sách candidates được cung cấp.

QUY TẮC NGHIÊM NGẶT:
- KHÔNG sinh SQL mới. Chỉ chọn template_key từ danh sách.
- Fill params từ time_range và resolved_entities được cung cấp.
- KHÔNG đặt outlet_id vào params (backend tự inject).
- Date format: YYYY-MM-DD.
- Nếu không có template phù hợp HOẶC thiếu thông tin → template_key = null, missing_info liệt kê **đúng một** đầu mục thiếu quan trọng nhất (ưu tiên: khoảng thời gian → outlet/phạm vi → chỉ số/báo cáo) — không liệt kê checklist dài.
- confidence: 0..1.
- Ưu tiên khớp câu hỏi với **mục đích nghiệp vụ** trong khối "Gợi ý nghiệp vụ" (nếu có).
"""


HR_UNSUPPORTED = (
    "AI Analyst hiện **chưa hỗ trợ** tra cứu danh sách nhân viên, ca làm hay hồ sơ HR. "
    "Bạn có thể dùng module Nhân sự trên hệ thống FERN, "
    "hoặc hỏi các báo cáo vận hành/kinh doanh trong phạm vi doanh thu, tồn kho, sản phẩm."
)


def _missing_info_message(missing: list[str]) -> str | None:
    cleaned = [str(m).strip() for m in missing if str(m).strip()]
    if not cleaned:
        return None
    blob = " ".join(cleaned).lower()
    # Không map sang “chọn một outlet” khi LLM báo thiếu template / danh sách master.
    if any(
        x in blob
        for x in (
            "template",
            "master",
            "liệt kê",
            "liet ke",
            "danh sách",
            "danh sach",
            "không có",
            "khong co",
            "outlet list",
        )
    ):
        return None
    first = cleaned[0].lower()
    if "date" in first or "time" in first or "thời gian" in first or "khoảng" in first:
        return "Bạn muốn xem khoảng thời gian nào (hôm nay, 7 ngày gần nhất, hay tháng này)?"
    if "outlet" in first or "cửa hàng" in first or "chi nhánh" in first:
        return "Bạn muốn xem outlet / cửa hàng nào?"
    if "metric" in first or "chỉ số" in first or "báo cáo" in first:
        return "Bạn muốn xem chỉ số hoặc báo cáo nào?"
    return f"Bạn vui lòng làm rõ thêm: {cleaned[0]}"


def _generic_metric_clarification(question: str, context: str) -> str | None:
    if context.strip():
        return None
    if _GENERIC_METRIC_QUESTION.match(question) and not _TIME_HINT.search(question):
        return "Bạn muốn xem khoảng thời gian nào (hôm nay, 7 ngày gần nhất, hay tháng này)? Nếu có outlet cụ thể hãy ghi tên."
    return None


def _clarification_for_failed_match(state: GraphState, missing_info: list[str]) -> tuple[str, str, list[str]]:
    """Returns (question_text, response_kind, hints)."""
    intent = state.get("intent") or "unknown"
    if intent == "export_request":
        return (
            "Xuất file **Excel/CSV** tự động chưa được bật trong phiên bản này. "
            "Bạn hãy mô tả báo cáo cần xem (ví dụ: doanh thu 7 ngày theo cửa hàng, "
            "tỷ lệ hủy đơn, tồn kho thấp...) kèm **khoảng thời gian** — số liệu sẽ hiển thị tại đây.",
            "clarification",
            [*missing_info],
        )

    hinted = _missing_info_message(missing_info)
    if hinted:
        return hinted, "clarification", [*missing_info]

    return (
        "Mình chưa hiểu rõ báo cáo bạn cần. "
        "Bạn cho **khoảng thời gian** trước (vd hôm nay / 7 ngày / tháng này), "
        "rồi **chỉ số** (doanh thu, tồn kho, top sản phẩm…)? "
        "Nếu có **outlet** cụ thể, ghi tên luôn nhé.",
        "clarification",
        [],
    )


async def template_matcher(state: GraphState) -> GraphState:
    question = question_text(state)
    intent = state.get("intent")
    time_range = question_time_range(state)
    resolved = state.get("resolved_entities", {})
    ctx = (state.get("conversation_context") or "").strip()

    planning = state.get("planning_decision") if isinstance(state.get("planning_decision"), dict) else {}
    planning_frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    missing_slots = [str(x).strip() for x in (planning.get("missing_slots") or []) if str(x).strip()]
    if missing_slots:
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["matcher_missing_info"] = missing_slots
        state["clarification_question"] = _missing_info_message(missing_slots) or "Bạn vui lòng làm rõ thêm báo cáo cần xem."
        state["response_kind"] = "clarification"
        state["response_hints"] = missing_slots
        state.setdefault("trace", []).append({"node": "template_matcher", "clarification": "planning_missing_slots"})
        return state

    if msg := _generic_metric_clarification(question, ctx):
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["matcher_missing_info"] = ["time_range"]
        state["clarification_question"] = msg
        state["response_kind"] = "clarification"
        state["response_hints"] = ["time_range"]
        state.setdefault("trace", []).append({"node": "template_matcher", "clarification": "generic_metric_time"})
        return state

    business_data_question = bool(_BUSINESS_DATA_RE.search(question))
    business_detail_question = bool(_BUSINESS_DETAIL_RE.search(question))
    folded_question = _fold(question)
    zero_revenue_question = bool(_zero_revenue_fast_match(folded_question, {"from_date": "x", "to_date": "x"}))
    if (business_detail_question or zero_revenue_question) and not _has_explicit_or_context_time(state, question):
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["matcher_missing_info"] = ["time_range"]
        state["clarification_question"] = (
            "Bạn muốn xem ngày hoặc khoảng thời gian nào? "
            "Ví dụ: ngày 5/4/2026, tháng này, hoặc từ ngày 1/3/2026 đến 31/3/2026."
        )
        state["response_kind"] = "clarification"
        state["response_hints"] = ["time_range"]
        state.setdefault("trace", []).append({"node": "template_matcher", "clarification": "strict_business_time"})
        return state

    # Danh sách cửa hàng trong phạm vi RBAC — có template T31 (tránh clarification sai nghĩa).
    # Nếu "chi tiết" đi cùng bán hàng/đơn hàng thì đó là fact sales detail, không phải outlet master profile.
    if intent in ("lookup", "unknown") and not business_data_question and (
        _OUTLET_LIST_QUESTION.search(question)
        or (_OUTLET_CODE_RE.search(question) and _OUTLET_DETAIL_RE.search(question) and not business_detail_question)
    ):
        state["template_key"] = "T31_outlet_directory"
        state["template_params"] = {}
        state["template_confidence"] = 0.95
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state.setdefault("trace", []).append({"node": "template_matcher", "shortcut": "T31_outlet_directory"})
        return state

    # HR không có trong registry template — không gọi LLM matcher để khỏi bị “hỏi lại chỉ số/thời gian” sai nghĩa.
    if intent == "hr_staff":
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["matcher_missing_info"] = []
        state["response_hints"] = []
        state["response_kind"] = "unsupported"
        state["clarification_question"] = HR_UNSUPPORTED
        state.setdefault("trace", []).append({"node": "template_matcher", "skipped": "hr_staff"})
        return state

    planning_frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    planning_inventory = any(
        str(planning_frame.get(k) or "").strip().lower() == "inventory"
        for k in ("domain", "task_type", "intent")
    )
    inventory_fast = _inventory_fast_match(folded_question)
    if inventory_fast and ((intent or "").strip().lower() == "inventory" or planning_inventory):
        key, params, confidence = inventory_fast
        state["template_key"] = key
        state["template_params"] = params
        state["template_confidence"] = confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state.setdefault("trace", []).append(
            {"node": "template_matcher", "source": "deterministic_inventory_stock", "shortcut": key}
        )
        return state

    pre_verified_fast = _fast_template_match(question, intent, time_range if isinstance(time_range, dict) else {})
    if pre_verified_fast and pre_verified_fast[0] == "T36_revenue_period_driver_bridge":
        key, params, confidence = pre_verified_fast
        state["template_key"] = key
        state["template_params"] = params
        state["template_confidence"] = confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state.setdefault("trace", []).append(
            {"node": "template_matcher", "source": "deterministic_period_bridge", "shortcut": key}
        )
        return state

    verified = select_verified_query(question=question, intent=intent, time_range=time_range)
    pre_verified_overrides_broad_verified = (
        verified is not None
        and pre_verified_fast is not None
        and pre_verified_fast[0] in {"T22_outlet_rank", "T03_revenue_by_category"}
        and verified.template_key in {"T32_period_revenue_summary", "T08_revenue_by_payment_method"}
        and verified.template_key != pre_verified_fast[0]
    )
    if verified and not pre_verified_overrides_broad_verified:
        state["template_key"] = verified.template_key
        state["template_params"] = verified.params
        state["template_confidence"] = verified.confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state["verified_query_asset"] = {
            "template_key": verified.asset.template_key,
            "metric_ids": list(verified.asset.metric_ids),
            "time_column": verified.asset.time_column,
            "outlet_column": verified.asset.outlet_column,
            "golden_cases": list(verified.asset.golden_cases),
        }
        state.setdefault("trace", []).append(
            {
                "node": "template_matcher",
                "source": "verified_query",
                "verified_asset": verified.asset.template_key,
                "shortcut": verified.template_key,
            }
        )
        return state

    if pre_verified_fast and pre_verified_fast[0] in {"T22_outlet_rank", "T03_revenue_by_category"}:
        key, params, confidence = pre_verified_fast
        state["template_key"] = key
        state["template_params"] = params
        state["template_confidence"] = confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state.setdefault("trace", []).append({"node": "template_matcher", "source": "deterministic_pre_verified", "shortcut": key})
        return state

    learned = (
        select_learned_scenario(
            question=question,
            intent=intent,
            time_range=time_range,
            planning_frame=state.get("planning_frame"),
            planning_decision=planning,
            min_score=float(getattr(get_settings(), "learned_scenario_match_min_score", 0.78) or 0.78),
        )
        if getattr(get_settings(), "learned_scenario_matching_enabled", True)
        else None
    )
    if learned:
        state["template_key"] = learned.template_key
        state["template_params"] = learned.params
        state["template_confidence"] = learned.confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state["learned_scenario_asset"] = {
            "scenario_key": learned.asset.scenario_key,
            "template_key": learned.asset.template_key,
            "intent": learned.asset.intent,
            "domain": learned.asset.domain,
            "task_type": learned.asset.task_type,
            "metric_ids": list(learned.asset.metric_ids),
            "required_slots": list(learned.asset.required_slots),
        }
        state.setdefault("trace", []).append(
            {
                "node": "template_matcher",
                "source": "learned_scenario",
                "scenario_key": learned.asset.scenario_key,
                "shortcut": learned.template_key,
            }
        )
        return state

    settings = get_settings()
    sql_writer_learned = (
        select_sql_writer_scenario(
            question=question,
            intent=intent,
            time_range=time_range,
            planning_frame=state.get("planning_frame"),
            planning_decision=planning,
            min_score=float(getattr(settings, "learned_scenario_match_min_score", 0.78) or 0.78),
        )
        if getattr(settings, "learned_scenario_matching_enabled", True)
        and getattr(settings, "codegen_sql_enabled", False)
        and getattr(settings, "codegen_route_mode", "off") != "off"
        else None
    )
    if sql_writer_learned:
        asset = sql_writer_learned.asset
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = sql_writer_learned.confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state["learned_sql_writer_scenario_asset"] = {
            "scenario_key": asset.scenario_key,
            "intent": asset.intent,
            "domain": asset.domain,
            "task_type": asset.task_type,
            "metric_ids": list(asset.metric_ids),
            "required_slots": list(asset.required_slots),
            "report_spec": dict(asset.report_spec),
            "dataset_candidates": list(asset.dataset_candidates),
            "tables_used": list(asset.tables_used),
            "sql_hashes": list(asset.sql_hashes),
            "sql_plan": dict(asset.sql_plan or {}),
            "confidence": sql_writer_learned.confidence,
        }
        state.setdefault("trace", []).append(
            {
                "node": "template_matcher",
                "source": "learned_sql_writer_scenario",
                "scenario_key": asset.scenario_key,
                "next_action": "gensql_candidate",
            }
        )
        return state

    if _planning_requires_sql_writer(planning):
        state["template_key"] = None
        state["template_params"] = {}
        state["template_confidence"] = 0.0
        state["matcher_missing_info"] = []
        state["response_hints"] = []
        state["clarification_question"] = None
        data_source = state.get("data_source_context") if isinstance(state.get("data_source_context"), dict) else {}
        if data_source.get("coverage_status") == "outside":
            state["response_kind"] = "answer"
            state["codegen_skip_reason"] = "coverage_outside"
            state.setdefault("trace", []).append(
                {
                    "node": "template_matcher",
                    "source": "planning_requires_sql_writer",
                    "next_action": "answer_formatter",
                    "reason": "coverage_outside",
                }
            )
            return state
        if getattr(settings, "codegen_sql_enabled", False) and getattr(settings, "codegen_route_mode", "off") != "off":
            state["response_kind"] = "answer"
            state.setdefault("trace", []).append(
                {"node": "template_matcher", "source": "planning_requires_sql_writer", "next_action": "gensql_candidate"}
            )
        else:
            state["response_kind"] = "unsupported"
            state["escalation_candidate"] = True
            state["escalation_reason"] = "no_verified_template_for_metric"
            state["escalation_target"] = "review_request"
            state["clarification_question"] = (
                "Câu hỏi này cần SQL Writer hoặc một template đã kiểm chứng. "
                "Hiện chưa có đường truy vấn an toàn được bật cho metric này."
            )
            state.setdefault("trace", []).append(
                {"node": "template_matcher", "unsupported": "planning_requires_sql_writer_but_codegen_disabled"}
            )
        return state

    from_planning = _template_from_planning_decision(planning, question=question, intent=intent, time_range=time_range)
    if from_planning:
        key, params, confidence = from_planning
        state["template_key"] = key
        state["template_params"] = params
        state["template_confidence"] = confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state.setdefault("trace", []).append({"node": "template_matcher", "source": "planning_decision", "shortcut": key})
        return state

    fast = (
        _fast_template_match(question, intent, time_range)
        if get_settings().template_fast_path_enabled
        else None
    )
    if fast:
        key, params, confidence = fast
        state["template_key"] = key
        state["template_params"] = params
        state["template_confidence"] = confidence
        state["matcher_missing_info"] = []
        state["response_kind"] = "answer"
        state["response_hints"] = []
        state["clarification_question"] = None
        state.setdefault("trace", []).append({"node": "template_matcher", "shortcut": key})
        return state

    emb = None
    if get_settings().openai_embeddings_enabled:
        try:
            emb = await embed(question)
        except Exception as e:  # noqa: BLE001
            logger.warning("Embedding failed: %s", e)

    # export_request không có template riêng — dùng cùng chỉ số POS/revenue/inventory.
    os_intent = None if intent == "export_request" else intent
    try:
        hits = hybrid_search_templates(text=question, embedding=emb, intent=os_intent, size=3)
    except Exception as e:  # noqa: BLE001
        logger.warning("OpenSearch templates failed, falling back to full template list: %s", e)
        hits = []

    candidate_keys = [h.get("template_key") for h in hits if h.get("template_key") in TEMPLATES]
    if not candidate_keys:
        # OpenSearch unavailable or returned no usable hits — use all templates so
        # the LLM can still pick the best match rather than being limited to 5.
        candidate_keys = list_templates()

    ctx_block = f"\nNgữ cảnh hội thoại gần đây:\n{ctx}\n" if ctx else ""

    outline = state.get("reasoning_outline")
    reasoning_block = format_reasoning_outline_for_matcher(outline if isinstance(outline, dict) else None)
    planning_block = format_planning_decision_for_matcher(
        planning if isinstance(planning, dict) else None,
        planning_frame=planning_frame,
    )
    catalog_block = format_catalog_digest_for_prompt(state.get("catalog_digest"))
    metadata_block = format_metadata_context_for_prompt(state.get("metadata_context"))
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))

    original = (state.get("normalized_question") or "").strip()
    original_block = f"Câu hỏi gốc: {original}\n" if original and original != question else ""

    user_prompt = f"""{original_block}Câu hỏi hiệu lực: {question}
{ctx_block}
Intent supervisor: {intent}
Time range: {time_range}
Resolved entities: {resolved}
{time_block}{coverage_block}{metadata_block}{catalog_block}{planning_block}{reasoning_block}
Candidates (chọn 1):
{chr(10).join(f"- {k}: {TEMPLATES[k].required_params}" for k in candidate_keys)}
"""

    lex_block = format_lexicon_hints(candidate_keys)
    matcher_system = _SYSTEM
    if lex_block:
        matcher_system += "\n\nGợi ý nghiệp vụ (chọn template phù hợp nhất):\n" + lex_block

    try:
        parsed, usage = await llm_call_json(
            system_prompt=matcher_system,
            user_prompt=user_prompt,
            json_schema=_schema(candidate_keys),
            temperature=0.1,
            agent="sql_planner",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Template matcher LLM failed: %s", e)
        parsed = {
            "template_key": None,
            "params": {"from_date": None, "to_date": None, "limit": None, "threshold": None},
            "confidence": 0.0,
            "missing_info": [],
        }
        usage = {"error": type(e).__name__, "latency_ms": 0, "tokens_in": 0, "tokens_out": 0}

    template_key = parsed.get("template_key")
    params = {k: v for k, v in (parsed.get("params") or {}).items() if v is not None}
    confidence = float(parsed.get("confidence", 0.0))
    missing_info_raw = parsed.get("missing_info") or []
    missing_info: list[str] = [str(x).strip() for x in missing_info_raw if str(x).strip()]
    state["matcher_missing_info"] = missing_info

    # Fill defaults from time_range if matcher missed them
    if template_key and template_key in TEMPLATES:
        meta = TEMPLATES[template_key]
        for required in meta.required_params:
            if not params.get(required) and required in time_range:
                params[required] = time_range[required]

    deterministic_match = _fast_template_match(question, intent, time_range if isinstance(time_range, dict) else {})
    if deterministic_match:
        det_key, det_params, det_confidence = deterministic_match
        if det_key in {"T22_outlet_rank", "T32_period_revenue_summary"} and det_key != template_key:
            state["template_key"] = det_key
            state["template_params"] = det_params
            state["template_confidence"] = det_confidence
            state["matcher_missing_info"] = []
            state["response_kind"] = "answer"
            state["response_hints"] = []
            state["clarification_question"] = None
            state.setdefault("trace", []).append(
                {"node": "template_matcher", **usage, "overridden_by_rule": det_key, "llm_template_key": template_key}
            )
            return state

    if not template_key or confidence < 0.5:
        recovery = deterministic_match
        if recovery:
            template_key, params, confidence = recovery
            missing_info = []
            state["matcher_missing_info"] = []
            state["template_key"] = template_key
            state["template_params"] = params
            state["template_confidence"] = confidence
            state["response_kind"] = "answer"
            state["response_hints"] = []
            state["clarification_question"] = None
            state.setdefault("trace", []).append(
                {"node": "template_matcher", **usage, "recovered_by_rule": template_key}
            )
            return state

    if template_key == "T22_outlet_rank":
        params = _outlet_rank_params(params, _fold(question))

    state["template_key"] = template_key
    state["template_params"] = params
    state["template_confidence"] = confidence
    if not template_key or confidence < 0.5:
        text, kind, hints = _clarification_for_failed_match(state, missing_info)
        state["clarification_question"] = text
        state["response_kind"] = kind
        state["response_hints"] = hints
    state.setdefault("trace", []).append({"node": "template_matcher", **usage})
    return state
