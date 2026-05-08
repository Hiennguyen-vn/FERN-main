"""CSV export module for AI Query Service.

Generates downloadable CSV artifacts so users (especially executives) can
verify the underlying data behind agent answers. Files are stored on local
disk with a TTL and served via an authenticated download endpoint.
"""

from app.exports.builder import build_csv_artifact, build_json_artifact
from app.exports.catalog import ExportArtifact, get_artifact, register_artifact, prune_expired
from app.exports.policy import should_generate_export
from app.exports.storage import artifact_path, ensure_storage_dir

__all__ = [
    "ExportArtifact",
    "build_csv_artifact",
    "build_json_artifact",
    "get_artifact",
    "register_artifact",
    "prune_expired",
    "should_generate_export",
    "artifact_path",
    "ensure_storage_dir",
]
