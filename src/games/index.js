import { coinflipCommand, handleCoinflip } from './coinflip.js';
import { diceCommand, handleDice } from './dice.js';
import { blackjackCommand, handleBlackjack, handleBlackjackButton } from './blackjack.js';
import { rouletteCommand, handleRoulette } from './roulette.js';
import { rpsCommand, handleRps, handleRpsButton } from './rps.js';
import { chickenCommand, handleChicken } from './chicken.js';

export const gameCommandBuilders = [
  coinflipCommand,
  diceCommand,
  blackjackCommand,
  rouletteCommand,
  rpsCommand,
  chickenCommand
];

export async function handleGameCommand({ interaction, economy }) {
  if (interaction.commandName === 'coinflip') return handleCoinflip({ interaction, economy });
  if (interaction.commandName === 'dice') return handleDice({ interaction, economy });
  if (interaction.commandName === 'blackjack') return handleBlackjack({ interaction, economy });
  if (interaction.commandName === 'roulette') return handleRoulette({ interaction, economy });
  if (interaction.commandName === 'rps') return handleRps({ interaction, economy });
  if (interaction.commandName === 'chicken') return handleChicken({ interaction, economy });
  return false;
}

export async function handleGameButton({ interaction, economy }) {
  if (!interaction.isButton()) return false;
  if (interaction.customId.startsWith('bj:')) {
    return handleBlackjackButton({ interaction, economy });
  }
  if (interaction.customId.startsWith('rps:')) {
    return handleRpsButton({ interaction, economy });
  }
  return false;
}
