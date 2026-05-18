"""GPT-4.1: extract intent, time_range, raw_entities."""
import re

from app.graph.nodes.contextualizer import effective_question
from app.graph.question_frame import build_question_frame
from app.graph.state import GraphState
from app.config import get_settings
from app.llm.openai_client import llm_call_json
from app.query_policy import domain_keys_for_question, find_semantic_matches
from app.time_utils import (
    build_time_context,
    format_time_context_for_prompt,
    has_time_expression,
    is_time_followup,
    parse_time_range,
    today_local,
)
_HR_CONTEXT_RE = re.compile(
    r"(nhân\s*sự|nhan\s*su|nhân\s*viên|nhan\s*vien|staff|employee|personnel|workforce|part\s*-?\s*time|parttime|"
    r"đi\s*làm|di\s*lam|làm\s*việc|lam\s*viec|chấm\s*công|cham\s*cong|"
    r"giờ\s*làm|gio\s*lam|tổng\s*giờ|tong\s*gio|bao\s*nhiêu\s*giờ|bao\s*nhieu\s*gio|"
    r"worked\s*hours?|work\s*hours?|total\s*hours?|"
    r"ca\s*làm|ca\s*lam|lương|luong|payroll|thâm\s*niên|tham\s*nien|"
    r"ngày\s*vào|ngay\s*vao|công\s*ty|cong\s*ty)",
    re.IGNORECASE,
)
_DOCS_RE = re.compile(
    r"(là\s+gì|la\s+gi|định\s+nghĩa|dinh\s+nghia|giải\s+thích|giai\s+thich|"
    r"cách\s+tính|cach\s+tinh|tính\s+như\s+thế\s+nào|tinh\s+nhu\s+the\s+nao|"
    r"policy|chính\s+sách|chinh\s+sach|quy\s*tắc|quy\s*tac|rbac|gensql)",
    re.IGNORECASE,
)
_EXPORT_RE = re.compile(r"\b(xuất|xuat|export|excel|csv|download|tải\s+file|tai\s+file)\b", re.IGNORECASE)
_VISUAL_RE = re.compile(r"\b(vẽ|ve|biểu\s*đồ|bieu\s*do|chart|graph|visual)\b", re.IGNORECASE)
_REVENUE_RE = re.compile(r"\b(doanh\s*thu|doanh\s*số|doanh\s*so|revenue|sales|gmv|aov|basket|giao\s*dịch|giao\s*dich|đơn\s*hàng|don\s*hang|hủy\s*đơn|huy\s*don)\b", re.IGNORECASE)
_PRODUCT_RE = re.compile(
    r"\b(sản\s*phẩm|san\s*pham|product|mặt\s*hàng|mat\s*hang|"
    r"category|danh\s*mục|danh\s*muc|nhóm\s*món|nhom\s*mon|nhóm\s*sản\s*phẩm|nhom\s*san\s*pham)\b",
    re.IGNORECASE,
)
_INVENTORY_RE = re.compile(
    r"\b(tồn\s*kho|ton\s*kho|tồn\s*âm|ton\s*am|tồn\s*thấp|ton\s*thap|"
    r"inventory|stock|nguyên\s*liệu|nguyen\s*lieu|hết\s*hàng|het\s*hang|"
    r"sắp\s*hết|sap\s*het|còn\s*hàng|con\s*hang)\b",
    re.IGNORECASE,
)
_PNL_RE = re.compile(r"\b(p&l|lãi|lai|lỗ|lo|lợi\s*nhuận|loi\s*nhuan|profit|margin|chi\s*phí|chi\s*phi|payroll)\b", re.IGNORECASE)
_OUTLET_COMPARE_RE = re.compile(
    r"\b(theo\s+(cửa\s*hàng|cua\s*hang|outlet|chi\s*nhánh|chi\s*nhanh)"
    r"|(?:cửa\s*hàng|cua\s*hang|outlet|chi\s*nhánh|chi\s*nhanh)\s+[\w-]+"
    r"|cửa\s*hàng\s+nào|cua\s*hang\s*nao|outlet\s+nào|outlet\s+nao"
    r"|so\s*sánh|so\s*sanh|so\s*với|so\s*voi|compare|xếp\s*hạng|xep\s*hang|ranking)\b",
    re.IGNORECASE,
)
_OUTLET_NAME_RE = re.compile(r"\boutlet\s+[\w-]+", re.IGNORECASE)
_OUTLET_DIRECTORY_RE = re.compile(
    r"(có\s+(các|những)\s+(cửa\s*hàng|cua\s*hang|outlet|chi\s*nhánh|chi\s*nhanh)"
    r"|co\s+(cac|nhung)\s+(cua\s*hang|outlet|chi\s*nhanh)"
    r"|những\s+(cửa\s*hàng|cua\s*hang|outlet)\s+nào"
    r"|nhung\s+(cua\s*hang|outlet)\s+nao"
    r"|các\s+(cửa\s*hàng|cua\s*hang|outlet)\s+nào"
    r"|cac\s+(cua\s*hang|outlet)\s+nao"
    r"|danh\s*sách\s+(cửa|cua|outlet|chi\s+nhánh|chi\s+nhanh)"
    r"|danh\s*sach\s+(cua|outlet|chi\s+nhanh)"
    r"|liệt\s*kê\s+(outlet|cửa|cua)"
    r"|liet\s*ke\s+(outlet|cua)"
    r"|hệ\s*thống.*(cửa\s*hàng|cua\s*hang|outlet)"
    r"|he\s*thong.*(cua\s*hang|outlet)"
    r"|store\s+list|list\s+outlets?)",
    re.IGNORECASE,
)
_OUTLET_CODE_RE = re.compile(r"\b[A-Z]{2,}(?:-[A-Z0-9]+){1,}-OUT-\d{1,6}\b", re.IGNORECASE)
_OUTLET_DETAIL_RE = re.compile(
    r"(thông\s*tin|thong\s*tin|chi\s*tiết|chi\s*tiet|detail|details?|info|profile|hồ\s*sơ|ho\s*so)",
    re.IGNORECASE,
)
_BUSINESS_DATA_RE = re.compile(
    r"(doanh\s*thu|doanh\s*số|doanh\s*so|revenue|sales?|bán\s*hàng|ban\s*hang|"
    r"đơn\s*hàng|don\s*hang|hóa\s*đơn|hoa\s*don|đơn\s*mua\s*hàng|don\s*mua\s*hang|"
    r"tồn\s*kho|ton\s*kho|inventory|payment|thanh\s*toán|thanh\s*toan)",
    re.IGNORECASE,
)
_ZERO_REVENUE_RE = re.compile(
    r"(không\s+phát\s+sinh\s+doanh\s+thu|khong\s+phat\s+sinh\s+doanh\s+thu|"
    r"không\s+có\s+doanh\s+thu|khong\s+co\s+doanh\s+thu|chưa\s+có\s+doanh\s+thu|chua\s+co\s+doanh\s+thu|"
    r"doanh\s+thu\s+bằng\s+0|doanh\s+thu\s+bang\s+0|zero\s+revenue|không\s+có\s+giao\s+dịch|khong\s+co\s+giao\s+dich)",
    re.IGNORECASE,
)
_SALES_DETAIL_RE = re.compile(
    r"(chi\s*tiết\s*bán\s*hàng|chi\s*tiet\s*ban\s*hang|sales?\s*detail|order\s*detail|"
    r"chi\s*tiết.*(đơn\s*hàng|don\s*hang|hóa\s*đơn|hoa\s*don|đơn\s*mua\s*hàng|don\s*mua\s*hang)|"
    r"(các\s*)?(đơn\s*mua\s*hàng|don\s*mua\s*hang|hóa\s*đơn\s*bán\s*hàng|hoa\s*don\s*ban\s*hang))",
    re.IGNORECASE,
)
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
_GENERIC_BUSINESS_RE = re.compile(
    r"^\s*(doanh\s*(thu|số)|revenue|sales|tồn\s*kho|ton\s*kho|inventory|"
    r"lợi\s*nhuận|loi\s*nhuan|p&l|profit|top\s+sản\s*phẩm|top\s+san\s+pham)"
    r"\s*[?!.]*\s*$",
    re.IGNORECASE,
)

