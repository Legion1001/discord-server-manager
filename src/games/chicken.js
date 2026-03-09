import { SlashCommandBuilder } from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond } from './gameUtils.js';

const cooldowns = new CooldownManager();
const WIN_CHANCE_PERCENT = 50;

export const chickenCommand = new SlashCommandBuilder()
  .setName('chicken')
  .setDescription('Fight a deadly chicken. Win pays 3x.')
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1));

export async function handleChicken({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));
  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });

  const rem = cooldowns.check(guildId, interaction.user.id, 'chicken');
  if (rem > 0) return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });

  const hasEnough = await economy.hasEnoughBalance(guildId, interaction.user.id, bet);
  if (!hasEnough) return respond(interaction, { content: 'Not enough balance for this bet.', ephemeral: true });

  const roll = Math.random() * 100;
  const won = roll < WIN_CHANCE_PERCENT;

  const result = await economy.resolveBet(guildId, interaction.user.id, bet, won ? 3 : 0);
  if (!result.ok) return respond(interaction, { content: 'Bet failed, try again.', ephemeral: true });

  const embed = gameEmbed('Chicken Fight', won ? 0x57f287 : 0xed4245)
    .setDescription(won ? 'You killed the chicken.' : 'The chicken killed you.')
    .addFields(
      { name: 'Bet', value: coins(bet), inline: true },
      { name: 'Win chance', value: `${WIN_CHANCE_PERCENT}%`, inline: true },
      { name: 'Outcome', value: won ? 'Win' : 'Lose', inline: true },
      { name: 'Change', value: result.net >= 0 ? `+${coins(result.net)}` : `-${coins(Math.abs(result.net))}`, inline: true },
      { name: 'New balance', value: coins(result.user.coins), inline: false }
    );

  return respond(interaction, { embeds: [embed] });
}
