#!/usr/bin/env bash
set -euo pipefail

# xTrader installer (no Docker). Intended to be attached to GitHub Releases.
PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"
REPO="${XTRADER_REPO:-xtrader/xtrader}"
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
if command -v curl >/dev/null; then
  curl -fsSL "$url" -o "$tmp/xtrader.tgz" || echo "Release asset not published yet; using local workspace copy if present"
else
  echo "curl is required"; exit 1
fi

if [[ -f "$tmp/xtrader.tgz" ]] && gzip -t "$tmp/xtrader.tgz" 2>/dev/null; then
  tar -xzf "$tmp/xtrader.tgz" -C "$PREFIX"
fi

mkdir -p "$PREFIX/bin" "$PREFIX/var"
if [[ ! -f "$PREFIX/.env" ]]; then
  cat > "$PREFIX/.env" <<'EOF'
NODE_ENV=production
APP_NAME=xTrader
APP_ORIGIN=http://127.0.0.1:3000
APP_BIND=127.0.0.1
API_HOST=127.0.0.1
API_PORT=4000
KITE_REDIRECT_URL=http://127.0.0.1:3000/zerodha/callback
EXECUTION_MODE=PAPER
LIVE_TRADING_ENABLED=false
AUTONOMOUS_TRADING_ENABLED=false
EMBEDDED_POSTGRES_PORT=54329
EOF
  echo "SESSION_SECRET=$(openssl rand -base64 48)" >> "$PREFIX/.env"
  echo "TOKEN_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)" >> "$PREFIX/.env"
  echo "Created $PREFIX/.env — add KITE_API_KEY and KITE_API_SECRET"
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

echo "xTrader files are in $PREFIX"
echo "UI: http://127.0.0.1:3000"