_NEXT_ACTIONS = frozenset({
    "answer_social",
    "ask_clarification",
    "docs_rag",
    "hr_static",
    "verified_template",
    "template_match",
    "gensql_candidate",
})


SUPERVISOR_SCHEMA = {
    "name": "supervisor_result",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "agent_route": {
                "type": "string",
                "enum": [
                    "data_query",
                    "docs_question",
                    "hr_staff",
                    "export_request",
                    "visualization_request",
                    "greeting",
                    "thanks",
                    "unknown",
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
            "evidence": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "ambiguities": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
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
        },
        "required": ["agent_route", "intent", "confidence", "evidence", "ambiguities", "time_range", "raw_entities"],
        "additionalProperties": False,
    },
}


def _system_prompt() -> str:
    today = today_local().isoformat()
    return f"""Bạn là Supervisor cho AI Query Assistant của hệ thống F&B FERN.

Hôm nay là {today}. Phân tích câu hỏi và trả về JSON với:

1. agent_route:
   - data_query: cần truy vấn dữ liệu/báo cáo
   - docs_question: hỏi định nghĩa/chính sách/quy tắc nội bộ, không cần truy DB
   - hr_staff: nhân viên, ca làm, payroll người, headcount
   - export_request: xuất CSV/Excel/file báo cáo
   - visualization_request: muốn vẽ biểu đồ/chart từ dữ liệu
   - greeting / thanks: xã giao toàn câu
   - unknown: không rõ

2. intent nghiệp vụ (1 trong các giá trị sau):
   - revenue: hỏi doanh thu, doanh số
   - inventory: hỏi tồn kho, nguyên liệu
   - product_mix: hỏi top sản phẩm, sản phẩm bán chạy/chậm
   - pnl: hỏi lãi/lỗ, P&L, chi phí
   - outlet_compare: so sánh giữa các outlet
   - trend: hỏi xu hướng theo thời gian
   - lookup: tra cứu thông tin (giá, địa chỉ outlet, thông tin đơn giản không phải nhân sự)
   - hr_staff: nhân viên, ca làm, hồ sơ staff, payroll người, headcount…
   - export_request: xuất excel, CSV, file, tải về báo cáo, đính kèm bảng
   - visualization_request: tạo biểu đồ/chart; nếu có metric thì vẫn chọn intent nghiệp vụ gần nhất (vd revenue) và agent_route=visualization_request
   - greeting: chỉ chào hỏi xã giao (xin chào, hello, chào bạn…) không hỏi số liệu
   - thanks: cảm ơn / thanks — không hỏi số liệu
   - unknown: không rõ ý định

3. time_range: ISO date YYYY-MM-DD
   - "hôm nay" → from=to={today}
   - "hôm qua" → from=to=(today-1)
   - "tuần này" → from=monday(today), to={today}
   - "tháng này" → from=01 tháng hiện tại, to={today}
   - "tháng trước" → toàn bộ tháng trước
   - "tuần trước/tuần rồi" → toàn bộ tuần lịch trước đó
   - "tháng trước/tháng rồi" → toàn bộ tháng trước
   - "quý này/quý trước/quý 1" → khoảng quý lịch tương ứng
   - "7 ngày qua/30 ngày gần nhất" → rolling range tính đến hôm nay
   - "năm nay" → from=01-01 của năm hiện tại, to={today}
   - "năm 2025" / "2025" khi nói về báo cáo → toàn bộ năm đó
   - Nếu không có thời gian rõ → from=to={today}

4. raw_entities: tên outlet, sản phẩm, danh mục, nhân viên được đề cập (chuỗi gốc).

confidence: 0..1.
evidence: các tín hiệu ngắn đã dùng để route (vd metric:net_revenue, route:hr, time:current_turn).
ambiguities: slot còn mơ hồ; nếu có slot quan trọng như time_range/metric_or_report/comparison_target thì hệ thống sẽ hỏi lại.
"""


