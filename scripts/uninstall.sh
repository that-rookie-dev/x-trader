#!/usr/bin/env bash
set -euo pipefail

# xTrader uninstall — stops services and deletes the install + all local data.
# Usage:
#   curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/uninstall.sh | bash
#   ~/.xtrader/uninstall.sh

PREFIX="${XTRADER_HOME:-$HOME/.xtrader}"

FANCY=0
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  FANCY=1
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[38;5;203m'
  C_GOLD=$'\033[38;5;220m'
  C_MUTED=$'\033[38;5;245m'
  C_GREEN=$'\033[38;5;114m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GOLD=""; C_MUTED=""; C_GREEN=""
fi

banner() {
  if [[ "$FANCY" -eq 1 ]]; then
    printf '%s\n' "${C_RED}${C_BOLD}"
    cat <<'ASCII'
   ╔══════════════════════════════════════════════════════╗
   ║   🐻  x T r a d e r   ·   C L O S I N G   B E L L   🐻  ║
   ║      unwind positions · clear vault · leave floor    ║
   ╚══════════════════════════════════════════════════════╝
ASCII
    printf '%s\n' "${C_RESET}"
  else
    echo "xTrader uninstall"
  fi
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -KILL $pids 2>/dev/null || true
    fi
  fi
}

confirm() {
  # Prefer the real terminal so `curl | bash` can still prompt.
  local tty=""
  if [[ -r /dev/tty ]]; then
    tty="/dev/tty"
  elif [[ -t 0 ]]; then
    tty=""
  else
    echo "No terminal available to confirm uninstall." >&2
    exit 1
  fi

  printf '%s\n' "${C_RED}${C_BOLD}This deletes the app AND all data under:${C_RESET}"
  echo "  $PREFIX"
  echo "  (Postgres, predictions, paper wallet, logs, .env / Kite vault)"
  echo
  if [[ -n "$tty" ]]; then
    printf '%s' "Type ${C_BOLD}uninstall${C_RESET} to confirm: " >"$tty"
    # shellcheck disable=SC2162
    read -r answer <"$tty" || true
  else
    printf '%s' "Type ${C_BOLD}uninstall${C_RESET} to confirm: "
    read -r answer || true
  fi
  if [[ "$answer" != "uninstall" ]]; then
    echo "Aborted."
    exit 1
  fi
}

banner
printf '%s\n' "${C_MUTED}  Target: ${C_BOLD}${PREFIX}${C_RESET}"
echo

if [[ ! -d "$PREFIX" ]] \
  && [[ ! -f "$HOME/Library/LaunchAgents/com.xtrader.app.plist" ]] \
  && [[ ! -f "$HOME/.config/systemd/user/xtrader.service" ]]; then
  printf '%s\n' "${C_GOLD}Nothing to uninstall — floor is already clear.${C_RESET}"
  exit 0
fi

confirm

echo "${C_MUTED}Stopping desk…${C_RESET}"

# launchd
if [[ "$(uname -s)" == "Darwin" ]]; then
  uid="$(id -u)"
  launchctl bootout "gui/${uid}/com.xtrader.app" 2>/dev/null || true
  launchctl unload -w "$HOME/Library/LaunchAgents/com.xtrader.app.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.xtrader.app.plist"
fi

# systemd user
if command -v systemctl >/dev/null; then
  systemctl --user disable --now xtrader 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/xtrader.service"
  systemctl --user daemon-reload 2>/dev/null || true
fi

# pid file
if [[ -f "$PREFIX/var/xtrader.pid" ]]; then
  pid="$(cat "$PREFIX/var/xtrader.pid" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$pid" 2>/dev/null || true
  fi
fi

# ports used by the desk / bundled postgres
kill_port 3456
kill_port 4000
kill_port 54329

# any leftover node running from this prefix
if command -v pgrep >/dev/null; then
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done < <(pgrep -f "$PREFIX/bin/xtrader|$PREFIX/apps/api/dist" 2>/dev/null || true)
  sleep 1
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    kill -KILL "$pid" 2>/dev/null || true
  done < <(pgrep -f "$PREFIX/bin/xtrader|$PREFIX/apps/api/dist" 2>/dev/null || true)
fi

echo "${C_MUTED}Wiping ${PREFIX}…${C_RESET}"
rm -rf "$PREFIX"

# stray logs from older layouts
rm -f /tmp/xtrader*.log 2>/dev/null || true

echo
if [[ "$FANCY" -eq 1 ]]; then
  cat <<EOF
${C_GREEN}${C_BOLD}   ▼ CLOSED  ·  UNINSTALL COMPLETE${C_RESET}
${C_MUTED}   App, vault, and local market data are gone.
   Re-enter anytime:${C_RESET}
${C_GOLD}   curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/install.sh | bash${C_RESET}
EOF
else
  echo "xTrader uninstalled. Removed $PREFIX"
fi
