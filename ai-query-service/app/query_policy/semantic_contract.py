"""Versioned semantic contract loader for ai-query core BI domains."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


CONTRACT_DIR = Path(__file__).resolve().parents[2] / "knowledge" / "semantic_contracts" / "v1"
REQUIRED_TOP_LEVEL_KEYS = frozenset({"version", "domain", "datasets", "metrics"})


class SemanticContractError(ValueError):
    """Raised when a semantic contract YAML file is missing required shape."""


def _validate_contract(path: Path, payload: dict[str, Any]) -> None:
    missing = sorted(REQUIRED_TOP_LEVEL_KEYS - set(payload))
    if missing:
        raise SemanticContractError(f"{path.name} missing required key(s): {missing}")
    if not isinstance(payload.get("datasets"), list) or not payload["datasets"]:
        raise SemanticContractError(f"{path.name} must declare at least one dataset")
    if not isinstance(payload.get("metrics"), list) or not payload["metrics"]:
        raise SemanticContractError(f"{path.name} must declare at least one metric")
    for metric in payload["metrics"]:
        if not isinstance(metric, dict) or not metric.get("id") or not metric.get("source_dataset"):
            raise SemanticContractError(f"{path.name} has metric without id/source_dataset")


@lru_cache(maxsize=1)
def load_semantic_contracts() -> tuple[dict[str, Any], ...]:
    """Load validated v1 semantic contracts from YAML files."""
    contracts: list[dict[str, Any]] = []
    for path in sorted(CONTRACT_DIR.glob("*.yaml")):
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            raise SemanticContractError(f"{path.name} must contain a mapping")
        _validate_contract(path, raw)
        raw["_source_path"] = str(path)
        contracts.append(raw)
    return tuple(contracts)


def semantic_contract_by_domain() -> dict[str, dict[str, Any]]:
    return {str(contract["domain"]): contract for contract in load_semantic_contracts()}


def semantic_metric_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for contract in load_semantic_contracts():
        domain = str(contract.get("domain") or "")
        for metric in contract.get("metrics") or []:
            if not isinstance(metric, dict):
                continue
            rows.append({**metric, "domain": domain})
    return rows


__all__ = [
    "CONTRACT_DIR",
    "SemanticContractError",
    "load_semantic_contracts",
    "semantic_contract_by_domain",
    "semantic_metric_rows",
]