def _time_source_for_range(current: str, contextual: str) -> str:
    """For follow-ups, let the current turn's time expression override prior context."""
    return current if has_time_expression(current or "") else contextual


def _empty_entities(text: str) -> dict[str, list[str]]:
    outlets = [m.group(0).strip() for m in _OUTLET_NAME_RE.finditer(text or "")]
    return {"outlet_names": outlets, "product_names": [], "categories": [], "employee_names": []}


def _metric_ids_for_question(text: str, intent: str | None) -> list[str]:
    hits = find_semantic_matches(text, max_items=10)
    out: list[str] = []
    for hit in hits:
        if hit.get("kind") == "metric":
            name = str(hit.get("canonical_name") or "").strip()
            if name and name not in out:
                out.append(name)
    if _SALES_DETAIL_RE.search(text) and "sale_record_detail" not in out:
        out.append("sale_record_detail")
    if _ZERO_REVENUE_RE.search(text) and "outlet_zero_revenue" not in out:
        out.append("outlet_zero_revenue")
    if _PEAK_HOUR_RE.search(text):
        for name in ("peak_hour", "txn_count", "net_revenue"):
            if name not in out:
                out.append(name)
    if not out and intent in {"revenue", "outlet_compare", "trend"}:
        out.append("net_revenue")
    if not out and intent == "inventory":
        out.append("qty_on_hand")
    if not out and intent == "product_mix":
        out.extend(["product_revenue", "qty"])
    if not out and intent == "pnl":
        out.append("operating_profit")
    return out


