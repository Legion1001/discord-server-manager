import 'dotenv/config';

import path from 'path';
import fs from 'fs-extra';
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

import { analyzeServer, buildProposedStructure } from './analyzeServer.js';
import logger from './utils/logger.js';
import { EconomyService } from './economyService.js';
import { gameCommandBuilders, handleGameButton, handleGameCommand } from './games/index.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID; // Optional for targeted registration.
const ADMIN_OWNER_USER_ID = process.env.ADMIN_OWNER_USER_ID || '679348790724919307';

if (!TOKEN) {
  logger.error('Missing DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
  setTimeout(() => process.exit(1), 250);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  setTimeout(() => process.exit(1), 250);
});

const EXPORT_DIR = path.resolve(process.cwd(), 'exports');
const VOICE_TICK_MS = 60 * 1000;
const PANEL_REFRESH_MS = Number(process.env.PANEL_REFRESH_MINUTES || 5) * 60 * 1000;
const PANELS_FILE = path.resolve(process.cwd(), 'data', 'economy', 'panels.json');
const economy = new EconomyService(logger);

function formatSlotKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}`;
}

function formatDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const baseCommandBuilders = [
  new SlashCommandBuilder()
    .setName('analyze_server')
    .setDescription('Analyze current server structure and export JSON.'),
  new SlashCommandBuilder()
    .setName('export_structure')
    .setDescription('Export current channel and role structure to JSON.'),
  new SlashCommandBuilder()
    .setName('propose_structure')
    .setDescription('Generate a non-destructive proposed server structure.'),
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show XP and coin balance.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Optional user to inspect').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('convert_xp')
    .setDescription('Convert XP to coins.')
    .addIntegerOption((option) =>
      option
        .setName('xp_amount')
        .setDescription('How much XP to convert')
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show top users by coins and XP.'),
  new SlashCommandBuilder()
    .setName('set_economy_channel')
    .setDescription('Set channel where economy leaderboard panel is auto-updated.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Target text channel (default: current channel)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('transfer_coins')
    .setDescription('Transfer coins to another user.')
    .addUserOption((option) =>
      option.setName('user').setDescription('User who receives coins').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('Amount of coins to transfer').setRequired(true).setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('admin_grant')
    .setDescription('Admin: grant XP and/or coins to one user or all users.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('scope')
        .setDescription('Grant target scope')
        .setRequired(true)
        .addChoices(
          { name: 'user', value: 'user' },
          { name: 'all', value: 'all' }
        )
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('Target user (required for scope=user)').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('xp').setDescription('XP delta to add').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('coins').setDescription('Coin delta to add').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('admin_take')
    .setDescription('Owner only: remove coins from one user or all users.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('scope')
        .setDescription('Take coins from one user or all')
        .setRequired(true)
        .addChoices(
          { name: 'user', value: 'user' },
          { name: 'all', value: 'all' }
        )
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('Target user (required for scope=user)').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('coins').setDescription('Coins to remove').setRequired(true).setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily coin reward.')
];

const commandDefs = [...baseCommandBuilders, ...gameCommandBuilders].map((c) => c.toJSON());

async function loadPanels() {
  await fs.ensureDir(path.dirname(PANELS_FILE));
  if (!(await fs.pathExists(PANELS_FILE))) return {};
  return fs.readJson(PANELS_FILE);
}

async function savePanels(panels) {
  await fs.ensureDir(path.dirname(PANELS_FILE));
  await fs.writeJson(PANELS_FILE, panels, { spaces: 2 });
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

async function refreshPanelForGuild(client, guildId) {
  const panels = await loadPanels();
  const panel = panels[guildId];
  if (!panel?.channelId) return;

  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(panel.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const leaderboard = await economy.getLeaderboard(guildId, 10, 'coins');
  const lines = leaderboard.map(
    (entry, index) => `${index + 1}. <@${entry.userId}> - ${entry.coins} coins | ${entry.xp} XP`
  );
  const text = buildPanelText(lines);

  let msg = null;
  if (panel.messageId) {
    msg = await channel.messages.fetch(panel.messageId).catch(() => null);
  }

  if (msg) {
    await msg.edit(text);
  } else {
    const sent = await channel.send(text);
    panel.messageId = sent.id;
    panels[guildId] = panel;
    await savePanels(panels);
  }
}

async function registerCommands(client) {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: commandDefs
    });
    logger.success(`Registered slash commands for guild ${GUILD_ID}`);
    return;
  }

  await client.guilds.fetch();
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: commandDefs
    });
    logger.success(`Registered slash commands for guild ${guild.id} (${guild.name})`);
  }
}

async function handleAnalyze(interaction, guild) {
  logger.info(`/analyze_server invoked by ${interaction.user.tag}`);
  const { structure, outPath, latestPath } = await analyzeServer(guild);
  await interaction.editReply(
    `Analysis complete. Channels: ${structure.summary.totalChannels}, Roles: ${structure.summary.totalRoles}.\nSaved:\n- ${outPath}\n- ${latestPath}`
  );
}

async function handleExport(interaction, guild) {
  logger.info(`/export_structure invoked by ${interaction.user.tag}`);
  const { outPath } = await analyzeServer(guild);
  await interaction.editReply(`Structure exported to:\n${outPath}`);
}

async function handlePropose(interaction, guild) {
  logger.info(`/propose_structure invoked by ${interaction.user.tag}`);

  const latestPath = path.join(EXPORT_DIR, `latest-server-structure-${guild.id}.json`);
  let structure;

  if (await fs.pathExists(latestPath)) {
    structure = await fs.readJson(latestPath);
  } else {
    const result = await analyzeServer(guild);
    structure = result.structure;
  }

  const proposal = buildProposedStructure(structure);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const proposalPath = path.join(EXPORT_DIR, `proposed-structure-${guild.id}-${ts}.json`);

  await fs.ensureDir(EXPORT_DIR);
  await fs.writeJson(proposalPath, proposal, { spaces: 2 });

  await interaction.editReply(
    `Proposal generated (no changes applied).\nSaved:\n${proposalPath}`
  );
}

async function handleBalance(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const profile = await economy.getProfile(guild.id, target.id);
  const cfg = economy.getConfig();
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Balance')
    .setDescription(`Account: <@${target.id}>`)
    .addFields(
      { name: 'Coins', value: `${profile.coins}`, inline: true },
      { name: 'XP', value: `${profile.xp}`, inline: true },
      { name: 'Conversion', value: `${cfg.XP_PER_COIN} XP = 1 coin`, inline: true }
    )
    .setFooter({
      text: `Msg +${cfg.MESSAGE_XP} XP (+${cfg.MESSAGE_BONUS_XP} each ${cfg.MESSAGE_BONUS_EVERY} msgs) | Voice +${cfg.VOICE_XP_PER_HOUR}/hour`
    })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleConvertXp(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const xpAmount = interaction.options.getInteger('xp_amount', true);
  const result = await economy.convertXpToCoins(guild.id, interaction.user.id, xpAmount);
  const cfg = economy.getConfig();

  if (!result.ok) {
    if (result.reason === 'not_enough_xp') {
      await interaction.editReply(
        `Not enough XP. You requested ${xpAmount} XP, but you currently have ${result.user.xp} XP.`
      );
      return;
    }

    if (result.reason === 'too_low_for_conversion') {
      await interaction.editReply(
        `Conversion too small. Minimum is ${cfg.XP_PER_COIN} XP to get 1 coin.`
      );
      return;
    }

    await interaction.editReply('Invalid amount.');
    return;
  }

  await interaction.editReply(
    `Conversion complete.\nConsumed XP: ${result.consumedXp}\nGained coins: ${result.gainedCoins}\nNew balance: XP ${result.user.xp}, coins ${result.user.coins}`
  );
}

async function handleLeaderboard(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const rows = await economy.getLeaderboard(guild.id, 10, 'coins');
  if (rows.length === 0) {
    await interaction.editReply('Leaderboard is empty for now.');
    return;
  }

  const text = rows
    .map((entry, index) => `${index + 1}. <@${entry.userId}> - ${entry.coins} coins | ${entry.xp} XP`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('Leaderboard')
    .setDescription(text)
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleDaily(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const result = await economy.claimDaily(guild.id, interaction.user.id);
  if (!result.ok) {
    if (result.reason === 'cooldown') {
      const seconds = Math.floor(result.retryAt / 1000);
      await interaction.editReply(
        `Daily already claimed. Try again <t:${seconds}:R>.`
      );
      return;
    }
    await interaction.editReply('Daily claim failed.');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Daily Reward')
    .setDescription(`You received **${result.amount}** coins.`)
    .addFields({ name: 'New balance', value: `${result.user.coins} coins`, inline: false })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function handleSetEconomyChannel(interaction, client) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const picked = interaction.options.getChannel('channel');
  const target = picked || interaction.channel;
  if (!target || target.type !== ChannelType.GuildText) {
    await interaction.editReply('Please choose a text channel.');
    return;
  }

  const panels = await loadPanels();
  panels[guild.id] = {
    channelId: target.id,
    messageId: null,
    updatedAt: new Date().toISOString(),
  };
  await savePanels(panels);
  await refreshPanelForGuild(client, guild.id);
  await interaction.editReply(`Economy panel channel set to <#${target.id}>.`);
}

