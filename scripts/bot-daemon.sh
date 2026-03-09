#!/usr/bin/env zsh
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$ROOT_DIR/logs/bot-daemon.pid"
NODE_BIN_DEFAULT="$HOME/.local/node/node-v22.14.0-darwin-arm64/bin/node"
NODE_BIN="${NODE_BIN:-$NODE_BIN_DEFAULT}"

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

start_daemon() {
  if [ -f "$PID_FILE" ]; then
    local oldpid
    oldpid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      echo "Daemon already running (PID $oldpid)"
      exit 0
    fi
  fi

  nohup "$SCRIPT_PATH" run >> "$LOG_DIR/bot-daemon.log" 2>&1 < /dev/null &
  local daemon_pid=$!
  echo "$daemon_pid" > "$PID_FILE"
  echo "Daemon started (PID $daemon_pid)"
}

run_loop() {
  echo "[$(date -Iseconds)] daemon run loop started"
  while true; do
    if [ ! -x "$NODE_BIN" ]; then
      echo "[$(date -Iseconds)] node binary not found: $NODE_BIN"
      sleep 10
      continue
    fi

    echo "[$(date -Iseconds)] starting bot process"
    "$NODE_BIN" src/bot.js >> "$LOG_DIR/bot.log" 2>&1
    local code=$?
    echo "[$(date -Iseconds)] bot exited with code $code"
    sleep 5
  done
}

stop_daemon() {
  if [ -f "$PID_FILE" ]; then
    local daemon_pid
    daemon_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$daemon_pid" ] && kill -0 "$daemon_pid" 2>/dev/null; then
      kill "$daemon_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$daemon_pid" 2>/dev/null || true
      echo "Daemon stopped (PID $daemon_pid)"
    fi
    rm -f "$PID_FILE"
  else
    echo "Daemon is not running"
  fi

  pkill -f "node .*src/bot.js" 2>/dev/null || true
}

status_daemon() {
  local running="no"
  local daemon_pid=""

  if [ -f "$PID_FILE" ]; then
    daemon_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$daemon_pid" ] && kill -0 "$daemon_pid" 2>/dev/null; then
      running="yes"
    fi
  fi

  local bot_info
  bot_info="$(pgrep -fal "node .*src/bot.js" || true)"

  echo "daemon_running=$running"
  echo "daemon_pid=${daemon_pid:-none}"
  echo "bot_processes:"
  if [ -n "$bot_info" ]; then
    echo "$bot_info"
  else
    echo "none"
  fi
}

cmd="${1:-status}"
case "$cmd" in
  start)
    start_daemon
    ;;
  run)
    run_loop
    ;;
  stop)
    stop_daemon
    ;;
  restart)
    stop_daemon
    start_daemon
    ;;
  status)
    status_daemon
    ;;
  *)
    echo "Usage: $0 {start|run|stop|restart|status}"
    exit 1
    ;;
esac
