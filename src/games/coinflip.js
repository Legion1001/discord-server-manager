import { SlashCommandBuilder } from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond, sleep } from './gameUtils.js';

const cooldowns = new CooldownManager();

export const coinflipCommand = new SlashCommandBuilder()
  .setName('coinflip')
  .setDescription('Coinflip against bot.')
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1))
  .addStringOption((o) =>
    o
      .setName('strana')
      .setDescription('heads or tails')
      .setRequired(true)
      .addChoices(
        { name: 'heads', value: 'heads' },
        { name: 'tails', value: 'tails' }
      )
  );

export async function handleCoinflip({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));
  const side = interaction.options.getString('strana', true);
  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });

  const rem = cooldowns.check(guildId, interaction.user.id, 'coinflip');
  if (rem > 0) {
    return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });
  }

  const balanceCheck = await economy.hasEnoughBalance(guildId, interaction.user.id, bet);
  if (!balanceCheck) {
    return respond(interaction, { content: 'Not enough balance for this bet.', ephemeral: true });
  }

  await respond(interaction, {
    embeds: [gameEmbed('Coinflip').setDescription('Flipping the coin...')]
  });
  await sleep(700);

  const roll = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = roll === side;
  const result = await economy.resolveBet(guildId, interaction.user.id, bet, won ? 3 : 0);
  if (!result.ok) {
    return respond(interaction, { content: 'Bet failed, try again.', ephemeral: true });
  }

  const embed = gameEmbed('Coinflip', won ? 0x57f287 : 0xed4245)
    .addFields(
      { name: 'Bet', value: coins(bet), inline: true },
      { name: 'Your side', value: side, inline: true },
      { name: 'Result', value: roll, inline: true },
      { name: 'Outcome', value: won ? 'Win' : 'Lose', inline: true },
      { name: 'Change', value: result.net >= 0 ? `+${coins(result.net)}` : `-${coins(Math.abs(result.net))}`, inline: true },
      { name: 'New balance', value: coins(result.user.coins), inline: false }
    );

  return respond(interaction, { embeds: [embed] });
}
