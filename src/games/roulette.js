import { SlashCommandBuilder } from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond, randomInt } from './gameUtils.js';

const cooldowns = new CooldownManager();
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function rouletteColor(num) {
  if (num === 0) return 'green';
  return RED_NUMBERS.has(num) ? 'red' : 'black';
}

export const rouletteCommand = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Roulette against bot.')
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1))
  .addStringOption((o) =>
    o
      .setName('typ')
      .setDescription('Bet type')
      .setRequired(true)
      .addChoices(
        { name: 'red', value: 'red' },
        { name: 'black', value: 'black' },
        { name: 'even', value: 'even' },
        { name: 'odd', value: 'odd' },
        { name: 'number', value: 'number' }
      )
  )
  .addIntegerOption((o) => o.setName('tip').setDescription('Number 0-36 (required for type=number)').setMinValue(0).setMaxValue(36).setRequired(false));

export async function handleRoulette({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));
  const type = interaction.options.getString('typ', true);
  const tip = interaction.options.getInteger('tip');
  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });

  if (type === 'number' && (tip === null || tip === undefined)) {
    return respond(interaction, { content: 'For type=number you must provide `tip` (0-36).', ephemeral: true });
  }

  const rem = cooldowns.check(guildId, interaction.user.id, 'roulette');
  if (rem > 0) return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });

  const hasEnough = await economy.hasEnoughBalance(guildId, interaction.user.id, bet);
  if (!hasEnough) return respond(interaction, { content: 'Not enough balance for this bet.', ephemeral: true });

  const spin = randomInt(0, 36);
  const color = rouletteColor(spin);
  let won = false;
  let multiplier = 0;

  if (type === 'red' || type === 'black') {
    won = color === type;
    multiplier = won ? 36 : 0;
  } else if (type === 'even' || type === 'odd') {
    if (spin !== 0) {
      won = type === 'even' ? spin % 2 === 0 : spin % 2 === 1;
    }
    multiplier = won ? 36 : 0;
  } else if (type === 'number') {
    won = spin === tip;
    multiplier = won ? 36 : 0;
  }

  const result = await economy.resolveBet(guildId, interaction.user.id, bet, multiplier);
  if (!result.ok) return respond(interaction, { content: 'Bet failed, try again.', ephemeral: true });

  const embed = gameEmbed('Roulette', won ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Bet', value: coins(bet), inline: true },
      { name: 'Type', value: type, inline: true },
      { name: 'Tip', value: type === 'number' ? String(tip) : '-', inline: true },
      { name: 'Spin', value: `${spin} (${color})`, inline: true },
      { name: 'Outcome', value: won ? 'Win' : 'Lose', inline: true },
      { name: 'Change', value: result.net >= 0 ? `+${coins(result.net)}` : `-${coins(Math.abs(result.net))}`, inline: true },
      { name: 'New balance', value: coins(result.user.coins), inline: false }
    );

  return respond(interaction, { embeds: [embed] });
}
