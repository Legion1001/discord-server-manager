# Discord Server Manager Bot

Node.js Discord bot for:

- server analysis/export
- XP and coin economy
- virtual-currency games system

## Features

- Connects to Discord using `discord.js`
- Reads server categories, channels, and roles
- Exports server structure into JSON files
- Awards XP for messages
- Awards XP for active voice presence
- Gives hourly coin income to all users
- Gives daily coin bonus at 03:00
- Starts every new user with 500 coins
- Converts XP to coins (safe non-destructive economy actions)
- Game commands with virtual currency:
  - `/coinflip`
  - `/dice`
  - `/blackjack`
  - `/roulette`
  - `/rps`
- Daily claim command: `/daily`
- Slash commands:
  - `/analyze_server`
  - `/export_structure`
  - `/propose_structure`
  - `/balance`
  - `/convert_xp`
- Leaderboard command: `/leaderboard`
- Uses JSON persistence with transaction-style guild lock for safer concurrent updates

## Project structure

```text
discord-server-manager
├── src
│   ├── bot.js
│   ├── analyzeServer.js
│   ├── economyService.js
│   ├── games
│   │   ├── index.js
│   │   ├── coinflip.js
│   │   ├── dice.js
│   │   ├── blackjack.js
│   │   ├── roulette.js
│   │   ├── rps.js
│   │   └── gameUtils.js
│   ├── commands
│   └── utils
│       └── economyHelper.js
├── data
│   └── economy
├── exports
├── .env.example
└── README.md
```

## 1) Configure environment

Copy `.env.example` to `.env` and fill values:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
GUILD_ID=optional_single_guild_id_for_command_registration
STARTING_COINS=500
HOURLY_COIN_AMOUNT=10
DAILY_COIN_AMOUNT=500
DAILY_COIN_HOUR=3
DAILY_CLAIM_AMOUNT=250
DAILY_CLAIM_COOLDOWN_HOURS=24
XP_PER_COIN=10
MESSAGE_XP=10
MESSAGE_BONUS_EVERY=10
MESSAGE_BONUS_XP=10
VOICE_XP_PER_HOUR=1000
GAME_COOLDOWN_SECONDS=5
```

Notes:

- `GUILD_ID` is optional. If empty, commands are registered for every guild where bot is present.
- Economy data is saved per guild in `data/economy/<guildId>.json`.

## 2) Run the bot

```bash
node src/bot.js
```

## Production (independent from Mac/Codex)

Run it on any Linux VPS or cloud VM with Docker.

1. Copy project to server
2. Create `.env` from `.env.example`
3. Start container:

```bash
docker compose up -d --build
```

4. Check logs:

```bash
docker compose logs -f
```

5. Auto-start after server reboot is handled by:

- Docker restart policy: `unless-stopped`

Important:

- Data is persistent in mounted folders: `./data`, `./exports`, `./logs`.
- Daily 03:00 bonus uses container timezone (`TZ=Europe/Bratislava` in `docker-compose.yml`).

## Easiest Cloud Deploy (Railway)

1. Push this project to a GitHub repository.
2. In Railway create a new project from that GitHub repo.
3. Add Railway variables:
   - `DISCORD_BOT_TOKEN`
   - `GUILD_ID`
   - optional economy tuning vars from `.env.example`
4. Deploy.

Notes:

- `railway.json` is included, so Railway uses the existing Dockerfile and starts with `node src/bot.js`.
- After deploy, check Railway logs for `Logged in as ...`.

## 3) Invite bot to your server

1. Open [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your app -> **OAuth2** -> **URL Generator**
3. Scopes: `bot`, `applications.commands`
4. Bot Permissions (minimum for analysis + XP/coins):
   - View Channels
   - Read Message History
   - Send Messages
   - Connect
   - Speak (optional, for full voice behavior)
5. In **Bot** tab enable Privileged Gateway Intents:
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT` (optional for richer spam filtering later)
5. Open generated URL and add bot to your server

## Economy behavior

- New user starts with `500` coins.
- Every hour all users get `+10` coins.
- Every day at `03:00` all users get `+500` coins.
- `/daily` gives claim reward with 24h cooldown.
- Message XP: `+10 XP` per message, plus `+10 XP` bonus every 10th message.
- Voice XP: `+1000 XP` per full hour in voice.
- Conversion: default `10 XP = 1 coin` using `/convert_xp`.

## Game commands

- `/coinflip suma strana`: heads/tails against bot, win pays `2x`.
- `/dice suma`: player roll vs bot roll; win `2x`, draw returns bet.
- `/blackjack suma`: interactive hit/stand buttons, dealer AI to 17+.
- `/roulette suma typ tip`: supports red/black/even/odd/number. Number uses high payout.
- `/rps @user suma`: player-vs-player with accept/decline and pick buttons.

All games:

- reject non-positive bets
- reject insufficient balance
- include per-user cooldown
- display bet, result, and new balance
- use economy lock to reduce race-condition risks

## Economy API

Economy is implemented in `src/economyService.js` with JSON storage in `data/economy/<guildId>.json`.

Core balance methods (used by game system):

- `getBalance(guildId, userId)`
- `addBalance(guildId, userId, amount)`
- `removeBalance(guildId, userId, amount)`
- `hasEnoughBalance(guildId, userId, amount)`

Additional game-safe methods:

- `resolveBet(...)`
- `reserveBet(...)`, `refundBet(...)`, `creditWinnings(...)`
- `reserveDuel(...)`, `resolveDuelWinner(...)`, `refundDuel(...)`
- `claimDaily(...)`

## Payout and cooldown tuning

Edit values in `.env`:

- `GAME_COOLDOWN_SECONDS`
- `XP_PER_COIN`
- `DAILY_CLAIM_AMOUNT`
- `DAILY_CLAIM_COOLDOWN_HOURS`
- other economy variables in `.env.example`

Game-specific logic and payout multipliers are in:

- `src/games/coinflip.js`
- `src/games/dice.js`
- `src/games/blackjack.js`
- `src/games/roulette.js`
- `src/games/rps.js`

## Output files

When you run analysis/export commands, JSON files are written to `exports/`:

- `server-structure-<guildId>-<timestamp>.json`
- `latest-server-structure-<guildId>.json`
- `proposed-structure-<guildId>-<timestamp>.json`

Economy state files are written to `data/economy/`.

## Next step readiness

The project is prepared for the next phase:

- channel/category reorganization
- category creation
- permission updates
- coin game commands (blackjack, bets, pvp)

Games already run on virtual currency only (no real money, no external gambling API).
