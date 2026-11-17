#!/bin/sh
# Builds after-effects.mcpb: a one-click extension for Claude Desktop (uses Desktop's built-in Node).
# Usage: sh scripts/pack-mcpb.sh   -> writes ./after-effects.mcpb
set -e
cd "$(dirname "$0")/.."
OUT="$PWD/after-effects.mcpb"
rm -f "$OUT"
zip -qr "$OUT" manifest.json LICENSE THIRD-PARTY-NOTICES.md dist ae style -x '*.DS_Store'
echo "Built $OUT"
