"""GPT-4.1: format Vietnamese natural-language answer from raw_result."""
from datetime import date, datetime
import json
import logging
import re
import unicodedata
from typing import Any

from app.graph.question_frame import question_text
from app.graph.nodes.data_coverage import (
    coverage_window_for_template,
    ensure_data_source_context,
    format_data_coverage_for_prompt,
)
from app.config import get_settings
from app.graph.state import GraphState
from app.llm.openai_client import llm_call_text
from app.graph.nodes.self_correction import is_self_correction_candidate
from app.time_utils import app_timezone, format_time_context_for_prompt

logger = logging.getLogger(__name__)

_MONTHLY_BREAKDOWN_RE = re.compile(
    r"(theo\s*từng\s*tháng|theo\s*tung\s*thang|theo\s*tháng|theo\s*thang|"
    r"từng\s*tháng|tung\s*thang|mỗi\s*tháng|moi\s*thang|monthly|by\s*month)",
    re.IGNORECASE,
)
_SPURIOUS_PERIOD_SUMMARY_REVIEW_RE = re.compile(
    r"(tách\s*theo\s*từng\s*tháng|tach\s*theo\s*tung\s*thang|theo\s*từng\s*tháng|"
    r"theo\s*tung\s*thang|sai\s*grain\s*thời\s*gian|sai\s*grain\s*thoi\s*gian|"
    r"sai\s*grain|grain\s*thời\s*gian|grain\s*thoi\s*gian)",
    re.IGNORECASE,
)


_SYSTEM_BASE = """Bạn là FERN Analytics Analyst — chuyên gia phân tích dữ liệu cho chuỗi F&B Việt Nam.

**ĐỊNH NGHĨA METRIC (F&B ngành nhà hàng/cà phê):**
- net_revenue / doanh thu ròng: doanh thu sau giảm giá (= gross − discount). Đây là chỉ số doanh thu chính.
- gross_revenue / doanh thu gộp: doanh thu trước giảm giá.
- txn_count / số giao dịch: số đơn bán hàng hoàn thành.
- AOV / avg_basket_size: giá trị trung bình mỗi đơn = net_revenue / txn_count.
- cancellation_rate / tỷ lệ hủy: đơn hủy / tổng đơn. Cao hơn 5% cần chú ý vận hành.
- operating_profit / lợi nhuận vận hành: revenue − cogs − payroll_cost.
- operating_margin: lợi nhuận vận hành / doanh thu. F&B thường 10–25%.
- qty / số lượng bán (đơn vị): **tổng khối lượng bán** trong grain của dòng (theo ngày + outlet + product_id, hoặc sau GROUP BY theo category). Là SUM của lượng bán POS (cốc/phần/cái…), **không** phải số SKU khác nhau và **không** phải cỡ catalog (~60 món). Khi diễn đạt cho user: dùng **"số lượng bán"**, **"đơn vị bán"**, **"tổng qty"** — **tránh** "món" nếu dễ hiểu nhầm là số món trong menu; chỉ dùng "món" nếu bạn nói rõ là đơn vị lượng bán.
- outlet / cửa hàng: một chi nhánh trong chuỗi.
- slow_moving: sản phẩm có doanh số thấp so với trung bình — nguy cơ tồn kho cao.

**NHIỆM VỤ:**
Đọc Answer facts (số liệu thực từ database), suy luận và viết câu trả lời theo TONE phía dưới.
Trả lời như analyst gửi sếp: nêu kết luận chính trước, sau đó đưa số liệu minh chứng, ý nghĩa vận hành và giới hạn dữ liệu nếu có.

{persona_block}

**RÀNG BUỘC NGHIÊM:**
- KHÔNG bịa số. KHÔNG đưa ra kết luận không có trong Answer facts.
- Nếu có Analysis brief: dùng phần findings/evidence làm dàn ý, nhưng vẫn chỉ dùng số trong Answer facts/Analysis brief.
- Nếu prompt có Grounding tóm tắt: dùng đó làm căn cứ, không chỉ dùng preview_rows.
- Nếu rows_summary.preview_includes_all_rows là true: mọi dòng đều nằm trong preview_rows — với câu hỏi dạng top/xếp hạng/danh sách, PHẢI liệt kê đủ từng dòng (đủ số thứ tự), không được rút gọn 1–3 mục rồi nói "chỉ có preview".
- Nếu preview_includes_all_rows là false: có thể tóm tắt, nhưng phải nêu rõ còn bao nhiêu dòng ngoài preview và không suy diễn chi tiết dòng chưa có trong facts.
- KHÔNG lộ SQL, template key, pipeline, reviewer, hoặc tên bảng kỹ thuật.
- Format số tiền: 1.234.567 đ (dấu chấm phân tách hàng nghìn). Percent: 12,34%.
- Kết thúc bằng dòng nguồn dữ liệu/khoảng thời gian rõ ràng.
"""


def _build_system_prompt(audience: str) -> str:
    from app.agents.personas import persona_block

    return _SYSTEM_BASE.replace("{persona_block}", persona_block(audience))


# NOTE: Do not call _build_system_prompt() at import time — it imports app.agents.personas,
# which loads the app.agents package and would create a cycle with graph_builder.


def _refusal(state: GraphState) -> str:
    errors = state.get("validation_errors") or []
    violations = state.get("guard_violations") or []
    clarification = state.get("clarification_question")

    if clarification:
        return clarification
    if any("Role insufficient" in e for e in errors):
        return "Bạn không có quyền xem báo cáo này. Vui lòng liên hệ quản lý."
    if any("No allowed outlets" in e for e in errors):
        return "Phạm vi outlet không hợp lệ với câu hỏi của bạn."
    if errors:
        return f"Câu hỏi chưa đủ thông tin: {', '.join(errors[:3])}."
    if violations:
        return "Yêu cầu của bạn không thể xử lý do vi phạm chính sách bảo mật."
    return "Xin lỗi, tôi không xử lý được câu hỏi này. Bạn có thể diễn đạt lại không?"