async function handleTransferCoins(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  if (target.id === interaction.user.id) {
    await interaction.editReply('You cannot transfer coins to yourself.');
    return;
  }
  if (target.bot) {
    await interaction.editReply('You cannot transfer coins to a bot.');
    return;
  }

  const result = await economy.transferCoins(guild.id, interaction.user.id, target.id, amount);
  if (!result.ok) {
    if (result.reason === 'not_enough_coins') {
      await interaction.editReply(
        `Not enough coins. You have ${result.from.coins}, tried to transfer ${amount}.`
      );
      return;
    }
    await interaction.editReply('Invalid transfer amount.');
    return;
  }

  await interaction.editReply(
    `Transfer complete: ${result.amount} coins -> <@${target.id}>.\nYour balance: ${result.from.coins} coins\nReceiver balance: ${result.to.coins} coins`
  );
}

async function handleAdminGrant(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  const scope = interaction.options.getString('scope', true);
  const target = interaction.options.getUser('user');
  const xp = interaction.options.getInteger('xp') || 0;
  const coins = interaction.options.getInteger('coins') || 0;

  if (xp === 0 && coins === 0) {
    await interaction.editReply('Provide at least one non-zero value (`xp` or `coins`).');
    return;
  }

  const isOwnerAdmin = interaction.user.id === ADMIN_OWNER_USER_ID;
  if ((coins < 0 || xp < 0) && !isOwnerAdmin) {
    await interaction.editReply('Only the owner admin can apply negative admin grant values.');
    return;
  }

  if (scope === 'user') {
    if (!target) {
      await interaction.editReply('For `scope=user`, you must choose `user`.');
      return;
    }
    const profile = await economy.adminGrant(guild.id, target.id, xp, coins);
    await interaction.editReply(
      `Grant applied for <@${target.id}>.\nNew balance: XP ${profile.xp}, coins ${profile.coins}`
    );
    return;
  }

  if (scope === 'all') {
    await guild.members.fetch();
    const members = guild.members.cache.filter((m) => !m.user.bot);
    let updated = 0;
    for (const [, member] of members) {
      await economy.adminGrant(guild.id, member.id, xp, coins);
      updated += 1;
    }
    await interaction.editReply(
      `Bulk grant applied to ${updated} users.\nDelta: XP ${xp >= 0 ? '+' : ''}${xp}, coins ${coins >= 0 ? '+' : ''}${coins}`
    );
    return;
  }

  await interaction.editReply('Invalid scope.');
}

