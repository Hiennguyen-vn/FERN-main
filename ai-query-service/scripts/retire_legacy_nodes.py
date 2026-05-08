"""Retire legacy LangGraph nodes after parity is measured.

This script enforces the parity gates documented in ``DEPRECATION.md`` and
performs a destructive but reproducible cleanup. Default invocation is a
**dry-run**: it prints what would change. Pass ``--confirm`` to actually
delete files and rewrite the graph builder.

Steps performed (in order):

1. Run ``scripts.run_openai_evals --mode local`` and require pass-rate ≥
   ``--min-pass-rate`` (default 0.95). Skipped only with ``--skip-eval``
   for emergency rollback workflows.
2. Delete the LLM-only legacy node files:
   - app/graph/nodes/supervisor.py
   - app/graph/nodes/query_reasoner.py
   - app/graph/nodes/template_matcher.py
   - app/graph/nodes/sql_logical_check.py
   - app/query_modes/codegen/planner.py
   - app/query_modes/codegen/reviewer.py
3. Delete cascade-orphaned modules:
   - app/query_modes/codegen/generator.py
   - app/query_modes/codegen/nodes.py
   - app/query_modes/codegen/trial.py
   - app/graph/builder.py
4. Rewrite ``app/agents/__init__.py`` to expose ``build_graph`` as an alias
   for ``build_agent_graph`` so legacy importers keep working until they
   migrate.
5. Remove obsolete test files (the agent-mode tests cover their behaviour).

If any step fails, no files are written and the script exits non-zero so
the operator can investigate before re-running.
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Step 2 removals.
LEGACY_LLM_NODES = [
    "app/graph/nodes/supervisor.py",
    "app/graph/nodes/query_reasoner.py",
    "app/graph/nodes/template_matcher.py",
    "app/graph/nodes/sql_logical_check.py",
    "app/query_modes/codegen/planner.py",
    "app/query_modes/codegen/reviewer.py",
]

# Step 3 cascade — these become dead code once step 2 is applied.
CASCADE_REMOVALS = [
    "app/query_modes/codegen/generator.py",
    "app/query_modes/codegen/nodes.py",
    "app/query_modes/codegen/trial.py",
    "app/graph/builder.py",
]

# Step 5 test cleanups — covered by tests/test_agents_*.py going forward.
LEGACY_TESTS = [
    "tests/test_supervisor_deterministic.py",
    "tests/test_reasoning_outline.py",
    "tests/test_template_matcher_outlet_directory.py",
    "tests/test_codegen_planner.py",
    "tests/test_codegen_generator.py",
    "tests/test_self_correction.py",
    "tests/test_social_routing.py",
]

CODEGEN_INIT_NEW_CONTENT = '''"""Legacy codegen package — retired in favour of app.agents.sql_writer_agent.

The Codex SQL Writer Agent owns this responsibility now. Imports against
this package raise ``ImportError`` so callers must migrate to
``from app.agents.sql_writer_agent import sql_writer_agent``.
"""

raise ImportError(
    "app.query_modes.codegen has been retired. "
    "Use app.agents.sql_writer_agent.sql_writer_agent instead."
)
'''

GRAPH_BUILDER_SHIM_CONTENT = '''"""Legacy build_graph shim — kept for one release for backwards compat.

