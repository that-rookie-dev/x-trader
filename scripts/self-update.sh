#!/usr/bin/env bash
# In-place update for a release install ($XTRADER_HOME). Preserves .env and var/.
set -euo pipefail

PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-that-rookie-dev/x-trader}"
VERSION="${XTRADER_VERSION:-latest}"
RESTART=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart) RESTART=1; shift ;;
    --version) VERSION="${2:?}"; shift 2 ;;
    *) shift ;;
  esac
done

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
esac
case "$os" in
  linux) platform="linux-$arch" ;;
  darwin) platform="darwin-$arch" ;;
  *) echo "unsupported platform $os/$arch"; exit 1 ;;
esac

if [[ "$RESTART" -eq 1 ]]; then
  # Wait for the old API process to exit after SIGTERM.
  sleep 3
fi

echo "[self-update] prefix=$PREFIX platform=$platform version=$VERSION"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  # Accept v0.1.0 or 0.1.0
  tag="$VERSION"
  [[ "$tag" == v* ]] || tag="v${tag}"
  url="https://github.com/${REPO}/releases/download/${tag}/xtrader-${platform}.tar.gz"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! command -v curl >/dev/null; then
  echo "curl is required"; exit 1
fi
if ! curl -fsSL "$url" -o "$tmp/xtrader.tgz"; then
  echo "Failed to download $url"; exit 1
fi

mkdir -p "$PREFIX/var"
if [[ -f "$PREFIX/.env" ]]; then
  cp "$PREFIX/.env" "$tmp/dotenv.bak"
fi

# Replace app files; keep var/ and .env
find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name var ! -name .env -exec rm -rf {} +
tar -xzf "$tmp/xtrader.tgz" -C "$PREFIX"

if [[ -f "$tmp/dotenv.bak" ]]; then
  mv "$tmp/dotenv.bak" "$PREFIX/.env"
fi

chmod +x "$PREFIX/bin/xtrader" 2>/dev/null || true
chmod +x "$PREFIX/scripts/"*.sh 2>/dev/null || true
chmod +x "$PREFIX/install.sh" 2>/dev/null || true

# Ensure VERSION file matches requested tag when tarball omitted it
if [[ "$VERSION" != "latest" ]]; then
  echo "${VERSION#v}" >"$PREFIX/VERSION"
fi

echo "[self-update] files replaced"

restarted=0
if [[ "$os" == "linux" ]] && command -v systemctl >/dev/null; then
  if systemctl --user restart xtrader 2>/dev/null; then
    restarted=1
    echo "[self-update] restarted systemd user unit xtrader"
  fi
elif [[ "$os" == "darwin" ]]; then
  uid="$(id -u)"
  if launchctl kickstart -k "gui/${uid}/com.xtrader.app" 2>/dev/null; then
    restarted=1
    echo "[self-update] kickstarted launchd com.xtrader.app"
  fi
fi

if [[ "$restarted" -eq 0 ]]; then
  echo "[self-update] starting bin/xtrader in background"
  nohup "$PREFIX/bin/xtrader" start >"$PREFIX/var/xtrader.log" 2>&1 &
  echo $! >"$PREFIX/var/xtrader.pid"
fi

echo "[self-update] done"
