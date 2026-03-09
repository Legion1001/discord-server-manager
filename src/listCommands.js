import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.GUILD_ID;
if (!token || !guildId) throw new Error('Missing DISCORD_BOT_TOKEN or GUILD_ID');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  const cmds = await rest.get(Routes.applicationGuildCommands(client.user.id, guildId));
  console.log(`app=${client.user.tag} guild=${guildId} commands=${cmds.length}`);
  for (const c of cmds) console.log(`- ${c.name}`);
  await client.destroy();
  process.exit(0);
});

await client.login(token);