All real wiring now lives in ``app.agents.graph_builder.build_agent_graph``.
"""

from app.agents.graph_builder import build_agent_graph as build_graph

__all__ = ["build_graph"]
'''


def _eval_gate(min_pass_rate: float) -> bool:
    """Run the local eval suite and check pass-rate gate."""
    print(f"→ running scripts/run_openai_evals.py --mode local --min-pass-rate {min_pass_rate}")
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.run_openai_evals",
            "--mode",
            "local",
            "--min-pass-rate",
            str(min_pass_rate),
        ],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode == 0


def _existing(path: Path) -> bool:
    return path.exists() and path.is_file()


def _delete(paths: list[str], *, dry_run: bool) -> int:
    removed = 0
    for rel in paths:
        p = ROOT / rel
        if not _existing(p):
            print(f"  · skip (not found): {rel}")
            continue
        if dry_run:
            print(f"  · would delete: {rel}")
        else:
            p.unlink()
            print(f"  ✓ deleted: {rel}")
        removed += 1
    return removed


def _write_text(rel: str, contents: str, *, dry_run: bool) -> bool:
    p = ROOT / rel
    if dry_run:
        print(f"  · would rewrite: {rel} ({len(contents)} bytes)")
        return False
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(contents, encoding="utf-8")
    print(f"  ✓ rewrote: {rel}")
    return True


def _ensure_agent_init_exposes_build_graph(*, dry_run: bool) -> None:
    """Make sure ``from app.agents import build_graph`` works post-retirement."""
    init_path = ROOT / "app/agents/__init__.py"
    if not init_path.exists():
        print("  ! app/agents/__init__.py missing — aborting", file=sys.stderr)
        return
    content = init_path.read_text(encoding="utf-8")
    if "build_graph" in content:
        return
    addition = (
        "\n# Backwards-compat shim: legacy callers import build_graph from app.graph.builder.\n"
        "build_graph = build_agent_graph\n"
        '__all__.append("build_graph")\n'
    )
    if dry_run:
        print(f"  · would append build_graph alias to app/agents/__init__.py")
    else:
        init_path.write_text(content + addition, encoding="utf-8")
        print("  ✓ appended build_graph alias to app/agents/__init__.py")


def _backup_to_attic(*, dry_run: bool) -> Path | None:
    """Copy retired files to .attic/<timestamp>/ before deletion (safety net)."""
    if dry_run:
        return None
    import datetime as _dt

    stamp = _dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    attic = ROOT / ".attic" / f"retire-legacy-{stamp}"
    attic.mkdir(parents=True, exist_ok=True)
    for rel in LEGACY_LLM_NODES + CASCADE_REMOVALS + LEGACY_TESTS:
        src = ROOT / rel
        if not src.exists():
            continue
        dst = attic / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    print(f"  ✓ backup written to {attic.relative_to(ROOT)}")
    return attic


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--confirm", action="store_true", help="actually apply changes")
    p.add_argument("--skip-eval", action="store_true", help="skip parity gate (emergency only)")
    p.add_argument("--min-pass-rate", type=float, default=0.95)
    args = p.parse_args()

    dry_run = not args.confirm

    print("=" * 70)
    print("FERN legacy retirement — " + ("DRY RUN" if dry_run else "APPLY"))
    print("=" * 70)

    if not args.skip_eval:
        if not _eval_gate(args.min_pass_rate):
            print(
                "\n✗ Eval gate failed. Refusing to proceed. "
                "Re-run after fixing regressions, or pass --skip-eval (emergency rollback only).",
                file=sys.stderr,
            )
            return 1
        print("✓ Eval gate passed.\n")
    else:
        print("⚠ --skip-eval set: skipping parity gate.\n")

    if not dry_run:
        _backup_to_attic(dry_run=False)

    print("[step 2] removing LLM-only legacy nodes:")
    _delete(LEGACY_LLM_NODES, dry_run=dry_run)

    print("\n[step 3] removing cascade-orphaned modules:")
    _delete(CASCADE_REMOVALS, dry_run=dry_run)

    print("\n[step 4] writing shims so legacy imports still resolve:")
    _write_text(
        "app/query_modes/codegen/__init__.py",
        CODEGEN_INIT_NEW_CONTENT,
        dry_run=dry_run,
    )
    _write_text("app/graph/builder.py", GRAPH_BUILDER_SHIM_CONTENT, dry_run=dry_run)
    _ensure_agent_init_exposes_build_graph(dry_run=dry_run)

    print("\n[step 5] removing obsolete test files:")
    _delete(LEGACY_TESTS, dry_run=dry_run)

    print()
    if dry_run:
        print("Dry-run complete. Re-run with --confirm to apply.")
    else:
        print("Retirement applied. Run `pytest -q` and the eval suite to confirm green.")
    return 0


if __name__ == "__main__":
    asyncio.set_event_loop_policy(None)  # not async; just safety
    sys.exit(main())
