import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { EconomyService } from './economyService.js';
import logger from './utils/logger.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const NAME = process.argv[2];
const XP = Number(process.argv[3] || 0);
const COINS = Number(process.argv[4] || 0);
const economy = new EconomyService(logger);

if (!TOKEN || !GUILD_ID) {
  logger.error('Missing DISCORD_BOT_TOKEN or GUILD_ID in .env');
  process.exit(1);
}

if (!NAME) {
  logger.error('Usage: node src/grantByName.js <name> <xp> <coins>');
  process.exit(1);
}

function norm(s) {
  return (s || '').trim().toLowerCase();
}

function match(member, q) {
  const target = norm(q);
  const values = [
    member.user.username,
    member.user.globalName,
    member.displayName,
    member.nickname,
    member.user.tag
  ].map(norm);
  return values.includes(target);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();
    const matches = guild.members.cache.filter((m) => match(m, NAME));
    if (matches.size === 0) {
      logger.error(`User '${NAME}' not found in guild.`);
      await client.destroy();
      process.exit(1);
    }
    if (matches.size > 1) {
      const list = matches.map((m) => `${m.user.tag} (${m.id})`).join(', ');
      logger.error(`Multiple matches for '${NAME}': ${list}`);
      await client.destroy();
      process.exit(1);
    }

    const member = matches.first();
    const profile = await economy.adminGrant(guild.id, member.id, XP, COINS);
    logger.success(
      `Grant applied for ${member.user.tag} (${member.id}): XP=${profile.xp}, coins=${profile.coins}`
    );
    await client.destroy();
    process.exit(0);
  } catch (err) {
    logger.error('Grant failed', err);
    await client.destroy();
    process.exit(1);
  }
});

client.login(TOKEN).catch((err) => {
  logger.error('Login failed', err);
  process.exit(1);
});

