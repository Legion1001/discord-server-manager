import { EconomyService } from '../src/economyService.js';
import logger from '../src/utils/logger.js';
import { handleRoulette } from '../src/games/roulette.js';
import { handleBlackjack } from '../src/games/blackjack.js';

const economy = new EconomyService(logger);
const guildId = 'selftest-guild';
const userId = 'selftest-user';
await economy.adminGrant(guildId, userId, 0, 5000);

function mkInteraction(cmdName, options = {}) {
  const state = { deferred: false, replied: false, edits: [], replies: [] };
  const interaction = {
    commandName: cmdName,
    guildId,
    user: { id: userId, username: 'self', tag: 'self#0001' },
    deferred: false,
    replied: false,
    options: {
      getInteger(name, required = false) {
        const v = options[name];
        if (required && (v === undefined || v === null)) throw new Error(`Missing int ${name}`);
        return v ?? null;
      },
      getString(name, required = false) {
        const v = options[name];
        if (required && (v === undefined || v === null)) throw new Error(`Missing str ${name}`);
        return v ?? null;
      },
      getUser(name, required = false) {
        const v = options[name];
        if (required && !v) throw new Error(`Missing user ${name}`);
        return v ?? null;
      }
    },
    async deferReply() {
      this.deferred = true;
      state.deferred = true;
    },
    async reply(payload) {
      this.replied = true;
      state.replied = true;
      state.replies.push(payload);
      return payload;
    },
    async editReply(payload) {
      state.edits.push(payload);
      return payload;
    }
  };
  return { interaction, state };
}

{
  const { interaction, state } = mkInteraction('roulette', { suma: 50, typ: 'red' });
  await interaction.deferReply();
  await handleRoulette({ interaction, economy });
  if (state.edits.length === 0 && state.replies.length === 0) {
    throw new Error('roulette: no response payload');
  }
}

{
  const { interaction, state } = mkInteraction('blackjack', { suma: 50 });
  await interaction.deferReply();
  await handleBlackjack({ interaction, economy });
  if (state.edits.length === 0 && state.replies.length === 0) {
    throw new Error('blackjack: no response payload');
  }
}

const bal = await economy.getBalance(guildId, userId);
if (!Number.isFinite(bal.coins) || bal.coins < 0) {
  throw new Error('invalid balance after tests');
}

console.log('SELFTEST_OK', bal);