async function handleAdminTake(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command can only be used inside a server.');
    return;
  }

  if (interaction.user.id !== ADMIN_OWNER_USER_ID) {
    await interaction.editReply('Only owner admin can use this command.');
    return;
  }

  const scope = interaction.options.getString('scope', true);
  const target = interaction.options.getUser('user');
  const coinsToTake = interaction.options.getInteger('coins', true);

  if (scope === 'user') {
    if (!target) {
      await interaction.editReply('For `scope=user`, you must choose `user`.');
      return;
    }
    const profile = await economy.adminGrant(guild.id, target.id, 0, -coinsToTake);
    await interaction.editReply(
      `Removed ${coinsToTake} coins from <@${target.id}>.\nNew balance: XP ${profile.xp}, coins ${profile.coins}`
    );
    return;
  }

  if (scope === 'all') {
    await guild.members.fetch();
    const members = guild.members.cache.filter((m) => !m.user.bot);
    let updated = 0;
    for (const [, member] of members) {
      await economy.adminGrant(guild.id, member.id, 0, -coinsToTake);
      updated += 1;
    }
    await interaction.editReply(
      `Removed ${coinsToTake} coins from each of ${updated} users.`
    );
    return;
  }

  await interaction.editReply('Invalid scope.');
}

async function handleMessageXp(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  const result = await economy.awardMessageXp(message.guild.id, message.author.id);
  if (result.awarded > 0) {
    const bonusNote = result.bonusAward > 0 ? ` (bonus +${result.bonusAward})` : '';
    logger.info(
      `Awarded ${result.awarded} message XP${bonusNote} to ${message.author.tag} in ${message.guild.name}. XP=${result.xp}, Coins=${result.coins}, Messages=${result.messageCount}`
    );
  }
}

