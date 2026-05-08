# Legacy LangGraph Retirement Plan

The Finch-style two-agent architecture (`app/agents/`) replaces the original
21-node LangGraph (`app/graph/builder.py`). Once we have measured parity
between the two pipelines on the golden eval suite, the modules below are
retired in a single step.

## Files retired in step 1 (LLM-only legacy nodes)

| Module                                     | Replaced by                                |
| ------------------------------------------ | ------------------------------------------ |
| `app/graph/nodes/supervisor.py`            | `app/agents/supervisor_agent.py`           |
| `app/graph/nodes/query_reasoner.py`        | folded into `supervisor_agent` JSON schema |
| `app/graph/nodes/template_matcher.py`      | folded into `supervisor_agent`             |
| `app/graph/nodes/sql_logical_check.py`     | deterministic `tools.validate_and_inject`  |
| `app/query_modes/codegen/planner.py`       | implicit in Codex agent's tool loop        |
| `app/query_modes/codegen/reviewer.py`      | deterministic `tools.validate_and_inject`  |

## Files retired in step 2 (cascade)

Once step 1 is gone, these modules also become dead code:

- `app/query_modes/codegen/generator.py` — only callable from legacy graph.
- `app/query_modes/codegen/nodes.py`     — orchestrator hooks for the legacy
  retry loop; SQL Writer Agent has its own loop.
- `app/query_modes/codegen/trial.py`     — `EXPLAIN`/dry-run orchestration;
  tools call `explain_pipeline` directly.
- `app/graph/builder.py`                 — replaced by `build_agent_graph`.

After step 2, `app/main.py` always uses `build_agent_graph` and the
`agent_mode_enabled` flag becomes a noop (kept for one minor version, then
removed in step 3).

## Tests retired

- `tests/test_supervisor_deterministic.py`         (covers legacy supervisor)
- `tests/test_reasoning_outline.py`                (covers query_reasoner)
- `tests/test_template_matcher_outlet_directory.py` (covers template_matcher)
- `tests/test_codegen_planner.py`                  (covers planner)
- `tests/test_codegen_generator.py`                (covers generator)
- `tests/test_self_correction.py`                  (covers `codegen.nodes`)
- `tests/test_social_routing.py`                   (covers template_matcher routing path)

The agent-mode equivalents (`tests/test_agents_*.py`) cover the same
behaviour against the new pipeline.

## Parity gates

Retirement is allowed only when **all** of these are true:

1. `python -m scripts.run_openai_evals --mode local --min-pass-rate 0.95`
   exits 0 against the curated golden cases.
2. A shadow run against staging OpenAI passes ≥ 0.90 over the production
   sample of last 14 days (`--mode shadow`, log archived).
3. `AGENT_MODE_ENABLED=true` has been the default in production for **at
   least 7 days** with no rollback. Track via deploy log + dashboards.
4. `tests/test_agents_*.py` passes, `tests/` overall green.

## Retirement command

```bash
# Dry-run (default): list what would be deleted.
python scripts/retire_legacy_nodes.py

# Apply (after parity gates pass):
python scripts/retire_legacy_nodes.py --confirm
```

The script refuses to delete unless step (1) above passes inside the same
invocation.

## Roll-back

If a regression is discovered after retirement:

1. `git revert` the retirement commit (single squashed commit recommended).
2. Re-enable legacy graph by reverting the `agent_mode_enabled` default
   change.
3. The eval suite stays — it's the new contract regardless of which
   pipeline implements it.
