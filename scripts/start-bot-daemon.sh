#!/bin/zsh
set -euo pipefail
BASE="/Users/peterthuransky/Documents/New project/linked in /outlook/discord/discord-server-manager"
NODE="/Users/peterthuransky/.local/node/node-v22.14.0-darwin-arm64/bin/node"
BOT="$BASE/src/bot.js"
OUT="$BASE/logs/cron-bot.out.log"
ERR="$BASE/logs/cron-bot.err.log"

cd "$BASE"
if pgrep -f "$BOT" >/dev/null 2>&1; then
  exit 0
fi
nohup "$NODE" "$BOT" >> "$OUT" 2>> "$ERR" < /dev/null &
