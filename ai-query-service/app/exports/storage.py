"""Local filesystem storage for export artifacts.

Production-grade swap target: presigned S3/MinIO URL. The registration
contract in ``catalog.py`` keeps storage backend swappable.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.config import get_settings


def ensure_storage_dir() -> Path:
    s = get_settings()
    base = Path(s.exports_storage_dir).resolve()
    base.mkdir(parents=True, exist_ok=True)
    return base


def artifact_path(artifact_id: str, filename: str) -> Path:
    if "/" in artifact_id or ".." in artifact_id:
        raise ValueError("invalid artifact_id")
    if "/" in filename or ".." in filename:
        raise ValueError("invalid filename")
    base = ensure_storage_dir()
    sub = base / artifact_id
    sub.mkdir(parents=True, exist_ok=True)
    return sub / filename


def remove_artifact_dir(artifact_id: str) -> None:
    base = ensure_storage_dir()
    target = base / artifact_id
    if not target.is_dir():
        return
    for p in target.iterdir():
        try:
            p.unlink()
        except OSError:
            pass
    try:
        target.rmdir()
    except OSError:
        pass


def disk_size_bytes(path: Path) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0
