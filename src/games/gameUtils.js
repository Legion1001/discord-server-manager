import { EmbedBuilder } from 'discord.js';

export const GAME_COOLDOWN_MS = Number(process.env.GAME_COOLDOWN_SECONDS || 5) * 1000;

export class CooldownManager {
  constructor() {
    this.map = new Map();
  }

  check(guildId, userId, key, cooldownMs = GAME_COOLDOWN_MS) {
    const k = `${guildId}:${userId}:${key}`;
    const now = Date.now();
    const prev = this.map.get(k) || 0;
    const remaining = prev + cooldownMs - now;
    if (remaining > 0) return remaining;
    this.map.set(k, now);
    return 0;
  }
}

export function ensurePositiveBet(amount) {
  const bet = Math.floor(Number(amount || 0));
  if (!Number.isFinite(bet) || bet <= 0) return null;
  return bet;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function coins(n) {
  return `${Math.floor(Number(n || 0))} coins`;
}

export function gameEmbed(title, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
}

export function fmtCooldown(remainingMs) {
  const s = Math.ceil(remainingMs / 1000);
  return `${s}s`;
}

export function safeUserTag(user) {
  return user?.tag || user?.username || 'unknown-user';
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const safePayload = { ...payload };
    delete safePayload.ephemeral;
    delete safePayload.flags;
    return interaction.editReply(safePayload);
  }
  return interaction.reply(payload);
}
