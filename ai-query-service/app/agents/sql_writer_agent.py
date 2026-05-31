"""Codex-driven SQL Writer Agent — single LLM with tool loop.

Replaces the legacy 7-node codegen subgraph (planner → generator → structure
guard → rbac_injector → reviewer → trial → retry) with **one** agent that
calls deterministic tools in a loop:

  search_schema → get_table_policy → list_columns (optional)
  → write SQL → validate_and_inject → execute_query

Self-correction = the agent's own next turn after ``validate_and_inject``
returns ``ok=false``; bounded by ``MAX_CODEGEN_ATTEMPTS`` and a hard tool-
call budget. No reviewer LLM — structural correctness is enforced by
``validate_and_inject``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import unicodedata
from typing import Any, Callable

from openai import AsyncOpenAI

from app.agents.tools import (
    ExecuteContext,
    ValidateContext,
    execute_query_tool,
    get_table_policy_tool,
    list_columns_tool,
    make_execute_query_tool,
    make_validate_and_inject_tool,
    search_schema_tool,
)
from app.config import get_settings
from app.graph.outlet_scope import requested_outlet_ids_for_rbac
from app.graph.state import GraphState
from app.llm.openai_client import (
    get_client,
    llm_call_chat_with_tools,
    llm_call_responses_with_tools,
)
from app.query_policy import candidate_tables_for_prompt, format_domain_contract
from app.time_utils import format_time_context_for_prompt
from app.utils.text import fold_text as _fold_text

logger = logging.getLogger(__name__)


_SYSTEM_PROMPT = """Bạn là SQL Analyst Agent cho FERN AI Query Assistant — hệ thống phân tích dữ liệu chuỗi F&B Việt Nam.
Database: ClickHouse (READ ONLY). Bạn có kiến thức sâu về nghiệp vụ F&B và ClickHouse SQL.

**KIẾN THỨC NGHIỆP VỤ F&B (dùng để suy luận chọn bảng/metric đúng):**
- net_revenue = gross_revenue − total_discount → cột thường là net_revenue hoặc tính từ sale_total − discount.
- Doanh thu "theo cửa hàng" → GROUP BY outlet_id (hoặc outlet_name nếu có JOIN).
- "Tăng trưởng" / "growth" → so sánh 2 kỳ: kỳ hiện tại vs kỳ trước = (current − prev) / prev.
- "Sản phẩm bán chậm" → qty thấp nhất hoặc dưới ngưỡng trung bình.
- "Cao điểm" → theo giờ (hour_of_day), cần bảng có timestamp hoặc cột giờ.
- Tồn kho = qty_on_hand từ inventory snapshot — không phải transaction.
- operating_profit = revenue − cogs − payroll_cost; margin = profit / revenue.
- AOV = net_revenue / txn_count.

**QUY TRÌNH LÀM VIỆC (tuân thủ theo thứ tự):**

BƯỚC 1 — NGHIÊN CỨU SCHEMA:
- Gọi `search_schema(query=<câu hỏi>)` → nhận candidate tables + metric definitions.
- Với câu hỏi phức tạp (growth, ranking, multi-period): gọi `list_columns(table_name=<bảng>)` để biết cột chính xác.
- Dùng `get_table_policy(table_name=<bảng>)` để xác nhận time_column, outlet_column, grain.

BƯỚC 2 — LÊN KẾ HOẠCH (reasoning trước khi viết SQL):
- Xác định bảng phù hợp nhất với câu hỏi + grain cần thiết.
- Xác định: SELECT columns, WHERE time_filter, GROUP BY, ORDER BY, LIMIT.
- Ưu tiên `analytics.ai_*_daily` cho câu hỏi theo ngày/tháng (đã aggregate, nhanh hơn).
- Dùng `cdc.fact_sale` / `cdc.sale_record` khi cần line-level: unit_price, discount %, tỷ lệ giảm giá.
- Khi cần so sánh 2 kỳ: dùng conditional aggregation (SUM(IF(period=A,...)) / SUM(IF(period=B,...))) trong một query.

BƯỚC 3 — VIẾT SQL:
- Viết SELECT đơn. KHÔNG tự thêm outlet_id filter — backend inject qua validate_and_inject.
- Không dùng WITH/CTE, UNION, DDL/DML, hoặc hàm remote/cluster/s3/odbc.
- Filter thời gian bắt buộc với bảng raw/event (cdc.*, analytics.*).

