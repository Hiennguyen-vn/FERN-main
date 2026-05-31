from __future__ import annotations

from typing import Any

from app.templates.registry import TEMPLATES, ensure_runtime_templates_loaded
from app.time_utils import today_local

SUPERVISOR_SCHEMA: dict[str, Any] = {
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


def build_supervisor_system_prompt() -> str:
    ensure_runtime_templates_loaded()
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