function isVoiceEligible(member) {
  if (!member || member.user.bot) return false;
  const channel = member.voice.channel;
  if (!channel) return false;
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return false;
  }
  if (member.voice.selfDeaf || member.voice.serverDeaf) return false;
  return true;
}

async function handleVoiceStateUpdate(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const guildId = newState.guild.id;

  const wasInVoice = Boolean(oldState.channelId);
  const isInVoice = Boolean(newState.channelId);

  if (!wasInVoice && isInVoice) {
    await economy.startVoiceSession(guildId, member.id, newState.channelId);
    logger.info(`Started voice session for ${member.user.tag} in ${newState.guild.name}`);
    return;
  }

  if (wasInVoice && !isInVoice) {
    await economy.stopVoiceSession(guildId, member.id);
    logger.info(`Stopped voice session for ${member.user.tag} in ${newState.guild.name}`);
    return;
  }

  if (wasInVoice && isInVoice && oldState.channelId !== newState.channelId) {
    await economy.startVoiceSession(guildId, member.id, newState.channelId);
    logger.info(`Moved voice session for ${member.user.tag} in ${newState.guild.name}`);
  }
}

function startVoiceXpTicker(client) {
  setInterval(async () => {
    try {
      await client.guilds.fetch();
      const guilds = [...client.guilds.cache.values()];

      for (const guild of guilds) {
        await guild.members.fetch();
        const eligible = guild.members.cache.filter((m) => isVoiceEligible(m));
        for (const [, member] of eligible) {
          const gained = await economy.tickVoiceXpForMember(guild.id, member.id);
          if (gained > 0) {
            logger.info(
              `Awarded ${gained} voice XP to ${member.user.tag} in ${guild.name}`
            );
          }
        }
      }
    } catch (err) {
      logger.error('Voice XP ticker failed', err);
    }
  }, VOICE_TICK_MS);
}

async function getHumanMemberIds(guild) {
  await guild.members.fetch();
  return guild.members.cache.filter((m) => !m.user.bot).map((m) => m.id);
}

async function applyHourlyCoins(client) {
  await client.guilds.fetch();
  const guilds = [...client.guilds.cache.values()];
  const slotKey = formatSlotKey(new Date());

  for (const guild of guilds) {
    const userIds = await getHumanMemberIds(guild);
    const result = await economy.awardHourlyCoins(guild.id, userIds, slotKey);
    if (result.applied) {
      logger.info(
        `Hourly coins applied in ${guild.name}: +${result.amountPerUser} to ${result.awardedUsers} users (slot ${slotKey})`
      );
    }
  }
}

async function applyDailyCoins(client) {
  await client.guilds.fetch();
  const guilds = [...client.guilds.cache.values()];
  const dateKey = formatDateKey(new Date());

  for (const guild of guilds) {
    const userIds = await getHumanMemberIds(guild);
    const result = await economy.awardDailyCoins(guild.id, userIds, dateKey);
    if (result.applied) {
      logger.info(
        `Daily coins applied in ${guild.name}: +${result.amountPerUser} to ${result.awardedUsers} users (date ${dateKey})`
      );
    }
  }
}

function scheduleHourlyCoins(client) {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  const delay = Math.max(1000, next.getTime() - now.getTime());

  setTimeout(async () => {
    try {
      await applyHourlyCoins(client);
    } catch (err) {
      logger.error('Hourly coin scheduler failed', err);
    }
    scheduleHourlyCoins(client);
  }, delay);
}