def _fold_text(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _outlet_rank_direction(state: GraphState) -> str:
    params = state.get("template_params")
    if isinstance(params, dict):
        direction = str(params.get("rank_direction") or "").strip().lower()
        if direction in {"asc", "bottom", "lowest", "weakest"}:
            return "asc"
    q = _fold_text(question_text(state))
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
    return "desc"


def _sql_verdict_footnote(state: GraphState) -> str:
    """Surface soft logical review (informational — hard guard still ran)."""
    chk = state.get("sql_logical_check")
    if not isinstance(chk, dict):
        return ""
    if state.get("template_key") in {"T11_inventory_current_stock", "T12_inventory_low_stock", "T15_inventory_reorder_alerts"}:
        if _coverage_caveat_vi(state):
            return ""
    consistent = chk.get("consistent", True)
    risk = str(chk.get("mismatch_risk") or "low").lower()
    notes = _review_note_for_user(str(chk.get("notes_vi") or "").strip())
    question = question_text(state)
    if (
        state.get("template_key") == "T32_period_revenue_summary"
        and notes
        and _SPURIOUS_PERIOD_SUMMARY_REVIEW_RE.search(notes)
        and not _MONTHLY_BREAKDOWN_RE.search(question)
    ):
        return ""

    if (not consistent) or risk == "high":
        if _coverage_caveat_vi(state) and not state.get("raw_result"):
            return ""
        msg = notes or "Pipeline phát hiện SQL có thể chưa phản ánh đủ ý định câu hỏi."
        return f"\n\n_Kiểm tra logic: {msg}_"

    if risk == "medium" and notes:
        if _coverage_caveat_vi(state):
            return ""
        return "\n\n_Lưu ý thêm: nếu dùng cho quyết định quan trọng, nên đối chiếu lại với báo cáo chuẩn._"
    return ""


def _sanitize_internal_terms(text: str) -> str:
    out = re.sub(r"\bSQL\b", "truy vấn", text or "", flags=re.IGNORECASE)
    out = re.sub(r"\btemplate(?:_key)?\b", "mẫu báo cáo", out, flags=re.IGNORECASE)
    out = re.sub(r"\boutlet_id\b", "cửa hàng", out, flags=re.IGNORECASE)
    out = re.sub(r"\bgroup(?:\s+by|\s+theo)?\s+[\w.]+", "nhóm theo chiều phân tích", out, flags=re.IGNORECASE)
    out = re.sub(r"\bbảng\b", "nguồn dữ liệu", out, flags=re.IGNORECASE)
    return out


def _review_note_for_user(text: str) -> str:
    out = _sanitize_internal_terms(text)
    out = re.sub(r"(?i)^truy vấn đúng[^.!?。]*[.!?。]\s*", "", out).strip()
    return out


def _scope_recap_vi(state: GraphState) -> str:
    """Supervisor time range + scoped outlets after RBAC (Postgres HR không có allowed_outlet_ids)."""
    tr = state.get("time_range") or {}
    fd = str(tr.get("from_date") or "").strip()
    td = str(tr.get("to_date") or "").strip()
    date_part = ""
    if fd and td:
        date_part = fd if fd == td else f"{fd} đến {td}"
    outlets = state.get("allowed_outlet_ids") or []
    scope_part = ""
    if isinstance(outlets, list) and outlets:
        if len(outlets) <= 3:
            scope_part = "cửa hàng (outlet_id): " + ", ".join(str(x) for x in outlets)
        else:
            scope_part = f"{len(outlets)} cửa hàng trong phạm vi quyền của bạn"
    bits = [x for x in (date_part, scope_part) if x]
    if not bits:
        return ""
    return "_Phạm vi: " + "; ".join(bits) + "._"


def _codegen_assumption_footer(state: GraphState) -> str:
    if state.get("executed_sql_source") != "codegen":
        return ""
    parts = []
    r = (state.get("codegen_rationale_vi") or "").strip()
    a = (state.get("codegen_assumption_vi") or "").strip()
    if r:
        parts.append(f"Lý do chọn metric/bảng: {r}")
    if a:
        parts.append(f"Giả định grain/thời gian: {a}")
    if not parts:
        return ""
    return "\n\n_" + " ".join(parts) + "_"


def _parse_iso_date(value: object) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _data_asof_footer(state: GraphState, now: str) -> str:
    if state.get("template_key") == "T31_outlet_directory":
        return f"_Nguồn: danh mục cửa hàng master hiện tại; trả lời lúc {now}._"
    ctx = ensure_data_source_context(state) or {}
    dataset = str(ctx.get("primary_dataset") or "").strip()
    time_column = str(ctx.get("time_column") or "").strip()
    semantics = str(ctx.get("time_semantics") or "").strip()
    available = ctx.get("available_range") if isinstance(ctx.get("available_range"), dict) else {}
    min_date = str((available or {}).get("min_date") or "").strip()
    max_date = str((available or {}).get("max_date") or "").strip()
    if dataset and time_column and min_date and max_date:
        sem = f" ({semantics})" if semantics else ""
        return f"_Nguồn thời gian: {time_column} trong {dataset}{sem}; dữ liệu hiện có {min_date} đến {max_date}._"
    if dataset and time_column:
        sem = f" ({semantics})" if semantics else ""
        return f"_Nguồn thời gian: {time_column} trong {dataset}{sem}; chưa xác định được dải dữ liệu hiện có._"
    window = coverage_window_for_template(state)
    max_date = str(window.get("max_date") or "").strip()
    if max_date:
        return f"_Nguồn: ClickHouse analytics cập nhật đến {max_date}; trả lời lúc {now}._"
    return f"_Nguồn: dữ liệu truy vấn tại thời điểm {now}._"


def _coverage_caveat_vi(state: GraphState) -> str:
    if state.get("template_key") == "T31_outlet_directory":
        return ""
    ctx = ensure_data_source_context(state) or {}
    notes: list[str] = []
    for caveat in ctx.get("caveats") or []:
        text = str(caveat or "").strip()
        if text and text not in notes:
            notes.append(text.rstrip("."))
    has_source_range_caveat = bool(notes)
    window = coverage_window_for_template(state)
    tr = state.get("time_range") or {}
    from_date = _parse_iso_date(tr.get("from_date"))
    to_date = _parse_iso_date(tr.get("to_date"))
    min_date = _parse_iso_date(window.get("min_date"))
    max_date = _parse_iso_date(window.get("max_date"))

    if state.get("template_key") in {"T11_inventory_current_stock", "T12_inventory_low_stock", "T15_inventory_reorder_alerts"}:
        return "_Lưu ý: " + "; ".join(notes) + "._" if notes else ""

    if not has_source_range_caveat and to_date and max_date and to_date > max_date:
        msg = f"bạn hỏi đến {to_date.isoformat()}, nhưng dữ liệu hiện chỉ cập nhật đến {max_date.isoformat()}"
        if msg not in notes:
            notes.append(msg)
    if not has_source_range_caveat and from_date and min_date and from_date < min_date:
        msg = f"dữ liệu hiện bắt đầu từ {min_date.isoformat()}, phần trước đó chưa có trong hệ thống phân tích"
        if msg not in notes:
            notes.append(msg)
    time_ctx = state.get("time_context")
    if isinstance(time_ctx, dict):
        comp_from = _parse_iso_date(time_ctx.get("comparison_from_date"))
        comp_to = _parse_iso_date(time_ctx.get("comparison_to_date"))
        if comp_to and max_date and comp_to > max_date:
            notes.append(
                f"kỳ so sánh đến {comp_to.isoformat()}, nhưng dữ liệu hiện chỉ cập nhật đến {max_date.isoformat()}"
            )
        if comp_from and min_date and comp_from < min_date:
            notes.append(
                f"kỳ so sánh bắt đầu {comp_from.isoformat()}, nhưng dữ liệu hiện bắt đầu từ {min_date.isoformat()}"
            )
    if not notes:
        return ""
    return "_Lưu ý: " + "; ".join(notes) + "._"


def _export_footer(state: GraphState) -> str:
    exports = state.get("exports") or []
    if not exports:
        return ""
    parts: list[str] = []
    for art in exports[:2]:
        if not isinstance(art, dict):
            continue
        fmt = str(art.get("format") or "csv").upper()
        rc = art.get("row_count")
        try:
            rc_text = f"{int(rc):,}".replace(",", ".") if rc is not None else "?"
        except (TypeError, ValueError):
            rc_text = "?"
        parts.append(f"{fmt} ({rc_text} dòng)")
    if not parts:
        return ""
    return (
        "_📎 Đã đính kèm file " + " và ".join(parts) +
        " để bạn đối chiếu dữ liệu thực tế. Link tải có hạn 24h._"
    )


def _append_common_footer(lines: list[str], state: GraphState, now: str, *, recap: str | None = None) -> None:
    lines.append(_data_asof_footer(state, now))
    caveat = _coverage_caveat_vi(state)
    if caveat:
        lines.append(caveat)
    if recap:
        lines.append(recap)
    export_line = _export_footer(state)
    if export_line:
        lines.append(export_line)


def _coverage_outside_answer(state: GraphState, now: str, *, recap: str | None = None) -> str | None:
    ctx = ensure_data_source_context(state) or {}
    if str(ctx.get("coverage_status") or "") != "outside":
        return None
    requested = ctx.get("requested_range") if isinstance(ctx.get("requested_range"), dict) else {}
    fd = str((requested or {}).get("from_date") or "").strip()
    td = str((requested or {}).get("to_date") or "").strip()
    dataset = str(ctx.get("primary_dataset") or "nguồn dữ liệu").strip()
    period = f"{fd} đến {td}" if fd and td and fd != td else (fd or td or "khoảng thời gian bạn hỏi")
    lines = [
        f"Nguồn {dataset} hiện chưa có đủ dữ liệu cho {period} trong snapshot hiện tại.",
        "Hệ thống đã có thể tự động thu hẹp kỳ truy vấn về phạm vi lịch sử có dữ liệu; nếu bạn vẫn thấy thông báo này, hãy thử hỏi lại hoặc chỉ rõ kỳ trong quá khứ có dữ liệu.",
    ]
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines)


