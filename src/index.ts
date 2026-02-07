import { config } from './utils/config';
import { createClient } from './bot/client';
import { handleReady } from './bot/events/ready';
import { handleInteractionCreate } from './bot/events/interactionCreate';
import { disconnectPrisma } from './db/client';

async function main() {
  console.log('Starting Domination Revival bot...');

  if (!config.discordToken) {
    console.error('DISCORD_TOKEN is not set. Please set it in .env');
    process.exit(1);
  }

  const client = createClient();

  // Register event handlers
  client.once('ready', () => handleReady(client));
  client.on('interactionCreate', handleInteractionCreate);

  // Login
  await client.login(config.discordToken);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    client.destroy();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
