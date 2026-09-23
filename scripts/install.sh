#!/usr/bin/env bash
set -euo pipefail

# xTrader installer — market-floor themed progress (bulls, bears, tape).
# Attached to GitHub Releases for that-rookie-dev/x-trader.

PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-that-rookie-dev/x-trader}"
VERSION="${XTRADER_VERSION:-latest}"

STEP=0
TOTAL_STEPS=6
SPIN_PID=""
FANCY=0

# ── theme ────────────────────────────────────────────────────────────────────
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  FANCY=1
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_GREEN=$'\033[38;5;114m'   # bull
  C_RED=$'\033[38;5;203m'     # bear
  C_GOLD=$'\033[38;5;220m'    # money / tape
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
  if [[ "$FANCY" -eq 1 ]]; then
    printf '%s\n' "${C_GOLD}${C_BOLD}"
    cat <<'ASCII'
   ╔══════════════════════════════════════════════════════╗
   ║                                                      ║
   ║   🐂  x T r a d e r   ·   O P E N I N G   B E L L   🐻  ║
   ║                                                      ║
   ║      ▲ NIFTY  ·  ₹ ₹ ₹  ·  tape rolling  ·  ▼ BANK   ║
   ║                                                      ║
   ╚══════════════════════════════════════════════════════╝
ASCII
    printf '%s\n' "${C_RESET}${C_MUTED}  personal F&O desk · analysis only · never places orders${C_RESET}"
    echo
  else
    echo "xTrader installer"
    echo
  fi
}

bar() {
  local pct="$1"
  local width=28
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  local i out=""
  for ((i = 0; i < filled; i++)); do out+="█"; done
  for ((i = 0; i < empty; i++)); do out+="░"; done
  printf '%s' "$out"
}

ticker_frame() {
  local n="$1"
  local frames=(
    "🐂  BULLS   ▲ ▲ ▲   ₹₹₹   tape ↑  "
    "  🐂 BULLS  ▲ ▲    ₹ ₹   tape ↑ "
    "🐻  BEARS   ▼ ▼ ▼   ₹₹₹   tape ↓  "
    "  🐻 BEARS  ▼ ▼    ₹ ₹   tape ↓ "
    "💰  MONEY   $ $ $   ₹₹₹   fill…  "
    "  💰 MONEY  ₹ ₹    $$$   fill… "
    "📈  CANDLE  ▲┃▼    OHLC   print "
    "  📉 CANDLE ┃▼▲    OHLC   print "
  )
  printf '%s' "${frames[$((n % ${#frames[@]}))]}"
}

stop_spin() {
  if [[ -n "${SPIN_PID:-}" ]] && kill -0 "$SPIN_PID" 2>/dev/null; then
    kill "$SPIN_PID" 2>/dev/null || true
    wait "$SPIN_PID" 2>/dev/null || true
  fi
  SPIN_PID=""
  if [[ "$FANCY" -eq 1 ]]; then
    printf '\r%s%s\n' "$C_CLEAR" "$C_RESET"
  fi
}

start_spin() {
  local label="$1"
  stop_spin
  [[ "$FANCY" -eq 1 ]] || { echo "… $label"; return; }
  printf '%s' "$HIDE_CUR"
  (
    local i=0
    while true; do
      local pct=$(( STEP * 100 / TOTAL_STEPS ))
      # nudge within the current step
      local jitter=$(( (i % 7) * 2 ))
      local show=$(( pct + jitter ))
      [[ "$show" -gt 99 ]] && show=99
      printf '\r%s%s[%s%s%s] %3d%%  %s%s%s  %s%s' \
        "$C_CLEAR" "$C_MUTED" "$C_GREEN" "$(bar "$show")" "$C_MUTED" "$show" \
        "$C_GOLD" "$(ticker_frame "$i")" "$C_RESET" \
        "$C_CYAN${C_DIM}${label}${C_RESET}"
      i=$((i + 1))
      sleep 0.12
    done
  ) &
  SPIN_PID=$!
}

