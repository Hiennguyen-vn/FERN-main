"""GenSQL trial execution node."""

from app.config import get_settings
from app.graph.state import GraphState


def codegen_trial(state: GraphState) -> GraphState:
    from app.clients.clickhouse import (
        execute_query_with_settings,
        explain_pipeline,
        explain_syntax,
    )

    s = get_settings()
    sql = (state.get("final_sql") or "").strip()

    ok_syn, syn_err = explain_syntax(sql)
    trace: dict = {"explain_syntax_ok": ok_syn, "syntax_error": syn_err or None}
    if not ok_syn:
        state["codegen_last_error_vi"] = f"EXPLAIN SYNTAX: {syn_err}"
        state["codegen_trial_passed"] = False
        state.setdefault("trace", []).append({"node": "codegen_trial", **trace})
        return state

    ok_pipe, pipe_err = explain_pipeline(sql, max_execution_seconds=min(5.0, s.max_codegen_trial_timeout_seconds))
    trace["explain_pipeline_ok"] = ok_pipe
    trace["pipeline_error"] = pipe_err or None
    if not ok_pipe:
        state["codegen_last_error_vi"] = f"EXPLAIN PIPELINE: {pipe_err}"
        state["codegen_trial_passed"] = False
        state.setdefault("trace", []).append({"node": "codegen_trial", **trace})
        return state

    try:
        rows = execute_query_with_settings(
            sql,
            settings={
                "max_result_rows": s.max_codegen_trial_rows,
                "max_execution_time": s.max_codegen_trial_timeout_seconds,
                "result_overflow_mode": "break",
            },
        )
        trace["trial_rows"] = len(rows)
        state["codegen_trial_passed"] = True
        state["executed_sql_source"] = "codegen"
        state.pop("codegen_last_error_vi", None)
        state.pop("sql_source", None)
    except Exception as e:  # noqa: BLE001
        state["codegen_last_error_vi"] = f"Trial execute: {e}"
        state["codegen_trial_passed"] = False
        trace["trial_error"] = str(e)

    state.setdefault("trace", []).append({"node": "codegen_trial", **trace})
    return state
