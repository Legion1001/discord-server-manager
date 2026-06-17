#!/bin/zsh
set -euo pipefail

BASE="/Users/peterthuransky/Documents/New project/linked in /outlook/discord/discord-server-manager"
PATH="/Users/peterthuransky/.local/node/node-v22.14.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PROJECT_ID="783de1c3-b344-4b21-bea7-9b95760c2932"
ENV_NAME="production"
SERVICE_NAME="discord-server-manager"

ts="$(date +%Y%m%d-%H%M%S)"
local_root="$BASE/data/cloud-snapshots/$ts"

mkdir -p "$local_root"

echo "Creating cloud snapshot: $ts"

# 1) Save a server-side snapshot copy in persistent volume
railway ssh --service "$SERVICE_NAME" --environment "$ENV_NAME" --project "$PROJECT_ID" \
  "mkdir -p /app/data/snapshots/$ts && cp -a /app/data/economy/. /app/data/snapshots/$ts/"

# 2) Pull all economy json files to local snapshot folder
files="$(railway ssh --service "$SERVICE_NAME" --environment "$ENV_NAME" --project "$PROJECT_ID" \
  "find /app/data/economy -maxdepth 1 -type f -name '*.json' | sort" | perl -pe 's/\e\[[0-9;]*m//g')"

if [[ -z "$files" ]]; then
  echo "No economy files found in cloud /app/data/economy"
  exit 1
fi

while IFS= read -r remote_file; do
  remote_file="$(printf '%s' "$remote_file" | tr -d '\r')"
  [[ -z "$remote_file" ]] && continue
  if [[ "$remote_file" != /app/data/economy/* ]]; then
    continue
  fi
  name="$(basename "$remote_file")"
  railway ssh --service "$SERVICE_NAME" --environment "$ENV_NAME" --project "$PROJECT_ID" \
    "base64 < '$remote_file'" | perl -pe 's/\e\[[0-9;]*m//g' | base64 -d > "$local_root/$name"
  echo "Saved $name"
done <<< "$files"

# 3) Save summary for quick integrity check
node -e "
const fs=require('fs');
const p='$local_root';
const files=fs.readdirSync(p).filter(f=>f.endsWith('.json')&&f!=='panels.json').sort();
const out=[];
for(const f of files){
  const d=JSON.parse(fs.readFileSync(p+'/'+f,'utf8'));
  const u=Object.values(d.users||{});
  out.push({
    guild:d.guildId||f.replace('.json',''),
    users:u.length,
    coins:u.reduce((a,x)=>a+Math.floor(Number(x.coins||0)),0),
    xp:u.reduce((a,x)=>a+Math.floor(Number(x.xp||0)),0)
  });
}
fs.writeFileSync(p+'/summary.json',JSON.stringify({createdAt:new Date().toISOString(),snapshots:out},null,2));
console.log('Summary written to '+p+'/summary.json');
"

echo "Cloud economy backup complete: $local_root"
