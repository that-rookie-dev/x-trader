#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/bin/xtrader"
PID_FILE="$ROOT/var/xtrader.pid"
HEALTH_URL="http://127.0.0.1:4000/api/health"

is_running() {
  curl -fsS -o /dev/null --connect-timeout 1 "$HEALTH_URL" 2>/dev/null
}

wait_until() {
  local expected="$1"
  local i
  for ((i = 0; i < 30; i++)); do
    if [[ "$expected" == "up" ]] && is_running; then
      return 0
    fi
    if [[ "$expected" == "down" ]] && ! is_running; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_background() {
  mkdir -p "$ROOT/var"
  nohup "$RUNTIME" start >"$ROOT/var/xtrader.log" 2>&1 &
  echo $! >"$PID_FILE"
}

start_app() {
  if is_running; then
    echo "xTrader is already running."
    return
  fi

  local started=0
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    local uid plist label
    uid="$(id -u)"
    plist="$HOME/Library/LaunchAgents/com.xtrader.app.plist"
    label="gui/${uid}/com.xtrader.app"
    if [[ -f "$plist" ]]; then
      if ! launchctl print "$label" >/dev/null 2>&1; then
        launchctl bootstrap "gui/${uid}" "$plist" >/dev/null
      fi
      launchctl kickstart -k "$label" >/dev/null
      started=1
    fi
  elif command -v systemctl >/dev/null 2>&1 \
    && [[ -f "$HOME/.config/systemd/user/xtrader.service" ]]; then
    systemctl --user daemon-reload
    systemctl --user start xtrader
    started=1
  fi

  if [[ "$started" -eq 0 ]]; then
    start_background
  fi

  if wait_until up; then
    echo "xTrader started: http://localhost:3456"
  else
    echo "xTrader did not start. Check $ROOT/var for logs." >&2
    exit 1
  fi
}

stop_pid_process() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid command
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"$ROOT"* ]]; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
}

stop_app() {
  local stopped=0
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    local label
    label="gui/$(id -u)/com.xtrader.app"
    if launchctl print "$label" >/dev/null 2>&1; then
      launchctl bootout "$label" >/dev/null
      stopped=1
    fi
  fi

  if command -v systemctl >/dev/null 2>&1 \
    && [[ -f "$HOME/.config/systemd/user/xtrader.service" ]]; then
    systemctl --user stop xtrader
    stopped=1
  fi

  stop_pid_process

  if wait_until down; then
    if [[ "$stopped" -eq 0 ]]; then
      echo "xTrader is already stopped."
    else
      echo "xTrader stopped."
    fi
  else
    echo "xTrader is still running. Check $ROOT/var for logs." >&2
    exit 1
  fi
}

show_help() {
  cat <<'EOF'
xTrader commands
  xtrader start           Start xTrader in the background
  xtrader stop            Stop xTrader
  xtrader update          Install the latest release and restart
  xtrader status          Show whether xTrader is running
  xtrader session reset   Revoke app cookies and broker sessions
  xtrader uninstall       Remove the app and all local data
EOF
}

command="${1:-help}"
shift || true

case "$command" in
  start)
    start_app
    ;;
  stop)
    stop_app
    ;;
  status)
    if is_running; then
      echo "xTrader is running: http://localhost:3456"
    else
      echo "xTrader is stopped."
      exit 1
    fi
    ;;
  update|uninstall|session)
    exec "$RUNTIME" "$command" "$@"
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    exec "$RUNTIME" "$command" "$@"
    ;;
esac
