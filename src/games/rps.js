import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond } from './gameUtils.js';

const cooldowns = new CooldownManager();
const games = new Map();
const REQUEST_TIMEOUT_MS = 60 * 1000;
const PICK_TIMEOUT_MS = 90 * 1000;

function acceptRow(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rps:accept:${gameId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rps:decline:${gameId}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
    )
  ];
}

function choiceRow(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rps:choose:${gameId}:rock`).setLabel('Rock').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:choose:${gameId}:paper`).setLabel('Paper').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rps:choose:${gameId}:scissors`).setLabel('Scissors').setStyle(ButtonStyle.Primary)
    )
  ];
}

function winnerOf(a, b) {
  if (a === b) return 'draw';
  if (
    (a === 'rock' && b === 'scissors') ||
    (a === 'paper' && b === 'rock') ||
    (a === 'scissors' && b === 'paper')
  ) {
    return 'a';
  }
  return 'b';
}

export const rpsCommand = new SlashCommandBuilder()
  .setName('rps')
  .setDescription('Rock Paper Scissors against another player.')
  .addUserOption((o) => o.setName('user').setDescription('Opponent').setRequired(true))
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1));

export async function handleRps({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const challenger = interaction.user;
  const opponent = interaction.options.getUser('user', true);
  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));

  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });
  if (opponent.id === challenger.id) return respond(interaction, { content: 'Cannot challenge yourself.', ephemeral: true });
  if (opponent.bot) return respond(interaction, { content: 'Cannot challenge bot.', ephemeral: true });

  const rem = cooldowns.check(guildId, challenger.id, 'rps');
  if (rem > 0) return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });

  const reserve = await economy.reserveDuel(guildId, challenger.id, opponent.id, bet);
  if (!reserve.ok) {
    if (reserve.reason === 'a_not_enough') {
      return respond(interaction, { content: 'You do not have enough coins.', ephemeral: true });
    }
    if (reserve.reason === 'b_not_enough') {
      return respond(interaction, { content: `${opponent} does not have enough coins.`, ephemeral: true });
    }
    return respond(interaction, { content: 'Could not reserve bet.', ephemeral: true });
  }

  const gameId = interaction.id;
  const game = {
    gameId,
    guildId,
    challengerId: challenger.id,
    opponentId: opponent.id,
    bet,
    status: 'pending',
    picks: {}
  };
  games.set(gameId, game);

  setTimeout(async () => {
    const current = games.get(gameId);
    if (!current || current.status !== 'pending') return;
    current.status = 'cancelled';
    games.delete(gameId);
    await economy.refundDuel(guildId, challenger.id, opponent.id, bet);
  }, REQUEST_TIMEOUT_MS);

  const embed = gameEmbed('RPS Challenge')
    .setDescription(`${challenger} challenged ${opponent} for ${coins(bet)} each.`)
    .addFields(
      { name: 'Stake', value: `${coins(bet)} per player`, inline: true },
      { name: 'Pot', value: coins(bet * 2), inline: true },
      { name: 'Action', value: `${opponent}, accept or decline within 60s.`, inline: false }
    );

  return respond(interaction, { embeds: [embed], components: acceptRow(gameId) });
}

export async function handleRpsButton({ interaction, economy }) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'rps') return false;

  const action = parts[1];
  const gameId = parts[2];
  const extra = parts[3];

  const game = games.get(gameId);
  if (!game) {
    await respond(interaction, { content: 'This RPS game no longer exists.', ephemeral: true });
    return true;
  }

  const userId = interaction.user.id;

  if (action === 'accept' || action === 'decline') {
    if (userId !== game.opponentId) {
      await respond(interaction, { content: 'Only challenged user can do that.', ephemeral: true });
      return true;
    }
    if (game.status !== 'pending') {
      await respond(interaction, { content: 'Game is no longer in pending state.', ephemeral: true });
      return true;
    }

    if (action === 'decline') {
      game.status = 'declined';
      games.delete(gameId);
      await economy.refundDuel(game.guildId, game.challengerId, game.opponentId, game.bet);
      const embed = gameEmbed('RPS', 0xed4245)
        .setDescription('Challenge declined. Stake refunded to both players.');
      await interaction.update({ embeds: [embed], components: [] });
      return true;
    }

    game.status = 'choosing';
    setTimeout(async () => {
      const current = games.get(gameId);
      if (!current || current.status !== 'choosing') return;
      games.delete(gameId);
      await economy.refundDuel(current.guildId, current.challengerId, current.opponentId, current.bet);
    }, PICK_TIMEOUT_MS);

    const embed = gameEmbed('RPS - Choose')
      .setDescription('Both players must pick Rock/Paper/Scissors within 90s.')
      .addFields(
        { name: 'Players', value: `<@${game.challengerId}> vs <@${game.opponentId}>`, inline: false },
        { name: 'Stake', value: `${coins(game.bet)} each`, inline: true },
        { name: 'Pot', value: coins(game.bet * 2), inline: true }
      );

    await interaction.update({ embeds: [embed], components: choiceRow(gameId) });
    return true;
  }

  if (action === 'choose') {
    if (game.status !== 'choosing') {
      await respond(interaction, { content: 'Game is not accepting choices now.', ephemeral: true });
      return true;
    }
    if (userId !== game.challengerId && userId !== game.opponentId) {
      await respond(interaction, { content: 'You are not part of this game.', ephemeral: true });
      return true;
    }

    game.picks[userId] = extra;

    const hasA = Boolean(game.picks[game.challengerId]);
    const hasB = Boolean(game.picks[game.opponentId]);

    if (!hasA || !hasB) {
      await respond(interaction, { content: 'Pick saved. Waiting for other player.', ephemeral: true });
      return true;
    }

    const aPick = game.picks[game.challengerId];
    const bPick = game.picks[game.opponentId];
    const win = winnerOf(aPick, bPick);
    game.status = 'finished';
    games.delete(gameId);

    let desc;
    let color = 0xfee75c;

    if (win === 'draw') {
      await economy.refundDuel(game.guildId, game.challengerId, game.opponentId, game.bet);
      desc = `Draw. Both players get ${coins(game.bet)} back.`;
      desc += `\nChange: +${coins(0)} each`;
    } else if (win === 'a') {
      await economy.resolveDuelWinner(game.guildId, game.challengerId, game.bet);
      desc = `<@${game.challengerId}> wins ${coins(game.bet * 3)}.`;
      desc += `\n<@${game.challengerId}>: +${coins(game.bet * 2)} | <@${game.opponentId}>: -${coins(game.bet)}`;
      color = 0x57f287;
    } else {
      await economy.resolveDuelWinner(game.guildId, game.opponentId, game.bet);
      desc = `<@${game.opponentId}> wins ${coins(game.bet * 3)}.`;
      desc += `\n<@${game.opponentId}>: +${coins(game.bet * 2)} | <@${game.challengerId}>: -${coins(game.bet)}`;
      color = 0x57f287;
    }

    const aBal = await economy.getBalance(game.guildId, game.challengerId);
    const bBal = await economy.getBalance(game.guildId, game.opponentId);

    const embed = gameEmbed('RPS Result', color)
      .setDescription(desc)
      .addFields(
        { name: `<@${game.challengerId}>`, value: `${aPick} | ${coins(aBal.coins)}`, inline: true },
        { name: `<@${game.opponentId}>`, value: `${bPick} | ${coins(bBal.coins)}`, inline: true },
        { name: 'Stake', value: `${coins(game.bet)} each`, inline: false }
      );

    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  await respond(interaction, { content: 'Unknown RPS action.', ephemeral: true });
  return true;
}
