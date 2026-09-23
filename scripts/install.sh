#!/usr/bin/env bash
set -euo pipefail

# xTrader installer (no Docker). Attached to GitHub Releases for that-rookie-dev/x-trader.
PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-that-rookie-dev/x-trader}"
VERSION="${XTRADER_VERSION:-latest}"

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

mkdir -p "$PREFIX"
echo "Installing xTrader into $PREFIX ($platform)"

if [[ "$VERSION" == "latest" ]]; then
  url="https://github.com/${REPO}/releases/latest/download/xtrader-${platform}.tar.gz"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/xtrader-${platform}.tar.gz"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if command -v curl >/dev/null; then
  if ! curl -fsSL "$url" -o "$tmp/xtrader.tgz"; then
    echo "Release asset not published yet at $url"
    echo "Build from source or set XTRADER_VERSION to a published tag."
    exit 1
  fi
else
  echo "curl is required"; exit 1
fi

tar -xzf "$tmp/xtrader.tgz" -C "$PREFIX"

mkdir -p "$PREFIX/bin" "$PREFIX/var"
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
ExecStart=$PREFIX/bin/xtrader start
Restart=on-failure
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload || true
  echo "Enable with: systemctl --user enable --now xtrader"
elif [[ "$os" == "darwin" ]]; then
  plist="$HOME/Library/LaunchAgents/com.xtrader.app.plist"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.xtrader.app</string>
  <key>WorkingDirectory</key><string>$PREFIX</string>
  <key>ProgramArguments</key><array><string>$PREFIX/bin/xtrader</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
  echo "Load with: launchctl load $plist"
fi

echo ""
echo "xTrader is installed in $PREFIX"
echo "Open http://localhost:3456"
echo "On first load, enter your Zerodha Kite API key and secret."
echo "In the Kite app, set redirect URL to: http://localhost:3456/zerodha/callback"
