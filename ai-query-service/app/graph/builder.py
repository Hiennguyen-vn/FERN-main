"""Assemble LangGraph StateGraph.

Edges:
  preprocess → contextualizer → (social shortcut?) social_reply | supervisor
  supervisor → (greeting/thanks?) social_reply | metadata_context | entity_resolver
  social_reply → answer_formatter → reviewer_agent → END
  entity_resolver → data_coverage → (hr_staff?) hr_query | catalog_digest → metadata_context → doc_reader | query_reasoner → template_matcher → …
  hr_query → answer_formatter → reviewer_agent → END
  template_matcher → (codegen?) codegen_entry | validator
  codegen subgraph: codegen_entry → codegen_sql_planner → codegen_generator → …
  … template path: validator → rbac_injector → sql_logical_check → sql_guard → executor
  executor → self_correction | answer_formatter → reviewer_agent → END
"""
from typing import Callable

from langgraph.graph import END, StateGraph

from app.agents.reviewer_agent import reviewer_agent
from app.agents.suggestions import suggestions_node
from app.graph.nodes.answer_formatter import answer_formatter
from app.graph.nodes.catalog_digest import catalog_digest
from app.query_modes.codegen import (
    codegen_entry,
    codegen_generator,
    codegen_retry_or_fallback,
    codegen_reviewer,
    codegen_sql_planner,
    codegen_structure_guard,
    codegen_trial,
    make_codegen_rbac_injector,
    route_after_codegen_rbac,
    route_after_codegen_retry,
    route_after_codegen_reviewer,
    route_after_codegen_trial,
    route_after_sql_guard_unified,
    route_after_template_matcher,
    route_structure_ok,
)
from app.graph.nodes.data_coverage import data_coverage
from app.graph.nodes.entity_resolver import entity_resolver
from app.graph.nodes.kb_retriever import kb_retriever
from app.graph.nodes.kb_writer import kb_writer
from app.graph.nodes.executor import executor
from app.graph.nodes.hr_query import make_hr_query
from app.graph.nodes.contextualizer import contextualizer
from app.graph.nodes.metadata_context import metadata_context
from app.graph.nodes.doc_reader import doc_reader
from app.graph.nodes.preprocess import preprocess
from app.graph.nodes.query_reasoner import query_reasoner
from app.graph.nodes.rbac_injector import make_rbac_injector
from app.graph.nodes.self_correction import is_self_correction_candidate, self_correction
from app.graph.nodes.session_enricher import session_enricher
from app.graph.nodes.social_reply import social_reply
from app.graph.nodes.sql_guard import sql_guard
from app.graph.nodes.sql_logical_check import sql_logical_check
from app.graph.nodes.supervisor import supervisor
from app.graph.nodes.template_matcher import template_matcher
from app.graph.nodes.validator import validator
from app.graph.nodes.visualizer import visualizer
from app.graph.state import GraphState


def _route_after_contextualizer(state: GraphState) -> str:
    if state.get("social_kind"):
        return "social_reply"
    return "supervisor"


def _route_after_supervisor(state: GraphState) -> str:
    if state.get("response_kind") in {"clarification", "unsupported"} or (state.get("planning_frame") or {}).get("next_action") == "ask_clarification":
        return "answer_formatter"
    if state.get("agent_route") in ("greeting", "thanks") or state.get("intent") in ("greeting", "thanks"):
        return "social_reply"
    if state.get("agent_route") == "docs_question":
        return "metadata_context"
    return "entity_resolver"


def _route_after_entity_resolver(state: GraphState) -> str:
    if state.get("agent_route") == "hr_staff" or state.get("intent") == "hr_staff":
        return "hr_query"
    return "catalog_digest"


def _route_after_metadata_context(state: GraphState) -> str:
    if state.get("agent_route") == "docs_question":
        return "doc_reader"
    return "query_reasoner"


def _route_after_validator(state: GraphState) -> str:
    if state.get("validation_errors"):
        return "answer_formatter"
    return "rbac_injector"


def _route_after_rbac(state: GraphState) -> str:
    if state.get("validation_errors") or not state.get("final_sql"):
        return "answer_formatter"
    return "sql_logical_check"


def _route_after_executor(state: GraphState) -> str:
    if (
        state.get("execution_error")
        and state.get("correction_attempts", 0) < 3
        and is_self_correction_candidate(state.get("execution_error"))
    ):
        return "self_correction"
    if not state.get("execution_error") and state.get("visualization_requested"):
        return "visualizer"
    return "answer_formatter"


def _route_after_self_correction(state: GraphState) -> str:
    if state.get("self_correction_applied") and state.get("corrected_sql"):
        return "sql_logical_check"
    return "answer_formatter"


