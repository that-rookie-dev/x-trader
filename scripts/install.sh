#!/usr/bin/env bash
set -euo pipefail

# xTrader installer (no Docker). Attached to GitHub Releases for that-rookie-dev/x-trader.

PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-that-rookie-dev/x-trader}"
VERSION="${XTRADER_VERSION:-latest}"

STEP=0
TOTAL_STEPS=6
SPIN_PID=""
DOWNLOAD_PID=""
FANCY=0
NODE_BIN=""
NODE_SOURCE="" # system | portable | brew
# Official Node LTS used when the machine has no Node 20+.
NODE_DIST_VERSION="${XTRADER_NODE_VERSION:-22.14.0}"

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
  if [[ -n "${DOWNLOAD_PID:-}" ]] && kill -0 "$DOWNLOAD_PID" 2>/dev/null; then
    kill "$DOWNLOAD_PID" 2>/dev/null || true
    wait "$DOWNLOAD_PID" 2>/dev/null || true
  fi
  DOWNLOAD_PID=""
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

download_file() {
  local label="$1"
  local url="$2"
  local destination="$3"
  local error_file="${destination}.curl.err"
  local total bytes pct downloaded_mb total_mb next tick rc
  stop_spin
  printf '  %s\n' "$label"

  total="$(
    curl -fsIL --retry 2 --connect-timeout 10 "$url" 2>/dev/null \
      | awk 'tolower($1) == "content-length:" { gsub("\r", "", $2); if ($2 ~ /^[0-9]+$/) size=$2 } END { print size + 0 }'
  )"
  rm -f "$destination" "$error_file"
  : >"$destination"
  curl -fL \
    --retry 3 \
    --retry-delay 2 \
    --connect-timeout 20 \
    --silent \
    --show-error \
    -o "$destination" \
    "$url" 2>"$error_file" &
  DOWNLOAD_PID=$!
  next=10
  tick=0

  if [[ "$FANCY" -eq 1 ]]; then
    printf '%s' "$HIDE_CUR"
  fi
  while kill -0 "$DOWNLOAD_PID" 2>/dev/null; do
    bytes="$(wc -c <"$destination" 2>/dev/null | tr -d ' ' || echo 0)"
    [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
    downloaded_mb=$(( bytes / 1048576 ))
    if [[ "$total" -gt 0 ]]; then
      pct=$(( bytes * 100 / total ))
      [[ "$pct" -le 99 ]] || pct=99
      total_mb=$(( (total + 1048575) / 1048576 ))
      if [[ "$FANCY" -eq 1 ]]; then
        printf '\r%s  [%s] %3d%%  %d / %d MB' \
          "$C_CLEAR" "$(bar "$pct")" "$pct" "$downloaded_mb" "$total_mb"
      elif [[ "$pct" -ge "$next" ]]; then
        echo "  Downloaded ${pct}% (${downloaded_mb} / ${total_mb} MB)"
        next=$(( ((pct / 10) + 1) * 10 ))
      fi
    elif [[ "$FANCY" -eq 1 ]]; then
      printf '\r%s  Downloaded %d MB' "$C_CLEAR" "$downloaded_mb"
    elif [[ "$tick" -gt 0 && $(( tick % 5 )) -eq 0 ]]; then
      echo "  Downloaded ${downloaded_mb} MB"
    fi
    tick=$((tick + 1))
    sleep 0.25
  done

  if wait "$DOWNLOAD_PID"; then
    rc=0
  else
    rc=$?
  fi
  DOWNLOAD_PID=""
  if [[ "$FANCY" -eq 1 ]]; then
    printf '\r%s%s' "$C_CLEAR" "$SHOW_CUR"
  fi
  if [[ "$rc" -ne 0 ]]; then
    cat "$error_file" >&2 2>/dev/null || true
    return "$rc"
  fi
  return 0
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

print_node_instructions() {
  stop_spin
  echo
  echo "Node.js 20.11+ is required and could not be installed automatically."
  echo
  echo "Install Node, then re-run this installer:"
  echo
  case "$os" in
    darwin)
      echo "  macOS (Homebrew):"
      echo "    brew install node"
      echo
      echo "  Or download the macOS installer:"
      echo "    https://nodejs.org/en/download"
      ;;
    linux)
      echo "  Ubuntu / Debian:"
      echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
      echo "    sudo apt-get install -y nodejs"
      echo
      echo "  Fedora:"
      echo "    sudo dnf install nodejs"
      echo
      echo "  Or download a Linux binary from:"
      echo "    https://nodejs.org/en/download"
      ;;
    *)
      echo "  Download Node.js 20+ from https://nodejs.org/en/download"
      ;;
  esac
  echo
  echo "  Or use nvm:"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  echo "    # restart the terminal, then:"
  echo "    nvm install 22"
  echo
  echo "Verify, then install xTrader again:"
  echo "  node -v"
  echo "  curl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | bash"
  echo
  exit 1
}

# Returns 0 and sets NODE_BIN if a usable Node 20+ is found.
try_existing_node() {
  local candidate=""
  if command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
  elif [[ -x "$PREFIX/runtime/node/bin/node" ]]; then
    candidate="$PREFIX/runtime/node/bin/node"
  fi
  [[ -n "$candidate" && -x "$candidate" ]] || return 1

  local major
  major="$("$candidate" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [[ "$major" -lt 20 ]]; then
    return 1
  fi
  NODE_BIN="$("$candidate" -p 'process.execPath' 2>/dev/null || echo "$candidate")"
  [[ -x "$NODE_BIN" ]] || return 1
  return 0
}

