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

mkdir -p "$PREFIX/var"
STATUS_FILE="$PREFIX/var/update-status.json"
STARTED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TARGET_VER="${VERSION#v}"

write_status() {
  local state="$1" message="$2" percent="$3"
  local tmpf
  tmpf="$(mktemp "$PREFIX/var/update-status.XXXXXX")"
  printf '{"state":"%s","target":"%s","message":"%s","percent":%s,"startedAt":"%s"}\n' \
    "$state" "$TARGET_VER" "$message" "$percent" "$STARTED" >"$tmpf"
  mv "$tmpf" "$STATUS_FILE"
}

fail_status() {
  local code="${1:-$?}"
  if [[ "$code" -ne 0 ]]; then
    write_status "failed" "Update failed. See var/update.log" "0"
  fi
}
trap 'fail_status $?' EXIT

echo "[self-update] prefix=$PREFIX platform=$platform version=$VERSION"
write_status "downloading" "Starting download" "0"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  # Accept v0.1.0 or 0.1.0
  tag="$VERSION"
  [[ "$tag" == v* ]] || tag="v${tag}"
  url="https://github.com/${REPO}/releases/download/${tag}/xtrader-${platform}.tar.gz"
fi

tmp="$(mktemp -d)"
trap 'code=$?; rm -rf "$tmp"; fail_status "$code"' EXIT

if ! command -v curl >/dev/null; then
  echo "curl is required"; exit 1
fi

bytes_of() {
  if stat -f%z "$1" >/dev/null 2>&1; then
    stat -f%z "$1"
  else
    stat -c%s "$1" 2>/dev/null || echo 0
  fi
}

total="$(curl -fsSL -I -L "$url" | awk 'tolower($1)=="content-length:" {n=$2} END {gsub("\r","",n); print n+0}')"
curl -fL "$url" -o "$tmp/xtrader.tgz" &
curl_pid=$!
while kill -0 "$curl_pid" 2>/dev/null; do
  got="$(bytes_of "$tmp/xtrader.tgz" 2>/dev/null || echo 0)"
  if [[ "${total:-0}" -gt 0 && "${got:-0}" -ge 0 ]]; then
    pct=$(( got * 100 / total ))
    if [[ "$pct" -gt 99 ]]; then pct=99; fi
  else
    pct=0
  fi
  write_status "downloading" "Downloading release" "$pct"
  sleep 1
done
if ! wait "$curl_pid"; then
  echo "Failed to download $url"
  exit 1
fi
write_status "extracting" "Replacing app files" "100"

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
chmod +x "$PREFIX/bin/xtraderctl" 2>/dev/null || true
chmod +x "$PREFIX/scripts/"*.sh 2>/dev/null || true
chmod +x "$PREFIX/install.sh" 2>/dev/null || true

# Keep the short `xtrader` command available after upgrades as well as fresh installs.
if [[ -x "$PREFIX/bin/xtraderctl" ]]; then
  cli_dir="$HOME/.local/bin"
  cli_path="$cli_dir/xtrader"
  mkdir -p "$cli_dir"
  cat >"$cli_path" <<EOF
#!/usr/bin/env bash
# xTrader CLI launcher
exec "$PREFIX/bin/xtraderctl" "\$@"
EOF
  chmod +x "$cli_path"

  path_line='export PATH="$HOME/.local/bin:$PATH" # xTrader CLI'
  case "${SHELL:-}" in
    */zsh) profile="$HOME/.zshrc" ;;
    */bash)
      if [[ "$os" == "darwin" ]]; then
        profile="$HOME/.bash_profile"
      else
        profile="$HOME/.bashrc"
      fi
      ;;
    *)
      if [[ "$os" == "darwin" ]]; then
        profile="$HOME/.zshrc"
      else
        profile="$HOME/.profile"
      fi
      ;;
  esac
  touch "$profile"
  if ! grep -Fqx "$path_line" "$profile" 2>/dev/null; then
    printf '\n%s\n' "$path_line" >>"$profile"
  fi
fi

# Ensure VERSION file matches requested tag when tarball omitted it
if [[ "$VERSION" != "latest" ]]; then
  echo "${VERSION#v}" >"$PREFIX/VERSION"
fi

echo "[self-update] files replaced"
write_status "restarting" "Restarting" "100"

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
write_status "done" "Updated" "100"
trap - EXIT
rm -rf "$tmp"