def _domain_for(intent: str | None, text: str) -> str:
    if intent == "hr_staff":
        return "hr"
    if intent in {"greeting", "thanks"}:
        return "social"
    if intent == "lookup":
        return "lookup"
    keys = domain_keys_for_question(intent, text)
    return keys[0] if keys else "sales"


def _task_type_for(text: str, route: str, intent: str) -> str:
    if route in {"greeting", "thanks"} or intent in {"greeting", "thanks"}:
        return "social"
    if route == "docs_question":
        return "docs_question"
    if route == "hr_staff" or intent == "hr_staff":
        return "hr_static"
    if _SALES_DETAIL_RE.search(text):
        return "sales_detail"
    if _ZERO_REVENUE_RE.search(text):
        return "zero_revenue_outlets"
    if _PEAK_HOUR_RE.search(text):
        return "peak_hour_analysis"
    if intent == "lookup":
        return "outlet_directory"
    if route == "visualization_request":
        return "visualization"
    if route == "export_request":
        return "export"
    if intent == "inventory":
        return "inventory"
    if intent == "product_mix":
        return "product_mix"
    if intent == "pnl":
        return "pnl"
    if intent == "trend":
        return "trend"
    if intent == "outlet_compare":
        return "outlet_compare"
    return "metric_summary"


def _grain_for(task_type: str, intent: str) -> str:
    if task_type == "sales_detail":
        return "sale_id + product_id"
    if task_type == "zero_revenue_outlets":
        return "outlet"
    if task_type == "peak_hour_analysis":
        return "hour_of_day"
    if task_type == "outlet_directory":
        return "outlet"
    if task_type == "inventory":
        return "outlet + item + latest_snapshot"
    if task_type == "product_mix":
        return "product"
    if task_type == "visualization" or intent == "trend":
        return "date"
    if intent == "outlet_compare":
        return "outlet"
    return "period"


def _explicit_time_given(state: GraphState, text: str, current: str) -> bool:
    time_ctx = state.get("time_context")
    if isinstance(time_ctx, dict):
        if time_ctx.get("current_has_time_expression") or time_ctx.get("is_time_followup"):
            return True
    return has_time_expression(current) or (text != current and has_time_expression(text))


def _planning_next_action(
    *,
    route: str,
    intent: str,
    task_type: str,
    text: str,
    current: str,
    state: GraphState,
) -> tuple[str, list[str]]:
    ambiguities: list[str] = []
    if route in {"greeting", "thanks"} or intent in {"greeting", "thanks"}:
        return "answer_social", []
    if route == "docs_question":
        return "docs_rag", []
    if route == "hr_staff" or intent == "hr_staff":
        return "hr_static", []

    explicit_time = _explicit_time_given(state, text, current)
    if task_type in {"sales_detail", "zero_revenue_outlets", "peak_hour_analysis"} and not explicit_time:
        ambiguities.append("time_range")
    if _GENERIC_BUSINESS_RE.match(current or "") and not explicit_time:
        ambiguities.append("time_range")
    if route == "export_request" and not _BUSINESS_DATA_RE.search(text):
        ambiguities.append("metric_or_report")
    if re.search(r"\b(so\s+sánh|so\s+sanh|compare|so\s+với|so\s+voi)\s*(cái\s+này|cai\s+nay|này|nay)?\s*[?!.]*$", text, re.IGNORECASE):
        ambiguities.append("comparison_target")
    if ambiguities:
        return "ask_clarification", ambiguities[:1]
    if task_type in {"sales_detail", "zero_revenue_outlets", "peak_hour_analysis"}:
        return "verified_template", []
    return "template_match", []


def _task_type_label_vi(task_type: str) -> str:
    return {
        "social": "Xã giao — không truy vấn số liệu",
        "docs_question": "Tra cứu tài liệu / policy nội bộ",
        "hr_static": "HR — lane truy vấn SQL tĩnh (hr_query), không GenSQL",
        "sales_detail": "Chi tiết bán hàng / đơn hàng (line-level)",
        "zero_revenue_outlets": "Danh sách outlet không phát sinh doanh thu",
        "peak_hour_analysis": "Phân tích giờ cao điểm / phân bổ theo giờ",
        "outlet_directory": "Danh bạ / tra cứu thông tin outlet",
        "visualization": "Trực quan hóa (biểu đồ)",
        "export": "Xuất báo cáo / file",
        "inventory": "Tồn kho / stock",
        "product_mix": "Mix sản phẩm — top / đóng góp",
        "pnl": "P&L — lãi lỗ, margin",
        "trend": "Xu hướng theo thời gian",
        "outlet_compare": "So sánh hoặc xếp hạng outlet",
        "metric_summary": "Tóm tắt chỉ số theo kỳ",
    }.get(task_type, task_type)


