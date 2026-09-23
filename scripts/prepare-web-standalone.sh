#!/usr/bin/env bash
# Copy Next.js static assets into the standalone output (required for production UI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STANDALONE="$ROOT/apps/web/.next/standalone"
STATIC="$ROOT/apps/web/.next/static"

if [[ ! -d "$STANDALONE" ]]; then
  echo "prepare-web-standalone: no standalone output at $STANDALONE (run next build first)" >&2
  exit 1
fi
if [[ ! -d "$STATIC" ]]; then
  echo "prepare-web-standalone: missing $STATIC" >&2
  exit 1
fi

mkdir -p "$STANDALONE/apps/web/.next"
rm -rf "$STANDALONE/apps/web/.next/static"
cp -R "$STATIC" "$STANDALONE/apps/web/.next/static"
echo "Prepared standalone static assets → $STANDALONE/apps/web/.next/static"
