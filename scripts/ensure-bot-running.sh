#!/bin/zsh
set -euo pipefail
BASE="/Users/peterthuransky/Documents/New project/linked in /outlook/discord/discord-server-manager"
BOT="$BASE/src/bot.js"
if pgrep -f "$BOT" >/dev/null 2>&1; then
  exit 0
fi
"$BASE/scripts/start-bot-daemon.sh"
