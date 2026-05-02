"""Assemble LangGraph StateGraph.

Edges:
  preprocess → supervisor → entity_resolver → template_matcher
  → validator → (errors? answer_formatter : rbac_injector)
  → rbac_injector → (errors? answer_formatter : sql_guard)
  → sql_guard → (passed? executor : answer_formatter)
  → executor → (success or attempts>=2 ? answer_formatter : self_correction)
  → self_correction → sql_guard  [loop]
  → answer_formatter → END
"""
from typing import Callable

from langgraph.graph import END, StateGraph

from app.graph.nodes.answer_formatter import answer_formatter
from app.graph.nodes.entity_resolver import entity_resolver
from app.graph.nodes.executor import executor
from app.graph.nodes.preprocess import preprocess
from app.graph.nodes.rbac_injector import make_rbac_injector
from app.graph.nodes.self_correction import self_correction
from app.graph.nodes.sql_guard import sql_guard
from app.graph.nodes.supervisor import supervisor
from app.graph.nodes.template_matcher import template_matcher
from app.graph.nodes.validator import validator
from app.graph.state import GraphState


def _route_after_validator(state: GraphState) -> str:
    if state.get("validation_errors"):
        return "answer_formatter"
    return "rbac_injector"


def _route_after_rbac(state: GraphState) -> str:
    if state.get("validation_errors") or not state.get("final_sql"):
        return "answer_formatter"
    return "sql_guard"


def _route_after_guard(state: GraphState) -> str:
    if state.get("guard_passed"):
        return "executor"
    return "answer_formatter"


def _route_after_executor(state: GraphState) -> str:
    if state.get("execution_error") and state.get("correction_attempts", 0) < 2:
        return "self_correction"
    return "answer_formatter"


def build_graph(
    *,
    all_outlet_ids_provider: Callable[[], list[int]] | None = None,
    checkpointer=None,
):
    g = StateGraph(GraphState)

    g.add_node("preprocess", preprocess)
    g.add_node("supervisor", supervisor)
    g.add_node("entity_resolver", entity_resolver)
    g.add_node("template_matcher", template_matcher)
    g.add_node("validator", validator)
    g.add_node("rbac_injector", make_rbac_injector(all_outlet_ids_provider))
    g.add_node("sql_guard", sql_guard)
    g.add_node("executor", executor)
    g.add_node("self_correction", self_correction)
    g.add_node("answer_formatter", answer_formatter)

    g.set_entry_point("preprocess")
    g.add_edge("preprocess", "supervisor")
    g.add_edge("supervisor", "entity_resolver")
    g.add_edge("entity_resolver", "template_matcher")
    g.add_edge("template_matcher", "validator")
    g.add_conditional_edges("validator", _route_after_validator, {
        "rbac_injector": "rbac_injector",
        "answer_formatter": "answer_formatter",
    })
    g.add_conditional_edges("rbac_injector", _route_after_rbac, {
        "sql_guard": "sql_guard",
        "answer_formatter": "answer_formatter",
    })
    g.add_conditional_edges("sql_guard", _route_after_guard, {
        "executor": "executor",
        "answer_formatter": "answer_formatter",
    })
    g.add_conditional_edges("executor", _route_after_executor, {
        "self_correction": "self_correction",
        "answer_formatter": "answer_formatter",
    })
    g.add_edge("self_correction", "sql_guard")
    g.add_edge("answer_formatter", END)

    if checkpointer is not None:
        return g.compile(checkpointer=checkpointer)
    return g.compile()