def build_graph(
    *,
    all_outlet_ids_provider: Callable[[], list[int]] | None = None,
    checkpointer=None,
):
    g = StateGraph(GraphState)

    g.add_node("preprocess", preprocess)
    g.add_node("kb_retriever", kb_retriever)
    g.add_node("contextualizer", contextualizer)
    g.add_node("supervisor", supervisor)
    g.add_node("social_reply", social_reply)
    g.add_node("doc_reader", doc_reader)
    g.add_node("entity_resolver", entity_resolver)
    g.add_node("data_coverage", data_coverage)
    g.add_node("hr_query", make_hr_query(all_outlet_ids_provider))
    g.add_node("catalog_digest", catalog_digest)
    g.add_node("metadata_context", metadata_context)
    g.add_node("query_reasoner", query_reasoner)
    g.add_node("template_matcher", template_matcher)
    g.add_node("codegen_entry", codegen_entry)
    g.add_node("codegen_sql_planner", codegen_sql_planner)
    g.add_node("codegen_generator", codegen_generator)
    g.add_node("codegen_structure_guard", codegen_structure_guard)
    g.add_node("codegen_rbac_injector", make_codegen_rbac_injector(all_outlet_ids_provider))
    g.add_node("codegen_reviewer", codegen_reviewer)
    g.add_node("codegen_trial", codegen_trial)
    g.add_node("codegen_retry_or_fallback", codegen_retry_or_fallback)
    g.add_node("validator", validator)
    g.add_node("rbac_injector", make_rbac_injector(all_outlet_ids_provider))
    g.add_node("sql_logical_check", sql_logical_check)
    g.add_node("sql_guard", sql_guard)
    g.add_node("executor", executor)
    g.add_node("visualizer", visualizer)
    g.add_node("self_correction", self_correction)
    g.add_node("answer_formatter", answer_formatter)
    g.add_node("reviewer_agent", reviewer_agent)
    g.add_node("suggestions", suggestions_node)
    g.add_node("session_enricher", session_enricher)
    g.add_node("kb_writer", kb_writer)

    g.set_entry_point("preprocess")
    g.add_edge("preprocess", "kb_retriever")
    g.add_edge("kb_retriever", "contextualizer")
    g.add_conditional_edges("contextualizer", _route_after_contextualizer, {
        "supervisor": "supervisor",
        "social_reply": "social_reply",
    })
    g.add_conditional_edges("supervisor", _route_after_supervisor, {
        "entity_resolver": "entity_resolver",
        "social_reply": "social_reply",
        "metadata_context": "metadata_context",
        "answer_formatter": "answer_formatter",
    })
    g.add_edge("social_reply", "answer_formatter")
    g.add_edge("doc_reader", "answer_formatter")
    g.add_edge("entity_resolver", "data_coverage")
    g.add_conditional_edges("data_coverage", _route_after_entity_resolver, {
        "hr_query": "hr_query",
        "catalog_digest": "catalog_digest",
    })
    g.add_edge("hr_query", "answer_formatter")
    g.add_edge("catalog_digest", "metadata_context")
    g.add_conditional_edges("metadata_context", _route_after_metadata_context, {
        "doc_reader": "doc_reader",
        "query_reasoner": "query_reasoner",
    })
    g.add_edge("query_reasoner", "template_matcher")
    g.add_conditional_edges("template_matcher", route_after_template_matcher, {
        "answer_formatter": "answer_formatter",
        "codegen_entry": "codegen_entry",
        "validator": "validator",
    })
    g.add_edge("codegen_entry", "codegen_sql_planner")
    g.add_edge("codegen_sql_planner", "codegen_generator")
    g.add_edge("codegen_generator", "codegen_structure_guard")
    g.add_conditional_edges("codegen_structure_guard", route_structure_ok, {
        "rbac": "codegen_rbac_injector",
        "retry": "codegen_retry_or_fallback",
    })
    g.add_conditional_edges("codegen_rbac_injector", route_after_codegen_rbac, {
        "guard": "sql_guard",
        "retry": "codegen_retry_or_fallback",
    })
    g.add_conditional_edges("codegen_retry_or_fallback", route_after_codegen_retry, {
        "validator": "validator",
        "generator": "codegen_generator",
        "answer_formatter": "answer_formatter",
    })
    g.add_conditional_edges("validator", _route_after_validator, {
        "rbac_injector": "rbac_injector",
        "answer_formatter": "answer_formatter",
    })
    g.add_conditional_edges("rbac_injector", _route_after_rbac, {
        "sql_logical_check": "sql_logical_check",
        "answer_formatter": "answer_formatter",
    })
    g.add_edge("sql_logical_check", "sql_guard")
    g.add_conditional_edges("sql_guard", route_after_sql_guard_unified, {
        "answer_formatter": "answer_formatter",
        "codegen_retry_or_fallback": "codegen_retry_or_fallback",
        "codegen_reviewer": "codegen_reviewer",
        "codegen_trial": "codegen_trial",
        "executor": "executor",
    })
    g.add_conditional_edges("codegen_reviewer", route_after_codegen_reviewer, {
        "trial": "codegen_trial",
        "retry": "codegen_retry_or_fallback",
    })
    g.add_conditional_edges("codegen_trial", route_after_codegen_trial, {
        "merge": "sql_logical_check",
        "retry": "codegen_retry_or_fallback",
    })
    g.add_conditional_edges("executor", _route_after_executor, {
        "self_correction": "self_correction",
        "visualizer": "visualizer",
        "answer_formatter": "answer_formatter",
    })
    g.add_edge("visualizer", "answer_formatter")
    g.add_conditional_edges("self_correction", _route_after_self_correction, {
        "sql_logical_check": "sql_logical_check",
        "answer_formatter": "answer_formatter",
    })
    g.add_edge("answer_formatter", "reviewer_agent")
    g.add_edge("reviewer_agent", "suggestions")
    g.add_edge("suggestions", "session_enricher")
    g.add_edge("session_enricher", "kb_writer")
    g.add_edge("kb_writer", END)

    if checkpointer is not None:
        return g.compile(checkpointer=checkpointer)
    return g.compile()
