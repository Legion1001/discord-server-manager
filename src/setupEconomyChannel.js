import 'dotenv/config';

import path from 'path';
import fs from 'fs-extra';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { EconomyService } from './economyService.js';
import logger from './utils/logger.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PANELS_FILE = path.resolve(process.cwd(), 'data', 'economy', 'panels.json');
const CHANNEL_NAME = 'xp-coins';
const economy = new EconomyService(logger);

if (!TOKEN || !GUILD_ID) {
  logger.error('Missing DISCORD_BOT_TOKEN or GUILD_ID in .env');
  process.exit(1);
}

function buildPanelText(lines) {
  const now = Math.floor(Date.now() / 1000);
  return [
    '## Economy Panel',
    'Pouzi `/balance` pre svoj stav a `/convert_xp` na premenu XP na coiny.',
    '',
    '### Top (Coins)',
    lines.length > 0 ? lines.join('\n') : 'Zatial bez dat.',
    '',
    `Aktualizovane: <t:${now}:R>`
  ].join('\n');
}

async function loadPanels() {
  await fs.ensureDir(path.dirname(PANELS_FILE));
  if (!(await fs.pathExists(PANELS_FILE))) return {};
  return fs.readJson(PANELS_FILE);
}

async function savePanels(panels) {
  await fs.ensureDir(path.dirname(PANELS_FILE));
  await fs.writeJson(PANELS_FILE, panels, { spaces: 2 });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME
    );

    if (!channel) {
      channel = await guild.channels.create({
        name: CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: 'XP and coin economy panel',
        reason: 'Create economy visibility channel',
      });
      logger.success(`Created channel #${channel.name} (${channel.id})`);
    } else {
      logger.info(`Channel #${channel.name} already exists (${channel.id})`);
    }

    const rows = await economy.getLeaderboard(guild.id, 10, 'coins');
    const lines = rows.map(
      (entry, index) => `${index + 1}. <@${entry.userId}> - ${entry.coins} coins | ${entry.xp} XP`
    );
    const panelMessage = await channel.send(buildPanelText(lines));

    const panels = await loadPanels();
    panels[guild.id] = {
      channelId: channel.id,
      messageId: panelMessage.id,
      updatedAt: new Date().toISOString(),
    };
    await savePanels(panels);

    logger.success(`Economy panel configured in #${channel.name}`);
    await client.destroy();
    process.exit(0);
  } catch (err) {
    logger.error('Failed to setup economy channel', err);
    await client.destroy();
    process.exit(1);
  }
});

client.login(TOKEN).catch((err) => {
  logger.error('Login failed', err);
  process.exit(1);
});

