"""Finch-style agentic architecture for ai-query-service.

Two main agents replace the 14-node LangGraph orchestration:

- ``supervisor_agent``: 1 LLM call (or 0 if verified/social shortcut) that
  emits route + intent + time_range + entities + optional template match.
- ``sql_writer_agent``: 1 Codex agent with tool calling (search_schema,
  get_table_policy, validate_and_inject, execute_query). Self-correction
  happens inside the tool loop, not as a separate graph node.

The deterministic template lane (``template_path``) reuses the existing
validator + RBAC injector + sql_guard + executor pipeline programmatically;
no LLM hop. SQL Writer Agent is the only LLM-driven SQL generation path.

This module is gated behind ``AGENT_MODE_ENABLED``. The legacy 21-node
graph in ``app/graph/builder.py`` keeps running until the new path is
validated against the golden eval suite.
"""

# NOTE: Submodules and functions in this package intentionally share names
# (``supervisor_agent``, ``sql_writer_agent``). To avoid the standard Python
# pitfall where ``from .supervisor_agent import supervisor_agent`` shadows
# the submodule reference inside the package namespace, we expose only the
# graph builder and tool helpers here. Callers wanting the agent functions
# import them via ``from app.agents.supervisor_agent import supervisor_agent``.

from app.agents.graph_builder import build_agent_graph
from app.agents.template_path import make_template_path
from app.agents.tools import (
    Tool,
    execute_query_tool,
    get_table_policy_tool,
    list_columns_tool,
    make_execute_query_tool,
    make_validate_and_inject_tool,
    search_schema_tool,
    validate_and_inject_tool,
)

__all__ = [
    "build_agent_graph",
    "make_template_path",
    "Tool",
    "execute_query_tool",
    "get_table_policy_tool",
    "list_columns_tool",
    "make_execute_query_tool",
    "make_validate_and_inject_tool",
    "search_schema_tool",
    "validate_and_inject_tool",
]
