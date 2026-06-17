import { SlashCommandBuilder } from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond, randomInt, sleep } from './gameUtils.js';

const cooldowns = new CooldownManager();
const SYMBOLS = ['🍒', '🍋', '🍉', '⭐', '7️⃣'];

function spinReels() {
  return [
    SYMBOLS[randomInt(0, SYMBOLS.length - 1)],
    SYMBOLS[randomInt(0, SYMBOLS.length - 1)],
    SYMBOLS[randomInt(0, SYMBOLS.length - 1)]
  ];
}

function calcMultiplier([a, b, c]) {
  if (a === '7️⃣' && b === '7️⃣' && c === '7️⃣') return 15;
  if (a === b && b === c) return 6;
  if (a === b || b === c || a === c) return 2.5;
  return 0;
}

function lineView(reels) {
  return `│ ${reels[0]} │ ${reels[1]} │ ${reels[2]} │`;
}

export const slotCommand = new SlashCommandBuilder()
  .setName('slot')
  .setDescription('Classic slot machine with spinning reels.')
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1));

export async function handleSlot({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));
  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });

  const rem = cooldowns.check(guildId, interaction.user.id, 'slot');
  if (rem > 0) return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });

  const hasEnough = await economy.hasEnoughBalance(guildId, interaction.user.id, bet);
  if (!hasEnough) return respond(interaction, { content: 'Not enough balance for this bet.', ephemeral: true });

  const finalReels = spinReels();
  const multiplier = calcMultiplier(finalReels);
  const won = multiplier > 0;

  const spinFrames = [
    ['🎰', '🎰', '🎰'],
    [SYMBOLS[randomInt(0, 4)], '🎰', '🎰'],
    [SYMBOLS[randomInt(0, 4)], SYMBOLS[randomInt(0, 4)], '🎰'],
    finalReels
  ];

  for (let i = 0; i < spinFrames.length; i += 1) {
    const e = gameEmbed('Slot Machine')
      .setDescription(`Spinning reels...\n${lineView(spinFrames[i])}`)
      .addFields({ name: 'Bet', value: coins(bet), inline: true });
    if (i === 0) {
      await respond(interaction, { embeds: [e] });
    } else {
      await interaction.editReply({ embeds: [e] });
    }
    await sleep(150);
  }

  const result = await economy.resolveBet(guildId, interaction.user.id, bet, multiplier);
  if (!result.ok) return respond(interaction, { content: 'Bet failed, try again.', ephemeral: true });

  const embed = gameEmbed('Slot Machine', won ? 0x57f287 : 0xed4245)
    .setDescription(`Final reels:\n${lineView(finalReels)}`)
    .addFields(
      { name: 'Bet', value: coins(bet), inline: true },
      { name: 'Multiplier', value: `${multiplier}x`, inline: true },
      { name: 'Outcome', value: won ? 'Win' : 'Lose', inline: true },
      { name: 'Change', value: result.net >= 0 ? `+${coins(result.net)}` : `-${coins(Math.abs(result.net))}`, inline: true },
      { name: 'New balance', value: coins(result.user.coins), inline: false },
      { name: 'Payout rules', value: '7️⃣7️⃣7️⃣ = 15x | 3 of a kind = 6x | 2 of a kind = 2.5x', inline: false }
    );

  return interaction.editReply({ embeds: [embed] });
}
