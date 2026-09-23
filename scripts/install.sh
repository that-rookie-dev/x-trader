#!/usr/bin/env bash
set -euo pipefail

# xTrader installer (no Docker). Attached to GitHub Releases for that-rookie-dev/x-trader.

PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-that-rookie-dev/x-trader}"
VERSION="${XTRADER_VERSION:-latest}"

STEP=0
TOTAL_STEPS=6
SPIN_PID=""
FANCY=0
NODE_BIN=""

if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  FANCY=1
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_GREEN=$'\033[38;5;114m'
  C_RED=$'\033[38;5;203m'
  C_GOLD=$'\033[38;5;220m'
  C_CYAN=$'\033[38;5;81m'
  C_MUTED=$'\033[38;5;245m'
  C_CLEAR=$'\033[2K'
  HIDE_CUR=$'\033[?25l'
  SHOW_CUR=$'\033[?25h'
else
  C_RESET=""; C_DIM=""; C_BOLD=""; C_GREEN=""; C_RED=""; C_GOLD=""
  C_CYAN=""; C_MUTED=""; C_CLEAR=""; HIDE_CUR=""; SHOW_CUR=""
fi

cleanup_ui() {
  stop_spin
  printf '%s' "$SHOW_CUR" 2>/dev/null || true
}
trap 'cleanup_ui; rm -rf "${tmp:-}"' EXIT
trap 'cleanup_ui; exit 130' INT
trap 'cleanup_ui; exit 143' TERM

banner() {
  echo
  echo "xTrader install"
  echo "---------------"
}

bar() {
  local pct="$1"
  local width=24
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  local i out=""
  for ((i = 0; i < filled; i++)); do out+="#"; done
  for ((i = 0; i < empty; i++)); do out+="-"; done
  printf '%s' "$out"
}

stop_spin() {
  if [[ -n "${SPIN_PID:-}" ]] && kill -0 "$SPIN_PID" 2>/dev/null; then
    kill "$SPIN_PID" 2>/dev/null || true
    wait "$SPIN_PID" 2>/dev/null || true
  fi
  SPIN_PID=""
  if [[ "$FANCY" -eq 1 ]]; then
    printf '\r%s%s' "$C_CLEAR" "$C_RESET"
  fi
}

start_spin() {
  local label="$1"
  stop_spin
  if [[ "$FANCY" -ne 1 ]]; then
    echo "  ... $label"
    return
  fi
  printf '%s' "$HIDE_CUR"
  (
    local i=0
    local frames=('|' '/' '-' '\')
    while true; do
      local pct=$(( STEP * 100 / TOTAL_STEPS ))
      local frame="${frames[$((i % 4))]}"
      printf '\r%s  [%s] %3d%%  %s %s' \
        "$C_CLEAR" "$(bar "$pct")" "$pct" "$frame" "$label"
      i=$((i + 1))
      sleep 0.15
    done
  ) &
  SPIN_PID=$!
}

finish_step() {
  local label="$1"
  stop_spin
  STEP=$((STEP + 1))
  local pct=$(( STEP * 100 / TOTAL_STEPS ))
  if [[ "$FANCY" -eq 1 ]]; then
    printf '  [%s] %3d%%  %s\n' "$(bar "$pct")" "$pct" "$label"
  else
    echo "  [$STEP/$TOTAL_STEPS] $label"
  fi
}

die() {
  stop_spin
  printf '%s\n' "${C_RED}${C_BOLD}ERROR: $1${C_RESET}" >&2
  shift || true
  for line in "$@"; do
    printf '%s\n' "  $line" >&2
  done
  exit 1
}

resolve_node() {
  if ! command -v node >/dev/null; then
    die "Node.js 20.11+ is required (node not found on PATH)."
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 20 ]]; then
    die "Node.js 20.11+ is required (found $(node -v))."
  fi
  # Absolute path so launchd / nohup work even when nvm is not in the service PATH.
  NODE_BIN="$(node -p 'process.execPath')"
  if [[ ! -x "$NODE_BIN" ]]; then
    die "Could not resolve Node binary path."
  fi
}

write_launcher() {
  mkdir -p "$PREFIX/bin"
  cat >"$PREFIX/bin/xtrader" <<EOF
#!/usr/bin/env bash
set -euo pipefail
ROOT="\$(cd "\$(dirname "\$0")/.." && pwd)"
cd "\$ROOT"
export NODE_ENV="\${NODE_ENV:-production}"
export DATA_DIR="\${DATA_DIR:-\$ROOT/var}"
export XTRADER_HOME="\${XTRADER_HOME:-\$ROOT}"
NODE_BIN="\${NODE_BINARY:-$NODE_BIN}"
if [[ ! -x "\$NODE_BIN" ]]; then
  NODE_BIN="\$(command -v node || true)"
fi
if [[ -z "\$NODE_BIN" || ! -x "\$NODE_BIN" ]]; then
  echo "node not found. Install Node.js 20.11+ or set NODE_BINARY." >&2
  exit 1
fi
exec "\$NODE_BIN" "\$ROOT/apps/api/dist/cli.js" "\$@"
EOF
  chmod +x "$PREFIX/bin/xtrader"
}