finish_step() {
  local label="$1"
  local tone="${2:-bull}" # bull | bear | gold
  stop_spin
  STEP=$((STEP + 1))
  local pct=$(( STEP * 100 / TOTAL_STEPS ))
  local icon color
  case "$tone" in
    bear) icon="🐻"; color="$C_RED" ;;
    gold) icon="💰"; color="$C_GOLD" ;;
    *)    icon="🐂"; color="$C_GREEN" ;;
  esac
  if [[ "$FANCY" -eq 1 ]]; then
    printf '%s[%s%s%s] %3d%%  %s %s%s%s\n' \
      "$C_MUTED" "$C_GREEN" "$(bar "$pct")" "$C_MUTED" "$pct" \
      "$icon" "$color" "$label" "$C_RESET"
  else
    echo "[$STEP/$TOTAL_STEPS] $label"
  fi
}

die() {
  stop_spin
  printf '%s\n' "${C_RED}${C_BOLD}✗ $1${C_RESET}" >&2
  shift || true
  for line in "$@"; do
    printf '%s\n' "${C_MUTED}  $line${C_RESET}" >&2
  done
  exit 1
}

need_node() {
  if ! command -v node >/dev/null; then
    die "Node.js 20.11+ is required (node not found on PATH)."
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 20 ]]; then
    die "Node.js 20.11+ is required (found $(node -v))."
  fi
}

# ── detect platform ──────────────────────────────────────────────────────────
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

printf '%s\n' "${C_MUTED}  floor → ${C_BOLD}${PREFIX}${C_RESET}${C_MUTED}  ·  contract ${C_GOLD}${platform}${C_RESET}${C_MUTED}  ·  session ${C_CYAN}${VERSION}${C_RESET}"
echo

start_spin "checking Node.js + curl…"
need_node
command -v curl >/dev/null || die "curl is required"
finish_step "Pre-market checks cleared (Node $(node -v | tr -d v | cut -d. -f1)+)"

mkdir -p "$PREFIX"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/xtrader-${platform}.tar.gz"
fi

tmp="$(mktemp -d)"

# ── download with live progress ──────────────────────────────────────────────
start_spin "calling the exchange… downloading release"
if [[ "$FANCY" -eq 1 ]]; then
  # curl writes quietly while our ticker animates
  if ! curl -fL --retry 2 --connect-timeout 20 -o "$tmp/xtrader.tgz" "$url" 2>"$tmp/curl.err"; then
    stop_spin
    die "Release asset not on the tape yet" "$url" "Build from source or set XTRADER_VERSION to a published tag."
  fi
else
  if ! curl -fL --progress-bar --retry 2 -o "$tmp/xtrader.tgz" "$url"; then
    die "Release asset not published yet at $url"
  fi
fi
size="$(du -h "$tmp/xtrader.tgz" 2>/dev/null | awk '{print $1}')"
finish_step "Filled the book — downloaded ${size:-bundle}" "gold"

# ── unpack ───────────────────────────────────────────────────────────────────
start_spin "unpacking lots… clearing old positions"
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
chmod +x "$PREFIX/bin/xtrader" "$PREFIX/install.sh" 2>/dev/null || true
chmod +x "$PREFIX/scripts/"*.sh 2>/dev/null || true
finish_step "Positions rolled — files on disk"

# ── secrets ──────────────────────────────────────────────────────────────────
start_spin "minting session vault keys…"
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
  finish_step "Vault minted — Kite keys go in the first-run UI" "gold"
else
  finish_step "Existing vault kept (.env preserved)" "gold"
fi

