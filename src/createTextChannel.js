import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import logger from "./utils/logger.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_NAME = "f1-fans";

if (!TOKEN || !GUILD_ID) {
  logger.error("Missing DISCORD_BOT_TOKEN or GUILD_ID in .env");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  try {
    logger.success(`Logged in as ${client.user.tag}`);
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();

    const existing = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildText && ch.name === CHANNEL_NAME
    );

    if (existing) {
      logger.warn(`Text channel '${CHANNEL_NAME}' already exists (${existing.id})`);
      await client.destroy();
      process.exit(0);
    }

    const channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      reason: "Create requested text channel f1-fans",
    });

    logger.success(`Created text channel '${channel.name}' (${channel.id})`);
    await client.destroy();
    process.exit(0);
  } catch (err) {
    logger.error("Failed to create text channel", err);
    await client.destroy();
    process.exit(1);
  }
});

client.login(TOKEN).catch((err) => {
  logger.error("Login failed", err);
  process.exit(1);
});