def _entities_summary_vi(entities: dict | None) -> str:
    if not isinstance(entities, dict):
        return ""
    parts: list[str] = []
    labels = (
        ("outlet_names", "Outlet"),
        ("product_names", "Sản phẩm"),
        ("categories", "Danh mục"),
        ("employee_names", "Nhân viên"),
    )
    for key, label in labels:
        vals = entities.get(key) or []
        if not isinstance(vals, list) or not vals:
            continue
        shown = ", ".join(str(x).strip() for x in vals[:4] if str(x).strip())
        if len(vals) > 4:
            shown += f" (+{len(vals) - 4})"
        if shown:
            parts.append(f"{label}: {shown}")
    return "; ".join(parts)


def _executor_directives_vi(
    *,
    next_action: str,
    route: str,
    task_type: str,
    ambiguities: list[str],
) -> list[str]:
    amb0 = str((ambiguities or [""])[0] or "").strip()
    if next_action == "ask_clarification":
        return [
            "Không chạy matcher hay SQL: trả lời làm rõ đúng một slot thiếu.",
            f"Slot ưu tiên: {amb0 or 'theo planning_frame.ambiguities'}.",
        ]
    if next_action == "hr_static":
        return [
            "Chuyển sang node hr_query; giữ nguyên outlet scope RBAC.",
            "Áp dụng time_range state nếu câu hỏi HR có yếu tố thời gian (giờ làm, payroll…).",
        ]
    if next_action == "docs_rag":
        return ["Chuyển doc_reader / RAG; không truy vấn ClickHouse analytics cho policy thuần túy."]
    if next_action == "answer_social":
        return ["Trả lời ngắn giao tiếp; không gọi pipeline số liệu."]
    if next_action == "verified_template":
        out = [
            "Bắt buộc dùng đúng template verified (T33/T34/T23…) đã gắn với task_type; không đổi grain.",
            "Tham số thời gian: from_date và to_date khớp time_range supervisor (đã suy diễn).",
        ]
        if task_type == "peak_hour_analysis":
            out.append("Ưu tiên lọc theo business_date/hour grain của template giờ cao điểm.")
        return out
    if route in {"data_query", "export_request", "visualization_request"} and next_action == "template_match":
        return [
            "Matcher / codegen: dùng time_range đã giải mã làm filter chính (business_date hoặc cột thời gian tương đương).",
            "Ưu tiên template verified hoặc dataset trong planning_decision; không mở rộng bảng ngoài candidate nếu không cần.",
            "Tôn trọng RBAC outlet_ids; không SELECT vượt phạm vi user.",
        ]
    return [
        "Thực thi theo next_action trong planning_frame; đối chiếu time_range và intent trước khi sinh SQL.",
    ]


def _compose_executor_brief_vi(
    *,
    route: str,
    intent: str,
    domain: str,
    task_type: str,
    metric_ids: list[str],
    grain: str,
    time_range: dict,
    time_context: dict | None,
    entities: dict | None,
    next_action: str,
    ambiguities: list[str],
) -> tuple[str, list[str]]:
    """Vietnamese handoff: what planning inferred + imperative directives for downstream agents."""
    tc = time_context if isinstance(time_context, dict) else {}
    fd = str(time_range.get("from_date") or "").strip()
    td = str(time_range.get("to_date") or "").strip()
    ts = str(tc.get("source") or "").strip()
    infer = str(tc.get("inference_vi") or "").strip()

    if fd and td:
        time_block = f"- **Thời gian:** {fd} → {td} (inclusive)" + (f"; nguồn suy diễn: `{ts}`" if ts else "")
        if infer:
            time_block += f". {infer}"
    else:
        time_block = "- **Thời gian:** chưa đủ from/to — cần làm rõ trước khi chạy số liệu."

    metrics = [str(x).strip() for x in (metric_ids or []) if str(x).strip()]
    metrics_line = (
        f"- **Metric (gợi ý semantic):** {', '.join(metrics[:10])}"
        + ("…" if len(metrics) > 10 else "")
        if metrics
        else ""
    )
    entity_line = _entities_summary_vi(entities)
    entity_block = f"- **Thực thể trích từ câu hỏi:** {entity_line}" if entity_line else ""

    amb_line = ""
    if ambiguities:
        amb_line = f"- **Còn mơ hồ:** {', '.join(str(a) for a in ambiguities[:4] if str(a).strip())}"

    lines = [
        "**Planner đã suy diễn (cho agent thực thi phía dưới):**",
        f"- **Luồng:** `{route}` · intent `{intent}` · domain `{domain}`",
        f"- **Dạng bài toán:** {_task_type_label_vi(task_type)} · grain `{grain}`",
        time_block,
    ]
    if metrics_line:
        lines.append(metrics_line)
    if entity_block:
        lines.append(entity_block)
    if amb_line:
        lines.append(amb_line)

    directives = _executor_directives_vi(
        next_action=next_action, route=route, task_type=task_type, ambiguities=list(ambiguities or [])
    )
    return "\n".join(lines), directives


