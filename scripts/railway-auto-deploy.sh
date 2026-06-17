#!/bin/zsh
set -u

BASE="/Users/peterthuransky/Documents/New project/linked in /outlook/discord/discord-server-manager"
PATH="/Users/peterthuransky/.local/node/node-v22.14.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PROJECT_ID="783de1c3-b344-4b21-bea7-9b95760c2932"
ENV_NAME="production"
SERVICE_NAME="discord-server-manager"
LOG="$BASE/logs/railway-auto-deploy.log"

cd "$BASE" || exit 1

token="$(grep '^DISCORD_BOT_TOKEN=' .env | head -n1 | cut -d'=' -f2-)"
guild="$(grep '^GUILD_ID=' .env | head -n1 | cut -d'=' -f2-)"

if [[ -z "$token" || -z "$guild" ]]; then
  echo "$(date -Iseconds) missing DISCORD_BOT_TOKEN or GUILD_ID in .env" >> "$LOG"
  exit 1
fi

echo "$(date -Iseconds) auto-deploy watcher started" >> "$LOG"

while true; do
  {
    echo "$(date -Iseconds) creating cloud economy backup before deploy"
    "$BASE/scripts/cloud-economy-backup.sh" || echo "$(date -Iseconds) warning: cloud backup failed"

    echo "$(date -Iseconds) deploy attempt"
    # Non-interactive deploy attempt. Fails fast while Railway incident is active.
    if CI=true railway up -c -p "$PROJECT_ID" -e "$ENV_NAME"; then
      echo "$(date -Iseconds) initial deploy accepted"
    else
      echo "$(date -Iseconds) initial deploy not ready"
    fi

    service_status="$(CI=true railway service status 2>&1 || true)"
    echo "$service_status"

    if echo "$service_status" | grep -qi "$SERVICE_NAME"; then
      echo "$(date -Iseconds) service found, setting variables"
      CI=true railway variable set --service "$SERVICE_NAME" \
        "DISCORD_BOT_TOKEN=$token" \
        "GUILD_ID=$guild" || true

      if CI=true railway up -c -p "$PROJECT_ID" -e "$ENV_NAME" -s "$SERVICE_NAME"; then
        echo "$(date -Iseconds) deploy completed"
        exit 0
      fi
    fi

    echo "$(date -Iseconds) retry in 120s"
  } >> "$LOG" 2>&1

  sleep 120
done