start_via_nohup() {
  mkdir -p "$PREFIX/var"
  if [[ -f "$PREFIX/var/xtrader.pid" ]]; then
    old="$(cat "$PREFIX/var/xtrader.pid" 2>/dev/null || true)"
    if [[ -n "${old:-}" ]]; then
      kill -TERM "$old" 2>/dev/null || true
      sleep 1
      kill -KILL "$old" 2>/dev/null || true
    fi
  fi
  # Kill anything still bound to desk ports from a failed launchd loop.
  for port in 3456 4000 54329; do
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -TERM $pids 2>/dev/null || true
    fi
  done
  sleep 1
  nohup env \
    PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin" \
    NODE_BINARY="$NODE_BIN" \
    XTRADER_HOME="$PREFIX" \
    DATA_DIR="$PREFIX/var" \
    "$PREFIX/bin/xtrader" start \
    >"$PREFIX/var/xtrader.log" 2>&1 &
  echo $! >"$PREFIX/var/xtrader.pid"
}

wait_healthy() {
  local seconds="$1"
  local i
  for ((i = 1; i <= seconds; i++)); do
    if curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:4000/api/health" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ── begin ────────────────────────────────────────────────────────────────────
banner
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
esac
case "$os" in
  linux) platform="linux-$arch" ;;
  darwin) platform="darwin-$arch" ;;
  *) die "Unsupported platform $os/$arch" "Need linux or macOS (x64 / arm64)." ;;
esac

echo "  Install dir : $PREFIX"
echo "  Platform    : $platform"
echo "  Version     : $VERSION"
echo

start_spin "Checking Node.js and curl"
resolve_node
command -v curl >/dev/null || die "curl is required"
finish_step "Ready (Node $(node -v), $(basename "$NODE_BIN"))"

mkdir -p "$PREFIX"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/xtrader-${platform}.tar.gz"
fi

tmp="$(mktemp -d)"

start_spin "Downloading release ($platform)"
# Always quiet + our own spinner (avoid curl's #=#=# meter)
if ! curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 \
  -o "$tmp/xtrader.tgz" "$url" 2>"$tmp/curl.err"; then
  err="$(tr '\n' ' ' <"$tmp/curl.err" 2>/dev/null || true)"
  die "Download failed" "$url" "${err:-check network / release assets}"
fi
size="$(du -h "$tmp/xtrader.tgz" 2>/dev/null | awk '{print $1}')"
finish_step "Downloaded ${size:-bundle}"

start_spin "Extracting files"
mkdir -p "$PREFIX/var"
if [[ -f "$PREFIX/.env" ]]; then
  cp "$PREFIX/.env" "$tmp/dotenv.bak"
fi
find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name var ! -name .env -exec rm -rf {} +
tar -xzf "$tmp/xtrader.tgz" -C "$PREFIX"
if [[ -f "$tmp/dotenv.bak" ]]; then
  mv "$tmp/dotenv.bak" "$PREFIX/.env"
fi
mkdir -p "$PREFIX/bin" "$PREFIX/var"
chmod +x "$PREFIX/install.sh" 2>/dev/null || true
chmod +x "$PREFIX/scripts/"*.sh 2>/dev/null || true
write_launcher
finish_step "Files installed"

start_spin "Writing config"
if [[ ! -f "$PREFIX/.env" ]]; then
  cat > "$PREFIX/.env" <<'EOF'
NODE_ENV=production
APP_NAME=xTrader
APP_ORIGIN=http://localhost:3456
APP_BIND=127.0.0.1
API_HOST=127.0.0.1
API_PORT=4000
KITE_REDIRECT_URL=http://localhost:3456/zerodha/callback
MARKET_TIMEZONE=Asia/Kolkata
EMBEDDED_POSTGRES_PORT=54329
EMBEDDED_POSTGRES_PASSWORD=xtrader
UPDATE_REPO=that-rookie-dev/x-trader
EOF
  echo "SESSION_SECRET=$(openssl rand -base64 48)" >> "$PREFIX/.env"
  echo "TOKEN_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)" >> "$PREFIX/.env"
  finish_step "Created .env (enter Kite keys in the UI)"
