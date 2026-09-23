#!/usr/bin/env bash
set -euo pipefail

# xTrader installer (no Docker). Attached to GitHub Releases for that-rookie-dev/x-trader.
PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-that-rookie-dev/x-trader}"
VERSION="${XTRADER_VERSION:-latest}"

need_node() {
  if ! command -v node >/dev/null; then
    echo "Node.js 20.11+ is required (node not found on PATH)." >&2
    exit 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 20 ]]; then
    echo "Node.js 20.11+ is required (found $(node -v))." >&2
    exit 1
  fi
}

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
esac
case "$os" in
  linux) platform="linux-$arch" ;;
  darwin) platform="darwin-$arch" ;;
  *) echo "unsupported platform $os/$arch (need linux or macOS)"; exit 1 ;;
esac

need_node
mkdir -p "$PREFIX"
echo "Installing xTrader into $PREFIX ($platform)"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/xtrader-${platform}.tar.gz"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! command -v curl >/dev/null; then
  echo "curl is required"; exit 1
fi
if ! curl -fsSL "$url" -o "$tmp/xtrader.tgz"; then
  echo "Release asset not published yet at $url"
  echo "Build from source or set XTRADER_VERSION to a published tag (e.g. v0.1.0)."
  exit 1
fi

# Replace install tree but keep existing .env / var data
mkdir -p "$PREFIX/var"
if [[ -f "$PREFIX/.env" ]]; then
  cp "$PREFIX/.env" "$tmp/dotenv.bak"
fi
# Clear previous app files (keep var/)
find "$PREFIX" -mindepth 1 -maxdepth 1 ! -name var ! -name .env -exec rm -rf {} +
tar -xzf "$tmp/xtrader.tgz" -C "$PREFIX"
if [[ -f "$tmp/dotenv.bak" ]]; then
  mv "$tmp/dotenv.bak" "$PREFIX/.env"
fi

mkdir -p "$PREFIX/bin" "$PREFIX/var"
chmod +x "$PREFIX/bin/xtrader" "$PREFIX/install.sh" 2>/dev/null || true

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
EOF
  echo "SESSION_SECRET=$(openssl rand -base64 48)" >> "$PREFIX/.env"
  echo "TOKEN_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)" >> "$PREFIX/.env"
  echo "Created $PREFIX/.env — enter Kite API key/secret in the first-run UI"
fi

started=0
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
    echo "Started systemd user service: xtrader"
  else
    echo "Enable with: systemctl --user enable --now xtrader"
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
  launchctl bootout "gui/$(id -u)/com.xtrader.app" 2>/dev/null || true
  if launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || launchctl load -w "$plist" 2>/dev/null; then
    started=1
    echo "Loaded launchd agent: com.xtrader.app"
  else
    echo "Load with: launchctl load -w $plist"
  fi
fi

if [[ "$started" -eq 0 ]]; then
  echo "Starting in background…"
  nohup "$PREFIX/bin/xtrader" start >"$PREFIX/var/xtrader.log" 2>&1 &
  echo $! >"$PREFIX/var/xtrader.pid"
  started=1
fi

echo ""
echo "xTrader is installed in $PREFIX"
echo "Open http://localhost:3456"
echo "On first load, enter your Zerodha Kite API key and secret."
echo "In the Kite app, set redirect URL to: http://localhost:3456/zerodha/callback"
echo "CLI: $PREFIX/bin/xtrader start | session reset"
