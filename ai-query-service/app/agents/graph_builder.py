"""Simplified Finch-style LangGraph builder.

Six effective lanes after Supervisor — none nested, none branching more
than once:

    preprocess
        ↓
    supervisor_agent  (1 LLM call; verified-template + social shortcuts)
        ↓
    ┌──────────┬──────────┬──────────┬──────────┬───────────────────┐
    ▼          ▼          ▼          ▼          ▼                   ▼
  social    doc_reader  hr_query  template_  sql_writer_agent   answer_formatter
                                  path                            (clarification)
        ↓          ↓         ↓          ↓                ↓
                            answer_formatter
                                ↓
                               END

``entity_resolver`` and ``data_coverage`` run before the data lanes
(template_path / sql_writer_agent) because they are deterministic, fast,
and feed RBAC + answer caveats. They never invoke an LLM.
"""

from __future__ import annotations

from typing import Callable

from langgraph.graph import END, StateGraph

from app.agents.supervisor_agent import supervisor_agent
from app.agents.sql_writer_agent import sql_writer_agent as _sql_writer_agent
from app.agents.template_path import make_template_path
from app.graph.nodes.analysis_brief import analysis_brief
from app.graph.nodes.answer_formatter import answer_formatter
from app.graph.nodes.data_coverage import data_coverage
from app.graph.nodes.doc_reader import doc_reader
from app.graph.nodes.entity_resolver import entity_resolver
from app.graph.nodes.export_builder import export_builder
from app.graph.nodes.kb_retriever import kb_retriever
from app.graph.nodes.kb_writer import kb_writer
from app.graph.nodes.session_enricher import session_enricher
from app.graph.nodes.hr_query import make_hr_query
from app.graph.nodes.preprocess import preprocess
from app.graph.nodes.social_reply import social_reply
from app.graph.nodes.visualizer import visualizer
from app.graph.state import GraphState
from app.agents.reviewer_agent import reviewer_agent
from app.agents.resilience import with_node_timeout
from app.agents.suggestions import suggestions_node
from app.config import get_settings
from app.query_modes.codegen.routing import sql_writer_preconditions_ok


def _finch_sql_writer_gate_message(state: GraphState) -> str:
    """User-facing clarification when SQL writer Preconditions fail after entity/coverage."""
    planning = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    amb = [str(x).strip().lower() for x in (planning.get("ambiguities") or []) if str(x).strip()]
    first = amb[0] if amb else ""
    if first == "time_range":
        return (
            "Bạn muốn xem khoảng thời gian nào (hôm nay, 7 ngày gần nhất, hay tháng này)? "
            "Nếu có outlet cụ thể hãy ghi tên."
        )
    if first == "metric_or_report":
        return (
            "Bạn muốn xuất báo cáo/chỉ số nào? Ví dụ: doanh thu theo cửa hàng, top sản phẩm, "
            "hoặc tồn kho thấp."
        )
    if first == "comparison_target":
        return "Bạn muốn so sánh chỉ số nào và với kỳ nào?"
    return "Bạn vui lòng làm rõ thêm báo cáo hoặc khoảng thời gian cần xem."


def _route_after_supervisor(state: GraphState) -> str:
    if state.get("response_kind") in {"clarification", "unsupported"}:
        return "answer_formatter"
    if state.get("social_kind"):
        return "social_reply"
    route = state.get("agent_route") or "data_query"
    if route in ("greeting", "thanks", "social"):
        return "social_reply"
    if route == "docs_question":
        return "doc_reader"
    if route == "hr_staff":
        return "entity_resolver"
    # data_query / export_request / visualization_request → resolve scope first
    return "entity_resolver"


def _period_comparison_union_range(state: GraphState) -> dict[str, str] | None:
    contract = state.get("sql_writer_contract") if isinstance(state.get("sql_writer_contract"), dict) else {}
    periods = contract.get("comparison_periods") if isinstance(contract.get("comparison_periods"), dict) else None
    if not periods:
        return None
    ranges: list[tuple[str, str]] = []
    for key in ("period_a", "period_b"):
        period = periods.get(key) if isinstance(periods.get(key), dict) else {}
        from_date = str(period.get("from_date") or "").strip()
        to_date = str(period.get("to_date") or "").strip()
        if from_date and to_date:
            ranges.append((from_date, to_date))
    if len(ranges) < 2:
        return None
    return {"from_date": min(item[0] for item in ranges), "to_date": max(item[1] for item in ranges)}


def _disable_template_response_if_needed(state: GraphState) -> GraphState:
    if state.get("template_key"):
        if not getattr(get_settings(), "template_response_enabled", True):
            state.setdefault("trace", []).append(
                {
                    "node": "data_coverage",
                    "template_response_disabled": True,
                    "template_key": state.get("template_key"),
                }
            )
            state["template_key"] = None
            state["template_params"] = {}
            state["needs_sql_writer"] = True
            union_range = _period_comparison_union_range(state)
            if union_range:
                state["time_range"] = union_range
                state["time_context"] = {**(state.get("time_context") or {}), **union_range}
                contract = state.get("sql_writer_contract")
                if isinstance(contract, dict):
                    contract["time_range"] = dict(union_range)
            if isinstance(state.get("planning_frame"), dict):
                state["planning_frame"] = {
                    **state["planning_frame"],
                    "next_action": "gensql_candidate",
                    "router_layer": "template_response_disabled",
                }
    return state


