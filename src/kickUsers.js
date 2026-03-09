import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import logger from "./utils/logger.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const targets = process.argv.slice(2);

if (!TOKEN || !GUILD_ID) {
  logger.error("Missing DISCORD_BOT_TOKEN or GUILD_ID in .env");
  process.exit(1);
}

if (targets.length === 0) {
  logger.error("No usernames provided. Usage: node src/kickUsers.js Milan Sanitkaml");
  process.exit(1);
}

function normalize(v) {
  return (v || "").trim().toLowerCase();
}

function matchMember(member, needle) {
  const n = normalize(needle);
  const user = member.user;
  const candidates = [
    user.username,
    user.globalName,
    member.displayName,
    member.nickname,
    user.tag,
  ].map(normalize);
  return candidates.includes(n);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", async () => {
  try {
    logger.success(`Logged in as ${client.user.tag}`);

    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();

    for (const target of targets) {
      const matches = guild.members.cache.filter((m) => matchMember(m, target));

      if (matches.size === 0) {
        logger.warn(`User '${target}' not found in guild.`);
        continue;
      }

      if (matches.size > 1) {
        const found = matches.map((m) => `${m.user.tag} (${m.id})`).join(", ");
        logger.warn(`User '${target}' matched multiple members: ${found}. Skipping.`);
        continue;
      }

      const member = matches.first();
      if (!member) {
        logger.warn(`Unexpected empty match for '${target}'. Skipping.`);
        continue;
      }

      if (!member.kickable) {
        logger.warn(`Cannot kick '${member.user.tag}' (${member.id}) due to role hierarchy/permissions.`);
        continue;
      }

      await member.kick(`Requested removal via server manager script. Target: ${target}`);
      logger.success(`Kicked '${member.user.tag}' (${member.id})`);
    }

    await client.destroy();
    process.exit(0);
  } catch (err) {
    logger.error("Failed to kick users", err);
    await client.destroy();
    process.exit(1);
  }
});

client.login(TOKEN).catch((err) => {
  logger.error("Login failed", err);
  process.exit(1);
});
