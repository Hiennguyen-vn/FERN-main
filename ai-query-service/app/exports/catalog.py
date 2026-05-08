"""Artifact catalog — tracks issued export artifacts with TTL + ownership.

In-process dict for now (single-replica deployment). For multi-replica
deployments swap to Redis with the same interface.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from app.config import get_settings
from app.exports.storage import disk_size_bytes, remove_artifact_dir

logger = logging.getLogger(__name__)


@dataclass
class ExportArtifact:
    artifact_id: str
    user_id: int
    correlation_id: str
    filename: str
    format: str  # "csv" | "json"
    path: Path
    row_count: int
    size_bytes: int
    sha256: str
    created_at: datetime
    expires_at: datetime
    question: str = ""
    metadata: dict = field(default_factory=dict)

    def is_expired(self, now: Optional[datetime] = None) -> bool:
        now = now or datetime.now(timezone.utc)
        return now >= self.expires_at

    def to_response_dict(self, download_url: str) -> dict:
        return {
            "artifact_id": self.artifact_id,
            "format": self.format,
            "filename": self.filename,
            "download_url": download_url,
            "row_count": self.row_count,
            "size_bytes": self.size_bytes,
            "expires_at": self.expires_at.isoformat().replace("+00:00", "Z"),
            "sha256": self.sha256,
        }


_REGISTRY: dict[str, ExportArtifact] = {}
_LOCK = threading.RLock()


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
    except OSError:
        return ""
    return h.hexdigest()


def register_artifact(
    *,
    artifact_id: str,
    user_id: int,
    correlation_id: str,
    filename: str,
    fmt: str,
    path: Path,
    row_count: int,
    question: str = "",
    metadata: Optional[dict] = None,
) -> ExportArtifact:
    s = get_settings()
    now = datetime.now(timezone.utc)
    artifact = ExportArtifact(
        artifact_id=artifact_id,
        user_id=user_id,
        correlation_id=correlation_id,
        filename=filename,
        format=fmt,
        path=path,
        row_count=row_count,
        size_bytes=disk_size_bytes(path),
        sha256=_hash_file(path),
        created_at=now,
        expires_at=now + timedelta(hours=s.exports_ttl_hours),
        question=question[:500],
        metadata=metadata or {},
    )
    with _LOCK:
        _REGISTRY[artifact_id] = artifact
    return artifact


def get_artifact(artifact_id: str) -> Optional[ExportArtifact]:
    with _LOCK:
        return _REGISTRY.get(artifact_id)


def prune_expired() -> int:
    now = datetime.now(timezone.utc)
    removed = 0
    with _LOCK:
        expired_ids = [aid for aid, art in _REGISTRY.items() if art.is_expired(now)]
        for aid in expired_ids:
            try:
                remove_artifact_dir(aid)
            except Exception as e:  # noqa: BLE001
                logger.warning("Failed to remove expired artifact dir %s: %s", aid, e)
            _REGISTRY.pop(aid, None)
            removed += 1
    return removed