def _data_coverage_node(state: GraphState) -> GraphState:
    state = data_coverage(state)
    return _disable_template_response_if_needed(state)


def _route_after_coverage(state: GraphState) -> str:
    if state.get("response_kind") in {"clarification", "unsupported"}:
        return "answer_formatter"
    if state.get("agent_route") == "hr_staff" or state.get("intent") == "hr_staff":
        return "hr_query"
    _disable_template_response_if_needed(state)
    if state.get("template_key"):
        return "template_path"
    if state.get("needs_sql_writer"):
        if not sql_writer_preconditions_ok(state):
            state["needs_sql_writer"] = False
            state["response_kind"] = "clarification"
            if not (state.get("clarification_question") or "").strip():
                state["clarification_question"] = _finch_sql_writer_gate_message(state)
            state.setdefault("trace", []).append({"node": "data_coverage", "sql_writer_gate": "blocked"})
            return "answer_formatter"
        return "sql_writer_agent"
    # Supervisor said data_query but didn't pick a template AND didn't enable
    # SQL writer → escalation/clarification.
    return "answer_formatter"


def _route_after_data_lane(state: GraphState) -> str:
    if state.get("execution_error"):
        return "answer_formatter"
    return "export_builder"


def _route_after_export(state: GraphState) -> str:
    if state.get("visualization_requested"):
        return "visualizer"
    return "analysis_brief"


def build_agent_graph(
    *,
    all_outlet_ids_provider: Callable[[], list[int]] | None = None,
    checkpointer=None,
):
    """Compile the simplified Finch-style graph."""
    g = StateGraph(GraphState)

    template_path_node = make_template_path(all_outlet_ids_provider)

    async def sql_writer_node(state: GraphState) -> GraphState:
        return await _sql_writer_agent(
            state,
            all_outlet_ids_provider=all_outlet_ids_provider,
        )

    g.add_node("preprocess", preprocess)
    g.add_node("kb_retriever", kb_retriever)
    # Supervisor feeds routing; a timeout there means we cannot continue safely.
    g.add_node("supervisor_agent", with_node_timeout("supervisor_agent", supervisor_agent, on_timeout="routing"))
    g.add_node("social_reply", with_node_timeout("social_reply", social_reply))
    g.add_node("doc_reader", with_node_timeout("doc_reader", doc_reader, on_timeout="routing"))
    g.add_node("entity_resolver", entity_resolver)
    g.add_node("data_coverage", _data_coverage_node)
    # Data lanes: a timeout becomes execution_error → graceful formatter message.
    g.add_node("hr_query", with_node_timeout("hr_query", make_hr_query(all_outlet_ids_provider), on_timeout="data"))
    g.add_node("template_path", template_path_node)
    g.add_node("sql_writer_agent", with_node_timeout("sql_writer_agent", sql_writer_node, on_timeout="data"))
    g.add_node("export_builder", export_builder)
    # Enrichment / post-answer nodes degrade softly (skip, keep the answer).
    g.add_node("analysis_brief", with_node_timeout("analysis_brief", analysis_brief))
    g.add_node("visualizer", with_node_timeout("visualizer", visualizer))
    g.add_node("answer_formatter", with_node_timeout("answer_formatter", answer_formatter))
    g.add_node("reviewer_agent", with_node_timeout("reviewer_agent", reviewer_agent))
    g.add_node("suggestions", with_node_timeout("suggestions", suggestions_node))
    g.add_node("session_enricher", with_node_timeout("session_enricher", session_enricher))
    g.add_node("kb_writer", with_node_timeout("kb_writer", kb_writer))

    g.set_entry_point("preprocess")
    g.add_edge("preprocess", "kb_retriever")
    g.add_edge("kb_retriever", "supervisor_agent")
    g.add_conditional_edges(
        "supervisor_agent",
        _route_after_supervisor,
        {
            "social_reply": "social_reply",
            "doc_reader": "doc_reader",
            "entity_resolver": "entity_resolver",
            "answer_formatter": "answer_formatter",
        },
    )
    g.add_edge("entity_resolver", "data_coverage")
    g.add_conditional_edges(
        "data_coverage",
        _route_after_coverage,
        {
            "hr_query": "hr_query",
            "template_path": "template_path",
            "sql_writer_agent": "sql_writer_agent",
            "answer_formatter": "answer_formatter",
        },
    )
    g.add_conditional_edges(
        "template_path",
        _route_after_data_lane,
        {
            "export_builder": "export_builder",
            "answer_formatter": "answer_formatter",
        },
    )
    g.add_conditional_edges(
        "sql_writer_agent",
        _route_after_data_lane,
        {
            "export_builder": "export_builder",
            "answer_formatter": "answer_formatter",
        },
    )
    g.add_conditional_edges(
        "export_builder",
        _route_after_export,
        {
            "visualizer": "visualizer",
            "analysis_brief": "analysis_brief",
        },
    )
    g.add_edge("hr_query", "export_builder")
    g.add_edge("social_reply", "answer_formatter")
    g.add_edge("doc_reader", "answer_formatter")
    g.add_edge("visualizer", "analysis_brief")
    g.add_edge("analysis_brief", "answer_formatter")
    g.add_edge("answer_formatter", "reviewer_agent")
    g.add_edge("reviewer_agent", "suggestions")
    g.add_edge("suggestions", "session_enricher")
    g.add_edge("session_enricher", "kb_writer")
    g.add_edge("kb_writer", END)

    if checkpointer is not None:
        return g.compile(checkpointer=checkpointer)
    return g.compile()