def _clarification_for_ambiguity(ambiguities: list[str], task_type: str) -> str:
    first = ambiguities[0] if ambiguities else ""
    if first == "time_range":
        if task_type == "sales_detail":
            return "Bạn muốn xem chi tiết bán hàng cho ngày hoặc khoảng thời gian nào?"
        if task_type == "zero_revenue_outlets":
            return "Bạn muốn kiểm tra cửa hàng không phát sinh doanh thu trong khoảng thời gian nào?"
        if task_type == "peak_hour_analysis":
            return "Bạn muốn phân tích giờ cao điểm bán hàng trong khoảng thời gian nào?"
        return "Bạn muốn xem khoảng thời gian nào (hôm nay, 7 ngày gần nhất, hay tháng này)? Nếu có outlet cụ thể hãy ghi tên."
    if first == "metric_or_report":
        return "Bạn muốn xuất báo cáo/chỉ số nào? Ví dụ: doanh thu theo cửa hàng, top sản phẩm, hoặc tồn kho thấp."
    if first == "comparison_target":
        return "Bạn muốn so sánh chỉ số nào và với kỳ nào?"
    return "Bạn vui lòng làm rõ thêm báo cáo cần xem."


def _make_planning_frame(
    *,
    route: str,
    intent: str,
    text: str,
    current: str,
    time_range: dict[str, str],
    time_context: dict,
    entities: dict[str, list[str]],
    confidence: float,
    router_layer: str,
    state: GraphState,
    extra_evidence: list[str] | None = None,
    extra_ambiguities: list[str] | None = None,
) -> dict:
    task_type = _task_type_for(text, route, intent)
    next_action, ambiguities = _planning_next_action(
        route=route,
        intent=intent,
        task_type=task_type,
        text=text,
        current=current,
        state=state,
    )
    evidence = [router_layer]
    metric_ids = _metric_ids_for_question(text, intent)
    if metric_ids:
        evidence.append("semantic_metric")
    if time_context.get("source"):
        evidence.append(f"time:{time_context.get('source')}")
    for item in extra_evidence or []:
        clean = str(item).strip()
        if clean and clean not in evidence:
            evidence.append(clean)
    for item in extra_ambiguities or []:
        clean = str(item).strip()
        if clean and clean not in ambiguities:
            ambiguities.append(clean)
    if ambiguities:
        next_action = "ask_clarification"
    domain = _domain_for(intent, text)
    grain = _grain_for(task_type, intent)
    final_next = next_action if next_action in _NEXT_ACTIONS else "ask_clarification"
    executor_brief_vi, executor_directives = _compose_executor_brief_vi(
        route=route,
        intent=intent,
        domain=domain,
        task_type=task_type,
        metric_ids=metric_ids,
        grain=grain,
        time_range=time_range,
        time_context=time_context,
        entities=entities,
        next_action=final_next,
        ambiguities=ambiguities[:4],
    )
    return {
        "route": route,
        "intent": intent,
        "domain": domain,
        "task_type": task_type,
        "metric_ids": metric_ids,
        "grain": grain,
        "time_range": {
            "from_date": str(time_range.get("from_date") or ""),
            "to_date": str(time_range.get("to_date") or ""),
        },
        "time_source": time_context.get("source"),
        "entities": entities,
        "confidence": max(0.0, min(float(confidence or 0.0), 1.0)),
        "evidence": evidence,
        "ambiguities": ambiguities[:4],
        "next_action": final_next,
        "router_layer": router_layer,
        "executor_brief_vi": executor_brief_vi,
        "executor_directives": executor_directives,
    }


def _install_planning_frame(state: GraphState, frame: dict) -> None:
    state["planning_frame"] = frame
    state["route_confidence"] = float(frame.get("confidence") or 0.0)
    state["ambiguities"] = list(frame.get("ambiguities") or [])
    if frame.get("next_action") == "ask_clarification":
        state["response_kind"] = "clarification"
        state["response_hints"] = list(frame.get("ambiguities") or [])
        state["clarification_question"] = _clarification_for_ambiguity(
            state["response_hints"],
            str(frame.get("task_type") or ""),
        )


