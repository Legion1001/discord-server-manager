import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  await client.guilds.fetch();
  for (const [id, g] of client.guilds.cache) {
    console.log(`${g.name} :: ${id}`);
  }
  await client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