def _is_empty_aggregate_result(state: GraphState, rows: list[dict[str, Any]]) -> bool:
    if len(rows) != 1 or not isinstance(rows[0], dict):
        return False
    row = rows[0]
    if state.get("template_key") == "T32_period_revenue_summary":
        return (
            str(row.get("first_business_date") or "") == "1970-01-01"
            and str(row.get("last_business_date") or "") == "1970-01-01"
            and _numeric(row.get("business_days")) == 0
            and _numeric(row.get("outlet_count")) == 0
            and _numeric(row.get("net_revenue")) == 0
            and _numeric(row.get("txn_count")) == 0
        )
    return False


def _format_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, float):
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def _format_vnd(value: Any) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return str(value)
    return f"{amount:,.0f} đ".replace(",", ".")


def _numeric(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _format_count(value: Any) -> str:
    try:
        return f"{int(float(value or 0)):,}".replace(",", ".")
    except (TypeError, ValueError):
        return str(value)


def _format_percent(value: Any, *, scale: float = 100.0) -> str:
    try:
        number = float(value or 0) * scale
    except (TypeError, ValueError):
        return str(value)
    return f"{number:,.2f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def _sum_numeric(rows: list[dict[str, Any]], column: str) -> float:
    return sum(_numeric(row.get(column)) for row in rows if isinstance(row, dict))


def _first_last_values(rows: list[dict[str, Any]], column: str) -> tuple[str, str]:
    vals = sorted({str(row.get(column)) for row in rows if isinstance(row, dict) and row.get(column) is not None})
    if not vals:
        return "", ""
    return vals[0], vals[-1]


def _period_from_rows_or_scope(state: GraphState, rows: list[dict[str, Any]], column: str = "business_date") -> str:
    first, last = _first_last_values(rows, column)
    if first and last:
        return first if first == last else f"{first} đến {last}"
    ctx = ensure_data_source_context(state) or {}
    actual = ctx.get("actual_data_range") if isinstance(ctx.get("actual_data_range"), dict) else {}
    actual_from = str((actual or {}).get("from_date") or "").strip()
    actual_to = str((actual or {}).get("to_date") or "").strip()
    if actual_from and actual_to:
        return actual_from if actual_from == actual_to else f"{actual_from} đến {actual_to}"
    tr = state.get("time_range") or {}
    fd = str(tr.get("from_date") or "").strip()
    td = str(tr.get("to_date") or "").strip()
    if fd and td:
        return fd if fd == td else f"{fd} đến {td}"
    return "khoảng thời gian đã chọn"


def _requested_dates(state: GraphState) -> tuple[date | None, date | None]:
    tr = state.get("time_range") or {}
    return _parse_iso_date(tr.get("from_date")), _parse_iso_date(tr.get("to_date"))


def _outlet_name(row: dict[str, Any]) -> str:
    return str(row.get("outlet_name") or row.get("outlet_code") or row.get("outlet_id") or "Không rõ outlet")


def _product_name(row: dict[str, Any]) -> str:
    return str(row.get("product_name") or row.get("product_id") or "Không rõ sản phẩm")


def _format_outlet_directory_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    if not rows:
        lines = ["Không tìm thấy cửa hàng nào trong phạm vi quyền hiện tại."]
        _append_common_footer(lines, state, now)
        return "\n".join(lines)

    if len(rows) == 1:
        row = rows[0]
        name = str(row.get("outlet_name") or "Không rõ tên")
        code = str(row.get("outlet_code") or row.get("outlet_id") or "").strip()
        status = str(row.get("outlet_status") or "").strip()
        lines = [f"Thông tin cửa hàng {name}" + (f" ({code}):" if code else ":")]
        if status:
            lines.append(f"- Trạng thái: {status}")
        if row.get("region_id") is not None:
            lines.append(f"- Region ID: {row.get('region_id')}")
        if row.get("address"):
            lines.append(f"- Địa chỉ: {row.get('address')}")
        if row.get("phone"):
            lines.append(f"- Điện thoại: {row.get('phone')}")
        if row.get("created_at"):
            lines.append(f"- Tạo lúc: {row.get('created_at')}")
        if row.get("updated_at"):
            lines.append(f"- Cập nhật lúc: {row.get('updated_at')}")
        _append_common_footer(lines, state, now)
        return "\n".join(lines)

    lines = [f"Có {len(rows)} cửa hàng trong phạm vi bạn đang xem:"]
    for idx, row in enumerate(rows[:20], start=1):
        name = str(row.get("outlet_name") or "Không rõ tên")
        code = str(row.get("outlet_code") or row.get("outlet_id") or "").strip()
        status = str(row.get("outlet_status") or "").strip()
        suffix = f" ({code})" if code else ""
        status_text = f" - {status}" if status else ""
        lines.append(f"{idx}. {name}{suffix}{status_text}")
    if len(rows) > 20:
        lines.append(f"Còn {len(rows) - 20} cửa hàng khác trong kết quả.")
    _append_common_footer(lines, state, now)
    return "\n".join(lines)


def _clean_llm_text(text: str) -> str:
    out = text.strip()
    out = re.sub(r"^(continue|tiếp tục|tiep tuc)\s*[:：,-]?\s+", "", out, flags=re.IGNORECASE)
    return out.rstrip()


def _safe_answer_facts(state: GraphState, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Compact numeric facts for LLM formatting. This is derived only from raw_result/state."""
    s = get_settings()
    cap = max(1, int(s.answer_facts_max_rows))
    preview_slice = rows[:cap]
    source_ctx = ensure_data_source_context(state) or {}
    facts: dict[str, Any] = {
        "business_question": question_text(state),
        "row_count": len(rows),
        "requested_time_range": state.get("time_range") or {},
        "actual_data_range": source_ctx.get("actual_data_range") or {},
        "coverage_status": source_ctx.get("coverage_status"),
        "source_context": {
            "primary_dataset": source_ctx.get("primary_dataset"),
            "source_system": source_ctx.get("source_system"),
            "time_column": source_ctx.get("time_column"),
            "time_semantics": source_ctx.get("time_semantics"),
            "available_range": source_ctx.get("available_range") or {},
            "caveats": source_ctx.get("caveats") or [],
        },
        "allowed_outlet_count": len(state.get("allowed_outlet_ids") or []),
        "data_coverage": coverage_window_for_template(state),
        "rows_summary": {
            "preview_row_count": len(preview_slice),
            "full_row_count": len(rows),
            "preview_includes_all_rows": len(rows) <= cap,
        },
    }
    if not rows:
        return facts

    first = rows[0] if isinstance(rows[0], dict) else {}
    numeric_columns = [
        k for k, v in first.items()
        if isinstance(v, (int, float)) and not str(k).lower().endswith("_id")
    ][:8]
    facts["numeric_totals"] = {
        col: _sum_numeric(rows, col)
        for col in numeric_columns
    }
    for col in ("business_date", "work_date", "first_business_date", "last_business_date"):
        first_val, last_val = _first_last_values(rows, col)
        if first_val or last_val:
            facts.setdefault("coverage", {})[col] = {"first": first_val, "last": last_val}
    facts["preview_rows"] = preview_slice
    return facts


def _fallback_answer_from_rows(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    """Deterministic fallback when the formatter LLM times out/fails."""
    recap = _scope_recap_vi(state)
    question = question_text(state)
    s = get_settings()
    cap = max(1, int(s.answer_facts_max_rows))
    lines = [f"Có {len(rows)} dòng dữ liệu phù hợp."]
    if question:
        lines.append(f"Câu hỏi: {question}")

    preview_lines: list[str] = []
    shown = rows[:cap]
    for idx, row in enumerate(shown, start=1):
        if not isinstance(row, dict):
            continue
        parts = [f"{k}={_format_scalar(v)}" for k, v in list(row.items())[:6]]
        preview_lines.append(f"{idx}. " + "; ".join(parts))
    if preview_lines:
        if len(rows) <= cap:
            lines.append("Chi tiết từng dòng:")
        else:
            lines.append(f"Chi tiết {len(shown)} dòng đầu (giới hạn hiển thị {cap}):")
        lines.extend(preview_lines)
        if len(rows) > cap:
            lines.append(f"Còn {len(rows) - cap} dòng chưa liệt kê — dùng xuất CSV/preview API nếu cần đầy đủ.")

    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _codegen_assumption_footer(state) + _sql_verdict_footnote(state)


def _format_period_revenue_summary(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    row = rows[0] if rows and isinstance(rows[0], dict) else {}
    recap = _scope_recap_vi(state)
    first = row.get("first_business_date")
    last = row.get("last_business_date")
    days = row.get("business_days")
    outlets = row.get("outlet_count")
    allowed = state.get("allowed_outlet_ids") or []
    allowed_count = len(allowed) if isinstance(allowed, list) else 0
    outlet_count = int(float(outlets or 0)) if outlets is not None else None
    period = f"{first} đến {last}" if first and last and first != last else str(first or last or "")

    if outlet_count is not None and allowed_count and outlet_count != allowed_count:
        headline = f"Trong {period}, có {outlet_count}/{allowed_count} cửa hàng trong phạm vi của bạn phát sinh doanh thu:"
    elif outlet_count is not None:
        headline = f"Doanh thu {outlet_count} cửa hàng trong {period}:"
    else:
        headline = f"Doanh thu trong {period}:"

    lines = [
        headline,
        f"Doanh thu ròng: {_format_vnd(row.get('net_revenue'))}.",
        f"Doanh thu gộp: {_format_vnd(row.get('gross_revenue'))}; giao dịch: {_format_count(row.get('txn_count'))}; giảm giá: {_format_vnd(row.get('total_discount'))}.",
    ]
    if days is not None:
        lines.append(f"Dữ liệu gồm {_format_count(days)} ngày kinh doanh trong kết quả.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_outlet_rank_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu doanh thu theo cửa hàng trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    direction = _outlet_rank_direction(state)
    top = rows[0]
    if direction == "asc":
        lines = [
            f"{top.get('outlet_name') or top.get('outlet_id')} đang có doanh thu thấp nhất trong phạm vi dữ liệu, "
            f"đạt {_format_vnd(top.get('net_revenue'))} doanh thu ròng."
        ]
    else:
        lines = [
            f"{top.get('outlet_name') or top.get('outlet_id')} đang dẫn đầu doanh thu, "
            f"đạt {_format_vnd(top.get('net_revenue'))} doanh thu ròng."
        ]
    if len(rows) > 1:
        lines.append("Xếp hạng doanh thu ròng từ thấp đến cao:" if direction == "asc" else "Top cửa hàng:")
        cap = max(5, int(get_settings().answer_facts_max_rows))
        shown_rows = rows[:cap]
        for row in shown_rows:
            rank = row.get("rank")
            prefix = f"{rank}. " if rank is not None else "- "
            lines.append(f"{prefix}{row.get('outlet_name') or row.get('outlet_id')}: {_format_vnd(row.get('net_revenue'))}")
        if len(rows) > len(shown_rows):
            lines.append(f"Còn {len(rows) - len(shown_rows)} cửa hàng khác trong kết quả.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_revenue_by_outlet_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu doanh thu theo cửa hàng trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: _numeric(r.get("net_revenue")), reverse=True)
    total_net = _sum_numeric(sorted_rows, "net_revenue")
    total_txn = _sum_numeric(sorted_rows, "txn_count")
    allowed = state.get("allowed_outlet_ids") or []
    allowed_count = len(allowed) if isinstance(allowed, list) else 0
    period = _period_from_rows_or_scope(state, sorted_rows)
    outlet_count = len(sorted_rows)

    if allowed_count and outlet_count != allowed_count:
        headline = (
            f"Trong {period}, có {outlet_count}/{allowed_count} cửa hàng trong phạm vi của bạn phát sinh doanh thu."
        )
    else:
        headline = f"Trong {period}, có {outlet_count} cửa hàng phát sinh doanh thu."

    lines = [
        headline,
        f"Tổng doanh thu ròng là {_format_vnd(total_net)} từ {_format_count(total_txn)} giao dịch.",
        "Top cửa hàng:",
    ]
    for idx, row in enumerate(sorted_rows[:5], start=1):
        lines.append(
            f"{idx}. {_outlet_name(row)} - {_format_vnd(row.get('net_revenue'))}, "
            f"{_format_count(row.get('txn_count'))} giao dịch"
        )
    if len(sorted_rows) > 5:
        lines.append(f"Còn {len(sorted_rows) - 5} cửa hàng khác trong kết quả.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_zero_revenue_outlets_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    period = _period_from_rows_or_scope(state, rows)
    allowed = state.get("allowed_outlet_ids") or []
    allowed_count = len(allowed) if isinstance(allowed, list) else 0

    if not rows:
        scope = f"{allowed_count} cửa hàng trong phạm vi của bạn" if allowed_count else "phạm vi bạn đang xem"
        lines = [f"Trong {period}, tất cả {scope} đều có phát sinh doanh thu."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n".join(lines) + _sql_verdict_footnote(state)

    sorted_rows = sorted(rows, key=lambda r: str(r.get("outlet_name") or r.get("outlet_code") or r.get("outlet_id")))
    if allowed_count:
        headline = f"Trong {period}, có {len(sorted_rows)}/{allowed_count} cửa hàng không phát sinh doanh thu."
    else:
        headline = f"Trong {period}, có {len(sorted_rows)} cửa hàng không phát sinh doanh thu."
    lines = [headline, "Danh sách cửa hàng:"]
    for idx, row in enumerate(sorted_rows[:20], start=1):
        code = str(row.get("outlet_code") or row.get("outlet_id") or "").strip()
        code_text = f" ({code})" if code else ""
        status = str(row.get("outlet_status") or "").strip()
        status_text = f" - {status}" if status else ""
        lines.append(f"{idx}. {_outlet_name(row)}{code_text}{status_text}.")
    if len(sorted_rows) > 20:
        lines.append(f"Còn {len(sorted_rows) - 20} cửa hàng khác trong kết quả.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_sales_detail_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    period = _period_from_rows_or_scope(state, rows)
    if not rows:
        lines = [f"Không thấy đơn bán hàng nào trong {period} theo phạm vi bạn đang xem."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n".join(lines) + _sql_verdict_footnote(state)

    sale_ids = [str(row.get("sale_id")) for row in rows if isinstance(row, dict) and row.get("sale_id") is not None]
    unique_sale_ids = sorted(set(sale_ids))
    line_rows = [row for row in rows if isinstance(row, dict) and row.get("product_id") is not None]
    sale_totals: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("sale_id") is None:
            continue
        key = str(row.get("sale_id"))
        if key not in sale_totals:
            sale_totals[key] = _numeric(row.get("sale_total_amount"))

    total_line = _sum_numeric(line_rows, "line_total")
    total_sale = sum(sale_totals.values())
    outlet_count = len({row.get("outlet_id") for row in rows if isinstance(row, dict) and row.get("outlet_id") is not None})
    outlet_part = f" tại {outlet_count} cửa hàng" if outlet_count else ""

    lines = [
        f"Trong {period}, có {_format_count(len(unique_sale_ids))} đơn bán hàng{outlet_part}.",
        f"Kết quả gồm {_format_count(len(line_rows) or len(rows))} dòng chi tiết; tổng theo dòng hàng là {_format_vnd(total_line)}.",
    ]
    if total_sale and abs(total_sale - total_line) > 0.5:
        lines.append(f"Tổng theo header đơn là {_format_vnd(total_sale)}; chênh lệch có thể do giảm giá/thuế cấp đơn.")
    lines.append("Một vài dòng đầu:")
    for idx, row in enumerate(rows[:10], start=1):
        product = str(row.get("product_name") or row.get("variant_name") or row.get("product_id") or "không rõ sản phẩm")
        outlet = _outlet_name(row)
        qty = _format_count(row.get("qty")) if row.get("qty") is not None else "0"
        line_total = _format_vnd(row.get("line_total"))
        status = str(row.get("sale_status") or "").strip()
        status_text = f", trạng thái {status}" if status else ""
        lines.append(
            f"{idx}. Đơn {row.get('sale_id')} - {outlet}: {product}, SL {qty}, {line_total}{status_text}."
        )
    if len(rows) > 10:
        lines.append(f"Còn {len(rows) - 10} dòng khác trong kết quả preview.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_daily_revenue_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu doanh thu theo ngày trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: str(r.get("business_date") or ""))
    period = _period_from_rows_or_scope(state, sorted_rows)
    total_net = _sum_numeric(sorted_rows, "net_revenue")
    total_gross = _sum_numeric(sorted_rows, "gross_revenue")
    total_txn = _sum_numeric(sorted_rows, "txn_count")
    lines = [
        f"Doanh thu theo ngày trong {period}:",
        f"- Doanh thu ròng: {_format_vnd(total_net)}; doanh thu gộp: {_format_vnd(total_gross)}; giao dịch: {_format_count(total_txn)}.",
        "Các ngày gần nhất:",
    ]
    for row in list(reversed(sorted_rows))[:5]:
        lines.append(
            f"- {row.get('business_date')}: {_format_vnd(row.get('net_revenue'))}, "
            f"{_format_count(row.get('txn_count'))} giao dịch"
        )
    if len(sorted_rows) > 5:
        lines.append(f"Kết quả có {len(sorted_rows)} ngày; đang tóm tắt 5 ngày gần nhất.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_weekly_revenue_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu doanh thu gộp theo tuần trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: str(r.get("week_start") or ""))
    period = _period_from_rows_or_scope(state, sorted_rows, column="week_start")
    total_net = _sum_numeric(sorted_rows, "net_revenue")
    total_gross = _sum_numeric(sorted_rows, "gross_revenue")
    total_txn = _sum_numeric(sorted_rows, "txn_count")
    lines = [
        f"Doanh thu theo tuần (tuần bắt đầu thứ Hai) trong {period}:",
        f"- Tổng doanh thu ròng: {_format_vnd(total_net)}; doanh thu gộp: {_format_vnd(total_gross)}; giao dịch: {_format_count(total_txn)}.",
        "Các tuần gần nhất:",
    ]
    for row in list(reversed(sorted_rows))[:8]:
        lines.append(
            f"- Tuần từ {row.get('week_start')}: {_format_vnd(row.get('net_revenue'))}, "
            f"{_format_count(row.get('txn_count'))} giao dịch"
        )
    if len(sorted_rows) > 8:
        lines.append(f"Kết quả có {len(sorted_rows)} tuần; đang tóm tắt 8 tuần gần nhất.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _period_bridge_span_label(tp: dict[str, Any], suffix: str) -> str:
    """Human label for T36 period A/B (date span), fallback-friendly."""
    f_raw = str(tp.get(f"from_date_{suffix}") or "").strip()
    t_raw = str(tp.get(f"to_date_{suffix}") or "").strip()
    f_d, t_d = f_raw[:10], t_raw[:10]
    if not f_d:
        return "—"
    if not t_d or f_d == t_d:
        return f_d
    return f"{f_d}–{t_d}"


def _format_revenue_driver_bridge_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    tp = state.get("template_params") or {}
    la = _period_bridge_span_label(tp if isinstance(tp, dict) else {}, "a")
    lb = _period_bridge_span_label(tp if isinstance(tp, dict) else {}, "b")
    if not rows or not isinstance(rows[0], dict):
        lines = [
            "Không có đủ dữ liệu để phân tích thành phần tăng trưởng giữa hai kỳ.",
            f"Kỳ đang so: **{la}** và **{lb}**.",
        ]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n".join(lines)

    r = rows[0]
    na = _numeric(r.get("net_revenue_a"))
    nb = _numeric(r.get("net_revenue_b"))
    txa = _numeric(r.get("txn_count_a"))
    txb = _numeric(r.get("txn_count_b"))
    oa = _numeric(r.get("outlet_count_a"))
    ob = _numeric(r.get("outlet_count_b"))

    def _aov(net: float, txn: float) -> float:
        if txn <= 0:
            return 0.0
        return net / txn

    aov_a = _aov(na, txa)
    aov_b = _aov(nb, txb)
    d_rev = na - nb
    d_tx = txa - txb
    d_oa = oa - ob
    d_aov = aov_a - aov_b
    pct_rev = (d_rev / nb) if nb else 0.0
    pct_tx = (d_tx / txb) if txb else 0.0
    pct_aov = (d_aov / aov_b) if aov_b else 0.0
    pct_out = (d_oa / ob) if ob else 0.0

    lines = [
        f"**Phân tích thành phần (doanh thu): {la} so với {lb}**",
        "",
        f"- Doanh thu ròng: **{_format_vnd(nb)}** ({lb}) → **{_format_vnd(na)}** ({la}), "
        f"chênh **{_format_vnd(d_rev)}** (khoảng **{_format_percent(abs(pct_rev))}**).",
        f"- Số giao dịch: **{_format_count(txb)}** → **{_format_count(txa)}** "
        f"(**{_format_count(d_tx)}**, ~**{_format_percent(abs(pct_tx))}**).",
        f"- AOV ước từ dữ liệu (doanh thu ròng / số giao dịch): **{_format_vnd(aov_b)}** → **{_format_vnd(aov_a)}** "
        f"(chênh ~**{_format_percent(abs(pct_aov))}**).",
        f"- Số outlet có phát sinh trong kỳ (ước `countDistinct`): **{_format_count(ob)}** → **{_format_count(oa)}** "
        f"(**{_format_count(d_oa)}**, ~**{_format_percent(abs(pct_out))}**).",
        "",
        "**Diễn giải nhanh:**",
    ]
    drivers: list[str] = []
    if abs(d_tx) >= abs(d_oa) and abs(d_tx) > 0 and txb > 0:
        drivers.append("tăng số lượng giao dịch (volume)")
    if d_oa != 0:
        drivers.append("thay đổi số outlet có doanh thu trong kỳ")
    if abs(d_aov) > 0 and aov_b > 0 and abs(pct_aov) >= 0.03:
        drivers.append("thay đổi AOV (giá trị mỗi đơn)")
    if not drivers:
        drivers.append("các thành phần trên cùng tác động — xem chi tiết số liệu")
    lines.append(
        f"Kết quả gợi ý tăng trưởng chịu ảnh hưởng chủ yếu bởi: **{'; '.join(drivers)}** "
        f"(đánh giá sơ bộ từ `txn`, `outlet_count` và AOV)."
    )
    lines.append(
        "\n_Nguồn: `analytics.ai_sales_daily` (gộp theo kỳ calendar từ câu hỏi); "
        "AOV = tổng doanh thu ròng / tổng số giao dịch trong kỳ._"
    )
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_top_products_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu sản phẩm bán ra trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: (_numeric(r.get("qty")), _numeric(r.get("revenue"))), reverse=True)
    period = _period_from_rows_or_scope(state, sorted_rows)
    total_qty = _sum_numeric(sorted_rows, "qty")
    total_rev = _sum_numeric(sorted_rows, "revenue")
    cap = max(1, int(get_settings().answer_facts_max_rows))
    shown = sorted_rows[:cap]
    lines = [
        f"Top sản phẩm bán chạy trong {period}:",
        f"Tổng trong kết quả: {_format_count(total_qty)} đơn vị, doanh thu {_format_vnd(total_rev)}.",
    ]
    brief = state.get("analysis_brief") if isinstance(state.get("analysis_brief"), dict) else {}
    findings = brief.get("findings") if isinstance(brief.get("findings"), list) else []
    if findings:
        lines.append("Nhận định chính:")
        for item in findings[:2]:
            if not isinstance(item, dict):
                continue
            claim = str(item.get("claim") or "").strip()
            evidence = [str(x).strip() for x in (item.get("evidence") or []) if str(x).strip()]
            if claim:
                suffix = f" Minh chứng: {'; '.join(evidence[:2])}." if evidence else ""
                lines.append(f"- {claim}.{suffix}")
    for idx, row in enumerate(shown, start=1):
        lines.append(
            f"{idx}. {_product_name(row)} - {_format_count(row.get('qty'))} đơn vị, "
            f"{_format_vnd(row.get('revenue'))}"
        )
    if len(sorted_rows) > cap:
        lines.append(
            f"Còn {len(sorted_rows) - cap} dòng trong kết quả (đang giới hạn hiển thị {cap} mục); dùng xuất file nếu cần đủ."
        )
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_yoy_revenue_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    row = rows[0] if rows and isinstance(rows[0], dict) else {}
    recap = _scope_recap_vi(state)
    current = _numeric(row.get("revenue_current"))
    last_year = _numeric(row.get("revenue_last_year"))
    time_ctx = state.get("time_context") if isinstance(state.get("time_context"), dict) else {}
    comp_from = _parse_iso_date(time_ctx.get("comparison_from_date"))
    comp_to = _parse_iso_date(time_ctx.get("comparison_to_date"))
    window = coverage_window_for_template(state)
    min_date = _parse_iso_date(window.get("min_date"))
    max_date = _parse_iso_date(window.get("max_date"))
    comparison_outside_coverage = bool(
        (comp_from and min_date and comp_from < min_date)
        or (comp_to and max_date and comp_to > max_date)
    )
    if comparison_outside_coverage:
        lines = [
            f"Kỳ này ghi nhận {_format_vnd(current)} từ {_format_count(row.get('txn_current'))} giao dịch.",
            "Chưa đủ dữ liệu cùng kỳ năm ngoái để kết luận tăng/giảm chính xác.",
        ]
        if comp_from and comp_to:
            lines.append(f"Kỳ cần so sánh là {comp_from.isoformat()} đến {comp_to.isoformat()}.")
        if min_date or max_date:
            coverage_text = " đến ".join(x.isoformat() for x in (min_date, max_date) if x)
            lines.append(f"Coverage hiện có của nguồn doanh thu: {coverage_text}.")
        _append_common_footer(lines, state, now, recap=recap)
        return "\n".join(lines) + _sql_verdict_footnote(state)

    delta = current - last_year
    if last_year:
        pct = delta / last_year
        change_text = f"{_format_vnd(abs(delta))} ({_format_percent(abs(pct))})"
    else:
        change_text = _format_vnd(abs(delta))
    direction = "tăng" if delta >= 0 else "giảm"
    txn_current = _numeric(row.get("txn_current"))
    txn_last = _numeric(row.get("txn_last_year"))
    lines = [
        f"Doanh thu kỳ này {direction} {change_text} so với cùng kỳ năm ngoái.",
        f"Kỳ này: {_format_vnd(current)} từ {_format_count(txn_current)} giao dịch.",
        f"Cùng kỳ năm ngoái: {_format_vnd(last_year)} từ {_format_count(txn_last)} giao dịch.",
    ]
    if comp_from and comp_to:
        lines.append(f"So sánh với giai đoạn {comp_from.isoformat()} đến {comp_to.isoformat()}.")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_payment_method_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu doanh thu theo phương thức thanh toán trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: _numeric(r.get("revenue")), reverse=True)
    total_revenue = _sum_numeric(sorted_rows, "revenue")
    total_txn = _sum_numeric(sorted_rows, "txn_count")
    top = sorted_rows[0]
    method = str(top.get("payment_method") or "Không rõ")
    lines = [
        f"{method} đang đóng góp doanh thu cao nhất trong các phương thức thanh toán.",
        f"Tổng doanh thu theo kết quả: {_format_vnd(total_revenue)} từ {_format_count(total_txn)} giao dịch.",
        "Chi tiết:",
    ]
    for row in sorted_rows[:8]:
        share = (_numeric(row.get("revenue")) / total_revenue) if total_revenue else 0
        lines.append(
            f"- {row.get('payment_method') or 'Không rõ'}: {_format_vnd(row.get('revenue'))}, "
            f"{_format_count(row.get('txn_count'))} giao dịch ({_format_percent(share)})."
        )
    window = coverage_window_for_template(state)
    min_date = _parse_iso_date(window.get("min_date"))
    max_date = _parse_iso_date(window.get("max_date"))
    requested_from, requested_to = _requested_dates(state)
    if (
        min_date
        and max_date
        and min_date == max_date
        and requested_from
        and requested_to
        and requested_from != requested_to
    ):
        lines.append(
            f"_Lưu ý: nguồn thanh toán hiện chỉ có dữ liệu ngày {max_date.isoformat()}; "
            "không nên xem là đủ toàn bộ kỳ nếu bạn hỏi nhiều ngày._"
        )
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_hour_window(value: Any) -> str:
    try:
        hour = int(float(value or 0))
    except (TypeError, ValueError):
        return str(value or "Không rõ giờ")
    hour = max(0, min(hour, 23))
    return f"{hour:02d}:00-{hour:02d}:59"


def _format_peak_hour_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu bán hàng theo giờ trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    ranked = sorted(rows, key=lambda r: (_numeric(r.get("txn_count")), _numeric(r.get("revenue"))), reverse=True)
    total_txn = _sum_numeric(ranked, "txn_count")
    total_revenue = _sum_numeric(ranked, "revenue")
    top = ranked[0]
    period = _period_from_rows_or_scope(state, ranked)
    top_share = (_numeric(top.get("txn_count")) / total_txn) if total_txn else 0
    lines = [
        f"Khung giờ cao điểm trong {period} là {_format_hour_window(top.get('hour_of_day'))}.",
        (
            f"Khung giờ này có {_format_count(top.get('txn_count'))} giao dịch, "
            f"doanh thu {_format_vnd(top.get('revenue'))}"
            + (f" ({_format_percent(top_share)} tổng giao dịch trong kết quả)." if total_txn else ".")
        ),
        f"Tổng theo kết quả: {_format_count(total_txn)} giao dịch, {_format_vnd(total_revenue)}.",
        "Top khung giờ:",
    ]
    for idx, row in enumerate(ranked[:5], start=1):
        lines.append(
            f"{idx}. {_format_hour_window(row.get('hour_of_day'))}: "
            f"{_format_count(row.get('txn_count'))} giao dịch, {_format_vnd(row.get('revenue'))}."
        )
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_avg_basket_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu AOV trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: str(r.get("business_date") or ""))
    period = _period_from_rows_or_scope(state, sorted_rows)
    total_txn = _sum_numeric(sorted_rows, "txn_count")
    weighted_sum = sum(_numeric(r.get("avg_basket_size")) * _numeric(r.get("txn_count")) for r in sorted_rows)
    avg = weighted_sum / total_txn if total_txn else _sum_numeric(sorted_rows, "avg_basket_size") / max(len(sorted_rows), 1)
    lines = [
        f"AOV trung bình trong {period} là {_format_vnd(avg)}.",
        f"Căn cứ trên {_format_count(total_txn)} giao dịch trong kết quả.",
        "Các ngày gần nhất:",
    ]
    for row in list(reversed(sorted_rows))[:5]:
        lines.append(f"- {row.get('business_date')}: {_format_vnd(row.get('avg_basket_size'))}, {_format_count(row.get('txn_count'))} giao dịch")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_transaction_count_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu giao dịch trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: str(r.get("business_date") or ""))
    period = _period_from_rows_or_scope(state, sorted_rows)
    total_txn = _sum_numeric(sorted_rows, "txn_count")
    lines = [f"Tổng số giao dịch trong {period} là {_format_count(total_txn)}."]
    lines.append("Các ngày gần nhất:")
    for row in list(reversed(sorted_rows))[:5]:
        lines.append(f"- {row.get('business_date')}: {_format_count(row.get('txn_count'))} giao dịch")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_cancellation_rate_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu hủy đơn trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: str(r.get("business_date") or ""))
    period = _period_from_rows_or_scope(state, sorted_rows)
    cancelled = _sum_numeric(sorted_rows, "cancelled_count")
    total = _sum_numeric(sorted_rows, "total_count")
    rate = cancelled / total if total else 0
    lines = [
        f"Tỷ lệ hủy đơn trong {period} là {_format_percent(rate)}.",
        f"Căn cứ: {_format_count(cancelled)} đơn hủy trên {_format_count(total)} đơn đã ghi nhận.",
        "Các ngày gần nhất:",
    ]
    for row in list(reversed(sorted_rows))[:5]:
        lines.append(
            f"- {row.get('business_date')}: {_format_percent(row.get('cancellation_rate'))} "
            f"({_format_count(row.get('cancelled_count'))}/{_format_count(row.get('total_count'))})."
        )
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_daily_pnl_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu P&L trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    period = _period_from_rows_or_scope(state, rows)
    revenue = _sum_numeric(rows, "revenue")
    cogs = _sum_numeric(rows, "cogs")
    payroll = _sum_numeric(rows, "payroll_cost")
    profit = _sum_numeric(rows, "operating_profit")
    margin = profit / revenue if revenue else 0
    lines = [
        f"P&L trong {period}: lợi nhuận vận hành {_format_vnd(profit)}, margin {_format_percent(margin)}.",
        f"Doanh thu {_format_vnd(revenue)}; giá vốn {_format_vnd(cogs)}; chi phí lương {_format_vnd(payroll)}.",
    ]
    if revenue > 0 and cogs == 0 and payroll == 0:
        lines.append(
            "_Lưu ý: giá vốn/chi phí lương đang bằng 0 trong kết quả, "
            "nên lợi nhuận và margin P&L chưa đủ tin cậy để kết luận tài chính._"
        )
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _format_inventory_stock_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    recap = _scope_recap_vi(state)
    if not rows:
        lines = ["Không có dữ liệu tồn kho phù hợp trong phạm vi này."]
        _append_common_footer(lines, state, now, recap=recap)
        return "\n\n".join(lines)

    sorted_rows = sorted(rows, key=lambda r: _numeric(r.get("qty_on_hand")))
    negative_count = sum(1 for row in sorted_rows if _numeric(row.get("qty_on_hand")) < 0)
    snapshot_column = "snapshot_date" if any(isinstance(row, dict) and row.get("snapshot_date") is not None for row in sorted_rows) else "business_date"
    snapshot = _period_from_rows_or_scope(state, sorted_rows, column=snapshot_column)
    if negative_count:
        lines = [f"Có {negative_count} cặp outlet-item đang tồn âm trong snapshot {snapshot}."]
    else:
        lines = [f"Tồn kho snapshot {snapshot} có {len(sorted_rows)} cặp outlet-item phù hợp."]
    lines.append("Kết quả xếp theo từng cặp outlet-item; cùng item ở outlet khác được tính riêng.")
    lines.append("Các cặp outlet-item thấp nhất:")
    for idx, row in enumerate(sorted_rows[:10], start=1):
        item = str(row.get("item_id") or "không rõ")
        outlet = row.get("outlet_id")
        outlet_text = f"outlet {outlet}" if outlet is not None else "outlet không rõ"
        lines.append(f"{idx}. Item {item} tại {outlet_text}: {_format_count(row.get('qty_on_hand'))}.")
    lines.append("_Lưu ý: kết quả tồn kho dùng item_id từ snapshot; nếu chưa có tên item thì tôi không tự suy diễn tên sản phẩm._")
    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _sql_verdict_footnote(state)


def _column_coverage(rows: list[dict[str, Any]], column: str | None) -> str:
    if not column:
        return ""
    vals = [str(row.get(column)) for row in rows if isinstance(row, dict) and row.get(column) is not None]
    if not vals:
        return ""
    distinct = len(set(vals))
    return f"{column}: {min(vals)} đến {max(vals)} ({distinct} giá trị khác nhau)"


def _grounding_summary(state: GraphState, rows: list[dict[str, Any]], sample_count: int) -> str:
    lines = [
        f"- Tổng số dòng kết quả: {len(rows)}",
        f"- Số dòng đưa vào Answer facts JSON: {sample_count}",
    ]
    if len(rows) > sample_count:
        lines.append(
            "- Không phải mọi dòng đều có trong facts; chỉ tóm tắt hoặc liệt kê theo phần có trong facts, không bịa dòng ngoài đó."
        )
    else:
        lines.append(
            "- Mọi dòng kết quả đều có trong Answer facts — với câu hỏi top/xếp hạng/danh sách phải liệt kê đủ các dòng đó, không được bảo \"chỉ có preview\"."
        )

    chart = state.get("chart_spec")
    if isinstance(chart, dict) and chart:
        ctype = chart.get("type")
        x = chart.get("x")
        y = chart.get("y")
        title = chart.get("title")
        metric_label = chart.get("metric_label")
        lines.append(
            "- Chart spec: "
            + ", ".join(
                str(part)
                for part in (
                    f"type={ctype}" if ctype else "",
                    f"title={title}" if title else "",
                    f"x={x}" if x else "",
                    f"y={y}" if y else "",
                    f"metric_label={metric_label}" if metric_label else "",
                )
                if part
            )
        )
        coverage = _column_coverage(rows, str(x) if x else None)
        if coverage:
            lines.append(f"- Coverage theo trục X: {coverage}")
    else:
        first = rows[0] if rows and isinstance(rows[0], dict) else {}
        for key in list(first.keys())[:8]:
            if "date" in key.lower():
                coverage = _column_coverage(rows, key)
                if coverage:
                    lines.append(f"- Coverage thời gian: {coverage}")
                    break

    return "\n".join(lines)


def _chart_kind_label(chart_type: object) -> str:
    if chart_type == "line":
        return "đường"
    if chart_type == "bar":
        return "cột"
    if chart_type == "table":
        return "bảng"
    return str(chart_type or "chart")


def _format_visualization_answer(state: GraphState, rows: list[dict[str, Any]], now: str) -> str:
    chart = state.get("chart_spec") or {}
    recap = _scope_recap_vi(state)
    if not isinstance(chart, dict) or not chart:
        return _fallback_answer_from_rows(state, rows, now)

    chart_type = chart.get("type")
    x = chart.get("x")
    y = chart.get("y")
    metric_label = chart.get("metric_label") or y
    title = chart.get("title") or "biểu đồ dữ liệu"
    coverage = _column_coverage(rows, str(x) if x else None)

    if chart_type == "table" or not x or not y:
        lines = [f"Mình đã chuẩn bị bảng dữ liệu với {len(rows)} dòng phù hợp để hiển thị."]
    else:
        lines = [
            f"Mình đã chuẩn bị biểu đồ {_chart_kind_label(chart_type)} `{title}` với {len(rows)} điểm dữ liệu.",
            f"Trục X = `{x}`, trục Y = `{y}` ({metric_label}).",
        ]
        if coverage:
            lines.append(f"Phạm vi dữ liệu theo trục X: {coverage}.")

    _append_common_footer(lines, state, now, recap=recap)
    return "\n".join(lines) + _codegen_assumption_footer(state) + _sql_verdict_footnote(state)


async def answer_formatter(state: GraphState) -> GraphState:
    now = datetime.now(app_timezone()).strftime("%Y-%m-%d %H:%M:%S")
    ensure_data_source_context(state)

    if state.get("skip_answer_formatter_llm") and state.get("answer_text"):
        state.setdefault("citations", [])
        state.setdefault("response_kind", "answer")
        return state

    if state.get("response_kind") in ("clarification", "unsupported") and state.get("clarification_question"):
        state["answer_text"] = str(state.get("clarification_question") or "")
        state["citations"] = []
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "direct_clarification"})
        return state

    # Refusal paths
    if state.get("validation_errors") or not state.get("guard_passed", True) or state.get("execution_error"):
        execution_error = str(state.get("execution_error") or "")
        if execution_error and (
            state.get("correction_attempts", 0) >= 2 or not is_self_correction_candidate(execution_error)
        ):
            state["answer_text"] = "Có lỗi khi truy xuất dữ liệu. Vui lòng thử lại sau."
            state["response_kind"] = "answer"
        else:
            state["answer_text"] = _refusal(state)
            if not state.get("response_kind"):
                state["response_kind"] = "clarification"
        state["citations"] = []
        return state

    rows = state.get("raw_result") or []
    recap = _scope_recap_vi(state)
    outside_answer = _coverage_outside_answer(state, now, recap=recap) if (not rows or _is_empty_aggregate_result(state, rows)) else None
    if outside_answer:
        state["answer_text"] = outside_answer
        state["citations"] = []
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "coverage_outside"})
        return state

    recap_block = f"\nPhạm vi/thời gian (recap): {recap}\n" if recap else ""
    gen_asm = (state.get("codegen_assumption_vi") or "").strip()
    gen_rat = (state.get("codegen_rationale_vi") or "").strip()
    gen_block = ""
    if gen_asm or gen_rat:
        gen_block = f"\nGiả định truy vấn: rationale={gen_rat!s} | assumption={gen_asm!s}\n"

    if state.get("template_key") == "T33_zero_revenue_outlets":
        state["answer_text"] = _format_zero_revenue_outlets_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_zero_revenue_outlets"})
        return state

    if state.get("template_key") == "T34_sales_detail_by_day":
        state["answer_text"] = _format_sales_detail_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_sales_detail"})
        return state

    if not rows:
        ctx = ensure_data_source_context(state) or {}
        status = str(ctx.get("coverage_status") or "")
        requested = ctx.get("requested_range") if isinstance(ctx.get("requested_range"), dict) else {}
        fd = str((requested or {}).get("from_date") or "").strip()
        td = str((requested or {}).get("to_date") or "").strip()
        dataset = str(ctx.get("primary_dataset") or "nguồn dữ liệu").strip()
        if status == "outside" and fd and td:
            lines = [f"Nguồn {dataset} hiện chưa có dữ liệu cho khoảng {fd} đến {td}."]
        elif status in {"partial_before", "partial_after"}:
            lines = ["Không có dữ liệu phù hợp trong phần dữ liệu hiện có của khoảng bạn hỏi."]
        elif status == "unknown":
            lines = ["Không có dữ liệu phù hợp; hiện cũng chưa xác định được coverage thời gian của nguồn này."]
        else:
            lines = ["Không có dữ liệu phù hợp trong khoảng thời gian này."]
        _append_common_footer(lines, state, now, recap=recap)
        state["answer_text"] = (
            "\n\n".join(lines)
            + _codegen_assumption_footer(state)
            + _sql_verdict_footnote(state)
        )
        state["citations"] = []
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "empty_result"})
        return state

    if state.get("chart_spec"):
        state["answer_text"] = _format_visualization_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_visualization"})
        return state

    if state.get("template_key") == "T32_period_revenue_summary":
        state["answer_text"] = _format_period_revenue_summary(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_period_summary"})
        return state

    if state.get("template_key") == "T22_outlet_rank":
        state["answer_text"] = _format_outlet_rank_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_outlet_rank"})
        return state

    if state.get("template_key") == "T02_revenue_by_outlet":
        state["answer_text"] = _format_revenue_by_outlet_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_revenue_by_outlet"})
        return state

    if state.get("template_key") == "T01_daily_revenue":
        state["answer_text"] = _format_daily_revenue_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_daily_revenue"})
        return state

    if state.get("template_key") == "T35_weekly_revenue_trend":
        state["answer_text"] = _format_weekly_revenue_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_weekly_revenue"})
        return state

    if state.get("template_key") == "T36_revenue_period_driver_bridge":
        state["answer_text"] = _format_revenue_driver_bridge_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_revenue_driver_bridge"})
        return state

    if state.get("template_key") == "T04_top_products":
        state["answer_text"] = _format_top_products_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_top_products"})
        return state

    if state.get("template_key") == "T07_revenue_comparison_yoy":
        state["answer_text"] = _format_yoy_revenue_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_yoy_revenue"})
        return state

    if state.get("template_key") == "T08_revenue_by_payment_method":
        state["answer_text"] = _format_payment_method_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_payment_method"})
        return state

    if state.get("template_key") == "T23_peak_hour_analysis":
        state["answer_text"] = _format_peak_hour_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_peak_hour"})
        return state

    if state.get("template_key") == "T09_avg_basket_size":
        state["answer_text"] = _format_avg_basket_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_avg_basket"})
        return state

    if state.get("template_key") == "T10_transaction_count":
        state["answer_text"] = _format_transaction_count_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_transaction_count"})
        return state

    if state.get("template_key") == "T30_sale_cancellation_rate":
        state["answer_text"] = _format_cancellation_rate_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_cancellation_rate"})
        return state

    if state.get("template_key") == "T24_daily_pnl_summary":
        state["answer_text"] = _format_daily_pnl_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_daily_pnl"})
        return state

    if state.get("template_key") in {"T11_inventory_current_stock", "T12_inventory_low_stock", "T15_inventory_reorder_alerts"}:
        state["answer_text"] = _format_inventory_stock_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_inventory_stock"})
        return state

    if state.get("template_key") == "T31_outlet_directory":
        state["answer_text"] = _format_outlet_directory_answer(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "source": "deterministic_outlet_directory"})
        return state

    s_fmt = get_settings()
    facts_cap = max(1, int(s_fmt.answer_facts_max_rows))
    grounding = _grounding_summary(state, rows, min(len(rows), facts_cap))
    facts = _safe_answer_facts(state, rows)
    question = question_text(state)
    original = (state.get("normalized_question") or "").strip()
    original_block = f"Câu hỏi gốc: {original}\n" if original and original != question else ""
    time_block = format_time_context_for_prompt(state.get("time_context"))
    coverage_block = format_data_coverage_for_prompt(state.get("data_coverage_context"))
    analysis_brief = state.get("analysis_brief") if isinstance(state.get("analysis_brief"), dict) else {}
    analysis_block = ""
    if analysis_brief:
        analysis_block = (
            "Analysis brief JSON (dàn ý analyst đã rút ra từ Answer facts; dùng để lập luận, không thêm số ngoài đây):\n"
            f"{json.dumps(analysis_brief, ensure_ascii=False, default=str)}\n\n"
        )

    # Include codegen reasoning so the LLM knows *how* the data was obtained
    rationale = (state.get("codegen_rationale_vi") or "").strip()
    tables_used = state.get("codegen_tables_used") or []
    approach_block = ""
    if rationale or tables_used:
        approach_parts = []
        if rationale:
            approach_parts.append(f"Cách tiếp cận truy vấn: {rationale}")
        if tables_used:
            approach_parts.append(f"Nguồn dữ liệu: {', '.join(str(t) for t in tables_used)}")
        approach_block = "\n" + "\n".join(approach_parts) + "\n"

    user_prompt = f"""{original_block}Câu hỏi hiệu lực: {question}
Số dòng kết quả: {len(rows)}
{recap_block}{gen_block}{approach_block}{time_block}{coverage_block}
Grounding tóm tắt:
{grounding}

{analysis_block}
Answer facts JSON (căn cứ duy nhất cho số liệu — không thêm số ngoài đây):
{json.dumps(facts, ensure_ascii=False, default=str)}

Hãy phân tích dữ liệu trên và trả lời câu hỏi bằng tiếng Việt. Mở đầu bằng kết luận chính, sau đó nêu số liệu minh chứng và giới hạn dữ liệu nếu có. Thời gian hiện tại: {now}.
"""

    from app.agents.personas import detect_audience

    audience = state.get("audience") or detect_audience(state.get("auth"))
    if not s_fmt.executive_persona_enabled and audience == "executive":
        audience = "analyst"
    state["audience"] = audience
    system_prompt = _build_system_prompt(audience)

    row_n = min(len(rows), facts_cap)
    base_tokens = 1100 if audience == "executive" else 1000
    max_tokens = min(8000, base_tokens + row_n * 45)

    try:
        text, usage = await llm_call_text(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.4,
            agent="formatter",
            max_tokens=max_tokens,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Answer formatter LLM failed, using deterministic fallback: %s", e)
        state["answer_text"] = _fallback_answer_from_rows(state, rows, now)
        state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
        state["response_kind"] = "answer"
        state.setdefault("trace", []).append({"node": "answer_formatter", "error": type(e).__name__, "fallback": True})
        return state
    out = _clean_llm_text(text)
    if recap:
        out += f"\n\n{recap}"
    out += _codegen_assumption_footer(state)
    out += _sql_verdict_footnote(state)
    export_line = _export_footer(state)
    if export_line:
        out += "\n\n" + export_line
    state["answer_text"] = out
    state["citations"] = [{"row_count": len(rows), "template": state.get("template_key")}]
    state["response_kind"] = "answer"
    state.setdefault("trace", []).append({"node": "answer_formatter", **usage})
    return state
