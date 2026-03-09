import path from 'path';
import fs from 'fs-extra';
import { ChannelType } from 'discord.js';

const OUTPUT_DIR = path.resolve(process.cwd(), 'exports');

function channelTypeName(type) {
  const map = {
    [ChannelType.GuildText]: 'text',
    [ChannelType.GuildVoice]: 'voice',
    [ChannelType.GuildCategory]: 'category',
    [ChannelType.GuildAnnouncement]: 'announcement',
    [ChannelType.AnnouncementThread]: 'announcement_thread',
    [ChannelType.PublicThread]: 'public_thread',
    [ChannelType.PrivateThread]: 'private_thread',
    [ChannelType.GuildStageVoice]: 'stage_voice',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildMedia]: 'media'
  };

  return map[type] || `unknown_${type}`;
}

export async function analyzeServer(guild) {
  const channels = await guild.channels.fetch();
  const roles = await guild.roles.fetch();

  const categoryMap = new Map();
  const uncategorized = [];

  for (const [, channel] of channels) {
    if (!channel) continue;

    const channelData = {
      id: channel.id,
      name: channel.name,
      type: channelTypeName(channel.type),
      position: channel.rawPosition ?? channel.position ?? 0,
      parentId: channel.parentId || null,
      nsfw: channel.nsfw || false,
      topic: channel.topic || null
    };

    if (channel.type === ChannelType.GuildCategory) {
      categoryMap.set(channel.id, {
        id: channel.id,
        name: channel.name,
        position: channelData.position,
        channels: []
      });
      continue;
    }

    if (channel.parentId && categoryMap.has(channel.parentId)) {
      categoryMap.get(channel.parentId).channels.push(channelData);
    } else {
      uncategorized.push(channelData);
    }
  }

  for (const [, channel] of channels) {
    if (!channel) continue;
    if (channel.type !== ChannelType.GuildCategory) continue;

    const children = channels
      .filter((c) => c && c.parentId === channel.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: channelTypeName(c.type),
        position: c.rawPosition ?? c.position ?? 0,
        parentId: c.parentId || null,
        nsfw: c.nsfw || false,
        topic: c.topic || null
      }))
      .sort((a, b) => a.position - b.position);

    const cat = categoryMap.get(channel.id);
    if (cat) cat.channels = children;
  }

  const roleList = roles
    .filter((role) => role)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      hoist: role.hoist,
      mentionable: role.mentionable,
      managed: role.managed,
      position: role.position,
      permissions: role.permissions.toArray()
    }))
    .sort((a, b) => b.position - a.position);

  const structure = {
    generatedAt: new Date().toISOString(),
    guild: {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      verificationLevel: guild.verificationLevel,
      features: guild.features,
      preferredLocale: guild.preferredLocale
    },
    summary: {
      totalChannels: channels.size,
      totalRoles: roles.size,
      categoryCount: categoryMap.size,
      uncategorizedCount: uncategorized.length
    },
    categories: [...categoryMap.values()].sort((a, b) => a.position - b.position),
    uncategorized: uncategorized.sort((a, b) => a.position - b.position),
    roles: roleList
  };

  await fs.ensureDir(OUTPUT_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `server-structure-${guild.id}-${timestamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, `latest-server-structure-${guild.id}.json`);

  await fs.writeJson(outPath, structure, { spaces: 2 });
  await fs.writeJson(latestPath, structure, { spaces: 2 });

  return { structure, outPath, latestPath };
}

export function buildProposedStructure(structure) {
  const proposals = [];

  if (structure.summary.uncategorizedCount > 0) {
    proposals.push({
      action: 'create_category',
      name: 'General',
      reason: 'Move uncategorized channels into a clear entry category.',
      targetChannelCount: structure.summary.uncategorizedCount
    });
  }

  proposals.push({
    action: 'create_category',
    name: 'Information',
    reason: 'Central place for rules, announcements, and onboarding.',
    suggestedChannels: ['rules', 'announcements', 'welcome', 'faq']
  });

  proposals.push({
    action: 'create_category',
    name: 'Community',
    reason: 'Main interaction zone for text and voice activity.',
    suggestedChannels: ['general-chat', 'introductions', 'media', 'voice-lounge']
  });

  proposals.push({
    action: 'create_category',
    name: 'Support',
    reason: 'Separate troubleshooting and support requests from general chat.',
    suggestedChannels: ['help', 'tickets', 'bug-report']
  });

  return {
    generatedAt: new Date().toISOString(),
    guildId: structure.guild.id,
    guildName: structure.guild.name,
    currentSummary: structure.summary,
    proposals,
    note: 'This file is advisory only. No server changes are performed.'
  };
}