else
  finish_step "Kept existing .env"
fi

start_spin "Starting xTrader"
# Stop any previous agent first
if [[ "$os" == "darwin" ]]; then
  uid="$(id -u)"
  launchctl bootout "gui/${uid}/com.xtrader.app" 2>/dev/null || true
fi
if command -v systemctl >/dev/null; then
  systemctl --user disable --now xtrader 2>/dev/null || true
fi

NODE_DIR="$(dirname "$NODE_BIN")"
SERVICE_PATH="${NODE_DIR}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
started_via=""

if [[ "$os" == "linux" ]] && command -v systemctl >/dev/null; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/xtrader.service" <<EOF
[Unit]
Description=xTrader
After=network.target
[Service]
Type=simple
WorkingDirectory=$PREFIX
EnvironmentFile=$PREFIX/.env
Environment=DATA_DIR=$PREFIX/var
Environment=XTRADER_HOME=$PREFIX
Environment=NODE_BINARY=$NODE_BIN
Environment=PATH=$SERVICE_PATH
ExecStart=$PREFIX/bin/xtrader start
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload || true
  if systemctl --user enable --now xtrader 2>/dev/null; then
    started_via="systemd"
  fi
elif [[ "$os" == "darwin" ]]; then
  plist="$HOME/Library/LaunchAgents/com.xtrader.app.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.xtrader.app</string>
  <key>WorkingDirectory</key><string>$PREFIX</string>
  <key>EnvironmentVariables</key><dict>
    <key>DATA_DIR</key><string>$PREFIX/var</string>
    <key>XTRADER_HOME</key><string>$PREFIX</string>
    <key>NODE_BINARY</key><string>$NODE_BIN</string>
    <key>PATH</key><string>$SERVICE_PATH</string>
  </dict>
  <key>ProgramArguments</key><array>
    <string>$PREFIX/bin/xtrader</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PREFIX/var/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$PREFIX/var/launchd.err.log</string>
</dict></plist>
EOF
  uid="$(id -u)"
  launchctl bootout "gui/${uid}/com.xtrader.app" 2>/dev/null || true
  if launchctl bootstrap "gui/${uid}" "$plist" 2>/dev/null || launchctl load -w "$plist" 2>/dev/null; then
    launchctl kickstart -k "gui/${uid}/com.xtrader.app" 2>/dev/null || true
    started_via="launchd"
  fi
fi

# If service manager did not take it, start in the background with an absolute Node path.
if [[ -z "$started_via" ]]; then
  start_via_nohup
  started_via="background"
fi
finish_step "Process started ($started_via)"

start_spin "Waiting for http://127.0.0.1:4000/api/health"
warm=0
if wait_healthy 45; then
  warm=1
fi

# Service may have failed (e.g. old plist). Fall back to background start once.
if [[ "$warm" -eq 0 ]]; then
  if [[ "$os" == "darwin" ]]; then
    launchctl bootout "gui/$(id -u)/com.xtrader.app" 2>/dev/null || true
  fi
  if command -v systemctl >/dev/null; then
    systemctl --user stop xtrader 2>/dev/null || true
  fi
  start_via_nohup
  started_via="background"
  if wait_healthy 45; then
    warm=1
  fi
fi

if [[ "$warm" -eq 1 ]]; then
  finish_step "Server is up"
  if command -v open >/dev/null; then
    open "http://localhost:3456" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null; then
    xdg-open "http://localhost:3456" >/dev/null 2>&1 || true
  fi
else
  finish_step "Install finished (server still starting)"
  echo "  Check logs: $PREFIX/var/xtrader.log"
  if [[ -f "$PREFIX/var/launchd.err.log" ]]; then
    echo "  launchd:  $PREFIX/var/launchd.err.log"
  fi
fi

if [[ -f "$PREFIX/scripts/uninstall.sh" ]]; then
  ln -sf "$PREFIX/scripts/uninstall.sh" "$PREFIX/uninstall.sh" 2>/dev/null || cp "$PREFIX/scripts/uninstall.sh" "$PREFIX/uninstall.sh"
  chmod +x "$PREFIX/uninstall.sh" "$PREFIX/scripts/uninstall.sh" 2>/dev/null || true
fi

echo
echo "Done."
echo "  Open     http://localhost:3456"
echo "  Home     $PREFIX"
echo "  CLI      $PREFIX/bin/xtrader start | update | session reset"
echo "  Remove   $PREFIX/uninstall.sh"
echo
echo "  First run: paste Kite API key + secret in the UI."
echo "  Kite redirect URL: http://localhost:3456/zerodha/callback"
echo