def _analytics_like(route: str, intent: str) -> bool:
    return route in {"data_query", "export_request", "visualization_request"} or intent in {
        "revenue",
        "inventory",
        "product_mix",
        "pnl",
        "outlet_compare",
        "trend",
        "lookup",
    }


def _install_escalation_contract(state: GraphState, frame: dict) -> None:
    route = str(frame.get("route") or "")
    intent = str(frame.get("intent") or "")

    candidate = False
    reason: str | None = None
    target: str | None = None

    if _analytics_like(route, intent) and frame.get("next_action") == "ask_clarification":
        qf = state.get("question_frame") if isinstance(state.get("question_frame"), dict) else {}
        followup_like = bool(qf.get("followup_source")) or bool(qf.get("is_time_followup")) or bool(
            state.get("contextualized_question")
        )
        prior_dialog = bool(state.get("conversation_context")) or len(state.get("conversation_turns") or []) >= 2
        if followup_like or prior_dialog:
            candidate = True
            reason = "still_missing_slots_after_followup"
            target = "review_request"

    state["escalation_candidate"] = candidate
    state["escalation_reason"] = reason
    state["escalation_target"] = target


def _business_intent(text: str) -> str | None:
    if _PEAK_HOUR_RE.search(text):
        return "revenue"
    if _PNL_RE.search(text):
        return "pnl"
    if _INVENTORY_RE.search(text):
        return "inventory"
    if _PRODUCT_RE.search(text):
        return "product_mix"
    if _REVENUE_RE.search(text):
        if _OUTLET_COMPARE_RE.search(text):
            return "outlet_compare"
        return "revenue"
    if _BUSINESS_DATA_RE.search(text):
        return "revenue"
    return None


def _deterministic_parse(question: str, current: str, ctx: str) -> dict | None:
    text = question or current
    if not text.strip():
        return None

    intent = _business_intent(text)
    time_source = _time_source_for_range(current, text)
    time_context = f"{text}\n{ctx}" if ctx else text
    business_data_question = bool(_BUSINESS_DATA_RE.search(text))
    if not business_data_question and (
        _OUTLET_DIRECTORY_RE.search(text) or (_OUTLET_CODE_RE.search(text) and _OUTLET_DETAIL_RE.search(text))
    ):
        return {
            "agent_route": "data_query",
            "intent": "lookup",
            "confidence": 0.94,
            "time_range": parse_time_range(time_source, today=today_local(), context_text=time_context),
            "raw_entities": _empty_entities(text),
        }

    if _DOCS_RE.search(text) and (
        intent
        or find_semantic_matches(text, max_items=1)
        or re.search(r"\b(rbac|gensql|clickhouse|cdc|quyền|quyen)\b", text, re.IGNORECASE)
    ):
        return {
            "agent_route": "docs_question",
            "intent": intent or "lookup",
            "confidence": 0.88,
            "time_range": parse_time_range(time_source, today=today_local(), context_text=time_context),
            "raw_entities": _empty_entities(text),
        }

    if _HR_CONTEXT_RE.search(text) or (ctx and is_time_followup(current) and _HR_CONTEXT_RE.search(ctx)):
        return {
            "agent_route": "hr_staff",
            "intent": "hr_staff",
            "confidence": 0.9,
            "time_range": parse_time_range(time_source, today=today_local(), context_text=time_context),
            "raw_entities": _empty_entities(text),
        }

    if not intent:
        return None

    route = "data_query"
    if _VISUAL_RE.search(text):
        route = "visualization_request"
    elif _EXPORT_RE.search(text):
        route = "export_request"

    return {
        "agent_route": route,
        "intent": intent,
        "confidence": 0.86,
        "time_range": parse_time_range(time_source, today=today_local(), context_text=time_context),
        "raw_entities": _empty_entities(text),
    }


