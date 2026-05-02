"""Execute SQL on ClickHouse. Set raw_result or execution_error."""
import logging

from app.clients.clickhouse import execute_query
from app.graph.state import GraphState

logger = logging.getLogger(__name__)


def executor(state: GraphState) -> GraphState:
    if not state.get("guard_passed"):
        state["execution_error"] = "Guard rejected SQL"
        return state

    sql = state.get("corrected_sql") or state.get("final_sql", "")
    try:
        rows = execute_query(sql)
        state["raw_result"] = rows
        state["execution_error"] = None
    except Exception as e:  # noqa: BLE001
        logger.warning("ClickHouse execution failed: %s", e)
        state["execution_error"] = str(e)
        state["correction_attempts"] = state.get("correction_attempts", 0) + 1
    return state