# Download official Node binaries into $PREFIX/runtime/node (no sudo).
install_portable_node() {
  local dist="node-v${NODE_DIST_VERSION}-${platform}"
  local url="https://nodejs.org/dist/v${NODE_DIST_VERSION}/${dist}.tar.gz"
  local tgz="$tmp/node.tgz"

  if ! download_file "Downloading Node.js v${NODE_DIST_VERSION}" "$url" "$tgz"; then
    return 1
  fi

  start_spin "Installing Node.js into $PREFIX/runtime"
  rm -rf "$PREFIX/runtime/node" "$PREFIX/runtime/$dist"
  mkdir -p "$PREFIX/runtime"
  if ! tar -xzf "$tgz" -C "$PREFIX/runtime" 2>/dev/null; then
    return 1
  fi
  mv "$PREFIX/runtime/$dist" "$PREFIX/runtime/node"
  NODE_BIN="$PREFIX/runtime/node/bin/node"
  if [[ ! -x "$NODE_BIN" ]]; then
    return 1
  fi
  NODE_SOURCE="portable"
  return 0
}

# Optional: Homebrew when available (macOS / Linuxbrew).
try_brew_node() {
  command -v brew >/dev/null 2>&1 || return 1
  start_spin "Installing Node.js with Homebrew"
  if ! brew install node >/dev/null 2>"$tmp/brew-node.err"; then
    return 1
  fi
  hash -r 2>/dev/null || true
  try_existing_node || return 1
  NODE_SOURCE="brew"
  return 0
}

ensure_node() {
  if try_existing_node; then
    if [[ -z "$NODE_SOURCE" ]]; then
      if [[ "$NODE_BIN" == "$PREFIX/runtime/node/bin/node" ]]; then
        NODE_SOURCE="portable"
      else
        NODE_SOURCE="system"
      fi
    fi
    return 0
  fi

  echo "  Node.js 20+ not found on PATH."
  echo "  Installing Node v${NODE_DIST_VERSION} into $PREFIX/runtime (no admin password)..."
  if install_portable_node; then
    return 0
  fi

  echo "  Download from nodejs.org failed."
  if command -v brew >/dev/null 2>&1; then
    echo "  Trying Homebrew..."
    if try_brew_node; then
      return 0
    fi
  fi

  print_node_instructions
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
  NODE_BIN="\$ROOT/runtime/node/bin/node"
fi
if [[ ! -x "\$NODE_BIN" ]]; then
  NODE_BIN="\$(command -v node || true)"
fi
if [[ -z "\$NODE_BIN" || ! -x "\$NODE_BIN" ]]; then
  echo "node not found. Re-run the installer or install Node.js 20.11+." >&2
  exit 1
fi
exec "\$NODE_BIN" "\$ROOT/apps/api/dist/cli.js" "\$@"
EOF
  chmod +x "$PREFIX/bin/xtrader"
}

stop_existing_ports() {
  local port pids found=0
  for port in 3456 4000 54329; do
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -TERM $pids 2>/dev/null || true
      found=1
    fi
  done
  if [[ "$found" -eq 1 ]]; then
    sleep 1
    for port in 3456 4000 54329; do
      pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
      if [[ -n "$pids" ]]; then
        # shellcheck disable=SC2086
        kill -KILL $pids 2>/dev/null || true
      fi
    done
  fi
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
  # Kill anything still bound to desk ports from a failed service start.
  stop_existing_ports
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

wait_ready() {
  local seconds="$1"
  local i
  for ((i = 1; i <= seconds; i++)); do
    if curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:4000/api/health" 2>/dev/null \
      && curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:3456" 2>/dev/null; then
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

command -v curl >/dev/null || die "curl is required"

mkdir -p "$PREFIX"
tmp="$(mktemp -d)"

# Prefer a system Node when present; otherwise install after unpack.
try_existing_node && NODE_SOURCE="${NODE_SOURCE:-system}"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/xtrader-${platform}.tar.gz"
fi

if ! download_file "Downloading release ($platform)" "$url" "$tmp/xtrader.tgz"; then
  die "Download failed" "$url" "Check the network connection and release assets."
fi
size="$(du -h "$tmp/xtrader.tgz" 2>/dev/null | awk '{print $1}')"
finish_step "Downloaded ${size:-bundle}"

start_spin "Extracting files"
mkdir -p "$PREFIX/var"
if [[ -f "$PREFIX/.env" ]]; then
  cp "$PREFIX/.env" "$tmp/dotenv.bak"
fi
# Keep var/, .env, and any previously installed portable Node runtime.
find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name var ! -name .env ! -name runtime -exec rm -rf {} +
tar -xzf "$tmp/xtrader.tgz" -C "$PREFIX"
if [[ -f "$tmp/dotenv.bak" ]]; then
  mv "$tmp/dotenv.bak" "$PREFIX/.env"
fi
mkdir -p "$PREFIX/bin" "$PREFIX/var"
chmod +x "$PREFIX/install.sh" 2>/dev/null || true
chmod +x "$PREFIX/scripts/"*.sh 2>/dev/null || true
finish_step "Files installed"

start_spin "Checking Node.js"
ensure_node
finish_step "Node ready ($("$NODE_BIN" -v), via $NODE_SOURCE)"

write_launcher

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
stop_existing_ports

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

start_spin "Waiting for xTrader to respond"
warm=0
if wait_ready 45; then
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
  if wait_ready 45; then
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
  die "xTrader did not start" \
    "App log: $PREFIX/var/xtrader.log" \
    "Service log: $PREFIX/var/launchd.err.log"
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