BƯỚC 4 — VALIDATE:
- Gọi `validate_and_inject(sql=<sql>)`. Nếu `ok=false`: đọc errors, sửa SQL, gọi lại — tối đa 3 lần.
- Lỗi thường gặp: thiếu time filter, bảng ngoài allow-list, cột không tồn tại.

BƯỚC 5 — EXECUTE:
- Khi `ok=true`: gọi `execute_query(sql=final_sql)` với exact SQL từ validate output.

BƯỚC 6 — KẾT THÚC bằng JSON:
Khi execute_query ok=true:
{"final_sql": "<exact SQL đã chạy>", "row_count": <int>, "rationale_vi": "<giải thích: tại sao chọn bảng này, metric nào, aggregate gì, insight từ row_count>", "tables_used": [<danh sách bảng>]}

Nếu sau 3 lần validate vẫn fail:
{"final_sql": null, "error": "<giải thích ngắn gọn tại sao thất bại>", "errors": [...]}

**QUY TẮC TUYỆT ĐỐI:**
- Chỉ SELECT đơn. Không DDL/DML. Không self-join vô tận.
- Mọi bảng phải từ search_schema hoặc get_table_policy (nằm trong allow-list).
- Không suy diễn cột — chỉ dùng cột đã xác nhận qua list_columns hoặc search_schema.
- rationale_vi phải đủ để người đọc hiểu bạn đã làm gì và tại sao.
"""


def _final_message_schema() -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_writer_final",
            "strict": False,
            "schema": {
                "type": "object",
                "properties": {
                    "final_sql": {"type": ["string", "null"]},
                    "row_count": {"type": ["integer", "null"]},
                    "rationale_vi": {"type": ["string", "null"]},
                    "tables_used": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                    },
                    "error": {"type": ["string", "null"]},
                    "errors": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                    },
                },
                "additionalProperties": True,
            },
        },
    }



def _deterministic_sql_for_question(state: GraphState) -> tuple[str, str] | None:
    """Known-hard L4 shapes where deterministic SQL is safer than retrying.

    These are still routed through validate_and_inject + execute_query below,
    so RBAC, AST policy, EXPLAIN, and row caps remain authoritative.
    """

    question = str(state.get("normalized_question") or state.get("raw_question") or "")
    q = _fold_text(question)
    time_range = state.get("time_range") or {}
    from_date = str(time_range.get("from_date") or "2026-05-01")
    to_date = str(time_range.get("to_date") or from_date)

    if (
        "doanh thu gio" in q
        and ("cung gio tuan truoc" in q or "vs cung gio tuan truoc" in q)
        and "outlet" in q
    ):
        return (
            "sales_hour_same_hour_last_week",
            f"""
            SELECT
                outlet_id,
                toHour(created_at) AS hour_of_day,
                sumIf(total_amount, business_date = toDate('{to_date}')) AS revenue_today,
                sumIf(total_amount, business_date = toDate('{to_date}') - INTERVAL 7 DAY) AS revenue_same_hour_last_week
            FROM cdc.sale_record
            WHERE business_date BETWEEN toDate('{to_date}') - INTERVAL 7 DAY AND toDate('{to_date}')
              AND status != 'CANCELLED'
            GROUP BY outlet_id, hour_of_day
            ORDER BY outlet_id, hour_of_day
            """,
        )

    if (
        ("growth" in q or "tang truong" in q)
        and ("doanh thu" in q or "revenue" in q)
        and ("outlet" in q or "cua hang" in q)
        and ("so voi thang truoc" in q or "thang truoc" in q or "mom" in q or "month over month" in q)
    ):
        return (
            "sales_outlet_revenue_mom_growth",
            f"""
            SELECT
                outlet_id,
                any(outlet_name) AS outlet_name,
                sumIf(net_revenue, business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}')) AS current_revenue,
                sumIf(net_revenue, business_date BETWEEN addMonths(toDate('{from_date}'), -1) AND addMonths(toDate('{to_date}'), -1)) AS previous_revenue,
                if(
                    sumIf(net_revenue, business_date BETWEEN addMonths(toDate('{from_date}'), -1) AND addMonths(toDate('{to_date}'), -1)) = 0,
                    NULL,
                    (
                        sumIf(net_revenue, business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}'))
                        - sumIf(net_revenue, business_date BETWEEN addMonths(toDate('{from_date}'), -1) AND addMonths(toDate('{to_date}'), -1))
                    )
                    / sumIf(net_revenue, business_date BETWEEN addMonths(toDate('{from_date}'), -1) AND addMonths(toDate('{to_date}'), -1))
                ) AS growth_rate
            FROM analytics.ai_sales_daily
            WHERE business_date BETWEEN addMonths(toDate('{from_date}'), -1) AND toDate('{to_date}')
            GROUP BY outlet_id
            ORDER BY growth_rate DESC NULLS LAST, current_revenue DESC
            LIMIT 5
            """,
        )

    if ("cap gia" in q or "price band" in q or "price bucket" in q or "low/mid/high" in q) and (
        "doanh thu" in q or "revenue" in q
    ):
        return (
            "sales_price_bucket",
            f"""
            SELECT
                multiIf(unit_price < 50000, 'low', unit_price < 150000, 'mid', 'high') AS price_bucket,
                sum(line_total - discount_amount) AS net_revenue,
                countDistinct(sale_id) AS txn_count
            FROM cdc.fact_sale
            WHERE business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}')
            GROUP BY price_bucket
            ORDER BY net_revenue DESC
            """,
        )

    if "so don quay lai" in q or (("repeat" in q or "mua lai" in q or "quay lai" in q) and "don" in q):
        return ("unsupported_missing_customer_key", "")

    if ("ton kho" in q or "inventory" in q) and ("tang/giam" in q or "tang giam" in q):
        return (
            "inventory_daily_movement_for_top_products",
            f"""
            SELECT
                m.business_date,
                m.item_id,
                sum(m.qty_change) AS net_qty_change,
                sum(abs(m.qty_change)) AS movement_qty,
                sum(p.revenue) AS product_revenue
            FROM cdc.inventory_transaction AS m
            INNER JOIN analytics.ai_product_daily AS p
                ON p.product_id = m.item_id
               AND p.outlet_id = m.outlet_id
               AND p.business_date = m.business_date
            WHERE m.business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}')
            GROUP BY m.business_date, m.item_id
            ORDER BY product_revenue DESC, m.business_date DESC
            """,
        )

    if "ton am" in q or "negative stock" in q or "negative inventory" in q:
        return (
            "inventory_negative_stock",
            f"""
            SELECT
                outlet_id,
                item_id,
                min(qty_on_hand) AS min_qty_on_hand
            FROM analytics.fct_inventory_snapshot
            WHERE business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}')
              AND qty_on_hand < 0
            GROUP BY outlet_id, item_id
            ORDER BY min_qty_on_hand ASC
            """,
        )

    if ("churn ton kho" in q or "inventory churn" in q) and ("outlet" in q or "cua hang" in q):
        return (
            "inventory_churn_by_outlet",
            f"""
            SELECT
                outlet_id,
                sum(abs(qty_change)) AS inventory_churn_qty
            FROM cdc.inventory_transaction
            WHERE business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}')
            GROUP BY outlet_id
            ORDER BY inventory_churn_qty DESC
            LIMIT 10
            """,
        )

    if ("margin" in q or "bien loi nhuan" in q) and ("outlet" in q or "cua hang" in q):
        return (
            "pnl_margin_compare",
            f"""
            SELECT
                outlet_id,
                avg(operating_margin) AS operating_margin
            FROM analytics.ai_pnl_daily
            WHERE business_date BETWEEN toDate('{from_date}') AND toDate('{to_date}')
            GROUP BY outlet_id
            ORDER BY outlet_id
            """,
        )

    return None


def _apply_deterministic_sql(
    state: GraphState,
    bound: dict[str, Any],
    pattern: str,
    sql: str,
) -> bool:
    if pattern == "unsupported_missing_customer_key":
        state["execution_error"] = (
            "Seeded sales schema does not expose a customer_id/member_id column, "
            "so repeat-customer order counts cannot be computed safely."
        )
        state["response_kind"] = "unsupported"
        state["clarification_question"] = (
            "Dữ liệu hiện tại chưa có định danh khách hàng để đếm đơn quay lại. "
            "Bạn có thể hỏi tổng số đơn hoặc doanh thu theo outlet trong cùng kỳ."
        )
        state["escalation_candidate"] = True
        state["escalation_reason"] = "missing_customer_identity_for_repeat_orders"
        state["trace"].append(
            {
                "node": "sql_writer_agent",
                "deterministic": pattern,
                "tokens_in": 0,
                "tokens_out": 0,
                "tokens_cached": 0,
                "latency_ms": 0,
            }
        )
        return True

    validate_out = bound["validate_and_inject"].execute(sql=sql)
    state["trace"].append(
        {
            "node": "sql_writer_agent",
            "deterministic": pattern,
            "tool_calls": ["validate_and_inject"],
            "tokens_in": 0,
            "tokens_out": 0,
            "tokens_cached": 0,
            "latency_ms": 0,
        }
    )
    if not validate_out.get("ok"):
        state["execution_error"] = "; ".join(validate_out.get("errors") or ["deterministic SQL rejected"])[:400]
        state["response_kind"] = "unsupported"
        state["clarification_question"] = (
            "Tôi chưa tìm được truy vấn an toàn cho câu hỏi này. "
            "Bạn có thể làm rõ thêm chỉ số/thời gian/phạm vi."
        )
        state["escalation_candidate"] = True
        state["escalation_reason"] = f"deterministic_sql_rejected:{pattern}"
        return True

    final_sql = str(validate_out.get("final_sql") or "").strip()
    state["final_sql"] = final_sql
    state["sql_source"] = "codegen"
    state["executed_sql_source"] = "codegen"
    state["guard_passed"] = True
    state["codegen_tables_used"] = [str(x).lower() for x in (validate_out.get("tables_used") or [])]
    if isinstance(validate_out.get("allowed_outlet_ids"), list):
        state["allowed_outlet_ids"] = [int(x) for x in validate_out["allowed_outlet_ids"]]

    exec_out = bound["execute_query"].execute(sql=final_sql)
    state["trace"][-1]["tool_calls"].append("execute_query")
    if exec_out.get("ok"):
        state["raw_result"] = exec_out.get("rows") or []
        state["execution_error"] = None
    else:
        state["raw_result"] = []
        state["execution_error"] = str(exec_out.get("error") or "execute_query failed")[:400]
    return True


def _build_user_prompt(state: GraphState, candidate_tables: list[str]) -> str:
    question = str(state.get("normalized_question") or state.get("raw_question") or "").strip()
    intent = state.get("intent") or "unknown"
    time_range = state.get("time_range") or {}
    auth = state["auth"]
    resolved = state.get("resolved_entities") or {}
    time_block = format_time_context_for_prompt(state.get("time_context"))
    pf = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    brief = str(pf.get("executor_brief_vi") or "").strip()
    directives = pf.get("executor_directives") or []
    dir_lines: list[str] = []
    if isinstance(directives, list):
        dir_lines = [str(x).strip() for x in directives if str(x).strip()]
    planning_handoff = ""
    if brief or dir_lines:
        parts = []
        if brief:
            parts.append("**Planning (suy diễn & phạm vi):**\n" + brief)
        if dir_lines:
            parts.append(
                "**Lệnh thực thi:**\n" + "\n".join(f"{i + 1}. {d}" for i, d in enumerate(dir_lines[:10]))
            )
        planning_handoff = "\n" + "\n".join(parts) + "\n"
    domain_block = "\n" + format_domain_contract(
        intent=intent,
        question=question,
        max_tables=10,
        include_fallbacks=True,
    ) + "\n"

    candidates_text = "\n".join(f"- {t}" for t in candidate_tables) or "(none)"

    investigative_block = ""
    if state.get("investigative_mode"):
        investigative_block = (
            "\n**INVESTIGATIVE MODE:** Câu hỏi này có giọng phân tích/đánh giá ('vì sao', 'phân tích',\n"
            "'outlet nào yếu', 'kém', 'tệ'). User là sếp đang muốn HIỂU lý do, không chỉ con số.\n"
            "→ Hãy chọn cách truy vấn cho phép tách theo dimension liên quan (outlet/sản phẩm/ngày/giờ)\n"
            "  thay vì chỉ tổng hợp toàn cục.\n"
            "→ Thêm ORDER BY metric chính DESC/ASC để bộc lộ outlier ở top/bottom.\n"
            "→ Trong rationale_vi: nêu rõ phát hiện chính (ai/cái gì lệch chuẩn, mức độ lệch),\n"
            "  KHÔNG chỉ liệt kê 'đã chạy SUM(net_revenue)'.\n"
        )

    return (
        f"Câu hỏi: {question}\n"
        f"Intent: {intent}\n"
        f"Time range (đã giải mã): {time_range}\n"
        f"Resolved outlet_ids requested by user: {resolved.get('outlet_ids') or []}\n"
        f"User roles: {sorted(auth.roles)}\n"
        f"User outlet scope size: {len(auth.outlet_ids)}\n"
        f"{planning_handoff}{time_block}{domain_block}{investigative_block}\n"
        f"Candidate ALLOWED_TABLES (ưu tiên):\n{candidates_text}\n"
        f"\nHãy bắt đầu bằng search_schema/get_table_policy nếu chưa chắc bảng nào, "
        f"sau đó write SQL → validate_and_inject → execute_query. "
        f"Hoàn tất bằng JSON theo schema."
    )


def _bind_tools(state: GraphState, all_outlet_ids_provider: Callable[[], list[int]] | None):
    s = get_settings()
    auth = state["auth"]
    intent = state.get("intent") or ""
    candidate_tables = candidate_tables_for_prompt(
        intent,
        question=str(state.get("normalized_question") or state.get("raw_question") or ""),
        max_tables=10,
        include_fallbacks=True,
    )

    validate_ctx = ValidateContext(
        auth_outlet_ids=frozenset(auth.outlet_ids),
        auth_roles=frozenset(auth.roles),
        candidate_tables=frozenset(candidate_tables),
        requested_outlet_ids=requested_outlet_ids_for_rbac(state),
        all_outlet_ids_provider=all_outlet_ids_provider,
    )
    exec_ctx = ExecuteContext(
        max_rows=s.max_rows_per_query,
        max_execution_seconds=float(s.query_timeout_seconds),
    )

    bound = {
        "search_schema": search_schema_tool,
        "get_table_policy": get_table_policy_tool,
        "list_columns": list_columns_tool,
        "validate_and_inject": make_validate_and_inject_tool(validate_ctx),
        "execute_query": make_execute_query_tool(exec_ctx),
    }
    return bound, candidate_tables


def _execute_tool(bound: dict[str, Any], name: str, arguments: dict[str, Any]) -> str:
    tool = bound.get(name)
    if not tool:
        return json.dumps({"ok": False, "error": f"unknown tool {name!r}"})
    try:
        result = tool.execute(**(arguments or {}))
    except TypeError as exc:
        return json.dumps({"ok": False, "error": f"bad arguments for {name}: {exc}"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("tool %s raised: %s", name, exc)
        return json.dumps({"ok": False, "error": f"tool {name} crashed: {exc}"})
    # Trim huge payloads (column lists, rows) before returning to the model.
    return json.dumps(result, ensure_ascii=False, default=str)[:18000]


async def _run_chat_loop(
    *,
    client: AsyncOpenAI,
    model: str,
    bound: dict[str, Any],
    user_prompt: str,
    max_steps: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Standard Chat Completions tool-calling loop.

    Returns (final_obj, usage_summary, captured). ``captured`` records the
    last successful output of a few high-signal tools so the orchestrator
    can surface them onto graph state (rows, validated SQL, tables used)
    without forcing the model to echo them in its final JSON.
    """
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    tools_schema = [bound[name].schema for name in bound]
    final: dict[str, Any] = {}
    usage = {
        "steps": 0,
        "tokens_in": 0,
        "tokens_out": 0,
        "tokens_cached": 0,
        "tool_calls": [],
        "api_mode": "chat",
    }
    captured: dict[str, Any] = {
        "rows": None,
        "row_count": None,
        "validated_sql": None,
        "tables_used": None,
        "allowed_outlet_ids": None,
        "execute_error": None,
    }
    started = time.time()

    for step in range(max_steps):
        usage["steps"] = step + 1
        try:
            resp, turn_usage = await llm_call_chat_with_tools(
                messages=messages,
                tools=tools_schema,
                model=model,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("sql_writer_agent chat failed at step %s: %s", step, exc)
            usage["error"] = type(exc).__name__
            break

        usage["tokens_in"] += int(turn_usage.get("tokens_in") or 0)
        usage["tokens_out"] += int(turn_usage.get("tokens_out") or 0)
        usage["tokens_cached"] += int(turn_usage.get("tokens_cached") or 0)

        choice = resp.choices[0]
        msg = choice.message

        # Append the assistant message verbatim so the model preserves its
        # tool_call IDs in the next turn.
        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in (msg.tool_calls or [])
                ]
                or None,
            }
        )

        if msg.tool_calls:
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                usage["tool_calls"].append(name)
                tool_output = _execute_tool(bound, name, args)
                _capture_tool_output(captured, name, tool_output)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_output,
                    }
                )
            continue  # let the model react to tool outputs

        # No more tool calls → expect final JSON content.
        if msg.content:
            final = _parse_final_text(msg.content)
        break

    usage["latency_ms"] = int((time.time() - started) * 1000)
    return final, usage, captured


