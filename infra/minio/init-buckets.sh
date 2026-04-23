#!/bin/sh
# Wait for MinIO to be ready, then create required buckets
set -e

MINIO_ALIAS="local"
MINIO_URL="${MINIO_URL:-http://minio:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"

echo "Waiting for MinIO at ${MINIO_URL}..."
until mc alias set "${MINIO_ALIAS}" "${MINIO_URL}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; do
  sleep 2
done

echo "MinIO ready. Creating buckets..."

for bucket in fern-media fern-exports fern-audit-archive; do
  if mc ls "${MINIO_ALIAS}/${bucket}" >/dev/null 2>&1; then
    echo "Bucket ${bucket} already exists, skipping."
  else
    mc mb "${MINIO_ALIAS}/${bucket}"
    echo "Created bucket: ${bucket}"
  fi
done

echo "Bucket initialisation complete."