function scheduleDailyCoins(client) {
  const cfg = economy.getConfig();
  const now = new Date();
  const next = new Date(now);
  next.setHours(cfg.DAILY_COIN_HOUR, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = Math.max(1000, next.getTime() - now.getTime());

  setTimeout(async () => {
    try {
      await applyDailyCoins(client);
    } catch (err) {
      logger.error('Daily coin scheduler failed', err);
    }
    scheduleDailyCoins(client);
  }, delay);
}

function startEconomyPanelTicker(client) {
  setInterval(async () => {
    try {
      const panels = await loadPanels();
      const guildIds = Object.keys(panels);
      for (const guildId of guildIds) {
        await refreshPanelForGuild(client, guildId);
      }
    } catch (err) {
      logger.error('Economy panel ticker failed', err);
    }
  }, PANEL_REFRESH_MS);
}

async function bootstrap() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  client.once('clientReady', async () => {
    try {
      logger.success(`Logged in as ${client.user.tag}`);
      await registerCommands(client);
      startVoiceXpTicker(client);
      startEconomyPanelTicker(client);
      scheduleHourlyCoins(client);
      scheduleDailyCoins(client);
      const cfg = economy.getConfig();
      logger.info(
        `Economy config: start=${cfg.STARTING_COINS}, messageXP=${cfg.MESSAGE_XP}, msgBonus=+${cfg.MESSAGE_BONUS_XP}/${cfg.MESSAGE_BONUS_EVERY}msgs, voiceXP/hour=${cfg.VOICE_XP_PER_HOUR}, hourlyCoins=+${cfg.HOURLY_COIN_AMOUNT}, dailyCoins=+${cfg.DAILY_COIN_AMOUNT}@${String(cfg.DAILY_COIN_HOUR).padStart(2, '0')}:00, rate=${cfg.XP_PER_COIN} XP->1 coin`
      );
    } catch (err) {
      logger.error('Startup failed during command registration', err);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      try {
        const handled = await handleGameButton({ interaction, economy });
        if (!handled) {
          await interaction.reply({ content: 'Unknown button interaction.', ephemeral: true }).catch(() => {});
        }
      } catch (err) {
        logger.error('Button interaction failed', err);
        await interaction.reply({ content: 'Button action failed.', ephemeral: true }).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      logger.info(
        `Interaction received: /${interaction.commandName} user=${interaction.user.tag} guild=${interaction.guildId || 'n/a'}`
      );

      const gameCommands = new Set(['coinflip', 'dice', 'blackjack', 'roulette', 'rps', 'chicken']);
      if (gameCommands.has(interaction.commandName)) {
        await interaction.deferReply();
        const handled = await handleGameCommand({ interaction, economy });
        if (!handled) {
          await interaction.editReply({ content: 'Unknown game command.' });
        }
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guildId = interaction.guildId || GUILD_ID;
      if (!guildId) {
        await interaction.editReply('GUILD_ID is not configured and command has no guild context.');
        return;
      }

      const guild = await client.guilds.fetch(guildId);

      const heavyCommands = new Set([
        'analyze_server',
        'export_structure',
        'propose_structure'
      ]);
      if (heavyCommands.has(interaction.commandName)) {
        await guild.channels.fetch();
        await guild.roles.fetch();
      }

      if (interaction.commandName === 'analyze_server') {
        await handleAnalyze(interaction, guild);
        return;
      }

      if (interaction.commandName === 'export_structure') {
        await handleExport(interaction, guild);
        return;
      }

      if (interaction.commandName === 'propose_structure') {
        await handlePropose(interaction, guild);
        return;
      }

      if (interaction.commandName === 'balance') {
        await handleBalance(interaction);
        return;
      }

      if (interaction.commandName === 'convert_xp') {
        await handleConvertXp(interaction);
        return;
      }

      if (interaction.commandName === 'leaderboard') {
        await handleLeaderboard(interaction);
        return;
      }

      if (interaction.commandName === 'set_economy_channel') {
        await handleSetEconomyChannel(interaction, client);
        return;
      }

      if (interaction.commandName === 'transfer_coins') {
        await handleTransferCoins(interaction);
        return;
      }

      if (interaction.commandName === 'admin_grant') {
        await handleAdminGrant(interaction);
        return;
      }

      if (interaction.commandName === 'admin_take') {
        await handleAdminTake(interaction);
        return;
      }

      if (interaction.commandName === 'daily') {
        await handleDaily(interaction);
        return;
      }

      await interaction.editReply('Unknown command.');
    } catch (err) {
      logger.error(`Command ${interaction.commandName} failed`, err);
      const msg = 'Command failed. Check bot logs for details.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  client.on('messageCreate', async (message) => {
    try {
      await handleMessageXp(message);
    } catch (err) {
      logger.error('Message XP handling failed', err);
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      await handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      logger.error('Voice state handler failed', err);
    }
  });

  client.on('error', (err) => logger.error('Discord client error', err));
  client.on('shardError', (err) => logger.error('Discord shard error', err));
  client.on('shardDisconnect', (event, shardId) => {
    logger.warn(`Shard ${shardId} disconnected (code=${event?.code ?? 'n/a'})`);
  });
  client.on('shardResume', (shardId, replayedEvents) => {
    logger.info(`Shard ${shardId} resumed with ${replayedEvents} replayed events`);
  });
  client.on('warn', (msg) => logger.warn(msg));

  logger.info('Starting Discord Server Manager bot...');
  await client.login(TOKEN);
}

bootstrap().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