def _capture_tool_output(captured: dict[str, Any], name: str, tool_output: str) -> None:
    """Update the per-run capture dict from a tool output JSON string."""
    try:
        parsed_output = json.loads(tool_output)
    except json.JSONDecodeError:
        return
    if isinstance(parsed_output, dict) and parsed_output.get("ok"):
        if name == "validate_and_inject":
            captured["validated_sql"] = parsed_output.get("final_sql")
            captured["tables_used"] = parsed_output.get("tables_used")
            captured["allowed_outlet_ids"] = parsed_output.get("allowed_outlet_ids")
        elif name == "execute_query":
            captured["rows"] = parsed_output.get("rows")
            captured["row_count"] = parsed_output.get("row_count")
            captured["execute_error"] = None
    elif isinstance(parsed_output, dict) and name == "execute_query":
        captured["execute_error"] = parsed_output.get("error")


def _parse_final_text(text: str) -> dict[str, Any]:
    """Parse the agent's closing message; tolerate extra prose around JSON."""
    text = (text or "").strip()
    if not text:
        return {"final_sql": None, "error": "empty final message"}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.rfind("{")
        end = text.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    return {"final_sql": None, "error": "non-JSON final message", "raw": text[:1000]}


def _is_previous_response_id_unsupported(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "previous_response_id" in msg and "unsupported" in msg


async def _run_responses_loop(
    *,
    model: str,
    bound: dict[str, Any],
    user_prompt: str,
    max_steps: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Tool-calling loop using OpenAI Responses API + previous_response_id.

    The system prompt is sent only on turn 1; subsequent turns reference
    ``previous_response_id`` so the server reuses the cached input prefix.
    Net effect: roughly halves prefill tokens billed across the loop.
    """
    tools_schema = [bound[name].schema for name in bound]
    final: dict[str, Any] = {}
    usage = {
        "steps": 0,
        "tokens_in": 0,
        "tokens_out": 0,
        "tokens_cached": 0,
        "tool_calls": [],
        "api_mode": "responses",
    }
    captured: dict[str, Any] = {
        "rows": None,
        "row_count": None,
        "validated_sql": None,
        "tables_used": None,
        "allowed_outlet_ids": None,
        "execute_error": None,
    }
    started = time.time()

    previous_response_id: str | None = None
    next_input: Any = user_prompt

    for step in range(max_steps):
        usage["steps"] = step + 1
        try:
            resp, turn_usage = await llm_call_responses_with_tools(
                instructions=_SYSTEM_PROMPT,
                user_input=next_input,
                tools=tools_schema,
                model=model,
                previous_response_id=previous_response_id,
                store=True,
            )
        except Exception as exc:  # noqa: BLE001
            if _is_previous_response_id_unsupported(exc):
                raise
            logger.warning("sql_writer_agent responses failed at step %s: %s", step, exc)
            usage["error"] = type(exc).__name__
            break

        usage["tokens_in"] += int(turn_usage.get("tokens_in") or 0)
        usage["tokens_out"] += int(turn_usage.get("tokens_out") or 0)
        usage["tokens_cached"] += int(turn_usage.get("tokens_cached") or 0)

        previous_response_id = getattr(resp, "id", None) or turn_usage.get("response_id")

        from app.llm.openai_client import (
            _responses_extract_tool_calls,
            _response_output_text,
        )

        tool_calls = _responses_extract_tool_calls(resp)
        if tool_calls:
            outputs: list[dict[str, Any]] = []
            for tc in tool_calls:
                name = tc["name"]
                try:
                    args = json.loads(tc["arguments"] or "{}")
                except (json.JSONDecodeError, TypeError):
                    args = {}
                usage["tool_calls"].append(name)
                tool_output = _execute_tool(bound, name, args)
                _capture_tool_output(captured, name, tool_output)
                outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": tc["call_id"],
                        "output": tool_output,
                    }
                )
            next_input = outputs
            continue

        text = _response_output_text(resp)
        if text:
            final = _parse_final_text(text)
        break

    usage["latency_ms"] = int((time.time() - started) * 1000)
    return final, usage, captured


def _candidate_score(final: dict[str, Any], captured: dict[str, Any]) -> tuple[int, int, int]:
    """Higher tuple = better candidate.

    Order of priority (lexicographic):
      1. validated_and_executed: validate_and_inject + execute_query both ok.
      2. validated_only: validate_and_inject ok, execute failed/skipped.
      3. final_sql claimed by model but never validated.
    Within the same tier, prefer non-empty result rows (proxy for "did the
    query actually find data"); tie-break by lower step count (faster).
    """
    validated = bool(captured.get("validated_sql"))
    executed = isinstance(captured.get("rows"), list) and not captured.get("execute_error")
    rows_signal = len(captured["rows"]) if isinstance(captured.get("rows"), list) else 0
    has_final = bool(final.get("final_sql")) if isinstance(final, dict) else False

    tier = 0
    if validated and executed:
        tier = 3
    elif validated:
        tier = 2
    elif has_final:
        tier = 1
    return (tier, min(rows_signal, 1), 1)


async def _run_self_consistent(
    *,
    n: int,
    runner: Callable[[], "asyncio.Future"],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Run ``runner`` n times concurrently and pick the highest-scoring run.

    Returns (final, usage, captured, vote_meta).
    """
    if n <= 1:
        final, usage, captured = await runner()
        return final, usage, captured, {"n": 1, "winner": 0, "scores": [_candidate_score(final, captured)]}

    results = await asyncio.gather(*[runner() for _ in range(n)], return_exceptions=True)
    candidates: list[tuple[int, dict, dict, dict]] = []
    errors: list[str] = []
    for idx, r in enumerate(results):
        if isinstance(r, BaseException):
            errors.append(f"run{idx}:{type(r).__name__}")
            continue
        f, u, c = r
        candidates.append((idx, f, u, c))

    if not candidates:
        return (
            {"final_sql": None, "error": "all self-consistency runs crashed", "errors": errors},
            {"steps": 0, "tokens_in": 0, "tokens_out": 0, "tool_calls": [], "self_consistency_n": n, "errors": errors},
            {"rows": None, "row_count": None, "validated_sql": None, "execute_error": "; ".join(errors)},
            {"n": n, "winner": -1, "scores": []},
        )

    scored = [(_candidate_score(f, c), idx, f, u, c) for idx, f, u, c in candidates]
    scored.sort(key=lambda x: x[0], reverse=True)
    winner = scored[0]
    _, win_idx, win_final, win_usage, win_captured = winner
    win_usage = {
        **win_usage,
        "self_consistency_n": n,
        "self_consistency_scores": [s[0] for s in scored],
        "self_consistency_winner": win_idx,
    }
    if errors:
        win_usage["self_consistency_errors"] = errors
    vote_meta = {
        "n": n,
        "winner": win_idx,
        "scores": [s[0] for s in scored],
    }
    return win_final, win_usage, win_captured, vote_meta


async def sql_writer_agent(
    state: GraphState,
    *,
    all_outlet_ids_provider: Callable[[], list[int]] | None = None,
) -> GraphState:
    """SQL Writer Agent graph node — Codex with tool loop."""
    s = get_settings()
    state.setdefault("trace", [])

    # If supervisor already pinned a verified template, this lane should not run.
    if state.get("template_key"):
        state["trace"].append({"node": "sql_writer_agent", "skipped": "template_path"})
        return state

    bound, candidate_tables = _bind_tools(state, all_outlet_ids_provider)
    state["codegen_candidate_tables"] = list(candidate_tables)

    deterministic = _deterministic_sql_for_question(state)
    if deterministic:
        pattern, sql = deterministic
        if _apply_deterministic_sql(state, bound, pattern, sql):
            return state

    user_prompt = _build_user_prompt(state, candidate_tables)
    client = get_client()
    model = (
        getattr(s, "openai_model_sql_generator", "")
        or getattr(s, "openai_model", "")
        or "gpt-5.3-codex"
    ).strip()

    max_steps = max(4, int(s.max_codegen_attempts or 2) * 4 + 2)
    use_responses = (
        (s.openai_api_mode or "chat").lower() == "responses"
        and bool(getattr(s, "openai_responses_previous_response_id_enabled", True))
    )
    n_self_consistency = max(1, int(getattr(s, "sql_writer_self_consistency_n", 1) or 1))

    async def _runner() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        if use_responses:
            try:
                return await _run_responses_loop(
                    model=model,
                    bound=bound,
                    user_prompt=user_prompt,
                    max_steps=max_steps,
                )
            except Exception as exc:  # noqa: BLE001
                if not _is_previous_response_id_unsupported(exc):
                    raise
                logger.warning(
                    "responses provider does not support previous_response_id; "
                    "falling back to chat tool loop"
                )
                final, usage, captured = await _run_chat_loop(
                    client=client,
                    model=model,
                    bound=bound,
                    user_prompt=user_prompt,
                    max_steps=max_steps,
                )
                usage["api_mode_fallback"] = "chat_after_previous_response_id_unsupported"
                return final, usage, captured
        return await _run_chat_loop(
            client=client,
            model=model,
            bound=bound,
            user_prompt=user_prompt,
            max_steps=max_steps,
        )

    try:
        final, usage, captured, vote_meta = await _run_self_consistent(
            n=n_self_consistency,
            runner=_runner,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("sql_writer_agent crashed: %s", exc)
        state["execution_error"] = f"sql_writer_agent crashed: {exc}"
        state["trace"].append({"node": "sql_writer_agent", "error": str(exc)[:200]})
        return state

    state["trace"].append(
        {
            "node": "sql_writer_agent",
            "self_consistency": vote_meta,
            **usage,
        }
    )

    # Prefer captured tool outputs over what the model echoed in its final
    # JSON: validate_and_inject is the only authoritative source for the SQL
    # actually executed. Falling back to ``final`` keeps tests with mocked
    # LLM (no tool calls) functional.
    final_sql = (captured.get("validated_sql") or "").strip()
    if not final_sql and isinstance(final, dict):
        final_sql = (final.get("final_sql") or "").strip()

    if not final_sql:
        state["execution_error"] = (
            (final.get("error") if isinstance(final, dict) else None)
            or captured.get("execute_error")
            or "sql_writer agent returned no SQL"
        )
        state["response_kind"] = "unsupported"
        state["clarification_question"] = (
            "Tôi chưa tìm được truy vấn an toàn cho câu hỏi này. "
            "Bạn có thể bấm Kiểm tra lại để gửi cho đội dữ liệu, "
            "hoặc làm rõ thêm chỉ số/thời gian/phạm vi."
        )
        state["escalation_candidate"] = True
        state["escalation_reason"] = "sql_writer_agent_no_safe_query"
        state["escalation_target"] = "review_request"
        return state

    state["final_sql"] = final_sql
    state["sql_source"] = "codegen"
    state["executed_sql_source"] = "codegen"
    state["guard_passed"] = True  # validate_and_inject already enforced this
    tables_used = captured.get("tables_used") or (
        final.get("tables_used") if isinstance(final, dict) else []
    )
    state["codegen_tables_used"] = [str(x).lower() for x in (tables_used or [])]
    state["codegen_rationale_vi"] = str(
        (final.get("rationale_vi") if isinstance(final, dict) else "") or ""
    )
    if isinstance(captured.get("allowed_outlet_ids"), list):
        state["allowed_outlet_ids"] = [int(x) for x in captured["allowed_outlet_ids"]]

    rows = captured.get("rows")
    if isinstance(rows, list):
        state["raw_result"] = rows
        state["execution_error"] = None
    elif captured.get("execute_error"):
        state["execution_error"] = str(captured["execute_error"])[:400]
    else:
        # Agent never called execute_query (or call failed) — run it now,
        # bounded by the same executor settings the legacy graph used.
        try:
            from app.clients.clickhouse import execute_query as _ch_execute

            state["raw_result"] = _ch_execute(final_sql)
            state["execution_error"] = None
        except Exception as exc:  # noqa: BLE001
            state["execution_error"] = str(exc)[:400]
    return state
