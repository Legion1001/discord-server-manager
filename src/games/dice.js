import { SlashCommandBuilder } from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond, randomInt } from './gameUtils.js';

const cooldowns = new CooldownManager();

export const diceCommand = new SlashCommandBuilder()
  .setName('dice')
  .setDescription('Dice duel against bot.')
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1));

export async function handleDice({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));
  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });

  const rem = cooldowns.check(guildId, interaction.user.id, 'dice');
  if (rem > 0) {
    return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });
  }

  const hasEnough = await economy.hasEnoughBalance(guildId, interaction.user.id, bet);
  if (!hasEnough) {
    return respond(interaction, { content: 'Not enough balance for this bet.', ephemeral: true });
  }

  const playerRoll = randomInt(1, 6);
  const botRoll = randomInt(1, 6);

  let multiplier = 0;
  let outcome = 'lose';
  if (playerRoll > botRoll) {
    multiplier = 3;
    outcome = 'win';
  } else if (playerRoll === botRoll) {
    multiplier = 1;
    outcome = 'draw';
  }

  const result = await economy.resolveBet(guildId, interaction.user.id, bet, multiplier);
  if (!result.ok) {
    return respond(interaction, { content: 'Bet failed, try again.', ephemeral: true });
  }

  const embed = gameEmbed('Dice', outcome === 'win' ? 0x57f287 : outcome === 'draw' ? 0xfee75c : 0xed4245)
    .addFields(
      { name: 'Bet', value: coins(bet), inline: true },
      { name: 'Your roll', value: String(playerRoll), inline: true },
      { name: 'Bot roll', value: String(botRoll), inline: true },
      {
        name: 'Outcome',
        value:
          outcome === 'win'
            ? 'Win'
            : outcome === 'draw'
              ? 'Draw'
              : 'Lose',
        inline: true
      },
      { name: 'Change', value: result.net >= 0 ? `+${coins(result.net)}` : `-${coins(Math.abs(result.net))}`, inline: true },
      { name: 'New balance', value: coins(result.user.coins), inline: false }
    );

  return respond(interaction, { embeds: [embed] });
}
