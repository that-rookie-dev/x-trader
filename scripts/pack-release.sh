#!/usr/bin/env bash
# Pack a platform release tarball (run after npm run build on the target OS/arch).
set -euo pipefail

PLATFORM="${1:?usage: pack-release.sh <platform> [outdir]}"
OUT="${2:-dist-release}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d apps/api/dist ]]; then
  echo "Missing apps/api/dist — run npm run build first" >&2
  exit 1
fi
if [[ ! -d apps/web/.next/standalone ]]; then
  echo "Missing Next standalone — run npm run build -w @xtrader/web first" >&2
  exit 1
fi

bash "$ROOT/scripts/prepare-web-standalone.sh"

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/var" "$OUT/apps/api" "$OUT/apps/web" "$OUT/packages/domain"

cp -R apps/api/dist "$OUT/apps/api/"
cp apps/api/package.json "$OUT/apps/api/"

cp -R packages/domain/dist "$OUT/packages/domain/"
cp packages/domain/package.json "$OUT/packages/domain/"

# Prefer packed layout: apps/web/standalone (contents of .next/standalone + static)
cp -R apps/web/.next/standalone "$OUT/apps/web/standalone"
cp apps/web/package.json "$OUT/apps/web/"

cp package.json "$OUT/"
[[ -f package-lock.json ]] && cp package-lock.json "$OUT/"
cp .env.example "$OUT/"
cp scripts/install.sh "$OUT/install.sh"
cp scripts/uninstall.sh "$OUT/uninstall.sh"

mkdir -p "$OUT/scripts"
cp scripts/self-update.sh scripts/install.sh scripts/uninstall.sh scripts/prepare-web-standalone.sh "$OUT/scripts/"
chmod +x "$OUT/scripts/"*.sh "$OUT/uninstall.sh"

# Semver stamped into the install (CI tag preferred)
VER="${GITHUB_REF_NAME:-}"
if [[ -z "$VER" ]]; then
  VER="$(node -p "require('./package.json').version")"
fi
VER="${VER#v}"
printf '%s\n' "$VER" >"$OUT/VERSION"

# Platform-correct node_modules from this runner (includes embedded-postgres binaries).
# Preserve workspace symlinks so @xtrader/* still resolve under apps/ and packages/.
if cp -a node_modules "$OUT/" 2>/dev/null; then
  :
else
  cp -R node_modules "$OUT/"
fi

cat > "$OUT/bin/xtrader" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export NODE_ENV="${NODE_ENV:-production}"
export DATA_DIR="${DATA_DIR:-$ROOT/var}"
export XTRADER_HOME="${XTRADER_HOME:-$ROOT}"
exec node "$ROOT/apps/api/dist/cli.js" "$@"
EOF
chmod +x "$OUT/bin/xtrader" "$OUT/install.sh" "$OUT/uninstall.sh" "$OUT/scripts/self-update.sh" "$OUT/scripts/uninstall.sh"

TARBALL="xtrader-${PLATFORM}.tar.gz"
tar -czf "$TARBALL" -C "$OUT" .
echo "Wrote $TARBALL ($(du -h "$TARBALL" | awk '{print $1}'))"