async def supervisor(state: GraphState) -> GraphState:
    ctx = (state.get("conversation_context") or "").strip()
    question = effective_question(state)
    current = state["normalized_question"]
    time_ctx = build_time_context(
        current_question=current,
        effective_question=question,
        conversation_context=ctx,
        today=today_local(),
    )
    state["time_context"] = time_ctx
    time_block = format_time_context_for_prompt(time_ctx)
    if ctx:
        user_prompt = (
            "Ngữ cảnh hội thoại gần đây (chỉ để hiểu câu hỏi tiếp nối, không coi là dữ liệu thật):\n"
            f"{ctx}\n\n---\nCâu hỏi hiện tại: {current}\n"
            f"Câu hỏi hiệu lực sau contextualizer: {question}"
            f"{time_block}"
        )
    else:
        user_prompt = f"{question}{time_block}"
    deterministic = _deterministic_parse(question, current, ctx) if get_settings().deterministic_supervisor_enabled else None
    if deterministic:
        route = deterministic["agent_route"]
        resolved_time_range = {
            "from_date": str(time_ctx["from_date"]),
            "to_date": str(time_ctx["to_date"]),
        }
        state["agent_route"] = route
        state["visualization_requested"] = route == "visualization_request"
        state["intent"] = deterministic["intent"]
        state["time_range"] = resolved_time_range
        state["time_context"] = {**time_ctx, **resolved_time_range}
        state["raw_entities"] = deterministic["raw_entities"]
        build_question_frame(
            state,
            effective_question=question,
            current_question=current,
            intent=state["intent"],
            time_range=state["time_range"],
            time_context=state["time_context"],
            raw_entities=state["raw_entities"],
        )
        frame = _make_planning_frame(
            route=route,
            intent=state["intent"],
            text=question,
            current=current,
            time_range=state["time_range"],
            time_context=state["time_context"],
            entities=state["raw_entities"],
            confidence=float(deterministic.get("confidence") or 0.0),
            router_layer="rule",
            state=state,
        )
        _install_planning_frame(state, frame)
        _install_escalation_contract(state, frame)
        state.setdefault("trace", []).append(
            {
                "node": "supervisor",
                "source": "deterministic",
                "router_layer": "rule",
                "confidence": frame.get("confidence"),
                "next_action": frame.get("next_action"),
                "outcome": "escalation_candidate" if state.get("escalation_candidate") else "ok",
                "latency_ms": 0,
            }
        )
        return state

    parsed, usage = await llm_call_json(
        system_prompt=_system_prompt(),
        user_prompt=user_prompt,
        json_schema=SUPERVISOR_SCHEMA,
        temperature=0.1,
        agent="supervisor",
    )
    # Lượt follow-up chỉ có thời gian ("tuần này") phải bám intent HR trước đó.
    # Nếu không, graph có thể rơi về lookup/staff list và trả danh sách thay vì ranking/chấm công.
    if (
        parsed.get("intent") in {"unknown", "lookup", "trend"}
        and ctx
        and is_time_followup(current)
        and _HR_CONTEXT_RE.search(ctx)
    ):
        parsed["intent"] = "hr_staff"
        parsed["agent_route"] = "hr_staff"
        parsed["time_range"] = parse_time_range(current, today=today_local(), context_text=question)
    if has_time_expression(current) or is_time_followup(current) or state.get("contextualized_question"):
        parsed["time_range"] = {
            "from_date": str(time_ctx["from_date"]),
            "to_date": str(time_ctx["to_date"]),
        }
    route = str(parsed.get("agent_route") or "").strip() or "data_query"
    if parsed.get("intent") in ("greeting", "thanks"):
        route = str(parsed["intent"])
    if parsed.get("intent") == "hr_staff":
        route = "hr_staff"
    if parsed.get("intent") == "export_request":
        route = "export_request"
    state["agent_route"] = route
    state["visualization_requested"] = route == "visualization_request" or parsed.get("intent") == "visualization_request"
    state["intent"] = parsed["intent"]
    state["time_range"] = parsed["time_range"]
    state["time_context"] = {**time_ctx, **state["time_range"]}
    state["raw_entities"] = parsed["raw_entities"]
    build_question_frame(
        state,
        effective_question=question,
        current_question=current,
        intent=state["intent"],
        time_range=state["time_range"],
        time_context=state["time_context"],
        raw_entities=state["raw_entities"],
    )
    semantic_hits = find_semantic_matches(question, max_items=4)
    router_layer = "semantic" if semantic_hits else "llm"
    frame = _make_planning_frame(
        route=route,
        intent=state["intent"],
        text=question,
        current=current,
        time_range=state["time_range"],
        time_context=state["time_context"],
        entities=state["raw_entities"],
        confidence=float(parsed.get("confidence") or 0.0),
        router_layer=router_layer,
        state=state,
        extra_evidence=[str(x).strip() for x in (parsed.get("evidence") or []) if str(x).strip()],
        extra_ambiguities=[str(x).strip() for x in (parsed.get("ambiguities") or []) if str(x).strip()],
    )
    _install_planning_frame(state, frame)
    _install_escalation_contract(state, frame)
    state.setdefault("trace", []).append(
        {
            "node": "supervisor",
            **usage,
            "router_layer": router_layer,
            "confidence": frame.get("confidence"),
            "next_action": frame.get("next_action"),
            "outcome": "escalation_candidate" if state.get("escalation_candidate") else "ok",
        }
    )
    return state
