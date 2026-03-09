import path from 'path';
import fs from 'fs-extra';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'economy');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULTS = {
  STARTING_COINS: Number(process.env.STARTING_COINS || 500),
  HOURLY_COIN_AMOUNT: Number(process.env.HOURLY_COIN_AMOUNT || 10),
  DAILY_COIN_AMOUNT: Number(process.env.DAILY_COIN_AMOUNT || 500),
  DAILY_COIN_HOUR: Number(process.env.DAILY_COIN_HOUR || 3),
  DAILY_CLAIM_AMOUNT: Number(process.env.DAILY_CLAIM_AMOUNT || 250),
  DAILY_CLAIM_COOLDOWN_MS: Number(process.env.DAILY_CLAIM_COOLDOWN_HOURS || 24) * HOUR_MS,
  FIRST_BET_BONUS: Number(process.env.FIRST_BET_BONUS || 10000),
  XP_PER_COIN: Number(process.env.XP_PER_COIN || 10),
  MESSAGE_XP: Number(process.env.MESSAGE_XP || 10),
  MESSAGE_BONUS_EVERY: Number(process.env.MESSAGE_BONUS_EVERY || 10),
  MESSAGE_BONUS_XP: Number(process.env.MESSAGE_BONUS_XP || 10),
  VOICE_XP_PER_HOUR: Number(process.env.VOICE_XP_PER_HOUR || 1000)
};

function nowMs() {
  return Date.now();
}

export class EconomyService {
  constructor(logger) {
    this.logger = logger;
    this.cache = new Map();
    this.writeLocks = new Map();
    this.guildLocks = new Map();
  }

  getConfig() {
    return { ...DEFAULTS };
  }

  guildPath(guildId) {
    return path.join(DATA_DIR, `${guildId}.json`);
  }

  async loadGuild(guildId) {
    if (this.cache.has(guildId)) return this.cache.get(guildId);

    await fs.ensureDir(DATA_DIR);
    const file = this.guildPath(guildId);
    let data;

    if (await fs.pathExists(file)) {
      data = await fs.readJson(file);
    } else {
      data = {
        guildId,
        createdAt: new Date().toISOString(),
        users: {},
        grants: { hourly: {}, daily: {} }
      };
      await fs.writeJson(file, data, { spaces: 2 });
    }

    if (!data.users) data.users = {};
    if (!data.grants) data.grants = { hourly: {}, daily: {} };
    if (!data.grants.hourly) data.grants.hourly = {};
    if (!data.grants.daily) data.grants.daily = {};

    this.cache.set(guildId, data);
    return data;
  }

  ensureUser(guildData, userId) {
    if (!guildData.users[userId]) {
      const now = nowMs();
      guildData.users[userId] = {
        userId,
        xp: 0,
        coins: DEFAULTS.STARTING_COINS,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        voiceSession: null,
        dailyClaimLastAt: 0,
        firstBetBonusClaimed: false
      };
    }
    return guildData.users[userId];
  }

  _applyFirstBetBonus(user) {
    if (user.firstBetBonusClaimed) return 0;
    const bonus = Math.max(0, Math.floor(Number(DEFAULTS.FIRST_BET_BONUS || 0)));
    user.firstBetBonusClaimed = true;
    if (bonus > 0) {
      user.coins += bonus;
    }
    this._touch(user);
    return bonus;
  }

  async saveGuild(guildId) {
    const data = this.cache.get(guildId);
    if (!data) return;

    const current = this.writeLocks.get(guildId) || Promise.resolve();
    const next = current.then(async () => {
      const file = this.guildPath(guildId);
      await fs.ensureDir(DATA_DIR);
      await fs.writeJson(file, data, { spaces: 2 });
    });
    this.writeLocks.set(guildId, next.catch(() => {}));
    await next;
  }

  async withGuildLock(guildId, fn) {
    const prev = this.guildLocks.get(guildId) || Promise.resolve();
    const next = prev.then(async () => fn());
    this.guildLocks.set(guildId, next.catch(() => {}));
    return next;
  }

  async mutateGuild(guildId, mutator) {
    return this.withGuildLock(guildId, async () => {
      const guild = await this.loadGuild(guildId);
      const result = await mutator(guild);
      await this.saveGuild(guildId);
      return result;
    });
  }

  _touch(user) {
    user.updatedAt = nowMs();
  }

