export async function getBalance(economy, guildId, userId) {
  return economy.getBalance(guildId, userId);
}

export async function addBalance(economy, guildId, userId, amount) {
  return economy.addBalance(guildId, userId, amount);
}

export async function removeBalance(economy, guildId, userId, amount) {
  return economy.removeBalance(guildId, userId, amount);
}

export async function hasEnoughBalance(economy, guildId, userId, amount) {
  return economy.hasEnoughBalance(guildId, userId, amount);
}
