#!/usr/bin/env bash
# Generates an Ed25519 keypair for sync-manifest signing.
# Outputs:
#   - PKCS#8 private key (base64) → set as FERN_SYNC_MANIFEST_PRIVATE_KEY_PKCS8_B64
#   - raw public key (base64)     → set as VITE_MANIFEST_PUBKEY in edge build
#
# In production: store the private key in Vault, never commit it.
# Rotate at least every 90 days; embed multiple public keys + keyId in edge build to allow overlap.

set -euo pipefail

OUT_DIR="${1:-./manifest-keys}"
mkdir -p "$OUT_DIR"

PRIV_PEM="$OUT_DIR/manifest_priv.pem"
PRIV_B64="$OUT_DIR/manifest_priv.pkcs8.b64"
PUB_B64="$OUT_DIR/manifest_pub.raw.b64"

openssl genpkey -algorithm ED25519 -out "$PRIV_PEM"
openssl pkcs8 -topk8 -nocrypt -in "$PRIV_PEM" -outform DER 2>/dev/null \
  | base64 | tr -d '\n' > "$PRIV_B64"

# Ed25519 SubjectPublicKeyInfo DER ends with the 32-byte raw key — extract it.
openssl pkey -in "$PRIV_PEM" -pubout -outform DER 2>/dev/null \
  | tail -c 32 | base64 | tr -d '\n' > "$PUB_B64"

echo "Wrote:"
echo "  $PRIV_PEM"
echo "  $PRIV_B64  → FERN_SYNC_MANIFEST_PRIVATE_KEY_PKCS8_B64"
echo "  $PUB_B64   → VITE_MANIFEST_PUBKEY"
echo ""
echo "Add to .env (server):"
echo "  FERN_SYNC_MANIFEST_PRIVATE_KEY_PKCS8_B64=$(cat "$PRIV_B64")"
echo "  FERN_SYNC_MANIFEST_KEY_ID=manifest-$(date +%Y%m)"
echo ""
echo "Add to .env (edge build):"
echo "  VITE_MANIFEST_PUBKEY=$(cat "$PUB_B64")"