# ── service / start ──────────────────────────────────────────────────────────
start_spin "ringing the opening bell…"
started=0
start_via_nohup() {
  mkdir -p "$PREFIX/var"
  # stop a previous background pid if present
  if [[ -f "$PREFIX/var/xtrader.pid" ]]; then
    old="$(cat "$PREFIX/var/xtrader.pid" 2>/dev/null || true)"
    if [[ -n "${old:-}" ]]; then
      kill -TERM "$old" 2>/dev/null || true
      sleep 1
      kill -KILL "$old" 2>/dev/null || true
    fi
  fi
  nohup env XTRADER_HOME="$PREFIX" DATA_DIR="$PREFIX/var" "$PREFIX/bin/xtrader" start \
    >"$PREFIX/var/xtrader.log" 2>&1 &
  echo $! >"$PREFIX/var/xtrader.pid"
  started=1
}

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
ExecStart=$PREFIX/bin/xtrader start
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload || true
  if systemctl --user enable --now xtrader 2>/dev/null; then
    started=1
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
    started=1
    launchctl kickstart -k "gui/${uid}/com.xtrader.app" 2>/dev/null || true
  fi
fi

# Always ensure a running process — service helpers sometimes no-op in restricted shells.
if [[ "$started" -eq 0 ]]; then
  start_via_nohup
fi
finish_step "Opening bell — desk process started" "bull"

# ── warm-up poll ─────────────────────────────────────────────────────────────
start_spin "waiting for first print on :3456…"
warm=0
for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:3456/" 2>/dev/null \
    || curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:4000/api/health" 2>/dev/null; then
    warm=1
    break
  fi
  sleep 1
done

# If launchd/systemd claimed start but nothing answers, fall back to nohup.
if [[ "$warm" -eq 0 ]]; then
  start_via_nohup
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:3456/" 2>/dev/null \
      || curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:4000/api/health" 2>/dev/null; then
      warm=1
      break
    fi
    sleep 1
  done
fi

if [[ "$warm" -eq 1 ]]; then
  finish_step "Market open — UI responding" "bull"
  # Auto-open the desk in the default browser
  if command -v open >/dev/null; then
    open "http://localhost:3456" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null; then
    xdg-open "http://localhost:3456" >/dev/null 2>&1 || true
  fi
else
  finish_step "Desk still booting — open http://localhost:3456 shortly" "bear"
fi

# Keep a local uninstall helper next to the install
if [[ -f "$PREFIX/scripts/uninstall.sh" ]]; then
  ln -sf "$PREFIX/scripts/uninstall.sh" "$PREFIX/uninstall.sh" 2>/dev/null || cp "$PREFIX/scripts/uninstall.sh" "$PREFIX/uninstall.sh"
  chmod +x "$PREFIX/uninstall.sh" "$PREFIX/scripts/uninstall.sh" 2>/dev/null || true
fi

# ── closing print ────────────────────────────────────────────────────────────
echo
if [[ "$FANCY" -eq 1 ]]; then
  cat <<EOF
${C_GREEN}${C_BOLD}   ▲ SETTLE  ·  INSTALL COMPLETE  ·  100%${C_RESET}
${C_MUTED}   ────────────────────────────────────────${C_RESET}
${C_GOLD}   💰  Open     ${C_BOLD}${C_CYAN}http://localhost:3456${C_RESET}
${C_MUTED}   🐂  Home     ${PREFIX}${C_RESET}
${C_MUTED}   🐻  CLI      ${PREFIX}/bin/xtrader start | update | session reset${C_RESET}
${C_MUTED}   🧹  Remove   ${PREFIX}/uninstall.sh   (or curl uninstall.sh | bash)${C_RESET}

${C_DIM}   First tick: paste Kite API key + secret in the UI.
   Redirect URL in Kite Connect:
   http://localhost:3456/zerodha/callback${C_RESET}
EOF
else
  echo "xTrader is installed in $PREFIX"
  echo "Open http://localhost:3456"
  echo "On first load, enter your Zerodha Kite API key and secret."
  echo "In the Kite app, set redirect URL to: http://localhost:3456/zerodha/callback"
  echo "CLI: $PREFIX/bin/xtrader start | update | session reset"
  echo "Uninstall: $PREFIX/uninstall.sh"
fi