  async getProfile(guildId, userId) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      this._touch(user);
      return { ...user };
    });
  }

  async getBalance(guildId, userId) {
    const profile = await this.getProfile(guildId, userId);
    return { coins: profile.coins, xp: profile.xp };
  }

  async addBalance(guildId, userId, amount) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const safeAmount = Math.floor(Number(amount || 0));
      if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return { ok: false, reason: 'invalid_amount', balance: user.coins };
      }
      user.coins += safeAmount;
      this._touch(user);
      return { ok: true, balance: user.coins, amount: safeAmount };
    });
  }

  async removeBalance(guildId, userId, amount) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const safeAmount = Math.floor(Number(amount || 0));
      if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return { ok: false, reason: 'invalid_amount', balance: user.coins };
      }
      if (user.coins < safeAmount) {
        return { ok: false, reason: 'not_enough_coins', balance: user.coins };
      }
      user.coins -= safeAmount;
      this._touch(user);
      return { ok: true, balance: user.coins, amount: safeAmount };
    });
  }

  async hasEnoughBalance(guildId, userId, amount) {
    const safeAmount = Math.floor(Number(amount || 0));
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) return false;
    const balance = await this.getBalance(guildId, userId);
    return balance.coins >= safeAmount;
  }

  async resolveBet(guildId, userId, betAmount, multiplier) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const bet = Math.floor(Number(betAmount || 0));
      const mult = Number(multiplier || 0);
      if (!Number.isFinite(bet) || bet <= 0 || !Number.isFinite(mult) || mult < 0) {
        return { ok: false, reason: 'invalid_input', user: { ...user } };
      }

      const firstBetBonus = this._applyFirstBetBonus(user);
      if (user.coins < bet) {
        return { ok: false, reason: 'not_enough_coins', user: { ...user } };
      }

      user.coins -= bet;
      const payout = Math.floor(bet * mult);
      if (payout > 0) user.coins += payout;
      this._touch(user);
      return {
        ok: true,
        bet,
        payout,
        firstBetBonus,
        net: payout - bet,
        user: { ...user }
      };
    });
  }

  async reserveBet(guildId, userId, amount) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const safeAmount = Math.floor(Number(amount || 0));
      if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return { ok: false, reason: 'invalid_amount', balance: user.coins };
      }

      const firstBetBonus = this._applyFirstBetBonus(user);
      if (user.coins < safeAmount) {
        return { ok: false, reason: 'not_enough_coins', balance: user.coins };
      }
      user.coins -= safeAmount;
      this._touch(user);
      return { ok: true, balance: user.coins, amount: safeAmount, firstBetBonus };
    });
  }

  async refundBet(guildId, userId, amount) {
    return this.addBalance(guildId, userId, amount);
  }

  async creditWinnings(guildId, userId, amount) {
    return this.addBalance(guildId, userId, amount);
  }

  async reserveDuel(guildId, userAId, userBId, amount) {
    return this.mutateGuild(guildId, async (guild) => {
      const a = this.ensureUser(guild, userAId);
      const b = this.ensureUser(guild, userBId);
      const bet = Math.floor(Number(amount || 0));
      if (!Number.isFinite(bet) || bet <= 0) {
        return { ok: false, reason: 'invalid_amount', a: { ...a }, b: { ...b } };
      }

      const firstBetBonusA = this._applyFirstBetBonus(a);
      const firstBetBonusB = this._applyFirstBetBonus(b);
      if (a.coins < bet) {
        return {
          ok: false,
          reason: 'a_not_enough',
          a: { ...a },
          b: { ...b },
          firstBetBonusA,
          firstBetBonusB
        };
      }
      if (b.coins < bet) {
        return {
          ok: false,
          reason: 'b_not_enough',
          a: { ...a },
          b: { ...b },
          firstBetBonusA,
          firstBetBonusB
        };
      }
      a.coins -= bet;
      b.coins -= bet;
      this._touch(a);
      this._touch(b);
      return { ok: true, bet, a: { ...a }, b: { ...b }, firstBetBonusA, firstBetBonusB };
    });
  }

  async resolveDuelWinner(guildId, winnerId, amountPerPlayer) {
    return this.addBalance(guildId, winnerId, Math.floor(Number(amountPerPlayer || 0)) * 3);
  }

  async refundDuel(guildId, userAId, userBId, amountPerPlayer) {
    const bet = Math.floor(Number(amountPerPlayer || 0));
    if (!Number.isFinite(bet) || bet <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }
    return this.mutateGuild(guildId, async (guild) => {
      const a = this.ensureUser(guild, userAId);
      const b = this.ensureUser(guild, userBId);
      a.coins += bet;
      b.coins += bet;
      this._touch(a);
      this._touch(b);
      return { ok: true, a: { ...a }, b: { ...b }, bet };
    });
  }

  async claimDaily(guildId, userId) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const now = nowMs();
      const nextAt = (user.dailyClaimLastAt || 0) + DEFAULTS.DAILY_CLAIM_COOLDOWN_MS;
      if (now < nextAt) {
        return {
          ok: false,
          reason: 'cooldown',
          retryAt: nextAt,
          user: { ...user }
        };
      }

      user.dailyClaimLastAt = now;
      user.coins += DEFAULTS.DAILY_CLAIM_AMOUNT;
      this._touch(user);
      return {
        ok: true,
        amount: DEFAULTS.DAILY_CLAIM_AMOUNT,
        nextAt: now + DEFAULTS.DAILY_CLAIM_COOLDOWN_MS,
        user: { ...user }
      };
    });
  }

  async awardMessageXp(guildId, userId) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      user.messageCount = (user.messageCount || 0) + 1;

      let gained = DEFAULTS.MESSAGE_XP;
      const bonusEvery = Math.max(1, DEFAULTS.MESSAGE_BONUS_EVERY);
      if (user.messageCount % bonusEvery === 0) {
        gained += DEFAULTS.MESSAGE_BONUS_XP;
      }
      user.xp += gained;
      this._touch(user);

      return {
        awarded: gained,
        baseAward: DEFAULTS.MESSAGE_XP,
        bonusAward: gained - DEFAULTS.MESSAGE_XP,
        messageCount: user.messageCount,
        xp: user.xp,
        coins: user.coins
      };
    });
  }

  async startVoiceSession(guildId, userId, channelId) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const now = nowMs();
      const prev = user.voiceSession;

      user.voiceSession = {
        channelId,
        joinedAt: prev?.joinedAt || now,
        lastHourlyAwardAt: prev?.lastHourlyAwardAt || now
      };
      this._touch(user);
      return { ...user.voiceSession };
    });
  }

  _applyVoiceHourlyXp(user, at = nowMs()) {
    if (!user.voiceSession?.lastHourlyAwardAt) return 0;
    const elapsed = at - user.voiceSession.lastHourlyAwardAt;
    if (elapsed < HOUR_MS) return 0;

    const fullHours = Math.floor(elapsed / HOUR_MS);
    const gained = fullHours * DEFAULTS.VOICE_XP_PER_HOUR;
    user.xp += gained;
    user.voiceSession.lastHourlyAwardAt += fullHours * HOUR_MS;
    return gained;
  }

  async stopVoiceSession(guildId, userId) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const gained = this._applyVoiceHourlyXp(user, nowMs());
      user.voiceSession = null;
      this._touch(user);
      return gained;
    });
  }

  async tickVoiceXpForMember(guildId, userId) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const gained = this._applyVoiceHourlyXp(user, nowMs());
      this._touch(user);
      return gained;
    });
  }

  async convertXpToCoins(guildId, userId, xpAmount) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const safeAmount = Math.floor(Number(xpAmount || 0));
      if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return { ok: false, reason: 'invalid_amount', user: { ...user } };
      }

      if (user.xp < safeAmount) {
        return { ok: false, reason: 'not_enough_xp', user: { ...user } };
      }

      const coins = Math.floor(safeAmount / DEFAULTS.XP_PER_COIN);
      if (coins <= 0) {
        return { ok: false, reason: 'too_low_for_conversion', user: { ...user } };
      }

      const consumedXp = coins * DEFAULTS.XP_PER_COIN;
      user.xp -= consumedXp;
      user.coins += coins;
      this._touch(user);

      return {
        ok: true,
        consumedXp,
        gainedCoins: coins,
        user: { ...user }
      };
    });
  }

  async getLeaderboard(guildId, limit = 10, sortBy = 'coins') {
    const guild = await this.loadGuild(guildId);
    const users = Object.values(guild.users || {});
    const key = sortBy === 'xp' ? 'xp' : 'coins';

    return users
      .sort((a, b) => {
        if (b[key] !== a[key]) return b[key] - a[key];
        return b.xp - a.xp;
      })
      .slice(0, Math.max(1, limit))
      .map((u) => ({ userId: u.userId, xp: u.xp, coins: u.coins }));
  }

  async adminGrant(guildId, userId, xpDelta = 0, coinDelta = 0) {
    return this.mutateGuild(guildId, async (guild) => {
      const user = this.ensureUser(guild, userId);
      const xp = Math.floor(Number(xpDelta || 0));
      const coins = Math.floor(Number(coinDelta || 0));

      if (Number.isFinite(xp)) user.xp = Math.max(0, user.xp + xp);
      if (Number.isFinite(coins)) user.coins = Math.max(0, user.coins + coins);
      this._touch(user);
      return { ...user };
    });
  }

  async transferCoins(guildId, fromUserId, toUserId, amount) {
    return this.mutateGuild(guildId, async (guild) => {
      const from = this.ensureUser(guild, fromUserId);
      const to = this.ensureUser(guild, toUserId);

      const safeAmount = Math.floor(Number(amount || 0));
      if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return { ok: false, reason: 'invalid_amount', from: { ...from }, to: { ...to } };
      }
      if (from.coins < safeAmount) {
        return { ok: false, reason: 'not_enough_coins', from: { ...from }, to: { ...to } };
      }

      from.coins -= safeAmount;
      to.coins += safeAmount;
      this._touch(from);
      this._touch(to);
      return { ok: true, amount: safeAmount, from: { ...from }, to: { ...to } };
    });
  }

  async ensureUsers(guildId, userIds = []) {
    return this.mutateGuild(guildId, async (guild) => {
      for (const userId of userIds) this.ensureUser(guild, userId);
      return Object.keys(guild.users || {}).length;
    });
  }

  _trimGrantMap(map, maxEntries = 72) {
    const keys = Object.keys(map || {}).sort();
    if (keys.length <= maxEntries) return;
    const toRemove = keys.slice(0, keys.length - maxEntries);
    for (const key of toRemove) delete map[key];
  }

  async awardHourlyCoins(guildId, userIds, slotKey) {
    return this.mutateGuild(guildId, async (guild) => {
      for (const userId of userIds) this.ensureUser(guild, userId);

      if (guild.grants.hourly[slotKey]) {
        return { applied: false, awardedUsers: 0, amountPerUser: DEFAULTS.HOURLY_COIN_AMOUNT };
      }

      let awardedUsers = 0;
      for (const userId of userIds) {
        const user = this.ensureUser(guild, userId);
        user.coins += DEFAULTS.HOURLY_COIN_AMOUNT;
        this._touch(user);
        awardedUsers += 1;
      }
      guild.grants.hourly[slotKey] = new Date().toISOString();
      this._trimGrantMap(guild.grants.hourly, 72);
      return { applied: true, awardedUsers, amountPerUser: DEFAULTS.HOURLY_COIN_AMOUNT };
    });
  }

  async awardDailyCoins(guildId, userIds, dateKey) {
    return this.mutateGuild(guildId, async (guild) => {
      for (const userId of userIds) this.ensureUser(guild, userId);

      if (guild.grants.daily[dateKey]) {
        return { applied: false, awardedUsers: 0, amountPerUser: DEFAULTS.DAILY_COIN_AMOUNT };
      }

      let awardedUsers = 0;
      for (const userId of userIds) {
        const user = this.ensureUser(guild, userId);
        user.coins += DEFAULTS.DAILY_COIN_AMOUNT;
        this._touch(user);
        awardedUsers += 1;
      }
      guild.grants.daily[dateKey] = new Date().toISOString();
      this._trimGrantMap(guild.grants.daily, 60);
      return { applied: true, awardedUsers, amountPerUser: DEFAULTS.DAILY_COIN_AMOUNT };
    });
  }

  async importUsers(guildId, users) {
    return this.mutateGuild(guildId, async (guild) => {
      for (const user of users) {
        if (!user?.id) continue;
        this.ensureUser(guild, user.id);
      }
      return Object.keys(guild.users).length;
    });
  }

  msToDuration(ms) {
    const safe = Math.max(0, ms);
    const hours = Math.floor(safe / HOUR_MS);
    const minutes = Math.floor((safe % HOUR_MS) / (60 * 1000));
    return { hours, minutes };
  }

  nextDailyResetFrom(lastAt) {
    const next = (lastAt || 0) + DAY_MS;
    return next;
  }
}
