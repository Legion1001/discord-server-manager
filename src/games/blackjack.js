import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { CooldownManager, coins, ensurePositiveBet, fmtCooldown, gameEmbed, respond, sleep } from './gameUtils.js';

const cooldowns = new CooldownManager();
const games = new Map();
const GAME_TIMEOUT_MS = 2 * 60 * 1000;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function drawCard() {
  return RANKS[Math.floor(Math.random() * RANKS.length)];
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(c)) {
      total += 10;
    } else {
      total += Number(c);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function renderHand(hand) {
  return `${hand.join(' ')} (${handValue(hand)})`;
}

function renderDealerHidden(dealer) {
  return `${dealer[0]} 🂠`;
}

function controls(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj:hit:${gameId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj:stand:${gameId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function noControls() {
  return [];
}

export const blackjackCommand = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Blackjack against bot.')
  .addIntegerOption((o) => o.setName('suma').setDescription('Bet amount').setRequired(true).setMinValue(1));

async function settleGame(economy, game, outcome) {
  const { guildId, userId, bet } = game;

  if (outcome === 'win') {
    await economy.creditWinnings(guildId, userId, bet * 5);
  } else if (outcome === 'push') {
    await economy.refundBet(guildId, userId, bet);
  }

  const balance = await economy.getBalance(guildId, userId);
  const net = outcome === 'win' ? bet * 4 : outcome === 'push' ? 0 : -bet;
  return { coins: balance.coins, net };
}

async function animateInitialDeal(interaction, bet, player, dealer) {
  const stages = [
    {
      text: 'Shuffling deck... 🃏',
      your: '🂠',
      dealerHand: '🂠 🂠'
    },
    {
      text: 'Dealing cards... 🃏',
      your: `${player[0]}`,
      dealerHand: '🂠 🂠'
    },
    {
      text: 'Dealing cards... 🃏',
      your: `${player[0]} ${player[1]}`,
      dealerHand: '🂠 🂠'
    },
    {
      text: 'Dealer takes card... 🃏',
      your: `${player[0]} ${player[1]}`,
      dealerHand: renderDealerHidden(dealer)
    }
  ];

  for (let i = 0; i < stages.length; i += 1) {
    const s = stages[i];
    const embed = gameEmbed('Blackjack')
      .setDescription(s.text)
      .addFields(
        { name: 'Bet', value: coins(bet), inline: true },
        { name: 'Your hand', value: s.your, inline: false },
        { name: 'Dealer hand', value: s.dealerHand, inline: false }
      );
    if (i === 0) {
      await respond(interaction, { embeds: [embed], components: noControls() });
    } else {
      await interaction.editReply({ embeds: [embed], components: noControls() });
    }
    await sleep(260);
  }
}

export async function handleBlackjack({ interaction, economy }) {
  const guildId = interaction.guildId;
  if (!guildId) return respond(interaction, { content: 'Guild only command.', ephemeral: true });

  const bet = ensurePositiveBet(interaction.options.getInteger('suma', true));
  if (!bet) return respond(interaction, { content: 'Invalid bet amount.', ephemeral: true });

  const rem = cooldowns.check(guildId, interaction.user.id, 'blackjack');
  if (rem > 0) return respond(interaction, { content: `Cooldown active: ${fmtCooldown(rem)}`, ephemeral: true });

  const reserve = await economy.reserveBet(guildId, interaction.user.id, bet);
  if (!reserve.ok) {
    return respond(interaction, { content: 'Not enough balance for this bet.', ephemeral: true });
  }

  const player = [drawCard(), drawCard()];
  const dealer = [drawCard(), drawCard()];
  const gameId = `${interaction.id}`;
  const createdAt = Date.now();

  const game = {
    gameId,
    guildId,
    userId: interaction.user.id,
    bet,
    player,
    dealer,
    status: 'active',
    createdAt
  };
  games.set(gameId, game);

  await animateInitialDeal(interaction, bet, player, dealer);

  const playerVal = handValue(player);
  const dealerVal = handValue(dealer);

  if (playerVal === 21 || dealerVal === 21) {
    let outcome = 'push';
    if (playerVal === 21 && dealerVal !== 21) outcome = 'win';
    if (dealerVal === 21 && playerVal !== 21) outcome = 'lose';

    const settle = await settleGame(economy, game, outcome);
    games.delete(gameId);

    const embed = gameEmbed('Blackjack', outcome === 'win' ? 0x57f287 : outcome === 'push' ? 0xfee75c : 0xed4245)
      .addFields(
        { name: 'Bet', value: coins(bet), inline: true },
        { name: 'Your hand', value: renderHand(player), inline: false },
        { name: 'Dealer hand', value: renderHand(dealer), inline: false },
        { name: 'Outcome', value: outcome.toUpperCase(), inline: true },
        { name: 'Change', value: settle.net >= 0 ? `+${coins(settle.net)}` : `-${coins(Math.abs(settle.net))}`, inline: true },
        { name: 'New balance', value: coins(settle.coins), inline: false }
      );

    return respond(interaction, { embeds: [embed] });
  }

  const embed = gameEmbed('Blackjack')
    .setDescription('Use buttons to play. Timeout: 2 minutes.')
    .addFields(
      { name: 'Bet', value: coins(bet), inline: true },
      { name: 'Your hand', value: renderHand(player), inline: false },
      { name: 'Dealer hand', value: renderDealerHidden(dealer), inline: false }
    );

  setTimeout(async () => {
    const current = games.get(gameId);
    if (!current || current.status !== 'active') return;
    current.status = 'timeout';
    games.delete(gameId);
    await economy.refundBet(guildId, interaction.user.id, bet);
  }, GAME_TIMEOUT_MS);

  await interaction.editReply({ embeds: [embed], components: controls(gameId) });
  return true;
}

export async function handleBlackjackButton({ interaction, economy }) {
  const [prefix, action, gameId] = interaction.customId.split(':');
  if (prefix !== 'bj') return false;

  const game = games.get(gameId);
  if (!game || game.status !== 'active') {
    await respond(interaction, { content: 'This blackjack game is no longer active.', ephemeral: true });
    return true;
  }

  if (interaction.user.id !== game.userId) {
    await respond(interaction, { content: 'This is not your blackjack game.', ephemeral: true });
    return true;
  }

  const player = game.player;
  const dealer = game.dealer;

  if (action === 'hit') {
    await interaction.deferUpdate();
    await interaction.editReply({
      embeds: [
        gameEmbed('Blackjack')
          .setDescription('Drawing your card... 🃏')
          .addFields(
            { name: 'Bet', value: coins(game.bet), inline: true },
            { name: 'Your hand', value: renderHand(player), inline: false },
            { name: 'Dealer hand', value: renderDealerHidden(dealer), inline: false }
          )
      ],
      components: noControls()
    });
    await sleep(260);
    player.push(drawCard());
    const v = handValue(player);
    if (v > 21) {
      game.status = 'finished';
      games.delete(gameId);
      const bal = await economy.getBalance(game.guildId, game.userId);

      const embed = gameEmbed('Blackjack', 0xed4245)
        .addFields(
          { name: 'Bet', value: coins(game.bet), inline: true },
          { name: 'Your hand', value: renderHand(player), inline: false },
          { name: 'Dealer hand', value: renderHand(dealer), inline: false },
          { name: 'Outcome', value: 'BUST - You lose', inline: false },
          { name: 'Change', value: `-${coins(game.bet)}`, inline: true },
          { name: 'New balance', value: coins(bal.coins), inline: false }
        );

      await interaction.editReply({ embeds: [embed], components: noControls() });
      return true;
    }

    const embed = gameEmbed('Blackjack')
      .addFields(
        { name: 'Bet', value: coins(game.bet), inline: true },
        { name: 'Your hand', value: renderHand(player), inline: false },
        { name: 'Dealer hand', value: renderDealerHidden(dealer), inline: false }
      );

    await interaction.editReply({ embeds: [embed], components: controls(gameId) });
    return true;
  }

  if (action === 'stand') {
    await interaction.deferUpdate();
    await interaction.editReply({
      embeds: [
        gameEmbed('Blackjack')
          .setDescription('Dealer turn... revealing cards 🃏')
          .addFields(
            { name: 'Bet', value: coins(game.bet), inline: true },
            { name: 'Your hand', value: renderHand(player), inline: false },
            { name: 'Dealer hand', value: renderHand(dealer), inline: false }
          )
      ],
      components: noControls()
    });
    await sleep(260);

    while (handValue(dealer) < 17) {
      dealer.push(drawCard());
      await interaction.editReply({
        embeds: [
          gameEmbed('Blackjack')
            .setDescription('Dealer draws... 🃏')
            .addFields(
              { name: 'Bet', value: coins(game.bet), inline: true },
              { name: 'Your hand', value: renderHand(player), inline: false },
              { name: 'Dealer hand', value: renderHand(dealer), inline: false }
            )
        ],
        components: noControls()
      });
      await sleep(260);
    }

    const p = handValue(player);
    const d = handValue(dealer);

    let outcome = 'lose';
    if (d > 21 || p > d) outcome = 'win';
    if (p === d) outcome = 'push';

    game.status = 'finished';
    games.delete(gameId);
    const settle = await settleGame(economy, game, outcome);

    const embed = gameEmbed('Blackjack', outcome === 'win' ? 0x57f287 : outcome === 'push' ? 0xfee75c : 0xed4245)
      .addFields(
        { name: 'Bet', value: coins(game.bet), inline: true },
        { name: 'Your hand', value: renderHand(player), inline: false },
        { name: 'Dealer hand', value: renderHand(dealer), inline: false },
        { name: 'Outcome', value: outcome.toUpperCase(), inline: true },
        { name: 'Change', value: settle.net >= 0 ? `+${coins(settle.net)}` : `-${coins(Math.abs(settle.net))}`, inline: true },
        { name: 'New balance', value: coins(settle.coins), inline: false }
      );

    await interaction.editReply({ embeds: [embed], components: noControls() });
    return true;
  }

  await respond(interaction, { content: 'Unknown blackjack action.', ephemeral: true });
  return true;
}
